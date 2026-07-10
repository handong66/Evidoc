import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkRepository, readRepository, resolveExistingPathInsideRoot } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("reports package manager drift in documented commands", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({
      packageManager: "pnpm@10.0.0",
      scripts: { test: "vitest" }
    })
  );
  await write(root, "README.md", "Run `npm test` before opening a PR.\n");

  const report = await checkRepository(root);

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].ruleId, "command.package-manager-mismatch");
  assert.equal(report.findings[0].status, "review_needed");
  assert.match(report.findings[0].message, /uses npm/i);
});

test("reports npx commands that conflict with the repository package manager", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({
      packageManager: "pnpm@10.0.0",
      scripts: { lint: "eslint ." }
    })
  );
  await write(root, "README.md", "Run `npx eslint` before opening a PR.\n");

  const report = await checkRepository(root);

  assert.equal(
    report.findings.filter((finding) => finding.ruleId === "command.package-manager-mismatch").length,
    1
  );
  assert.equal(report.findings.some((finding) => finding.ruleId === "command.unknown-script"), false);
});

test("does not report scoped external npx packages as repository package-manager drift", async () => {
  const root = await fixture();
  await write(root, "package.json", JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "node --test" } }));
  await write(root, "README.md", "Install with `npx repo-evidoc` or `npx -p @handong66/evidoc-mcp-server repo-evidoc-mcp`.\n");

  const report = await checkRepository(root);

  assert.equal(report.findings.length, 0);
});

test("does not report package-manager subcommands as missing package scripts", async () => {
  const root = await fixture();
  await write(root, "package.json", JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "node --test" } }));
  await write(
    root,
    "README.md",
    [
      "Release checks:",
      "",
      "```sh",
      "npm whoami",
      "npm view repo-evidoc name version --json",
      "npm publish ./packages/core --dry-run --access public",
      "npm run missing",
      "```"
    ].join("\n")
  );

  const report = await checkRepository(root);

  assert.deepEqual(
    report.findings.filter((finding) => finding.ruleId === "command.unknown-script").map((finding) => finding.evidence[0].subject),
    ["npm run missing"]
  );
});

test("does not infer npm when package manager evidence is absent", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({
      scripts: { test: "vitest" }
    })
  );
  await write(root, "README.md", "Run `pnpm test` before opening a PR.\n");

  const report = await checkRepository(root);

  assert.equal(report.findings.length, 0);
});

test("does not treat parent traversal references as existing outside the repository root", async () => {
  const root = await fixture();
  const outsideName = "evidoc-existing-outside.ts";
  await writeFile(join(root, "..", outsideName), "export const outside = true;\n", "utf8");
  await write(root, "README.md", `Outside code lives in \`../${outsideName}\`.\n`);

  const report = await checkRepository(root);

  const finding = report.findings.find((candidate) => candidate.ruleId === "path.missing-reference");
  assert.equal(finding?.evidence[0].subject, `../${outsideName}`);
});

test("resolves Markdown links relative to the document directory", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Root documentation\n");
  await write(root, "docs/guide.md", "[Back to the root README](../README.md)\n");

  const report = await checkRepository(root);

  assert.equal(
    report.findings.some(
      (finding) => finding.ruleId === "path.missing-reference" && finding.evidence[0]?.subject === "../README.md"
    ),
    false
  );
});

test("does not treat symlinked paths that resolve outside the repository root as existing", async () => {
  const root = await fixture();
  const outside = await fixture();
  await write(outside, "secret.ts", "export const secret = true;\n");
  await symlink(outside, join(root, "src"), "dir");
  await write(root, "README.md", "Implementation lives in `src/secret.ts`.\n");

  const report = await checkRepository(root);

  const finding = report.findings.find((candidate) => candidate.ruleId === "path.missing-reference");
  assert.equal(finding?.evidence[0].subject, "src/secret.ts");
});

test("returns canonical real paths for existing repository-relative paths", async () => {
  const root = await fixture();
  await write(root, "src/real.md", "# Real\n");
  await symlink(join(root, "src"), join(root, "linked-src"), "dir");

  const target = await resolveExistingPathInsideRoot(root, "linked-src/real.md");

  assert.equal(target, await realpath(join(root, "src", "real.md")));
});

test("repository index ignores platform metadata files", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".DS_Store", "metadata\n");
  await write(root, "src/.DS_Store", "metadata\n");

  const snapshot = await readRepository(root);

  assert.equal(snapshot.files.has(".DS_Store"), false);
  assert.equal(snapshot.files.has("src/.DS_Store"), false);
  assert.equal(snapshot.files.has("README.md"), true);
});

test("reports missing local source path references", async () => {
  const root = await fixture();
  await write(root, "README.md", "Auth code lives in `src/auth/token.ts`.\n");
  await write(root, "src/auth/token-store.ts", "export const tokenStore = true;\n");

  const report = await checkRepository(root);

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].ruleId, "path.missing-reference");
  assert.equal(report.findings[0].status, "broken");
  assert.equal(report.findings[0].evidence[0].subject, "src/auth/token.ts");
});

test("ignores documents with an explicit ignore-file directive", async () => {
  const root = await fixture();
  await write(
    root,
    "docs/reference/full-plan.md",
    "<!-- evidoc: ignore-file -->\nExample path: `src/auth/token.ts`.\n"
  );

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 0);
  assert.equal(report.findings.length, 0);
});

test("reports review-needed when no documents are scanned", async () => {
  const root = await fixture();
  await write(root, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 0);
  assert.equal(report.summary.reviewNeeded, 1);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].ruleId, "coverage.no-documents-scanned");
  assert.equal(report.findings[0].status, "review_needed");
  assert.match(report.findings[0].message, /No documentation files were scanned/);
  assert.match(report.findings[0].suggestedAction, /README\.md|docRoots/);
});

test("does not report zero-document coverage when configured docs are explicitly ignored", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["docs"] }));
  await write(root, "docs/generated.md", "<!-- evidoc: ignore-file -->\nGenerated reference.\n");

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 0);
  assert.equal(report.findings.some((finding) => finding.ruleId === "coverage.no-documents-scanned"), false);
});

test("reports zero-document coverage when configured doc roots contain no Markdown", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["docs"] }));
  await write(root, "docs/reference.txt", "No Markdown files live here.\n");

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 0);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].ruleId, "coverage.no-documents-scanned");
});

test("agent instruction coverage does not mask empty configured document roots", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["docs"] }));
  await write(root, "docs/reference.txt", "No Markdown files live here.\n");
  await write(root, "AGENTS.md", "Always use `npm test`.\n");

  const report = await checkRepository(root);

  assert.ok(report.documents.some((document) => document.path === "AGENTS.md"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "coverage.no-documents-scanned"));
});

test("normalizes configured document roots with trailing slashes", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["docs/"] }));
  await write(root, "docs/guide.md", "# Guide\n");

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 1);
  assert.equal(report.findings.some((finding) => finding.ruleId === "config.missing-path"), false);
  assert.equal(report.findings.some((finding) => finding.ruleId === "coverage.no-documents-scanned"), false);
});

test("always scans agent instruction files even outside configured document roots", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(root, "README.md", "# Example\n");
  await write(root, "AGENTS.md", "Always use `npm test`.\nProject policy lives in `docs/missing.md`.\n");
  await write(root, "CLAUDE.md", "Never use `npm test`.\n");

  const report = await checkRepository(root);

  assert.deepEqual(
    report.documents.map((document) => document.path).sort(),
    ["AGENTS.md", "CLAUDE.md", "README.md"]
  );
  assert.ok(report.findings.some((finding) => finding.ruleId === "agent_instruction.contradiction"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "agent_instruction.missing-path"));
});

test("scans Markdown files with uppercase extensions", async () => {
  const root = await fixture();
  await write(root, "README.MD", "# Uppercase extension\n");

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 1);
  assert.equal(report.documents[0].path, "README.MD");
  assert.equal(report.findings.some((finding) => finding.ruleId === "coverage.no-documents-scanned"), false);
});
