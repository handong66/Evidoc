import { readFile } from "node:fs/promises";
import { resolveExistingPathInsideRoot } from "./path-safety.js";
import type { DriftReport } from "./types.js";

export async function readFindingDocuments(
  root: string,
  report: DriftReport
): Promise<Record<string, string>> {
  const documents: Record<string, string> = {};
  for (const finding of report.findings) {
    if (documents[finding.docPath] !== undefined) continue;
    const target = await resolveExistingPathInsideRoot(root, finding.docPath);
    documents[finding.docPath] = target ? await readFile(target, "utf8") : "";
  }
  return documents;
}
