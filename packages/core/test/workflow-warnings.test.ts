import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectEvidocWorkflowText,
  evidocWorkflowWarnings,
  isEvidocWorkflowText,
  workflowLocalActionPaths
} from "../src/index.js";

test("recognizes source-checkout Evidoc CLI workflows", () => {
  const commands = [
    "npm run evidoc",
    "npm run evidoc -- --fail-on=review_needed",
    "npm --silent run evidoc -- --fail-on=review_needed",
    "npm --prefix packages/cli run evidoc -- --fail-on=review_needed",
    "npm run --silent evidoc -- --fail-on=review_needed",
    "npm run --prefix packages/cli evidoc -- --fail-on=review_needed",
    "npx evidoc check --fail-on=review_needed",
    "npx evidoc check --fail-on=review_needed",
    "pnpm evidoc --fail-on=review_needed",
    "pnpm run evidoc --fail-on=review_needed",
    "pnpm --filter . run evidoc --fail-on=review_needed",
    "pnpm exec evidoc check --fail-on=review_needed",
    "pnpm dlx evidoc check --fail-on=review_needed",
    "pnpm dlx evidoc check --fail-on=review_needed",
    "yarn evidoc --fail-on=review_needed",
    "yarn run evidoc --fail-on=review_needed",
    "yarn --cwd . run evidoc --fail-on=review_needed",
    "yarn exec evidoc --fail-on=review_needed",
    "yarn --cwd . exec evidoc --fail-on=review_needed",
    "yarn dlx evidoc check --fail-on=review_needed",
    "yarn dlx evidoc check --fail-on=review_needed",
    "bun run evidoc --fail-on=review_needed",
    "bunx evidoc check --fail-on=review_needed",
    "bunx evidoc check --fail-on=review_needed",
    "evidoc check --fail-on=review_needed"
  ];

  for (const command of commands) {
    assert.equal(
      isEvidocWorkflowText(
        [
          "name: CI",
          "on:",
          "  pull_request:",
          "jobs:",
          "  test:",
          "    steps:",
          `      - run: ${command}`,
          ""
        ].join("\n")
      ),
      true,
      command
    );
  }
});

test("recognizes source-checkout Evidoc CLI workflows in shell blocks", () => {
  assert.equal(
    isEvidocWorkflowText(
      [
        "name: CI",
        "jobs:",
        "  test:",
        "    steps:",
        "      - run: |",
        "          npm run evidoc -- \\",
        "            --fail-on=review_needed",
        ""
      ].join("\n")
    ),
    true
  );
});

test("recognizes legacy DriftGuard packaged action workflows after repository rename", () => {
  assert.equal(
    isEvidocWorkflowText(
      [
        "name: Legacy docs gate",
        "jobs:",
        "  evidoc:",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: handong66/DriftGuard/packages/github-action@main",
        "        with:",
        "          fail-on: review_needed",
        ""
      ].join("\n")
    ),
    true
  );
});

test("does not recognize packaged action mentions outside uses steps", () => {
  assert.equal(
    isEvidocWorkflowText(
      [
        "name: Mentions old action only",
        "env:",
        "  OLD_ACTION: handong66/DriftGuard/packages/github-action@main",
        "jobs:",
        "  test:",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          cache-dependency-path: handong66/Evidoc/packages/github-action@main",
        "      # Former gate used handong66/DriftGuard/packages/github-action@main.",
        "      - run: echo handong66/Evidoc/packages/github-action@main",
        "      - run: |",
        "          echo handong66/DriftGuard/packages/github-action@main",
        ""
      ].join("\n")
    ),
    false
  );
});

test("does not recognize comments or echo text as Evidoc workflows", () => {
  const workflow = [
    "name: Mentions Evidoc only",
    "on: pull_request",
    "jobs:",
    "  test:",
    "    steps:",
      "      # Verify locally with evidoc check before pushing.",
      "      - name: Install evidoc dependencies",
      "        run: echo \"evidoc guard completed\"",
      "      - run: npm run test evidoc",
      "      - run: npm run test -- evidoc",
      ""
    ].join("\n");

  assert.equal(isEvidocWorkflowText(workflow), false);
});

test("extracts safe local action paths from workflow uses steps", () => {
  const workflow = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: ./.github/actions/evidoc-check",
    "      - uses: './.github/actions/quoted-check' # local wrapper",
    "      - uses: './.github/actions/commented-check' # @main belongs to the comment",
    "      - uses: ./.github/actions/evidoc-check",
    "      - uses: ./../outside",
    "      - uses: ./.github/actions/invalid@main",
    ""
  ].join("\n");

  assert.deepEqual(workflowLocalActionPaths(workflow), [
    ".github/actions/evidoc-check",
    ".github/actions/quoted-check",
    ".github/actions/commented-check"
  ]);
});

test("detects Evidoc through recursive local action entrypoints", async () => {
  const workflow = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: ./.github/actions/wrapper",
    ""
  ].join("\n");
  const actions = new Map([
    [
      ".github/actions/wrapper",
      {
        path: ".github/actions/wrapper/action.yml",
        text: [
          "name: Wrapper",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - uses: ./.github/actions/evidoc-check",
          ""
        ].join("\n")
      }
    ],
    [
      ".github/actions/evidoc-check",
      {
        path: ".github/actions/evidoc-check/action.yml",
        text: [
          "name: Evidoc check",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - shell: bash",
          "      run: npm run evidoc -- --fail-on=review_needed",
          ""
        ].join("\n")
      }
    ]
  ]);

  const detection = await detectEvidocWorkflowText(workflow, async (path) => actions.get(path));

  assert.equal(detection.matches, true);
  assert.deepEqual(
    detection.localActions.map((action) => action.path),
    [".github/actions/evidoc-check/action.yml"]
  );
});

test("detects packaged Evidoc action through recursive local action entrypoints", async () => {
  const workflow = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: ./.github/actions/evidoc-wrapper",
    ""
  ].join("\n");
  const actions = new Map([
    [
      ".github/actions/evidoc-wrapper",
      {
        path: ".github/actions/evidoc-wrapper/action.yml",
        text: [
          "name: Evidoc wrapper",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - uses: handong66/Evidoc/packages/github-action@main",
          "      with:",
          "        fail-on: review_needed",
          ""
        ].join("\n")
      }
    ]
  ]);

  const detection = await detectEvidocWorkflowText(workflow, async (path) => actions.get(path));

  assert.equal(detection.matches, true);
  assert.deepEqual(
    detection.localActions.map((action) => action.path),
    [".github/actions/evidoc-wrapper/action.yml"]
  );
});

test("ignores local action-like text inside shell blocks", async () => {
  const workflow = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: |",
    "          echo preparing docs",
    "          uses: ./.github/actions/evidoc-check",
    ""
  ].join("\n");
  const actions = new Map([
    [
      ".github/actions/evidoc-check",
      {
        path: ".github/actions/evidoc-check/action.yml",
        text: "runs:\n  using: composite\n  steps:\n    - run: npm run evidoc -- --fail-on=review_needed\n"
      }
    ]
  ]);

  const detection = await detectEvidocWorkflowText(workflow, async (path) => actions.get(path));

  assert.equal(detection.matches, false);
  assert.deepEqual(workflowLocalActionPaths(workflow), []);
});

test("ignores local action-like values outside steps blocks", async () => {
  const workflow = [
    "env:",
    "  uses: ./.github/actions/evidoc-check",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: npm test",
    ""
  ].join("\n");
  const actions = new Map([
    [
      ".github/actions/evidoc-check",
      {
        path: ".github/actions/evidoc-check/action.yml",
        text: "runs:\n  using: composite\n  steps:\n    - run: npm run evidoc -- --fail-on=review_needed\n"
      }
    ]
  ]);

  const detection = await detectEvidocWorkflowText(workflow, async (path) => actions.get(path));

  assert.equal(detection.matches, false);
  assert.deepEqual(workflowLocalActionPaths(workflow), []);
});

test("bounds and deduplicates recursive local action detection", async () => {
  const cycleWorkflow = "jobs:\n  test:\n    steps:\n      - uses: ./.github/actions/a\n";
  const cycleActions = new Map([
    [
      ".github/actions/a",
      {
        path: ".github/actions/a/action.yml",
        text: "runs:\n  using: composite\n  steps:\n    - uses: ./.github/actions/b\n"
      }
    ],
    [
      ".github/actions/b",
      {
        path: ".github/actions/b/action.yml",
        text: "runs:\n  using: composite\n  steps:\n    - uses: ./.github/actions/a\n"
      }
    ]
  ]);

  const cycleDetection = await detectEvidocWorkflowText(cycleWorkflow, async (path) => cycleActions.get(path));
  assert.equal(cycleDetection.matches, false);

  const deepWorkflow = "jobs:\n  test:\n    steps:\n      - uses: ./.github/actions/a1\n";
  const deepActions = new Map<string, { path: string; text: string }>();
  for (let index = 1; index <= 6; index += 1) {
    const next = index === 6 ? "run: npm run evidoc -- --fail-on=review_needed" : `uses: ./.github/actions/a${index + 1}`;
    deepActions.set(`.github/actions/a${index}`, {
      path: `.github/actions/a${index}/action.yml`,
      text: ["runs:", "  using: composite", "  steps:", `    - ${next}`, ""].join("\n")
    });
  }

  const defaultDepthDetection = await detectEvidocWorkflowText(deepWorkflow, async (path) => deepActions.get(path));
  const expandedDepthDetection = await detectEvidocWorkflowText(deepWorkflow, async (path) => deepActions.get(path), {
    maxLocalActionDepth: 6
  });

  assert.equal(defaultDepthDetection.matches, false);
  assert.equal(expandedDepthDetection.matches, true);
});

test("workflow warnings detect inline pull_request and push triggers", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on: [pull_request, push]",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "true"',
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /duplicate push and pull-request checks/);
});

test("workflow warnings accept branch filters and single-quoted PR comments", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches: ['main']",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      "          pr-comment: 'true'",
      ""
    ].join("\n"),
    "main"
  );

  assert.deepEqual(warnings, []);
});

test("workflow warnings report disabled PR comments and missing default branch", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches:",
      "      - trunk",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "false"',
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /push\.branches does not include detected default branch main/);
  assert.match(warnings.join("\n"), /PR comments are disabled/);
});

test("workflow warnings report security-events permission when SARIF is disabled", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "permissions:",
      "  contents: read",
      "  actions: read",
      "  security-events: write",
      "  pull-requests: write",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          sarif: "false"',
      '          pr-comment: "true"',
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /security-events: write is only needed when sarif: "true"/);
});

test("workflow warnings report advisory fail-on policy", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      "          fail-on: broken",
      '          pr-comment: "true"',
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /fail-on: broken is advisory/);
  assert.match(warnings.join("\n"), /fail-on: review_needed/);
});

test("workflow warnings allow review-needed fail-on policy", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      "          fail-on: review_needed",
      '          pr-comment: "true"',
      ""
    ].join("\n"),
    "main"
  );

  assert.deepEqual(warnings, []);
});

test("workflow warnings audit legacy packaged action workflows", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/driftguard.yml",
    [
      "name: Legacy docs gate",
      "on:",
      "  pull_request:",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/DriftGuard/packages/github-action@main",
      "        with:",
      '          pr-comment: "false"',
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /PR comments are disabled/);
});

test("workflow warnings audit legacy packaged action fail policy and SARIF permissions", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/driftguard.yml",
    [
      "name: Legacy docs gate",
      "on:",
      "  pull_request:",
      "permissions:",
      "  contents: read",
      "  security-events: write",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/DriftGuard/packages/github-action@main",
      "        with:",
      "          fail-on: broken",
      '          sarif: "false"',
      '          pr-comment: "true"',
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /fail-on: broken is advisory/);
  assert.match(warnings.join("\n"), /security-events: write is only needed when sarif: "true"/);
});

test("workflow warnings report advisory fail-on policy in source-checkout commands", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - run: npm run evidoc -- --fail-on=broken",
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /fail-on: broken is advisory/);
  assert.doesNotMatch(warnings.join("\n"), /PR comments are disabled/);
});

test("workflow warnings accept quoted source-checkout fail-on broken commands", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "jobs:",
      "  evidoc:",
      "    steps:",
      '      - run: npm run evidoc -- --fail-on="broken"',
      ""
    ].join("\n"),
    "main"
  );

  assert.match(warnings.join("\n"), /fail-on: broken is advisory/);
});

test("workflow warnings ignore advisory fail-on text in comments", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      # Previous rollout used --fail-on=broken.",
      "      - run: npm run evidoc -- --fail-on=review_needed # not --fail-on=broken",
      ""
    ].join("\n"),
    "main"
  );

  assert.doesNotMatch(warnings.join("\n"), /fail-on: broken is advisory/);
});

test("workflow warnings do not require PR comments for direct CLI action runs", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - run: evidoc action --fail-on=review_needed",
      ""
    ].join("\n"),
    "main"
  );

  assert.doesNotMatch(warnings.join("\n"), /PR comments are disabled/);
});

test("workflow warnings allow security-events permission when SARIF is enabled", () => {
  const warnings = evidocWorkflowWarnings(
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "permissions:",
      "  contents: read",
      "  actions: read",
      "  security-events: write",
      "  pull-requests: write",
      "jobs:",
      "  evidoc:",
      "    steps:",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      "          sarif: 'true'",
      '          pr-comment: "true"',
      ""
    ].join("\n"),
    "main"
  );

  assert.deepEqual(warnings, []);
});
