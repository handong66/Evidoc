import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { callMcpTool, handleJsonRpcRequest, listMcpTools, resolveMcpStartupCwd } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-mcp-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

async function markGitRepository(root: string): Promise<void> {
  await write(root, ".git/HEAD", "ref: refs/heads/main\n");
}

test("lists MCP tools and runs a read-only drift check", async () => {
  const root = await fixture();
  await markGitRepository(root);
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const tools = listMcpTools();
  assert.ok(tools.some((tool) => tool.name === "evidoc.check_worktree_drift"));

  const result = await callMcpTool(
    "evidoc.check_worktree_drift",
    { root },
    { cwd: root, allowWrites: false }
  );

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /path\.missing-reference/);
});

test("agent scan returns a fresh read-parity evidence bundle for the default MCP entry", async () => {
  const root = await fixture();
  await markGitRepository(root);
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const result = await callMcpTool(
    "evidoc.agent_scan",
    { root },
    { cwd: root, allowWrites: false }
  );

  assert.equal(result.isError, false);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.mcp.defaultTool, true);
  assert.equal(payload.mcp.tool, "evidoc.agent_scan");
  assert.equal(payload.coldStart.status, "ready");
  assert.equal(payload.freshness.status, "fresh");
  assert.equal(payload.freshness.partial, false);
  assert.equal(payload.readParity.canActFromThis, true);
  assert.deepEqual(payload.readParity.affectedDocuments, ["README.md"]);
  assert.ok(payload.readParity.evidenceToInspect.includes("referenced source/path targets"));
  assert.match(payload.nextCommands.verify, /check --fail-on=review_needed/);
  assert.equal(payload.findings[0].ruleId, "path.missing-reference");
  assert.equal(payload.findings[0].repairMode, "review_with_structured_evidence");
  assert.equal(payload.runtime.source, "evidoc");
  assert.equal(payload.runtime.event, "mcp");
  assert.equal(payload.runtime.mode, "advisory");
  assert.equal(payload.runtime.status, "failed");
  assert.match(payload.runtime.findings[0].fingerprint, /^dgf_[a-f0-9]{16}$/);
});

test("MCP status and diagnosis tools expose the same agent runtime contract", async () => {
  const root = await fixture();
  await markGitRepository(root);
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const statusResult = await callMcpTool(
    "evidoc.get_drift_status",
    { root },
    { cwd: root, allowWrites: false }
  );
  const diagnosisResult = await callMcpTool(
    "evidoc.diagnose_drift",
    { root },
    { cwd: root, allowWrites: false }
  );
  const fixResult = await callMcpTool(
    "evidoc.suggest_doc_fix",
    { root },
    { cwd: root, allowWrites: false }
  );

  assert.equal(statusResult.isError, false);
  assert.equal(diagnosisResult.isError, false);
  assert.equal(fixResult.isError, false);
  const status = JSON.parse(statusResult.content[0].text);
  const diagnosis = JSON.parse(diagnosisResult.content[0].text);
  const fix = JSON.parse(fixResult.content[0].text);
  assert.equal(status.runtime.schemaVersion, "evidoc.agent-runtime.v1");
  assert.equal(status.runtime.status, "failed");
  assert.equal(diagnosis.runtime.fingerprint, status.runtime.fingerprint);
  assert.equal(diagnosis.findings[0].fingerprint, status.runtime.findings[0].fingerprint);
  assert.equal(fix.runtime.fingerprint, status.runtime.fingerprint);
  assert.equal(Array.isArray(fix.proposals), true);
});

test("blocks write tools unless explicitly enabled", async () => {
  const result = await callMcpTool(
    "evidoc.record_review",
    { findingId: "finding-1" },
    { cwd: process.cwd(), allowWrites: false }
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /requires allowWrites/);
});

test("blocks write tools from targeting roots outside the MCP cwd", async () => {
  const cwd = await fixture();
  const outside = await fixture();

  const result = await callMcpTool(
    "evidoc.record_review",
    { root: outside, findingId: "finding-1", decision: "false_positive", reviewer: "tester" },
    { cwd, allowWrites: true }
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /root must stay inside MCP cwd/);
  assert.equal(existsSync(join(outside, ".evidoc", "review-log.jsonl")), false);
});

test("records review decisions through the resolved review-log path", async () => {
  const root = await fixture();
  await markGitRepository(root);

  const result = await callMcpTool(
    "evidoc.record_review",
    { root, findingId: "README.md:1:path.missing-reference:src/missing.ts", decision: "false_positive", reviewer: "tester" },
    { cwd: root, allowWrites: true }
  );

  assert.equal(result.isError, false);
  const log = await readFile(join(root, ".evidoc", "review-log.jsonl"), "utf8");
  assert.match(log, /README\.md:1:path\.missing-reference:src\/missing\.ts/);
  assert.match(log, /false_positive/);
  assert.match(log, /tester/);
});

test("requires an explicit root when MCP cwd is not a repository", async () => {
  const cwd = await fixture();

  const result = await callMcpTool(
    "evidoc.check_worktree_drift",
    {},
    { cwd, allowWrites: false }
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /explicit root/);
});

test("requires explicit MCP roots to point at repositories", async () => {
  const cwd = await fixture();
  await mkdir(join(cwd, "not-a-repo"));

  const result = await callMcpTool(
    "evidoc.check_worktree_drift",
    { root: "not-a-repo" },
    { cwd, allowWrites: false }
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /repository root/);
});

test("reports an invalid EVIDOC_ROOT instead of silently falling back", async () => {
  const cwd = await fixture();
  const original = process.env.EVIDOC_ROOT;
  process.env.EVIDOC_ROOT = join(cwd, "missing");
  try {
    await assert.rejects(() => resolveMcpStartupCwd(cwd), /EVIDOC_ROOT/);
  } finally {
    if (original === undefined) {
      delete process.env.EVIDOC_ROOT;
    } else {
      process.env.EVIDOC_ROOT = original;
    }
  }
});

test("handles JSON-RPC initialize and tools/list requests", async () => {
  const initialized = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {}
  });
  const listed = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });

  const initializedResult = initialized.result as { protocolVersion: string };
  const initializedDetails = initialized.result as {
    instructions: string;
    privacy: { telemetry: string; repositoryContentUpload: string };
  };
  const listedResult = listed.result as { tools: unknown[] };

  assert.equal(initializedResult.protocolVersion, "2024-11-05");
  assert.match(initializedDetails.instructions, /evidoc\.agent_scan/);
  assert.match(initializedDetails.instructions, /evidoc\.get_drift_status/);
  assert.equal(initializedDetails.privacy.telemetry, "disabled_by_default");
  assert.equal(initializedDetails.privacy.repositoryContentUpload, "never_by_default");
  assert.ok(listedResult.tools.length > 0);
});
