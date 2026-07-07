import { test } from "node:test";
import assert from "node:assert/strict";
import { isWriteToolAllowed, READ_ONLY_TOOLS, WRITE_TOOLS } from "../src/index.js";

test("read-only MCP tools are allowed without write permission", () => {
  assert.equal(READ_ONLY_TOOLS[0], "evidoc.agent_scan");
  assert.equal(isWriteToolAllowed(READ_ONLY_TOOLS[0], false), true);
  assert.ok(READ_ONLY_TOOLS.includes("evidoc.draft_doc_patch"));
  assert.ok(READ_ONLY_TOOLS.includes("evidoc.validate_patch"));
  assert.ok(READ_ONLY_TOOLS.includes("evidoc.agent_scan"));
  assert.ok(READ_ONLY_TOOLS.includes("evidoc.get_drift_status"));
  assert.ok(READ_ONLY_TOOLS.includes("evidoc.diagnose_drift"));
  assert.ok(READ_ONLY_TOOLS.includes("evidoc.suggest_doc_fix"));
  assert.equal(isWriteToolAllowed("evidoc.draft_doc_patch", false), true);
  assert.equal(isWriteToolAllowed("evidoc.validate_patch", false), true);
  assert.equal(isWriteToolAllowed("evidoc.agent_scan", false), true);
  assert.equal(isWriteToolAllowed("evidoc.get_drift_status", false), true);
});

test("review recording requires explicit write permission", () => {
  assert.deepEqual(WRITE_TOOLS, ["evidoc.record_review"]);
  assert.equal(isWriteToolAllowed("evidoc.record_review", false), false);
  assert.equal(isWriteToolAllowed("evidoc.record_review", true), true);
});
