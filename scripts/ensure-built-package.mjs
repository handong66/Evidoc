#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const entry = manifest.bin ? Object.values(manifest.bin)[0] : manifest.exports?.["."] ?? "./dist/src/index.js";
const target = join(root, String(entry).replace(/^\.\//, ""));

try {
  await access(target);
} catch {
  console.error(`Refusing to publish ${manifest.name ?? "package"} before build output exists at ${entry}.`);
  console.error("Run npm run build from the repository root before publishing.");
  process.exit(1);
}
