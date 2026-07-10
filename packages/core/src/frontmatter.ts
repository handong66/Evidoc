import { normalizeRepositoryRelativePath } from "./path-safety.js";

export interface SourceBinding {
  path: string;
  symbols?: string[];
}

export interface DocumentFrontmatter {
  id?: string;
  owner?: string;
  sources?: SourceBinding[];
  lastReviewed?: string;
  ttlDays?: number;
}

export interface ParsedDocumentFrontmatter {
  frontmatter: DocumentFrontmatter;
  body: string;
  hasFrontmatter: boolean;
  locations: {
    lastReviewedLine: number;
    sources: Array<{ path: string; line: number; symbols: string[] }>;
  };
}

export function parseDocumentFrontmatter(text: string): ParsedDocumentFrontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return emptyParsedFrontmatter(text);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return emptyParsedFrontmatter(text);

  const parsed = parseFrontmatterLines(lines.slice(1, end));
  return {
    frontmatter: parsed.frontmatter,
    body: lines.slice(end + 1).join("\n"),
    hasFrontmatter: true,
    locations: parsed.locations
  };
}

export function serializeDocumentFrontmatter(value: DocumentFrontmatter): string {
  const lines = ["---"];
  if (value.id) lines.push(`id: ${value.id}`);
  if (value.owner) lines.push(`owner: ${value.owner}`);
  if (value.sources?.length) {
    lines.push("sources:");
    for (const source of value.sources) {
      lines.push(`  - path: ${source.path}`);
      if (source.symbols?.length) {
        lines.push("    symbols:");
        for (const symbol of source.symbols) lines.push(`      - ${symbol}`);
      }
    }
  }
  if (value.lastReviewed) lines.push(`lastReviewed: ${value.lastReviewed}`);
  if (value.ttlDays !== undefined) lines.push(`ttlDays: ${value.ttlDays}`);
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

export function backfillDocumentFrontmatter(text: string, patch: DocumentFrontmatter): string {
  const parsed = parseDocumentFrontmatter(text);
  const frontmatter = mergeFrontmatter(parsed.frontmatter, patch);
  const body = parsed.body.replace(/^\n+/, "");
  return `${serializeDocumentFrontmatter(frontmatter)}${body}`;
}

export function validateDocumentFrontmatter(value: DocumentFrontmatter): string[] {
  const errors: string[] = [];
  for (const source of value.sources ?? []) {
    if (!normalizeRepositoryRelativePath(source.path)) {
      errors.push("sources.path must be a non-empty repository-relative path");
    }
  }
  if (value.ttlDays !== undefined && (!Number.isInteger(value.ttlDays) || value.ttlDays <= 0)) {
    errors.push("ttlDays must be a positive integer when provided");
  }
  return errors;
}

function parseFrontmatterLines(lines: string[]): Pick<ParsedDocumentFrontmatter, "frontmatter" | "locations"> {
  const frontmatter: DocumentFrontmatter = {};
  const locations: ParsedDocumentFrontmatter["locations"] = { lastReviewedLine: 1, sources: [] };
  let currentSource: SourceBinding | undefined;
  let currentLocatedSource: ParsedDocumentFrontmatter["locations"]["sources"][number] | undefined;
  let inSymbols = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 2;
    const trimmed = line.trim();
    if (trimmed.startsWith("id:")) frontmatter.id = trimmed.slice(3).trim();
    else if (trimmed.startsWith("owner:")) frontmatter.owner = trimmed.slice(6).trim();
    else if (trimmed.startsWith("lastReviewed:")) {
      frontmatter.lastReviewed = trimmed.slice("lastReviewed:".length).trim();
      locations.lastReviewedLine = lineNumber;
    } else if (trimmed.startsWith("ttlDays:")) {
      frontmatter.ttlDays = Number.parseInt(trimmed.slice("ttlDays:".length).trim(), 10);
    } else if (trimmed === "sources:") {
      frontmatter.sources ??= [];
    } else if (trimmed.startsWith("- path:")) {
      const path = trimmed.slice("- path:".length).trim();
      frontmatter.sources ??= [];
      currentSource = { path };
      currentLocatedSource = { path, line: lineNumber, symbols: [] };
      frontmatter.sources.push(currentSource);
      locations.sources.push(currentLocatedSource);
      inSymbols = false;
      continue;
    } else if (trimmed === "symbols:") {
      if (currentSource && currentLocatedSource) {
        currentSource.symbols ??= [];
        inSymbols = true;
      }
      continue;
    } else if (inSymbols && trimmed.startsWith("- ") && currentSource && currentLocatedSource) {
      const symbol = trimmed.slice(2).trim();
      currentSource.symbols ??= [];
      currentSource.symbols.push(symbol);
      currentLocatedSource.symbols.push(symbol);
      continue;
    }
    if (trimmed && !line.startsWith(" ")) inSymbols = false;
  }
  return { frontmatter, locations };
}

function emptyParsedFrontmatter(text: string): ParsedDocumentFrontmatter {
  return {
    frontmatter: {},
    body: text,
    hasFrontmatter: false,
    locations: { lastReviewedLine: 1, sources: [] }
  };
}

function mergeFrontmatter(base: DocumentFrontmatter, patch: DocumentFrontmatter): DocumentFrontmatter {
  return { ...base, ...patch, sources: mergeSources(base.sources ?? [], patch.sources ?? []) };
}

function mergeSources(base: SourceBinding[], patch: SourceBinding[]): SourceBinding[] | undefined {
  const byPath = new Map<string, SourceBinding>();
  for (const source of [...base, ...patch]) {
    const existing = byPath.get(source.path);
    const symbols = [...new Set([...(existing?.symbols ?? []), ...(source.symbols ?? [])])];
    byPath.set(source.path, { path: source.path, ...(symbols.length ? { symbols } : {}) });
  }
  const sources = [...byPath.values()];
  return sources.length ? sources : undefined;
}
