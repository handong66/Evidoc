import { readRepository } from "./repository.js";
import type { EvidocConfig, RepositorySnapshot } from "./types.js";

export interface ChangedImpact {
  changedFiles: string[];
  affectedDocuments: string[];
  undocumentedChangedFiles: string[];
}

export async function createChangedImpactFromFiles(root: string, changedFiles: string[]): Promise<ChangedImpact> {
  return createChangedImpactFromSnapshot(await readRepository(root), changedFiles);
}

export function createChangedImpactFromSnapshot(
  snapshot: RepositorySnapshot,
  changedFiles: string[]
): ChangedImpact {
  const normalizedChangedFiles = [...new Set(changedFiles.map(normalizePath).filter(Boolean))].sort();
  const changed = new Set(normalizedChangedFiles);
  const affected = new Set<string>();
  const undocumentedChangedFiles = new Set(normalizedChangedFiles.filter((file) => !isMarkdown(file)));
  const changedGlobalEvidence = normalizedChangedFiles.filter(
    (file) => isPackageManagerEvidenceFile(file) || isApiSpecEvidenceFile(file, snapshot.config)
  );

  if (changedGlobalEvidence.length > 0) {
    for (const document of snapshot.documents) affected.add(document.path);
    for (const file of changedGlobalEvidence) undocumentedChangedFiles.delete(file);
  }

  for (const document of snapshot.documents) {
    if (changed.has(document.path)) affected.add(document.path);
    for (const file of normalizedChangedFiles) {
      if (!isMarkdown(file) && documentReferencesChangedFile(document.text, file)) {
        affected.add(document.path);
        undocumentedChangedFiles.delete(file);
      }
    }
  }

  return {
    changedFiles: normalizedChangedFiles,
    affectedDocuments: [...affected].sort(),
    undocumentedChangedFiles: [...undocumentedChangedFiles].sort()
  };
}

function isMarkdown(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdx");
}

function isPackageManagerEvidenceFile(path: string): boolean {
  return (
    path === "package.json" ||
    path === "package-lock.json" ||
    path === "npm-shrinkwrap.json" ||
    path === "pnpm-lock.yaml" ||
    path === "yarn.lock" ||
    path === "bun.lock" ||
    path === "bun.lockb"
  );
}

function isApiSpecEvidenceFile(path: string, config: EvidocConfig): boolean {
  const configured = config.apiSpecPaths ?? [];
  if (configured.includes(path)) return true;
  return /(^|\/)(openapi|swagger)\.json$/i.test(path);
}

function documentReferencesChangedFile(text: string, file: string): boolean {
  const normalizedText = text.replaceAll("\\", "/").toLowerCase();
  const normalizedFile = normalizePath(file).toLowerCase();
  if (normalizedText.includes(normalizedFile)) return true;

  const parts = normalizedFile.split("/").filter(Boolean);
  for (let length = parts.length - 1; length > 0; length -= 1) {
    const directory = `${parts.slice(0, length).join("/")}/`;
    if (
      normalizedText.includes(directory) ||
      normalizedText.includes(`./${directory}`) ||
      normalizedText.includes(`../${directory}`)
    ) {
      return true;
    }
  }
  return false;
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}
