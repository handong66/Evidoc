import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import ts from "typescript";
import { parseDocumentFrontmatter } from "./frontmatter.js";
import { pathExists } from "./repository.js";
import type { DriftFinding, RepositorySnapshot } from "./types.js";

type DocumentedPackageManager = "npm" | "pnpm" | "yarn" | "bun" | "npx";

const PACKAGE_MANAGERS = new Set<DocumentedPackageManager>(["npm", "pnpm", "yarn", "bun", "npx"]);
const BUILTIN_PACKAGE_COMMANDS = new Set([
  "add",
  "ci",
  "create",
  "dlx",
  "exec",
  "i",
  "init",
  "install",
  "link",
  "pack",
  "publish",
  "remove",
  "uninstall",
  "view",
  "whoami",
  "x"
]);

export async function detectDrift(snapshot: RepositorySnapshot): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];

  findings.push(...(await detectAgentInstructionDrift(snapshot)));

  for (const doc of snapshot.documents) {
    findings.push(...detectDocumentedCommands(snapshot, doc.path, doc.text));
    if (doc.kind !== "agent_instruction") {
      findings.push(...(await detectMissingPaths(snapshot, doc.path, doc.text)));
    }
    findings.push(...detectApiDrift(snapshot, doc.path, doc.text));
    findings.push(...(await detectSymbolDrift(snapshot, doc.path, doc.text)));
    findings.push(...(await detectFrontmatterDrift(snapshot, doc.path, doc.text)));
    findings.push(...detectPackageClaims(snapshot, doc.path, doc.text));
    findings.push(...detectAdrDrift(snapshot, doc.path, doc.text));
  }

  return findings;
}

async function detectAgentInstructionDrift(snapshot: RepositorySnapshot): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];
  const agentDocs = snapshot.documents.filter((doc) => doc.kind === "agent_instruction");
  findings.push(...detectAgentInstructionPackageManagerDrift(snapshot, agentDocs));
  findings.push(...detectAgentInstructionContradictions(agentDocs));
  findings.push(...(await detectAgentInstructionMissingPaths(snapshot, agentDocs)));
  return findings;
}

function detectAgentInstructionPackageManagerDrift(
  snapshot: RepositorySnapshot,
  agentDocs: RepositorySnapshot["documents"]
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const packageManagers = new Map<string, Array<{ path: string; line: number }>>();

  for (const doc of agentDocs) {
    for (const [line, text] of lines(doc.text)) {
      const match = text.match(/\bpackageManager\s*:\s*(npm|pnpm|yarn|bun)\b/i);
      if (!match) continue;
      const manager = match[1].toLowerCase();
      const entries = packageManagers.get(manager) ?? [];
      entries.push({ path: doc.path, line });
      packageManagers.set(manager, entries);

      if (snapshot.expectedPackageManager && manager !== snapshot.expectedPackageManager) {
        const rawSubject = match[0];
        findings.push({
          id: findingId(doc.path, line, "agent_instruction.package-manager-mismatch", "packageManager"),
          ruleId: "agent_instruction.package-manager-mismatch",
          severity: "medium",
          status: "review_needed",
          docPath: doc.path,
          line,
          message: `${doc.path}:${line} declares ${manager}, but this repository is configured for ${snapshot.expectedPackageManager}.`,
          evidence: [
            {
              kind: "agent_instruction",
              subject: rawSubject,
              expected: snapshot.expectedPackageManager,
              actual: manager,
              detail: "Agent instruction package-manager field does not match package.json or lockfile evidence."
            }
          ],
          suggestedAction: `Update the agent instruction packageManager field to ${snapshot.expectedPackageManager}.`
        });
      }
    }
  }

  if (packageManagers.size <= 1) return findings;

  const actual = [...packageManagers.entries()]
    .map(([manager, entries]) => `${manager} in ${entries.map((entry) => entry.path).join(", ")}`)
    .join("; ");
  const first = [...packageManagers.values()][0][0];

  findings.push({
    id: findingId(first.path, first.line, "agent_instruction.conflict", "packageManager"),
    ruleId: "agent_instruction.conflict",
    severity: "high",
    status: "broken",
    docPath: first.path,
    line: first.line,
    message: "Agent instruction files declare conflicting package managers.",
    evidence: [
      {
        kind: "config",
        subject: "packageManager",
        expected: "one package manager across agent instruction files",
        actual,
        detail: "AGENTS.md and CLAUDE.md are agent-facing control surfaces and must not disagree."
      }
    ],
    suggestedAction: "Align agent instruction package-manager guidance with the repository package manager."
  });

  return findings;
}

function detectAgentInstructionContradictions(
  agentDocs: RepositorySnapshot["documents"]
): DriftFinding[] {
  const required = new Map<string, Array<{ path: string; line: number; text: string }>>();
  const forbidden = new Map<string, Array<{ path: string; line: number; text: string }>>();

  for (const doc of agentDocs) {
    for (const [line, text] of lines(doc.text)) {
      const must = text.match(/\b(?:always|must)\s+(?:use|run)\s+[`"']?([^`"'.\n]+)[`"']?/i);
      if (must) {
        const key = normalizeInstructionTarget(must[1]);
        const entries = required.get(key) ?? [];
        entries.push({ path: doc.path, line, text: text.trim() });
        required.set(key, entries);
      }

      const never = text.match(/\b(?:never|do not|don't)\s+(?:use|run)\s+[`"']?([^`"'.\n]+)[`"']?/i);
      if (never) {
        const key = normalizeInstructionTarget(never[1]);
        const entries = forbidden.get(key) ?? [];
        entries.push({ path: doc.path, line, text: text.trim() });
        forbidden.set(key, entries);
      }
    }
  }

  const findings: DriftFinding[] = [];
  for (const [target, requiredEntries] of required) {
    const forbiddenEntries = forbidden.get(target);
    if (!forbiddenEntries?.length) continue;
    const first = requiredEntries[0];
    findings.push({
      id: findingId(first.path, first.line, "agent_instruction.contradiction", target),
      ruleId: "agent_instruction.contradiction",
      severity: "high",
      status: "broken",
      docPath: first.path,
      line: first.line,
      message: `Agent instruction files both require and forbid "${target}".`,
      evidence: [
        {
          kind: "agent_instruction",
          subject: target,
          expected: `consistent instruction for ${target}`,
          actual: [
            ...requiredEntries.map((entry) => `${entry.path}:${entry.line} ${entry.text}`),
            ...forbiddenEntries.map((entry) => `${entry.path}:${entry.line} ${entry.text}`)
          ].join("; "),
          detail: "Agent-facing control files contain directly contradictory always/never guidance."
        }
      ],
      suggestedAction:
        "Choose one current instruction and update AGENTS.md, CLAUDE.md, Cursor, and Copilot guidance to match."
    });
  }

  return findings;
}

async function detectAgentInstructionMissingPaths(
  snapshot: RepositorySnapshot,
  agentDocs: RepositorySnapshot["documents"]
): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();

  for (const doc of agentDocs) {
    for (const reference of extractPathReferences(doc.text)) {
      const candidate = resolveDocumentReferencePath(doc.path, reference);
      if (!candidate || seen.has(`${doc.path}:${candidate}:${reference.line}`)) continue;
      seen.add(`${doc.path}:${candidate}:${reference.line}`);
      if (snapshot.files.has(candidate) || (await pathExists(snapshot.root, candidate))) continue;

      findings.push({
        id: findingId(doc.path, reference.line, "agent_instruction.missing-path", candidate),
        ruleId: "agent_instruction.missing-path",
        severity: "high",
        status: "broken",
        docPath: doc.path,
        line: reference.line,
        message: `${doc.path}:${reference.line} points agents at missing path ${candidate}.`,
        evidence: [
          {
            kind: "agent_instruction",
            subject: candidate,
            expected: "agent instruction file path exists",
            actual: "missing",
            detail:
              "Agent instruction files are executable guidance for coding agents; stale file pointers cause repeated wrong actions."
          }
        ],
        suggestedAction: "Update the agent instruction path, restore the file, or remove the stale instruction."
      });
    }
  }

  return findings;
}

function normalizeInstructionTarget(value: string): string {
  return value.replace(/[.;:]+$/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function detectDocumentedCommands(
  snapshot: RepositorySnapshot,
  docPath: string,
  text: string
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  const scripts = snapshot.packageManifest?.scripts ?? {};

  for (const command of extractDocumentedCommands(text)) {
    const key = `${command.manager}:${command.script}:${command.line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      snapshot.expectedPackageManager &&
      shouldCheckPackageManagerMismatch(command) &&
      !isPackageManagerCompatible(command.manager, snapshot.expectedPackageManager)
    ) {
      findings.push({
        id: findingId(docPath, command.line, "command.package-manager-mismatch", command.raw),
        ruleId: "command.package-manager-mismatch",
        severity: "medium",
        status: "review_needed",
        docPath,
        line: command.line,
        message: `${docPath}:${command.line} uses ${command.manager}, but this repository is configured for ${snapshot.expectedPackageManager}.`,
        evidence: [
          {
            kind: "command",
            subject: command.raw,
            expected: snapshot.expectedPackageManager,
            actual: command.manager,
            detail: "Documented package-manager command does not match package.json or lockfile evidence."
          }
        ],
        suggestedAction: `Review the command and update it to ${snapshot.expectedPackageManager} if the repository package manager has changed.`
      });
    }

    if (
      snapshot.packageManifest &&
      command.manager !== "npx" &&
      !BUILTIN_PACKAGE_COMMANDS.has(command.script) &&
      !Object.hasOwn(scripts, command.script)
    ) {
      findings.push({
        id: findingId(docPath, command.line, "command.unknown-script", command.raw),
        ruleId: "command.unknown-script",
        severity: "high",
        status: "broken",
        docPath,
        line: command.line,
        message: `${docPath}:${command.line} references script "${command.script}", but package.json does not define it.`,
        evidence: [
          {
            kind: "command",
            subject: command.raw,
            expected: `package.json scripts.${command.script}`,
            actual: "missing",
            detail: "Documented command names a package script that is absent from the manifest."
          }
        ],
        suggestedAction: "Update the documented command or add the missing package script if the command is still intended."
      });
    }
  }

  return findings;
}

async function detectMissingPaths(
  snapshot: RepositorySnapshot,
  docPath: string,
  text: string
): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();

  for (const reference of extractPathReferences(text)) {
    const candidate = resolveDocumentReferencePath(docPath, reference);
    if (!candidate || seen.has(`${candidate}:${reference.line}`)) continue;
    seen.add(`${candidate}:${reference.line}`);

    if (snapshot.files.has(candidate)) {
      continue;
    }

    if (!(await pathExists(snapshot.root, candidate))) {
      findings.push({
        id: findingId(docPath, reference.line, "path.missing-reference", candidate),
        ruleId: "path.missing-reference",
        severity: "high",
        status: "broken",
        docPath,
        line: reference.line,
        message: `${docPath}:${reference.line} references missing path ${candidate}.`,
        evidence: [
          {
            kind: "path",
            subject: candidate,
            expected: "path exists in repository",
            actual: "missing",
            detail: "Markdown contains a local repository path that could not be resolved."
          }
        ],
        suggestedAction: "Update the path reference, restore the file, or mark the example so Evidoc can ignore it."
      });
    }
  }

  return findings;
}

function detectApiDrift(
  snapshot: RepositorySnapshot,
  docPath: string,
  text: string
): DriftFinding[] {
  if (snapshot.apiOperations.length === 0) return [];

  const findings: DriftFinding[] = [];
  const known = new Set(
    snapshot.apiOperations.map((operation) => `${operation.method} ${operation.path}`)
  );
  const byOperation = new Map(
    snapshot.apiOperations.map((operation) => [`${operation.method} ${operation.path}`, operation])
  );
  const seen = new Set<string>();

  for (const reference of extractApiReferences(text)) {
    const key = `${reference.method} ${reference.path}`;
    if (seen.has(`${key}:${reference.line}`)) continue;
    seen.add(`${key}:${reference.line}`);
    if (known.has(key)) continue;

    findings.push({
      id: findingId(docPath, reference.line, "api.missing-operation", key),
      ruleId: "api.missing-operation",
      severity: "high",
      status: "broken",
      docPath,
      line: reference.line,
      message: `${docPath}:${reference.line} references ${key}, but no matching OpenAPI operation exists.`,
      evidence: [
        {
          kind: "api",
          subject: key,
          expected: "OpenAPI operation exists",
          actual: "missing",
          detail: "Documented HTTP operation could not be resolved against openapi.json/swagger.json."
        }
      ],
      suggestedAction:
        "Update the documented API operation, add it to the OpenAPI spec, or mark the example as intentionally external."
    });
  }

  for (const reference of extractApiSchemaReferences(text)) {
    const key = `${reference.method} ${reference.path}`;
    const operation = byOperation.get(key);
    if (!operation) continue;
    const requestMatches =
      !reference.requestSchema || operation.requestSchemas.includes(reference.requestSchema);
    const responseSchemas = Object.values(operation.responseSchemas).flat();
    const responseMatches =
      !reference.responseSchema || responseSchemas.includes(reference.responseSchema);
    if (requestMatches && responseMatches) continue;

    const subject = `${key} request:${reference.requestSchema ?? "*"} response:${reference.responseSchema ?? "*"}`;
    findings.push({
      id: findingId(docPath, reference.line, "api.schema-mismatch", subject),
      ruleId: "api.schema-mismatch",
      severity: "high",
      status: "broken",
      docPath,
      line: reference.line,
      message: `${docPath}:${reference.line} references ${key} ${
        requestMatches ? "response schema" : "request schema"
      } that does not match the OpenAPI operation.`,
      evidence: [
        {
          kind: "api",
          subject,
          expected: `request schemas ${operation.requestSchemas.join(", ") || "none"}; response schemas ${
            responseSchemas.join(", ") || "none"
          }`,
          actual: `request ${reference.requestSchema ?? "unspecified"}; response ${
            reference.responseSchema ?? "unspecified"
          }`,
          detail: "Documented request/response schema claim could not be resolved against the OpenAPI operation."
        }
      ],
      suggestedAction: "Update the documented schema names or the OpenAPI operation schema references."
    });
  }

  return findings;
}

async function detectSymbolDrift(
  snapshot: RepositorySnapshot,
  docPath: string,
  text: string
): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];

  for (const reference of extractSymbolReferences(text)) {
    if (!snapshot.files.has(reference.path)) continue;
    if (await fileHasSymbol(snapshot.root, reference.path, reference.symbol)) continue;

    findings.push({
      id: findingId(
        docPath,
        reference.line,
        "symbol.missing-reference",
        `${reference.path}#${reference.symbol}`
      ),
      ruleId: "symbol.missing-reference",
      severity: "high",
      status: "broken",
      docPath,
      line: reference.line,
      message: `${docPath}:${reference.line} references missing symbol ${reference.path}#${reference.symbol}.`,
      evidence: [
        {
          kind: "symbol",
          subject: `${reference.path}#${reference.symbol}`,
          expected: "symbol exists in source file",
          actual: "missing",
          detail: "Documented source binding names a symbol that could not be found in the referenced file."
        }
      ],
      suggestedAction:
        "Update the symbol binding, restore the symbol, or remove the source binding if it is no longer relevant."
    });
  }

  return findings;
}

async function detectFrontmatterDrift(
  snapshot: RepositorySnapshot,
  docPath: string,
  text: string
): Promise<DriftFinding[]> {
  const parsed = parseFrontmatter(text);
  if (!parsed) return [];

  const findings: DriftFinding[] = [];
  for (const source of parsed.sources) {
    if (snapshot.files.has(source.path) || (await pathExists(snapshot.root, source.path))) {
      if (snapshot.config.requireTestsForSources && !hasTestCoverage(snapshot, source.path)) {
        findings.push(missingSourceCoverageFinding(docPath, source.line, source.path));
      }
      continue;
    }

    findings.push({
      id: findingId(docPath, source.line, "frontmatter.missing-source", source.path),
      ruleId: "frontmatter.missing-source",
      severity: "high",
      status: "broken",
      docPath,
      line: source.line,
      message: `${docPath}:${source.line} binds missing frontmatter source ${source.path}.`,
      evidence: [
        {
          kind: "frontmatter",
          subject: source.path,
          expected: "frontmatter source path exists",
          actual: "missing",
          detail: "The document declares a source binding that cannot be resolved in the repository."
        }
      ],
      suggestedAction:
        "Restore the source file, update the frontmatter source binding, or remove the binding after review."
    });

    if (snapshot.config.requireTestsForSources && !hasTestCoverage(snapshot, source.path)) {
      findings.push(missingSourceCoverageFinding(docPath, source.line, source.path));
    }
  }

  const ttlDays = parsed.ttlDays ?? snapshot.config.reviewTtlDays;
  if (parsed.lastReviewed && ttlDays !== undefined) {
    const reviewedAt = Date.parse(parsed.lastReviewed);
    if (!Number.isNaN(reviewedAt)) {
      const expiresAt = reviewedAt + ttlDays * 24 * 60 * 60 * 1000;
      if (expiresAt < Date.now()) {
        findings.push({
          id: findingId(docPath, parsed.lastReviewedLine, "frontmatter.review-expired", parsed.lastReviewed),
          ruleId: "frontmatter.review-expired",
          severity: "medium",
          status: "review_needed",
          docPath,
          line: parsed.lastReviewedLine,
          message: `${docPath}:${parsed.lastReviewedLine} review window expired for lastReviewed ${parsed.lastReviewed}.`,
          evidence: [
            {
              kind: "frontmatter",
              subject: "lastReviewed",
              expected: `review within ${ttlDays} days`,
              actual: parsed.lastReviewed,
              detail: "The document declares a review TTL that has elapsed."
            }
          ],
          suggestedAction:
            "Re-review the document against its sources and update lastReviewed only after the evidence is checked."
        });
      }
    }
  }

  return findings;
}

function missingSourceCoverageFinding(docPath: string, line: number, sourcePath: string): DriftFinding {
  return {
    id: findingId(docPath, line, "test.missing-source-coverage", sourcePath),
    ruleId: "test.missing-source-coverage",
    severity: "medium",
    status: "review_needed",
    docPath,
    line,
    message: `${docPath}:${line} binds ${sourcePath}, but no matching test file was found.`,
    evidence: [
      {
        kind: "config",
        subject: sourcePath,
        expected: "matching test file for frontmatter source binding",
        actual: "missing",
        detail: "Configured source coverage checks require a nearby or test-directory test for bound source files."
      }
    ],
    suggestedAction: "Add a source test, update owner mapping, or disable requireTestsForSources for this repository."
  };
}

function detectPackageClaims(
  snapshot: RepositorySnapshot,
  docPath: string,
  text: string
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const manifest = snapshot.packageManifest;
  if (!manifest) return findings;

  for (const claim of extractPackageClaims(text)) {
    const actual = packageField(manifest, claim.field);
    if (actual === undefined || actual === claim.value) continue;
    findings.push({
      id: findingId(docPath, claim.line, "claim.package-field-mismatch", `${claim.field}=${claim.value}`),
      ruleId: "claim.package-field-mismatch",
      severity: "medium",
      status: "review_needed",
      docPath,
      line: claim.line,
      message: `${docPath}:${claim.line} claims package.${claim.field}=${claim.value}, but package.json has ${actual}.`,
      evidence: [
        {
          kind: "config",
          subject: `package.${claim.field}`,
          expected: String(actual),
          actual: claim.value,
          detail: "Documented semantic package claim does not match package.json."
        }
      ],
      suggestedAction: "Update the documented claim or package metadata after review."
    });
  }

  return findings;
}

function detectAdrDrift(
  snapshot: RepositorySnapshot,
  docPath: string,
  text: string
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const docsByPath = new Map(snapshot.documents.map((doc) => [doc.path, doc]));

  for (const reference of extractAdrReferences(text)) {
    const adr = docsByPath.get(reference.path);
    if (!adr) continue;
    const status = adr.text.match(/^Status:\s*(.+)$/im)?.[1]?.trim().toLowerCase();
    if (status !== "superseded" && status !== "deprecated") continue;
    findings.push({
      id: findingId(docPath, reference.line, "adr.superseded-reference", reference.path),
      ruleId: "adr.superseded-reference",
      severity: "medium",
      status: "review_needed",
      docPath,
      line: reference.line,
      message: `${docPath}:${reference.line} references ${status} ADR ${reference.path}.`,
      evidence: [
        {
          kind: "path",
          subject: reference.path,
          expected: "active ADR",
          actual: status,
          detail: "Document references an ADR whose status indicates it should not be treated as current guidance."
        }
      ],
      suggestedAction: "Update the document to the superseding ADR or record why the old ADR still applies."
    });
  }

  return findings;
}

function extractDocumentedCommands(text: string): Array<{
  line: number;
  manager: DocumentedPackageManager;
  script: string;
  raw: string;
}> {
  const results: Array<{
    line: number;
    manager: DocumentedPackageManager;
    script: string;
    raw: string;
  }> = [];
  const commandRegex = /\b(npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?((?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.:@/-]+)\b/g;

  for (const { line: index, text: snippet } of codeSnippets(text)) {
    for (const match of snippet.matchAll(commandRegex)) {
      const manager = match[1] as DocumentedPackageManager;
      const script = match[2];
      if (!PACKAGE_MANAGERS.has(manager)) continue;
      results.push({
        line: index,
        manager,
        script,
        raw: match[0]
      });
    }
  }

  return results;
}

function shouldCheckPackageManagerMismatch(command: { manager: DocumentedPackageManager; script: string }): boolean {
  if (command.manager !== "npx") return true;
  if (command.script.startsWith("-")) return false;
  if (command.script.startsWith("@") || command.script.includes("/")) return false;
  return true;
}

function isPackageManagerCompatible(manager: DocumentedPackageManager, expected: DocumentedPackageManager): boolean {
  if (manager === expected) return true;
  return manager === "npx" && expected === "npm";
}

type PathReference = { line: number; path: string; kind: "markdown_link" | "code_path" };

function extractPathReferences(text: string): PathReference[] {
  const results: PathReference[] = [];
  const markdownLinkRegex = /\[[^\]]*]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)]+)?\)/g;
  const pathRegex =
    /(?:^|[\s`"'])((?:\.{1,2}\/)?[A-Za-z0-9_.@/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|mdx?|py|go|rs|java|rb|php|cs|sh|toml|sql|proto|graphql|gql|lock))(?:$|[\s`"',;:)])/g;

  for (const [index, line] of lines(text)) {
    for (const match of line.matchAll(markdownLinkRegex)) {
      results.push({ line: index, path: match[1], kind: "markdown_link" });
    }
  }

  for (const snippet of codeSnippets(text)) {
    for (const match of snippet.text.matchAll(pathRegex)) {
      results.push({ line: snippet.line, path: match[1], kind: "code_path" });
    }
  }

  return results;
}

function resolveDocumentReferencePath(docPath: string, reference: PathReference): string | undefined {
  const candidate = normalizeCandidatePath(reference.path);
  if (!candidate || reference.kind !== "markdown_link") return candidate;
  const resolved = posix.normalize(posix.join(posix.dirname(docPath), candidate));
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../")) {
    return candidate;
  }
  return resolved;
}

function extractApiReferences(text: string): Array<{ line: number; method: string; path: string }> {
  const results: Array<{ line: number; method: string; path: string }> = [];
  const apiRegex =
    /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+((?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)+)\b/g;

  for (const snippet of codeSnippets(text)) {
    for (const match of snippet.text.matchAll(apiRegex)) {
      results.push({
        line: snippet.line,
        method: match[1].toUpperCase(),
        path: match[2]
      });
    }
  }

  return results;
}

function extractApiSchemaReferences(text: string): Array<{
  line: number;
  method: string;
  path: string;
  requestSchema?: string;
  responseSchema?: string;
}> {
  const results: Array<{
    line: number;
    method: string;
    path: string;
    requestSchema?: string;
    responseSchema?: string;
  }> = [];
  const apiSchemaRegex =
    /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+((?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)+)\b([^\n`]*)/g;

  for (const snippet of codeSnippets(text)) {
    for (const match of snippet.text.matchAll(apiSchemaRegex)) {
      const tail = match[3] ?? "";
      const requestSchema = tail.match(/\brequest:\s*([A-Za-z_$][\w$]*)\b/)?.[1];
      const responseSchema = tail.match(/\bresponse:\s*([A-Za-z_$][\w$]*)\b/)?.[1];
      if (!requestSchema && !responseSchema) continue;
      results.push({
        line: snippet.line,
        method: match[1].toUpperCase(),
        path: match[2],
        requestSchema,
        responseSchema
      });
    }
  }

  return results;
}

function extractSymbolReferences(text: string): Array<{ line: number; path: string; symbol: string }> {
  const results: Array<{ line: number; path: string; symbol: string }> = [];
  const symbolRegex =
    /((?:\.{1,2}\/)?[A-Za-z0-9_.@/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs))#([A-Za-z_$][\w$]*)/g;

  for (const snippet of codeSnippets(text)) {
    for (const match of snippet.text.matchAll(symbolRegex)) {
      const path = normalizeCandidatePath(match[1]);
      if (!path) continue;
      results.push({ line: snippet.line, path, symbol: match[2] });
    }
  }

  const frontmatter = parseFrontmatter(text);
  for (const source of frontmatter?.sources ?? []) {
    for (const symbol of source.symbols) {
      results.push({ line: source.line, path: source.path, symbol });
    }
  }

  return results;
}

function extractPackageClaims(text: string): Array<{ line: number; field: string; value: string }> {
  const results: Array<{ line: number; field: string; value: string }> = [];
  const claimRegex = /\bclaim:package\.([A-Za-z0-9_.-]+)=([^\s`]+)\b/g;

  for (const snippet of codeSnippets(text)) {
    for (const match of snippet.text.matchAll(claimRegex)) {
      results.push({ line: snippet.line, field: match[1], value: match[2] });
    }
  }

  return results;
}

function extractAdrReferences(text: string): Array<{ line: number; path: string }> {
  const results: Array<{ line: number; path: string }> = [];
  const adrRegex = /\bADR:\s*((?:\.{1,2}\/)?[A-Za-z0-9_.@/-]+\.md)\b/g;

  for (const snippet of codeSnippets(text)) {
    for (const match of snippet.text.matchAll(adrRegex)) {
      const path = normalizeCandidatePath(match[1]);
      if (path) results.push({ line: snippet.line, path });
    }
  }

  return results;
}

function normalizeCandidatePath(raw: string): string | undefined {
  const withoutQuotes = raw.trim().replace(/^['"`]+|['"`.,;:)]+$/g, "");
  if (!withoutQuotes) return undefined;
  if (withoutQuotes.includes("://")) return undefined;
  if (withoutQuotes.startsWith("#")) return undefined;
  if (withoutQuotes.startsWith("/")) return undefined;
  if (withoutQuotes.startsWith("node_modules/")) return undefined;
  if (withoutQuotes.includes("*")) return undefined;
  if (withoutQuotes.includes("$")) return undefined;

  return withoutQuotes.replace(/^\.\//, "");
}

async function fileHasSymbol(root: string, path: string, symbol: string): Promise<boolean> {
  const text = await readFile(join(root, path), "utf8");
  if (hasTypeScriptSymbol(text, path, symbol)) {
    return true;
  }

  const escaped = escapeRegExp(symbol);
  const patterns = [
    new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\b`),
    new RegExp(`\\b(?:export\\s+)?(?:abstract\\s+)?class\\s+${escaped}\\b`),
    new RegExp(`\\b(?:export\\s+)?interface\\s+${escaped}\\b`),
    new RegExp(`\\b(?:export\\s+)?type\\s+${escaped}\\b`),
    new RegExp(`\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\b`),
    new RegExp(`\\b(?:export\\s+)?enum\\s+${escaped}\\b`),
    new RegExp(`\\b${escaped}\\s*[:=]\\s*`)
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function hasTypeScriptSymbol(text: string, path: string, symbol: string): boolean {
  const scriptKind = path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
  const exported = new Set<string>();

  function visit(node: ts.Node): void {
    if (hasExportModifier(node)) {
      const name = declarationName(node);
      if (name) exported.add(name);
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exported.add(element.name.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exported.has(symbol);
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function declarationName(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isVariableDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) return declaration.name.text;
    }
  }

  return undefined;
}

function parseFrontmatter(text: string): {
  lastReviewed?: string;
  lastReviewedLine: number;
  ttlDays?: number;
  sources: Array<{ path: string; line: number; symbols: string[] }>;
} | undefined {
  const parsed = parseDocumentFrontmatter(text);
  if (!parsed.hasFrontmatter) return undefined;
  return {
    lastReviewed: parsed.frontmatter.lastReviewed,
    lastReviewedLine: parsed.locations.lastReviewedLine,
    ttlDays: parsed.frontmatter.ttlDays,
    sources: parsed.locations.sources
  };
}

function hasTestCoverage(snapshot: RepositorySnapshot, sourcePath: string): boolean {
  const withoutExtension = sourcePath.replace(/\.[^.]+$/, "");
  const basename = withoutExtension.split("/").at(-1);
  if (!basename) return false;

  const candidates = [
    `${withoutExtension}.test.ts`,
    `${withoutExtension}.spec.ts`,
    `${withoutExtension}.test.tsx`,
    `${withoutExtension}.spec.tsx`,
    `test/${basename}.test.ts`,
    `tests/${basename}.test.ts`,
    `test/${basename}.spec.ts`,
    `tests/${basename}.spec.ts`
  ];

  return candidates.some((candidate) => snapshot.files.has(candidate));
}

function packageField(manifest: { name?: string; version?: string }, field: string): string | undefined {
  if (field === "name") return manifest.name;
  if (field === "version") return manifest.version;
  return undefined;
}

function findingId(docPath: string, line: number, ruleId: string, subject: string): string {
  return `${docPath}:${line}:${ruleId}:${subject}`.replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codeSnippets(text: string): Array<{ line: number; text: string }> {
  const snippets: Array<{ line: number; text: string }> = [];
  let inFence = false;

  for (const [lineNumber, line] of lines(text)) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      snippets.push({ line: lineNumber, text: line });
      continue;
    }

    for (const match of line.matchAll(/`([^`]+)`/g)) {
      snippets.push({ line: lineNumber, text: match[1] });
    }
  }

  return snippets;
}

function lines(text: string): Array<[number, string]> {
  return text.split(/\r?\n/).map((line, index) => [index + 1, line]);
}
