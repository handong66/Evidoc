#!/usr/bin/env node
export { runCli } from "@evidoc/cli";

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runCli } from "@evidoc/cli";

function isDirectExecution(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return metaUrl === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return metaUrl === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
