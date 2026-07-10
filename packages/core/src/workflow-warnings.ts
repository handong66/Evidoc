import { readFile } from "node:fs/promises";
import { resolveExistingPathInsideRoot } from "./path-safety.js";

export interface WorkflowLocalActionDefinition {
  path: string;
  text: string;
}

export interface EvidocWorkflowTextDetection {
  matches: boolean;
  localActions: WorkflowLocalActionDefinition[];
}

export type WorkflowLocalActionReader = (repoRelativeActionPath: string) => Promise<WorkflowLocalActionDefinition | undefined>;

const DEFAULT_MAX_LOCAL_ACTION_DEPTH = 5;

export function isEvidocWorkflowText(text: string): boolean {
  return workflowUsesPackagedEvidocAction(text) || workflowRunsEvidocCli(text);
}

export async function detectEvidocWorkflowText(
  text: string,
  readLocalAction: WorkflowLocalActionReader,
  options: { maxLocalActionDepth?: number } = {}
): Promise<EvidocWorkflowTextDetection> {
  const localActions: WorkflowLocalActionDefinition[] = [];
  const seenActionPaths = new Set<string>();
  const direct = isEvidocWorkflowText(text);
  const maxDepth = options.maxLocalActionDepth ?? DEFAULT_MAX_LOCAL_ACTION_DEPTH;

  async function visitLocalActions(currentText: string, depth: number): Promise<boolean> {
    if (depth >= maxDepth) return false;

    let matched = false;
    for (const actionPath of workflowLocalActionPaths(currentText)) {
      if (seenActionPaths.has(actionPath)) continue;
      seenActionPaths.add(actionPath);

      const action = await readLocalAction(actionPath);
      if (!action) continue;

      if (isEvidocWorkflowText(action.text)) {
        localActions.push(action);
        matched = true;
      }

      if (await visitLocalActions(action.text, depth + 1)) {
        matched = true;
      }
    }

    return matched;
  }

  const indirect = await visitLocalActions(text, 0);
  return { matches: direct || indirect, localActions };
}

export async function detectRepositoryEvidocWorkflowText(
  root: string,
  text: string,
  options: { maxLocalActionDepth?: number } = {}
): Promise<EvidocWorkflowTextDetection> {
  return detectEvidocWorkflowText(text, (actionPath) => readRepositoryLocalActionDefinition(root, actionPath), options);
}

async function readRepositoryLocalActionDefinition(
  root: string,
  actionPath: string
): Promise<WorkflowLocalActionDefinition | undefined> {
  for (const candidate of [`${actionPath}/action.yml`, `${actionPath}/action.yaml`]) {
    const target = await resolveExistingPathInsideRoot(root, candidate);
    if (!target) continue;

    try {
      return { path: candidate, text: await readFile(target, "utf8") };
    } catch {
      continue;
    }
  }

  return undefined;
}

export function workflowLocalActionPaths(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const value of workflowStepUsesValues(text)) {
    const actionPath = workflowLocalActionPathFromValue(value);
    if (!actionPath || seen.has(actionPath)) continue;
    seen.add(actionPath);
    paths.push(actionPath);
  }

  return paths;
}

function workflowStepUsesValues(text: string): string[] {
  const values: string[] = [];
  let blockScalarIndent: number | undefined;
  let stepsIndent: number | undefined;
  let stepItemIndent: number | undefined;

  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const indent = leadingSpaces(line);
    if (blockScalarIndent !== undefined) {
      if (!line.trim()) continue;
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = undefined;
    }

    if (stepsIndent !== undefined && line.trim() && indent <= stepsIndent) {
      stepsIndent = undefined;
      stepItemIndent = undefined;
    }

    if (lineStartsStepsBlock(line)) {
      stepsIndent = indent;
      stepItemIndent = undefined;
      continue;
    }

    if (lineStartsYamlBlockScalar(line)) {
      blockScalarIndent = indent;
      continue;
    }

    if (stepsIndent === undefined) continue;
    if (/^-\s+/.test(line.trim())) stepItemIndent = indent;
    if (stepItemIndent === undefined || indent < stepItemIndent) continue;

    const value = workflowUsesValue(line);
    if (value) values.push(value);
  }

  return values;
}

function lineStartsStepsBlock(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  const withoutListMarker = trimmed.replace(/^-\s+/, "");
  return /^steps\s*:\s*(?:#.*)?$/.test(withoutListMarker);
}

function lineStartsYamlBlockScalar(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  const withoutListMarker = trimmed.replace(/^-\s+/, "");
  return /^[^:#]+:\s*[>|][+-]?\s*(?:#.*)?$/.test(withoutListMarker);
}

export function evidocWorkflowWarnings(path: string, text: string, defaultBranch: string | undefined): string[] {
  const warnings: string[] = [];
  if (workflowHasPullRequestAndUnfilteredPush(text)) {
    warnings.push(
      `${path} uses pull_request plus unfiltered push triggers; add push.branches for default branches to avoid duplicate push and pull-request checks on same-repository PR branches.`
    );
  }

  const pushBranches = workflowPushBranches(text);
  if (defaultBranch && pushBranches && !pushBranches.includes(defaultBranch)) {
    warnings.push(
      `${path} push.branches does not include detected default branch ${defaultBranch}; add it so default-branch pushes run Evidoc full scans.`
    );
  }

  if (workflowSupportsPrCommentInput(text) && !workflowEnablesPrComments(text)) {
    warnings.push(
      `${path} PR comments are disabled; set pr-comment: "true" so pull requests show the repair plan, safe-fix commands, and agent prompt.`
    );
  }

  if (workflowGrantsSecurityEvents(text) && !workflowEnablesSarif(text)) {
    warnings.push(
      `${path} grants security-events: write, but security-events: write is only needed when sarif: "true"; remove it for the default low-permission workflow.`
    );
  }

  if (workflowUsesAdvisoryFailOn(text)) {
    warnings.push(
      `${path} uses fail-on: broken, but fail-on: broken is advisory for review-needed drift; set fail-on: review_needed so documentation and agent-instruction drift blocks CI.`
    );
  }

  return warnings;
}

function workflowUsesPackagedEvidocAction(text: string): boolean {
  return workflowStepUsesValues(text).some((action) =>
    /(?:^|\/)(?:Evidoc|DriftGuard)\/packages\/github-action(?:@|$)/i.test(action)
  );
}

function workflowLocalActionPathFromValue(value: string): string | undefined {
  if (!value.startsWith("./") || value.includes("@")) return undefined;

  return normalizeLocalActionPath(value.slice(2));
}

function workflowUsesValue(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;

  const withoutListMarker = trimmed.replace(/^-\s+/, "");
  const match = withoutListMarker.match(/^uses\s*:\s*(.+)$/);
  if (!match) return undefined;

  return stripTokenQuotes(stripInlineYamlComment(match[1]).trim());
}

function normalizeLocalActionPath(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.includes("\n") ||
    normalized.includes("\r") ||
    normalized.startsWith("/") ||
    normalized.includes(":")
  ) {
    return undefined;
  }

  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    return undefined;
  }

  return normalized;
}

function stripInlineYamlComment(value: string): string {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (char === "#" && !quote && /\s/.test(value[index - 1] ?? " ")) {
      return value.slice(0, index);
    }
  }

  return value;
}

function workflowRunsEvidocCli(text: string): boolean {
  return workflowCommandSegments(text).some((command) => isEvidocCommand(command));
}

function workflowSupportsPrCommentInput(text: string): boolean {
  return workflowUsesPackagedEvidocAction(text);
}

function workflowEnablesPrComments(text: string): boolean {
  return /^\s*pr-comment\s*:\s*["']?true["']?\s*(?:#.*)?$/im.test(text);
}

function workflowEnablesSarif(text: string): boolean {
  return /^\s*sarif\s*:\s*["']?true["']?\s*(?:#.*)?$/im.test(text);
}

function workflowGrantsSecurityEvents(text: string): boolean {
  return /^\s*security-events\s*:\s*write\s*(?:#.*)?$/im.test(text);
}

function workflowUsesAdvisoryFailOn(text: string): boolean {
  return (
    /^\s*fail-on\s*:\s*["']?broken["']?\s*(?:#.*)?$/im.test(text) ||
    workflowCommandSegments(text).some(
      (command) => isEvidocCommand(command) && commandUsesAdvisoryFailOn(command)
    )
  );
}

function isEvidocCommand(command: string): boolean {
  const tokens = command
    .replace(/\s+#.*$/, "")
    .replace(/\\\s*$/, "")
    .split(/\s+/)
    .map(stripTokenQuotes)
    .filter((token) => token.length > 0 && token !== "\\");
  if (tokens.length === 0) return false;

  const subcommandIndex = commandNameIndexAfterOptions(tokens, 1);
  const subcommand = subcommandIndex === undefined ? undefined : tokens[subcommandIndex];
  const subcommandArgsIndex = subcommandIndex === undefined ? 1 : subcommandIndex + 1;

  if (tokens[0] === "npm" && subcommand === "run") {
    return scriptNameAfterOptions(tokens, subcommandArgsIndex) === "evidoc";
  }

  if (tokens[0] === "npx") return hasEvidocPackageToken(tokens);
  if (tokens[0] === "pnpm") {
    if (subcommand === "run") return scriptNameAfterOptions(tokens, subcommandArgsIndex) === "evidoc";
    if (subcommand === "evidoc") return true;
    if (subcommand === "exec") {
      return (
        commandNameAfterOptions(tokens, subcommandArgsIndex) === "evidoc" ||
        hasEvidocPackageToken(tokens)
      );
    }
    if (subcommand === "dlx") return hasEvidocPackageToken(tokens);
  }
  if (tokens[0] === "yarn") {
    if (subcommand === "run") return scriptNameAfterOptions(tokens, subcommandArgsIndex) === "evidoc";
    if (subcommand === "exec") {
      return (
        commandNameAfterOptions(tokens, subcommandArgsIndex) === "evidoc" ||
        hasEvidocPackageToken(tokens)
      );
    }
    return hasEvidocPackageToken(tokens) || subcommand === "evidoc";
  }
  if (tokens[0] === "bun") {
    return subcommand === "run" && scriptNameAfterOptions(tokens, subcommandArgsIndex) === "evidoc";
  }
  if (tokens[0] === "bunx") return hasEvidocPackageToken(tokens);
  if (tokens[0] === "evidoc") return true;
  return false;
}

function hasEvidocPackageToken(tokens: string[]): boolean {
  return tokens.includes("evidoc") || tokens.includes("evidoc");
}

function commandUsesAdvisoryFailOn(command: string): boolean {
  const tokens = command
    .replace(/\s+#.*$/, "")
    .split(/\s+/)
    .map(stripTokenQuotes)
    .filter((token) => token.length > 0 && token !== "\\");

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("--fail-on=")) {
      return stripTokenQuotes(token.slice("--fail-on=".length)) === "broken";
    }
    if (token === "--fail-on") {
      return stripTokenQuotes(tokens[index + 1] ?? "") === "broken";
    }
  }

  return false;
}

function scriptNameAfterOptions(tokens: string[], startIndex: number): string | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") return undefined;
    if (!token.startsWith("-")) return token;
    if (!token.includes("=") && PACKAGE_MANAGER_VALUE_OPTIONS.has(token)) index += 1;
  }

  return undefined;
}

function commandNameAfterOptions(tokens: string[], startIndex: number): string | undefined {
  const index = commandNameIndexAfterOptions(tokens, startIndex);
  return index === undefined ? undefined : tokens[index];
}

function commandNameIndexAfterOptions(tokens: string[], startIndex: number): number | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") return undefined;
    if (!token.startsWith("-")) return index;
    if (!token.includes("=") && PACKAGE_MANAGER_VALUE_OPTIONS.has(token)) index += 1;
  }

  return undefined;
}

const PACKAGE_MANAGER_VALUE_OPTIONS = new Set(["--prefix", "--workspace", "-w", "--filter", "-F", "--cwd"]);

function stripTokenQuotes(token: string): string {
  return token.replace(/^["']|["']$/g, "");
}

function workflowCommandSegments(text: string): string[] {
  const segments: string[] = [];
  let continued: string | undefined;

  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const command = workflowCommandLine(line)?.trim();
    if (!command || isYamlBlockMarker(command)) continue;

    const continues = /\\\s*$/.test(command);
    const withoutContinuation = command.replace(/\\\s*$/, "").trim();

    if (continued) {
      continued = `${continued} ${withoutContinuation}`.trim();
    } else {
      continued = withoutContinuation;
    }

    if (!continues) {
      segments.push(continued);
      continued = undefined;
    }
  }

  if (continued) segments.push(continued);
  return segments;
}

function isYamlBlockMarker(command: string): boolean {
  return /^(?:[>|][+-]?)$/.test(command);
}

function workflowCommandLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const withoutListMarker = trimmed.replace(/^-\s+/, "");
  const runMatch = withoutListMarker.match(/^run\s*:\s*(.*)$/);
  if (runMatch) return runMatch[1];
  return withoutListMarker;
}

function workflowHasPullRequestAndUnfilteredPush(text: string): boolean {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const inlineTrigger = lines.find((line) => /^\s*on\s*:/.test(line));
  const inlineValue = inlineTrigger?.replace(/^\s*on\s*:\s*/, "").trim();
  if (inlineValue && inlineValue !== "") {
    const normalized = inlineValue.toLowerCase();
    return normalized.includes("pull_request") && /\bpush\b/.test(normalized);
  }

  const onIndex = lines.findIndex((line) => /^\s*on\s*:\s*(?:#.*)?$/.test(line));
  if (onIndex === -1) return false;

  const onIndent = leadingSpaces(lines[onIndex]);
  let hasPullRequest = false;
  let hasUnfilteredPush = false;

  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const indent = leadingSpaces(line);
    if (indent <= onIndent) break;
    if (indent !== onIndent + 2) continue;

    const trimmed = line.trim();
    if (/^-\s*pull_request\s*(?:#.*)?$/.test(trimmed)) {
      hasPullRequest = true;
      continue;
    }
    if (/^-\s*push\s*(?:#.*)?$/.test(trimmed)) {
      hasUnfilteredPush = true;
      continue;
    }
    if (/^pull_request\s*:/.test(trimmed)) {
      hasPullRequest = true;
      continue;
    }
    if (/^push\s*:/.test(trimmed)) {
      hasUnfilteredPush = !pushTriggerHasBranches(lines, index, indent);
    }
  }

  return hasPullRequest && hasUnfilteredPush;
}

function workflowPushBranches(text: string): string[] | undefined {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const onIndex = lines.findIndex((line) => /^\s*on\s*:\s*(?:#.*)?$/.test(line));
  if (onIndex === -1) return undefined;

  const onIndent = leadingSpaces(lines[onIndex]);
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const indent = leadingSpaces(line);
    if (indent <= onIndent) break;
    if (indent !== onIndent + 2) continue;
    if (/^push\s*:/.test(line.trim())) {
      return pushTriggerBranches(lines, index, indent);
    }
  }

  return undefined;
}

function pushTriggerBranches(lines: string[], pushIndex: number, pushIndent: number): string[] | undefined {
  const branches: string[] = [];
  let branchListIndent: number | undefined;

  for (let index = pushIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const indent = leadingSpaces(line);
    if (indent <= pushIndent) break;

    const trimmed = line.trim();
    if (branchListIndent === undefined) {
      const inlineBranches = trimmed.match(/^branches\s*:\s*\[(.*)]\s*(?:#.*)?$/);
      if (inlineBranches) return parseInlineBranchList(inlineBranches[1]);
      if (/^branches\s*:\s*(?:#.*)?$/.test(trimmed)) {
        branchListIndent = indent;
      }
      continue;
    }

    if (indent <= branchListIndent) break;
    const match = trimmed.match(/^-\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/);
    if (match) branches.push(match[1]);
  }

  return branchListIndent === undefined ? undefined : branches;
}

function pushTriggerHasBranches(lines: string[], pushIndex: number, pushIndent: number): boolean {
  for (let index = pushIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const indent = leadingSpaces(line);
    if (indent <= pushIndent) return false;
    if (/^branches\s*:/.test(line.trim())) return true;
  }

  return false;
}

function parseInlineBranchList(value: string): string[] | undefined {
  const branches = value
    .split(",")
    .map((branch) => branch.trim().replace(/^["']|["']$/g, ""))
    .filter((branch) => branch.length > 0);
  return branches.every((branch) => /^[^"'#\s]+$/.test(branch)) ? branches : undefined;
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}
