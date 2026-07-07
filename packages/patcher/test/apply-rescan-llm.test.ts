import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkRepository } from "@handong66/evidoc-core";
import {
  applyPatchProposal,
  callOpenAiCompatiblePatchProvider,
  createLlmPatchRequest,
  createPatchProposals,
  validatePatchByRescan
} from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-patcher-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("applies deterministic patches only with explicit write permission and verifies by re-scan", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "README.md", "Run `npm test`.\n");
  const report = await checkRepository(root);
  const [proposal] = createPatchProposals(report, {
    "README.md": await readFile(join(root, "README.md"), "utf8")
  });

  await assert.rejects(() => applyPatchProposal(root, proposal, { allowWrites: false }));
  await applyPatchProposal(root, proposal, { allowWrites: true });
  const validation = await validatePatchByRescan(root, proposal);

  assert.equal(await readFile(join(root, "README.md"), "utf8"), "Run `pnpm test`.\n");
  assert.equal(validation.ok, true);
});

test("applies deterministic patches for stale agent package-manager fields", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "AGENTS.md", "packageManager: npm\nAlways use `pnpm test`.\n");

  const report = await checkRepository(root);
  const [proposal] = createPatchProposals(report, {
    "AGENTS.md": await readFile(join(root, "AGENTS.md"), "utf8")
  });

  assert.equal(proposal.kind, "safe_deterministic");
  assert.equal(proposal.classification, "safe");
  assert.equal(proposal.findingId, "AGENTS.md:1:agent_instruction.package-manager-mismatch:packageManager");

  await applyPatchProposal(root, proposal, { allowWrites: true });
  const validation = await validatePatchByRescan(root, proposal);

  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "packageManager: pnpm\nAlways use `pnpm test`.\n");
  assert.equal(validation.ok, true);
});

test("applies deterministic patches for non-canonical agent package-manager fields", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "AGENTS.md", "PackageManager : NPM\nAlways use `pnpm test`.\n");

  const report = await checkRepository(root);
  const [proposal] = createPatchProposals(report, {
    "AGENTS.md": await readFile(join(root, "AGENTS.md"), "utf8")
  });

  assert.equal(proposal.kind, "safe_deterministic");
  assert.equal(proposal.classification, "safe");

  await applyPatchProposal(root, proposal, { allowWrites: true });
  const validation = await validatePatchByRescan(root, proposal);

  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "PackageManager : pnpm\nAlways use `pnpm test`.\n");
  assert.equal(validation.ok, true);
});

test("applies partial unified diff hunks without dropping untouched file content", async () => {
  const root = await fixture();
  await write(root, "README.md", ["before", "Run npm test.", "after", ""].join("\n"));

  await applyPatchProposal(
    root,
    {
      kind: "llm_draft",
      findingId: "finding-1",
      docPath: "README.md",
      requiresHumanReview: true,
      unifiedDiff: [
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -2,1 +2,1 @@",
        "-Run npm test.",
        "+Run pnpm test.",
        ""
      ].join("\n")
    },
    { allowWrites: true }
  );

  assert.equal(await readFile(join(root, "README.md"), "utf8"), "before\nRun pnpm test.\nafter\n");
});

test("rejects patch proposals that target files outside the repository root", async () => {
  const root = await fixture();
  const outside = join(root, "..", "evidoc-outside.md");
  await writeFile(outside, "before\n", "utf8");

  await assert.rejects(
    () =>
      applyPatchProposal(
        root,
        {
          kind: "llm_draft",
          findingId: "finding-1",
          docPath: "../evidoc-outside.md",
          requiresHumanReview: true,
          unifiedDiff: [
            "--- a/../evidoc-outside.md",
            "+++ b/../evidoc-outside.md",
            "@@ -1,1 +1,1 @@",
            "-before",
            "+after",
            ""
          ].join("\n")
        },
        { allowWrites: true }
      ),
    /outside repository root/
  );
  assert.equal(await readFile(outside, "utf8"), "before\n");
});

test("rejects patch proposals whose diff touches a different path", async () => {
  const root = await fixture();
  await write(root, "README.md", "before\n");

  await assert.rejects(
    () =>
      applyPatchProposal(
        root,
        {
          kind: "llm_draft",
          findingId: "finding-1",
          docPath: "README.md",
          requiresHumanReview: true,
          unifiedDiff: ["--- a/OTHER.md", "+++ b/OTHER.md", "@@ -1,1 +1,1 @@", "-before", "+after", ""].join("\n")
        },
        { allowWrites: true }
      ),
    /outside the evidence document/
  );
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "before\n");
});

test("rejects patch proposals that resolve through symlinks outside the repository root", async () => {
  const root = await fixture();
  const outside = await fixture();
  await write(outside, "README.md", "before\n");
  await symlink(outside, join(root, "linked-docs"), "dir");

  await assert.rejects(
    () =>
      applyPatchProposal(
        root,
        {
          kind: "llm_draft",
          findingId: "finding-1",
          docPath: "linked-docs/README.md",
          requiresHumanReview: true,
          unifiedDiff: [
            "--- a/linked-docs/README.md",
            "+++ b/linked-docs/README.md",
            "@@ -1,1 +1,1 @@",
            "-before",
            "+after",
            ""
          ].join("\n")
        },
        { allowWrites: true }
      ),
    /outside repository root/
  );
  assert.equal(await readFile(join(outside, "README.md"), "utf8"), "before\n");
});

test("calls an opt-in OpenAI-compatible patch provider", async () => {
  const report = await checkRepository(await fixture());
  const request = createLlmPatchRequest(report, {
    id: "finding-1",
    ruleId: "path.missing-reference",
    severity: "high",
    status: "broken",
    docPath: "README.md",
    line: 1,
    message: "missing path",
    evidence: [],
    suggestedAction: "fix"
  });

  assert.doesNotMatch(request.prompt, /reportRoot/);
  assert.doesNotMatch(request.prompt, new RegExp(escapeRegExp(report.root)));

  const response = await callOpenAiCompatiblePatchProvider(request, {
    endpoint: "https://example.invalid/v1/chat/completions",
    apiKey: "test-key",
    model: "test-model",
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      assert.match(String(headers.authorization), /Bearer test-key/);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  findingId: "finding-1",
                  docPath: "README.md",
                  unifiedDiff: "--- a/README.md\n+++ b/README.md\n@@\n-old\n+new\n"
                })
              }
            }
          ]
        })
      );
    }
  });

  assert.equal(response.findingId, "finding-1");
  assert.match(response.unifiedDiff, /README\.md/);
});

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
