#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  checkRepository,
  createAgentRuntimeContract,
  readFindingDocuments,
  resolveExistingPathInsideRoot,
  resolveExistingRootInsideBoundary,
  resolveWritablePathInsideRoot,
  type DriftFinding,
  type DriftReport,
  type AgentRuntimeContract
} from "@handong66/evidoc-core";
import { createPatchProposals, validatePatchProposal, type PatchProposal } from "@handong66/evidoc-patcher";
import { formatMarkdownReport } from "@handong66/evidoc-reports";
import { serializeReviewLogEntry, type ReviewDecision } from "@handong66/evidoc-review-log";
import { z } from "zod";

export const READ_ONLY_TOOLS = [
  "evidoc.agent_scan",
  "evidoc.get_drift_status",
  "evidoc.diagnose_drift",
  "evidoc.suggest_doc_fix",
  "evidoc.get_repo_contract",
  "evidoc.search_docs",
  "evidoc.check_worktree_drift",
  "evidoc.explain_drift",
  "evidoc.get_evidence_pack",
  "evidoc.draft_doc_patch",
  "evidoc.validate_patch"
] as const;

export const WRITE_TOOLS = [
  "evidoc.record_review"
] as const;

export type EvidocMcpTool = (typeof READ_ONLY_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

export interface McpToolDefinition {
  name: EvidocMcpTool;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export interface McpContext {
  cwd: string;
  allowWrites: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export function isWriteToolAllowed(tool: EvidocMcpTool, allowWrites: boolean): boolean {
  return allowWrites || !WRITE_TOOLS.includes(tool as (typeof WRITE_TOOLS)[number]);
}

export function listMcpTools(): McpToolDefinition[] {
  return [
    {
      name: "evidoc.agent_scan",
      description:
        "Default agent entrypoint: run a fresh repo-local scan and return actionable evidence, freshness, read-parity, and next commands in one bundle.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.get_drift_status",
      description:
        "Return the Evidoc Agent Runtime Contract for the current repository. Use this before speaking about drift status in an agent reply.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.diagnose_drift",
      description:
        "Return Evidoc findings with runtime fingerprints and agent-actionable repair context without writing files.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.suggest_doc_fix",
      description:
        "Return evidence-bound documentation patch proposals plus the matching runtime fingerprint. Does not write files.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.get_repo_contract",
      description: "Read the local Evidoc pursuit goal and architecture contract when present.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.search_docs",
      description: "Search repository Markdown documents for a literal query.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" }, query: { type: "string" } },
        required: ["query"]
      }
    },
    {
      name: "evidoc.check_worktree_drift",
      description: "Run a read-only Evidoc scan for the current repository.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.explain_drift",
      description: "Explain a finding by id or by index from the current report.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" }, findingId: { type: "string" }, index: { type: "number" } }
      }
    },
    {
      name: "evidoc.get_evidence_pack",
      description: "Return a compact evidence pack for all current drift findings.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.draft_doc_patch",
      description: "Draft evidence-bound patch proposals without writing files.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.validate_patch",
      description: "Validate that a proposed patch is bound to a current finding and allowed path.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" }, proposal: { type: "object" } },
        required: ["proposal"]
      }
    },
    {
      name: "evidoc.record_review",
      description: "Append a human review decision to .evidoc/review-log.jsonl.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string" },
          findingId: { type: "string" },
          decision: { type: "string" },
          reviewer: { type: "string" },
          expiresAt: { type: "string" },
          note: { type: "string" }
        },
        required: ["findingId", "decision", "reviewer"]
      }
    }
  ];
}

export function createMcpSdkServer(context: McpContext): McpServer {
  const server = new McpServer({ name: "evidoc", version: "0.1.0" });

  for (const tool of listMcpTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: sdkInputSchemaFor(tool.name)
      },
      async (args) => {
        const result = await callMcpTool(tool.name, args as Record<string, unknown>, context);
        return { content: result.content, isError: result.isError };
      }
    );
  }

  return server;
}

export async function callMcpTool(
  tool: EvidocMcpTool,
  args: Record<string, unknown> = {},
  context: McpContext
): Promise<McpToolResult> {
  if (!isWriteToolAllowed(tool, context.allowWrites)) {
    return textResult(`Tool ${tool} requires allowWrites=true.`, true);
  }

  try {
    const root = await resolveMcpRoot(context, args);
    if (!root) {
      return textResult(mcpRootError(args), true);
    }

    if (tool === "evidoc.agent_scan") {
      const report = await checkRepository(root);
      const documents = await readFindingDocuments(root, report);
      const proposals = createPatchProposals(report, documents);
      return textResult(JSON.stringify(createAgentScanPayload(report, proposals), null, 2));
    }

    if (tool === "evidoc.get_drift_status") {
      const report = await checkRepository(root);
      return textResult(
        JSON.stringify(
          {
            runtime: createMcpRuntimeContract(report),
            summary: report.summary
          },
          null,
          2
        )
      );
    }

    if (tool === "evidoc.diagnose_drift") {
      const report = await checkRepository(root);
      const documents = await readFindingDocuments(root, report);
      const proposals = createPatchProposals(report, documents);
      return textResult(JSON.stringify(createAgentDiagnosisPayload(report, proposals), null, 2));
    }

    if (tool === "evidoc.suggest_doc_fix") {
      const report = await checkRepository(root);
      const documents = await readFindingDocuments(root, report);
      const proposals = createPatchProposals(report, documents);
      return textResult(
        JSON.stringify(
          {
            runtime: createMcpRuntimeContract(report),
            proposals
          },
          null,
          2
        )
      );
    }

    if (tool === "evidoc.check_worktree_drift") {
      const report = await checkRepository(root);
      return textResult(formatMarkdownReport(report));
    }

    if (tool === "evidoc.get_evidence_pack") {
      const report = await checkRepository(root);
      return textResult(JSON.stringify({ root: report.root, findings: report.findings }, null, 2));
    }

    if (tool === "evidoc.explain_drift") {
      const report = await checkRepository(root);
      const finding =
        typeof args.findingId === "string"
          ? report.findings.find((candidate) => candidate.id === args.findingId)
          : report.findings[typeof args.index === "number" ? args.index : 0];
      if (!finding) return textResult("No matching Evidoc finding.", true);
      return textResult(JSON.stringify(finding, null, 2));
    }

    if (tool === "evidoc.search_docs") {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return textResult("query is required.", true);
      const report = await checkRepository(root);
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const document of report.documents) {
        const documentPath = await resolveExistingPathInsideRoot(root, document.path);
        if (!documentPath) continue;
        const text = await readFile(documentPath, "utf8");
        text.split(/\r?\n/).forEach((line, index) => {
          if (line.includes(query)) {
            matches.push({ path: document.path, line: index + 1, text: line });
          }
        });
      }
      return textResult(JSON.stringify(matches, null, 2));
    }

    if (tool === "evidoc.get_repo_contract") {
      const paths = [
        "docs/vision/pursuit-goal.zh-CN.md",
        "docs/architecture/full-scope-architecture.md"
      ];
      const documents: Record<string, string> = {};
      for (const path of paths) {
        try {
          const documentPath = await resolveExistingPathInsideRoot(root, path);
          documents[path] = documentPath ? await readFile(documentPath, "utf8") : "";
        } catch {
          documents[path] = "";
        }
      }
      return textResult(JSON.stringify(documents, null, 2));
    }

    if (tool === "evidoc.draft_doc_patch") {
      const report = await checkRepository(root);
      const documents = await readFindingDocuments(root, report);
      return textResult(JSON.stringify(createPatchProposals(report, documents), null, 2));
    }

    if (tool === "evidoc.validate_patch") {
      const report = await checkRepository(root);
      return textResult(JSON.stringify(validatePatchProposal(args.proposal as never, report), null, 2));
    }

    if (tool === "evidoc.record_review") {
      const findingId = stringArg(args, "findingId");
      const decision = stringArg(args, "decision") as ReviewDecision;
      const reviewer = stringArg(args, "reviewer");
      const logPath = await resolveWritablePathInsideRoot(root, ".evidoc/review-log.jsonl");
      if (!logPath) return textResult("review log path must stay inside repository root.", true);
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(
        logPath,
        `${serializeReviewLogEntry({
          findingId,
          decision,
          reviewer,
          reviewedAt: new Date().toISOString(),
          expiresAt: typeof args.expiresAt === "string" ? args.expiresAt : undefined,
          note: typeof args.note === "string" ? args.note : undefined
        })}\n`,
        "utf8"
      );
      return textResult(`Recorded review decision for ${findingId}.`);
    }

    return textResult(`Unknown Evidoc tool: ${tool}`, true);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

export async function handleJsonRpcRequest(
  request: JsonRpcRequest,
  context: Partial<McpContext> = {}
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;

  try {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "evidoc", version: "0.0.0" },
          instructions:
            "Call evidoc.agent_scan first for repair work, or evidoc.get_drift_status before speaking about drift status. These read-only tools return the Agent Runtime Contract, freshness, read-parity evidence, patch classifications, next commands, and privacy constraints.",
          privacy: {
            repositoryContentUpload: "never_by_default",
            telemetry: "disabled_by_default"
          }
        }
      };
    }

    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: listMcpTools() } };
    }

    if (request.method === "tools/call") {
      const params = asRecord(request.params);
      const name = params.name;
      if (!isEvidocTool(name)) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool." } };
      }
      const result = await callMcpTool(name, asRecord(params.arguments), {
        cwd: context.cwd ?? process.cwd(),
        allowWrites: context.allowWrites ?? false
      });
      return { jsonrpc: "2.0", id, result };
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found." } };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function runMcpStdio(context: Partial<McpContext> = {}): Promise<void> {
  const cwd = await resolveMcpStartupCwd(context.cwd ?? process.cwd());
  const server = createMcpSdkServer({
    cwd,
    allowWrites: context.allowWrites ?? false
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function textResult(text: string, isError = false): McpToolResult {
  return {
    isError,
    content: [{ type: "text", text }]
  };
}

function createAgentScanPayload(report: DriftReport, proposals: PatchProposal[]): Record<string, unknown> {
  const runtime = createMcpRuntimeContract(report);
  const proposalByFinding = new Map(proposals.map((proposal) => [proposal.findingId, proposal]));
  const affectedDocuments = [...new Set(report.findings.map((finding) => finding.docPath))].sort();
  const evidenceToInspect = evidenceCategories(report.findings);
  const findings = report.findings.map((finding) => {
    const proposal = proposalByFinding.get(finding.id);
    return {
      id: finding.id,
      ruleId: finding.ruleId,
      status: finding.status,
      severity: finding.severity,
      location: `${finding.docPath}:${finding.line}`,
      message: finding.message,
      suggestedAction: finding.suggestedAction,
      repairMode: repairModeFor(finding, proposal),
      patchClassification: proposal?.classification ?? "blocked",
      evidence: finding.evidence
    };
  });

  return {
    schemaVersion: "evidoc.agent_scan.v1",
    root: report.root,
    scannedAt: report.scannedAt,
    runtime,
    mcp: {
      tool: "evidoc.agent_scan",
      defaultTool: true,
      otherReadTools: READ_ONLY_TOOLS.filter((tool) => tool !== "evidoc.agent_scan")
    },
    coldStart: {
      status: "ready",
      rootResolved: true,
      fallback: "If status is not ready, pass an explicit root or launch the MCP server from a repository root."
    },
    freshness: {
      status: "fresh",
      partial: false,
      scanScope: "full_repository",
      checkedAt: new Date().toISOString(),
      staleAfter: "next repository content, config, or review-log change",
      reasons: []
    },
    summary: report.summary,
    readParity: {
      canActFromThis: report.findings.every((finding) => finding.evidence.length > 0),
      affectedDocuments,
      evidenceToInspect,
      stopReadingWhen: [
        "the finding has structured evidence and the affected document is unchanged since scannedAt",
        "the proposed edit only touches the reported document path",
        "verification reruns Evidoc after any edit"
      ],
      insufficientEvidence: findings
        .filter((finding) => Array.isArray(finding.evidence) && finding.evidence.length === 0)
        .map((finding) => finding.id)
    },
    findings,
    patchPlan: {
      safeAutoFixCandidates: proposals.filter((proposal) => proposal.classification === "safe").length,
      reviewCandidates: proposals.filter((proposal) => proposal.classification === "review").length,
      blockedCandidates: proposals.filter((proposal) => proposal.classification === "blocked").length
    },
    nextCommands: {
      diagnose: "npx repo-evidoc diagnose --root <target-repository-root>",
      safeFixPreview: "npx repo-evidoc fix --safe --json --root <target-repository-root>",
      verify: "npx repo-evidoc check --fail-on=review_needed --root <target-repository-root>",
      sourceCheckoutFallback: "replace `npx repo-evidoc` with `npm run evidoc --` from an Evidoc source checkout before npm publication"
    },
    privacy: {
      repositoryContentUpload: "never_by_default",
      telemetry: "disabled_by_default",
      writes: "none"
    }
  };
}

function createAgentDiagnosisPayload(report: DriftReport, proposals: PatchProposal[]): Record<string, unknown> {
  const runtime = createMcpRuntimeContract(report);
  const proposalByFinding = new Map(proposals.map((proposal) => [proposal.findingId, proposal]));
  return {
    schemaVersion: "evidoc.diagnose_drift.v1",
    root: report.root,
    scannedAt: report.scannedAt,
    runtime,
    summary: report.summary,
    findings: report.findings.map((finding) => {
      const runtimeFinding = runtime.findings.find((candidate) => candidate.findingId === finding.id);
      const proposal = proposalByFinding.get(finding.id);
      return {
        fingerprint: runtimeFinding?.fingerprint,
        findingId: finding.id,
        ruleId: finding.ruleId,
        status: finding.status,
        severity: finding.severity,
        location: `${finding.docPath}:${finding.line}`,
        message: finding.message,
        suggestedAction: finding.suggestedAction,
        repairMode: repairModeFor(finding, proposal),
        patchClassification: proposal?.classification ?? "blocked",
        evidence: finding.evidence
      };
    }),
    nextCommands: {
      diagnose: "npx repo-evidoc diagnose --root <target-repository-root>",
      safeFixPreview: "npx repo-evidoc fix --safe --json --root <target-repository-root>",
      verify: "npx repo-evidoc check --fail-on=review_needed --root <target-repository-root>"
    }
  };
}

function createMcpRuntimeContract(report: DriftReport): AgentRuntimeContract {
  return createAgentRuntimeContract(report, {
    event: "mcp",
    mode: "advisory",
    scope: "full_repository"
  });
}

function repairModeFor(finding: DriftFinding, proposal: PatchProposal | undefined): string {
  if (proposal?.classification === "safe") return "safe_deterministic_fix";
  if (finding.evidence.length > 0) return "review_with_structured_evidence";
  return "review_only_missing_evidence";
}

function evidenceCategories(findings: DriftFinding[]): string[] {
  const categories = new Set<string>();
  for (const finding of findings) {
    const evidenceKinds = finding.evidence.map((item) => item.kind);
    if (
      evidenceKinds.includes("command") ||
      evidenceKinds.includes("agent_instruction") ||
      finding.ruleId.includes("package-manager")
    ) {
      categories.add("package.json/lockfiles");
    }
    if (evidenceKinds.includes("api") || finding.ruleId.includes("api.")) {
      categories.add("OpenAPI specs");
    }
    if (
      evidenceKinds.includes("symbol") ||
      finding.ruleId.includes("symbol.") ||
      finding.ruleId.includes("path.")
    ) {
      categories.add("referenced source/path targets");
    }
    if (evidenceKinds.includes("config") || finding.ruleId.includes("config.")) {
      categories.add(".evidoc/config.json");
    }
  }
  const ordered = [
    "package.json/lockfiles",
    "OpenAPI specs",
    "referenced source/path targets",
    ".evidoc/config.json"
  ].filter((category) => categories.has(category));
  return ordered.length > 0 ? ordered : ["finding locations and current repository files"];
}

async function resolveMcpRoot(
  context: McpContext,
  args: Record<string, unknown>
): Promise<string | undefined> {
  const hasExplicitRoot = typeof args.root === "string";
  const root = await resolveExistingRootInsideBoundary(
    context.cwd,
    hasExplicitRoot ? args.root as string : "."
  );
  if (!root) return undefined;
  if (!(await looksLikeRepositoryRoot(root))) {
    return undefined;
  }
  return root;
}

function mcpRootError(args: Record<string, unknown>): string {
  if (typeof args.root === "string") return "root must stay inside MCP cwd and point at a repository root.";
  return "MCP tool needs an explicit root because the server startup cwd is not a repository. Pass root or launch the MCP server from the repository root.";
}

async function looksLikeRepositoryRoot(root: string): Promise<boolean> {
  return (
    (await exists(join(root, ".git"))) ||
    (await exists(join(root, ".evidoc", "config.json")))
  );
}

export async function resolveMcpStartupCwd(defaultCwd: string): Promise<string> {
  const configuredRoot = process.env.EVIDOC_ROOT;
  if (!configuredRoot) return defaultCwd;
  try {
    return realpathSync(configuredRoot);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`EVIDOC_ROOT does not resolve to an existing directory: ${configuredRoot}. ${detail}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function isEvidocTool(value: unknown): value is EvidocMcpTool {
  return (
    typeof value === "string" &&
    ([...READ_ONLY_TOOLS, ...WRITE_TOOLS] as readonly string[]).includes(value)
  );
}

function sdkInputSchemaFor(tool: EvidocMcpTool): Record<string, z.ZodTypeAny> {
  const root = z.string().optional();
  if (tool === "evidoc.search_docs") {
    return { root, query: z.string() };
  }
  if (tool === "evidoc.explain_drift") {
    return { root, findingId: z.string().optional(), index: z.number().optional() };
  }
  if (tool === "evidoc.validate_patch") {
    return { root, proposal: z.record(z.string(), z.unknown()) };
  }
  if (tool === "evidoc.record_review") {
    return {
      root,
      findingId: z.string(),
      decision: z.enum(["accepted", "false_positive", "deferred", "fixed"]),
      reviewer: z.string(),
      expiresAt: z.string().optional(),
      note: z.string().optional()
    };
  }
  return { root };
}

function isDirectExecution(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return metaUrl === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return metaUrl === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectExecution(import.meta.url)) {
  await runMcpStdio({
    cwd: process.cwd(),
    allowWrites: process.argv.includes("--allow-writes")
  });
}
