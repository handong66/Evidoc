import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyGraph } from "../src/index.js";

test("creates an empty graph with stable node and edge arrays", () => {
  const graph = createEmptyGraph();

  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
});
