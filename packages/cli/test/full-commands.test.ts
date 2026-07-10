import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli } from "../src/index.js";

async function fixture(prefix = "evidoc-cli-full-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("prints graph JSON for the current repository", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["graph", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const graph = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.ok(graph.nodes.some((node: { id: string }) => node.id === "document:README.md"));
});

test("writes dashboard output when requested", async () => {
  const root = await fixture();
  const outputPath = join(root, "evidoc-dashboard.html");
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const exitCode = await runCli(["dashboard", "--out", outputPath], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });

  const html = await readFile(outputPath, "utf8");
  assert.equal(exitCode, 0);
  assert.match(html, /Evidoc Dashboard/);
});

test("prints multi-repository aggregate JSON", async () => {
  const first = await fixture("evidoc-cli-first-");
  const second = await fixture("evidoc-cli-second-");
  await write(first, "README.md", "Clean.\n");
  await write(second, "README.md", "Code lives in `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["multi", "--root", first, "--root", second, "--json"], {
    cwd: first,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const aggregate = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(aggregate.summary.repositoriesScanned, 2);
  assert.equal(aggregate.summary.findings, 1);
});

test("prints deterministic patch drafts as JSON", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "README.md", "Run `npm test`.\n");

  let stdout = "";
  const exitCode = await runCli(["draft", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const proposals = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(proposals[0].kind, "safe_deterministic");
  assert.match(proposals[0].unifiedDiff, /pnpm test/);
});

test("prints an agent evaluation benchmark pack as JSON", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "README.md", "Run `npm test`.\n");

  let stdout = "";
  const exitCode = await runCli(["agent-eval", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const evaluation = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(evaluation.root, "<redacted-local-repository-root>");
  assert.equal(evaluation.benchmark.id, "evidoc-agent-ab-v0");
  assert.equal(evaluation.coverage.mcpDefaultTool, "evidoc.agent_scan");
  assert.equal(evaluation.coverage.safeAutoFixCandidates, 1);
  assert.ok(evaluation.abProtocol.agents.includes("opencode"));
  assert.ok(evaluation.tasks.some((task: { id: string }) => task.id === "read_parity_repair"));
  assert.equal(evaluation.privacy.telemetry, "disabled_by_default");
});

test("prints generic local CI recipes that call the same Evidoc CLI", async () => {
  let stdout = "";
  const exitCode = await runCli(["recipes", "--target", "all"], {
    cwd: await fixture(),
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /GitLab CI/);
  assert.match(stdout, /Jenkins/);
  assert.match(stdout, /Gitea Actions/);
  assert.match(stdout, /Buildkite/);
  assert.match(stdout, /evidoc guard --event pre-push --since merge-base:\$EVIDOC_BASE_BRANCH/);
});

test("check --root scans a target repository from a source checkout", async () => {
  const sourceCheckout = await fixture("evidoc-cli-source-");
  const target = await fixture("evidoc-cli-target-");
  await write(sourceCheckout, "README.md", "Source checkout docs are clean.\n");
  await write(target, "README.md", "Code lives in `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["check", "--root", target, "--json"], {
    cwd: sourceCheckout,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(report.root, target);
  assert.equal(report.findings[0].docPath, "README.md");
  assert.equal(report.findings[0].ruleId, "path.missing-reference");
});

test("rejects unknown CLI options instead of silently ignoring requested outputs", async () => {
  const root = await fixture();
  await write(root, "README.md", "Clean.\n");

  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["action", "--summry", join(root, "summary.md")], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  assert.equal(exitCode, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown option: --summry/);
  assert.match(stderr, /evidoc action/);
});

test("rejects invalid fail-on policies instead of silently disabling the gate", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");
  let stderr = "";

  const exitCode = await runCli(["action", "--fail-on=revie_needed"], {
    cwd: root,
    stdout: () => {},
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  assert.equal(exitCode, 2);
  assert.match(stderr, /Invalid --fail-on value "revie_needed"/);
  assert.match(stderr, /none, broken, or review_needed/);
});

test("action accepts PR comment and annotation file aliases for local smoke runs", async () => {
  const root = await fixture();
  const summaryPath = join(root, "comment.md");
  const annotationsPath = join(root, "annotations.txt");
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const exitCode = await runCli(
    ["action", "--fail-on=none", "--pr-comment-file", summaryPath, "--annotations-file", annotationsPath],
    {
      cwd: root,
      stdout: () => {},
      stderr: () => {}
    }
  );

  assert.equal(exitCode, 0);
  assert.match(await readFile(summaryPath, "utf8"), /Evidoc Report/);
  assert.match(await readFile(annotationsPath, "utf8"), /path\.missing-reference/);
});

test("action accepts github format flag for copied CI-like commands", async () => {
  const root = await fixture();
  const summaryPath = join(root, "comment.md");
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const exitCode = await runCli(["action", "--fail-on=none", "--format=github", "--summary", summaryPath], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(await readFile(summaryPath, "utf8"), /Evidoc Report/);
});

test("fix --safe --write --root applies safe fixes to a target repository", async () => {
  const sourceCheckout = await fixture("evidoc-cli-source-");
  const target = await fixture("evidoc-cli-target-");
  await write(
    target,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(target, "README.md", "Run `npm test`.\n");

  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["fix", "--safe", "--write", "--root", target, "--json"], {
    cwd: sourceCheckout,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 0, stderr);
  assert.equal(result.applied.length, 1);
  assert.equal(await readFile(join(target, "README.md"), "utf8"), "Run `pnpm test`.\n");
});

test("fix --write requires --safe before applying repository changes", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "README.md", "Run `npm test`.\n");

  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["fix", "--write", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /requires --safe/);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "Run `npm test`.\n");
});

test("fix --safe --write applies multiple safe fixes in the same file", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "AGENTS.md", "packageManager: npm\nAlways use `npm test`.\n");

  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["fix", "--safe", "--write", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 0, stderr);
  assert.equal(result.applied.length, 2);
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "packageManager: pnpm\nAlways use `pnpm test`.\n");

  stdout = "";
  const checkExitCode = await runCli(["check", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });
  const report = JSON.parse(stdout);
  assert.equal(checkExitCode, 0);
  assert.equal(report.summary.findings, 0);
});

test("fix --safe --write reports remaining non-safe proposals as skipped", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "README.md", "Run `npm test`.\nMissing path: `src/missing.ts`.\n");

  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["fix", "--safe", "--write", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 0, stderr);
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.postFixSummary.findings, 1);
  assert.equal(result.postFixSummary.broken, 1);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "Run `pnpm test`.\nMissing path: `src/missing.ts`.\n");
});

test("fix --safe --write applies more than one hundred safe fixes", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  for (let index = 0; index < 101; index += 1) {
    await write(root, `docs/page-${index}.md`, "Run `npm test`.\n");
  }

  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["fix", "--safe", "--write", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 0, stderr);
  assert.equal(result.applied.length, 101);
  assert.equal(result.truncated, false);
  assert.equal(await readFile(join(root, "docs/page-100.md"), "utf8"), "Run `pnpm test`.\n");
});

test("explains a current finding by index", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["explain", "0", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const finding = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(finding.ruleId, "path.missing-reference");
});

test("prints a repository index for agent use", async () => {
  const root = await fixture();
  await write(root, "README.md", "Documented.\n");
  await write(root, "src/index.ts", "export const ok = true;\n");

  let stdout = "";
  const exitCode = await runCli(["index", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const index = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.ok(index.files.includes("src/index.ts"));
  assert.equal(index.documents[0].path, "README.md");
});

test("validates a patch proposal file against current evidence", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "README.md", "Run `npm test`.\n");

  let draftStdout = "";
  await runCli(["draft", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      draftStdout += chunk;
    },
    stderr: () => {}
  });
  const [proposal] = JSON.parse(draftStdout);
  const proposalPath = join(root, "proposal.json");
  await writeFile(proposalPath, JSON.stringify(proposal), "utf8");

  let stdout = "";
  const exitCode = await runCli(["validate", "--proposal", proposalPath, "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const validation = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(validation.ok, true);
});

test("validates the full draft output file without extracting one proposal", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" } })
  );
  await write(root, "README.md", "Run `npm test`.\n");

  let draftStdout = "";
  await runCli(["draft", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      draftStdout += chunk;
    },
    stderr: () => {}
  });
  const proposalPath = join(root, "proposals.json");
  await writeFile(proposalPath, draftStdout, "utf8");

  let stdout = "";
  const exitCode = await runCli(["validate", "--proposal", proposalPath, "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const validation = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(validation.ok, true);
  assert.equal(validation.proposals, 1);
  assert.deepEqual(validation.errors, []);
});
