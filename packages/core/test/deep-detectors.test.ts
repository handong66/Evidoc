import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkRepository } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-deep-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("resolves exported TypeScript symbol aliases through AST", async () => {
  const root = await fixture();
  await write(root, "src/service.ts", "const removeUser = () => true;\nexport { removeUser as deleteUser };\n");
  await write(root, "README.md", "Public API symbol: `src/service.ts#deleteUser`.\n");

  const report = await checkRepository(root);

  assert.equal(report.findings.filter((finding) => finding.ruleId === "symbol.missing-reference").length, 0);
});

test("reports request and response schema drift from OpenAPI references", async () => {
  const root = await fixture();
  await write(
    root,
    "openapi.json",
    JSON.stringify({
      openapi: "3.1.0",
      components: {
        schemas: {
          CreateUser: { type: "object" },
          User: { type: "object" }
        }
      },
      paths: {
        "/v1/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreateUser" }
                }
              }
            },
            responses: {
              "201": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/User" }
                  }
                }
              }
            }
          }
        }
      }
    })
  );
  await write(root, "README.md", "Endpoint: `POST /v1/users request: MissingUser response: User`.\n");

  const report = await checkRepository(root);

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].ruleId, "api.schema-mismatch");
  assert.match(report.findings[0].message, /request schema/i);
});

test("reports one-sided OpenAPI request schema drift", async () => {
  const root = await fixture();
  await write(
    root,
    "openapi.json",
    JSON.stringify({
      openapi: "3.1.0",
      components: {
        schemas: {
          CreateUser: { type: "object" },
          User: { type: "object" }
        }
      },
      paths: {
        "/v1/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreateUser" }
                }
              }
            },
            responses: {
              "201": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/User" }
                  }
                }
              }
            }
          }
        }
      }
    })
  );
  await write(root, "README.md", "Endpoint: `POST /v1/users request: MissingUser`.\n");

  const report = await checkRepository(root);

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].ruleId, "api.schema-mismatch");
  assert.match(report.findings[0].message, /request schema/i);
});

test("reports agent instruction package-manager conflicts and semantic package claims", async () => {
  const root = await fixture();
  await write(root, "package.json", JSON.stringify({ name: "evidoc-fixture", version: "0.1.0" }));
  await write(root, "AGENTS.md", "packageManager: pnpm\n");
  await write(root, "CLAUDE.md", "packageManager: npm\n");
  await write(root, "README.md", "Release claim: `claim:package.version=9.9.9`.\n");

  const report = await checkRepository(root);

  assert.ok(report.findings.some((finding) => finding.ruleId === "agent_instruction.conflict"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "claim.package-field-mismatch"));
});

test("reports agent instruction package-manager fields that drift from repository evidence", async () => {
  const root = await fixture();
  await write(root, "package.json", JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } }));
  await write(root, "AGENTS.md", "packageManager: npm\nAlways use `pnpm test`.\n");
  await write(root, "CLAUDE.md", "packageManager: npm\nAlways use `pnpm test`.\n");

  const report = await checkRepository(root);

  const findings = report.findings.filter((finding) => finding.ruleId === "agent_instruction.package-manager-mismatch");
  assert.equal(findings.length, 2);
  assert.equal(findings[0].status, "review_needed");
  assert.match(findings[0].message, /declares npm/i);
  assert.equal(findings[0].evidence[0].expected, "pnpm");
});

test("preserves raw agent package-manager field evidence for non-canonical formatting", async () => {
  const root = await fixture();
  await write(root, "package.json", JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } }));
  await write(root, "AGENTS.md", "PackageManager : NPM\nAlways use `pnpm test`.\n");

  const report = await checkRepository(root);

  const finding = report.findings.find((candidate) => candidate.ruleId === "agent_instruction.package-manager-mismatch");
  assert.ok(finding);
  assert.equal(finding.evidence[0].subject, "PackageManager : NPM");
  assert.equal(finding.evidence[0].actual, "npm");
  assert.equal(finding.evidence[0].expected, "pnpm");
});

test("reports dedicated agent instruction drift for stale paths and contradictory rules", async () => {
  const root = await fixture();
  await write(root, "AGENTS.md", "Always use `npm test`.\nProject policy lives in `docs/missing.md`.\n");
  await write(root, "CLAUDE.md", "Never use `npm test`.\n");

  const report = await checkRepository(root);

  assert.ok(report.findings.some((finding) => finding.ruleId === "agent_instruction.contradiction"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "agent_instruction.missing-path"));
  assert.ok(!report.findings.some((finding) => finding.ruleId === "path.missing-reference"));
});

test("reports superseded ADR references from documents", async () => {
  const root = await fixture();
  await write(root, "docs/adr/0001-old.md", "# Old ADR\n\nStatus: superseded\n");
  await write(root, "README.md", "Architecture follows `ADR: docs/adr/0001-old.md`.\n");

  const report = await checkRepository(root);

  assert.equal(report.findings[0].ruleId, "adr.superseded-reference");
});
