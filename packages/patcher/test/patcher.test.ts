import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPatchWritesAllowed } from "../src/index.js";

test("rejects patch writes unless explicitly enabled", () => {
  assert.throws(() => assertPatchWritesAllowed(false), /disabled/);
});

test("allows patch writes when explicitly enabled", () => {
  assert.doesNotThrow(() => assertPatchWritesAllowed(true));
});
