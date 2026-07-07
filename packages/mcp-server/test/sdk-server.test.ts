import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpSdkServer } from "../src/index.js";

test("creates an official SDK-backed MCP server", () => {
  const server = createMcpSdkServer({ cwd: process.cwd(), allowWrites: false });

  assert.equal(typeof server.connect, "function");
});
