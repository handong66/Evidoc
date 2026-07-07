import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveExistingPathInsideRoot } from "./path-safety.js";
import type {
  ApiOperation,
  DocumentRecord,
  EvidocConfig,
  PackageManifest,
  RepositorySnapshot,
  ReviewLogEntry
} from "./types.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".opencode-plugin-codex",
  ".evidoc",
  "coverage",
  "dist",
  "node_modules"
]);
const IGNORED_FILE_NAMES = new Set([".DS_Store"]);

export interface ReadRepositoryOptions {
  changedFiles?: string[];
}

export async function readRepository(
  root: string,
  options: ReadRepositoryOptions = {}
): Promise<RepositorySnapshot> {
  const files = await listFiles(root);
  const config = await readConfig(root);
  const packageManifest = await readPackageManifest(root, files);
  const { documents, skippedOversized } = await readDocuments(root, files, config, options);
  const apiOperations = await readApiOperations(root, files, config);
  const reviewLog = await readReviewLog(root);

  return {
    root,
    files: new Set(files),
    documents,
    packageManifest,
    expectedPackageManager: detectPackageManager(packageManifest, files),
    apiOperations,
    config,
    reviewLog,
    skippedOversized
  };
}

export async function pathExists(root: string, candidate: string): Promise<boolean> {
  try {
    const target = await resolveExistingPathInsideRoot(root, candidate);
    if (!target) return false;
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      if (entry.isFile() && IGNORED_FILE_NAMES.has(entry.name)) {
        continue;
      }

      const absolute = join(current, entry.name);
      const repoRelative = relative(root, absolute).replaceAll("\\", "/");

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        results.push(repoRelative);
      }
    }
  }

  await walk(root);
  return results.sort();
}

async function readPackageManifest(
  root: string,
  files: string[]
): Promise<PackageManifest | undefined> {
  if (!files.includes("package.json")) {
    return undefined;
  }

  const raw = await readFile(join(root, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as {
    name?: string;
    version?: string;
    packageManager?: string;
    scripts?: Record<string, string>;
  };

  return {
    name: parsed.name,
    version: parsed.version,
    packageManager: parsed.packageManager,
    scripts: parsed.scripts ?? {}
  };
}

async function readDocuments(
  root: string,
  files: string[],
  config: EvidocConfig,
  options: ReadRepositoryOptions
): Promise<{ documents: DocumentRecord[]; skippedOversized: number }> {
  const restrictToChangedFiles = options.changedFiles !== undefined;
  const changedFiles = new Set(options.changedFiles?.map(normalizePath));
  const docs = files.filter(
    (file) => isMarkdown(file) && (isIncludedDocument(file, config) || isAgentInstruction(file))
  );
  const records: DocumentRecord[] = [];
  let skippedOversized = 0;

  for (const path of docs) {
    const size = await fileSize(root, path);
    if (config.maxFileBytes !== undefined && size > config.maxFileBytes) {
      skippedOversized += 1;
      continue;
    }

    if (restrictToChangedFiles && !changedFiles.has(path)) {
      continue;
    }

    const text = await readFile(join(root, path), "utf8");
    if (hasIgnoreFileDirective(text)) {
      continue;
    }

    records.push({
      path,
      kind: isAgentInstruction(path) ? "agent_instruction" : "markdown",
      lineCount: text.split(/\r?\n/).length,
      text
    });
  }

  return { documents: records, skippedOversized };
}

async function readApiOperations(
  root: string,
  files: string[],
  config: EvidocConfig
): Promise<ApiOperation[]> {
  const configured = config.apiSpecPaths ?? [];
  const specs = configured.length > 0
    ? configured.filter((file) => files.includes(file))
    : files.filter((file) => /(^|\/)(openapi|swagger)\.json$/i.test(file));
  const operations: ApiOperation[] = [];

  for (const specPath of specs) {
    const raw = await readFile(join(root, specPath), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const paths = asRecord(asRecord(parsed).paths);
    for (const [apiPath, methods] of Object.entries(paths)) {
      if (!apiPath.startsWith("/")) continue;
      for (const [method, operation] of Object.entries(asRecord(methods))) {
        const normalizedMethod = method.toUpperCase();
        if (!isHttpMethod(normalizedMethod)) continue;
        const operationId = asRecord(operation).operationId;
        operations.push({
          specPath,
          method: normalizedMethod,
          path: apiPath,
          operationId: typeof operationId === "string" ? operationId : undefined,
          requestSchemas: extractRequestSchemas(asRecord(operation)),
          responseSchemas: extractResponseSchemas(asRecord(operation))
        });
      }
    }
  }

  return operations;
}

async function readConfig(root: string): Promise<EvidocConfig> {
  try {
    const raw = await readFile(join(root, ".evidoc", "config.json"), "utf8");
    const parsed = JSON.parse(raw) as EvidocConfig;
    return {
      ...parsed,
      ignorePatterns: parsed.ignorePatterns ?? [],
      docRoots: parsed.docRoots?.map(normalizePath),
      apiSpecPaths: parsed.apiSpecPaths?.map(normalizePath)
    };
  } catch {
    return { ignorePatterns: [] };
  }
}

async function readReviewLog(root: string): Promise<ReviewLogEntry[]> {
  try {
    const raw = await readFile(join(root, ".evidoc", "review-log.jsonl"), "utf8");
    const entries: ReviewLogEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ReviewLogEntry;
        if (typeof parsed.findingId === "string" && typeof parsed.reviewedAt === "string") {
          entries.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function hasIgnoreFileDirective(text: string): boolean {
  return text.split(/\r?\n/, 12).some((line) => line.includes("evidoc: ignore-file"));
}

function isAgentInstruction(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  const name = normalized.split("/").at(-1);
  return (
    name === "agents.md" ||
    name === "claude.md" ||
    normalized === ".github/copilot-instructions.md" ||
    normalized.startsWith(".cursor/rules/")
  );
}

function isMarkdown(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdx");
}

function isIncludedDocument(path: string, config: EvidocConfig): boolean {
  const normalized = normalizePath(path);
  if (config.docRoots?.length && !config.docRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
    return false;
  }

  return !(config.ignorePatterns ?? []).some((pattern) => matchesGlob(normalized, pattern));
}

function detectPackageManager(
  manifest: PackageManifest | undefined,
  files: string[]
): RepositorySnapshot["expectedPackageManager"] {
  const declared = manifest?.packageManager?.split("@")[0];
  if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") {
    return declared;
  }

  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("package-lock.json")) return "npm";
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isHttpMethod(value: string): boolean {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"].includes(value);
}

function extractRequestSchemas(operation: Record<string, unknown>): string[] {
  const requestBody = asRecord(operation.requestBody);
  return extractSchemasFromContent(asRecord(requestBody.content));
}

function extractResponseSchemas(operation: Record<string, unknown>): Record<string, string[]> {
  const responses: Record<string, string[]> = {};
  for (const [status, response] of Object.entries(asRecord(operation.responses))) {
    responses[status] = extractSchemasFromContent(asRecord(asRecord(response).content));
  }
  return responses;
}

function extractSchemasFromContent(content: Record<string, unknown>): string[] {
  const schemas = new Set<string>();
  for (const media of Object.values(content)) {
    const schema = asRecord(asRecord(media).schema);
    const name = schemaName(schema);
    if (name) schemas.add(name);
  }
  return [...schemas].sort();
}

function schemaName(schema: Record<string, unknown>): string | undefined {
  const ref = schema.$ref;
  if (typeof ref === "string") return ref.split("/").at(-1);
  const title = schema.title;
  return typeof title === "string" ? title : undefined;
}

async function fileSize(root: string, file: string): Promise<number> {
  try {
    return (await stat(join(root, file))).size;
  } catch {
    return 0;
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function matchesGlob(path: string, pattern: string): boolean {
  const normalized = normalizePath(pattern);
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "__DOUBLE_STAR__")
    .replaceAll("*", "[^/]*")
    .replaceAll("__DOUBLE_STAR__", ".*");
  return new RegExp(`^${escaped}$`).test(path);
}
