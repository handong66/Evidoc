#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const lines = changelog.split(/\r?\n/);
const headingIndex = lines.findIndex((line) => line.startsWith("## "));
const nextHeadingIndex =
  headingIndex < 0
    ? -1
    : lines.findIndex((line, index) => index > headingIndex && line.startsWith("## "));

if (headingIndex < 0) {
  console.error("No release notes found in CHANGELOG.md.");
  process.exitCode = 1;
} else {
  const title = lines[headingIndex].replace(/^##\s+/, "");
  const body = lines
    .slice(headingIndex + 1, nextHeadingIndex > headingIndex ? nextHeadingIndex : undefined)
    .join("\n")
    .trim();
  process.stdout.write(`# Evidoc ${title}\n\n${body}\n`);
}
