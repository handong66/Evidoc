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
}

export function parseDocumentFrontmatter(text: string): ParsedDocumentFrontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {
      frontmatter: {},
      body: text,
      hasFrontmatter: false
    };
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    return {
      frontmatter: {},
      body: text,
      hasFrontmatter: false
    };
  }

  return {
    frontmatter: parseFrontmatterLines(lines.slice(1, end)),
    body: lines.slice(end + 1).join("\n"),
    hasFrontmatter: true
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
        for (const symbol of source.symbols) {
          lines.push(`      - ${symbol}`);
        }
      }
    }
  }
  if (value.lastReviewed) lines.push(`lastReviewed: ${value.lastReviewed}`);
  if (value.ttlDays !== undefined) lines.push(`ttlDays: ${value.ttlDays}`);
  lines.push("---");

  return `${lines.join("\n")}\n`;
}

export function backfillDocumentFrontmatter(
  text: string,
  patch: DocumentFrontmatter
): string {
  const parsed = parseDocumentFrontmatter(text);
  const frontmatter = mergeFrontmatter(parsed.frontmatter, patch);
  const body = parsed.body.replace(/^\n+/, "");
  return `${serializeDocumentFrontmatter(frontmatter)}${body}`;
}

export function validateDocumentFrontmatter(value: DocumentFrontmatter): string[] {
  const errors: string[] = [];

  for (const source of value.sources ?? []) {
    if (!source.path || source.path.startsWith("/")) {
      errors.push("sources.path must be a non-empty repository-relative path");
    }
  }

  if (value.ttlDays !== undefined && (!Number.isInteger(value.ttlDays) || value.ttlDays <= 0)) {
    errors.push("ttlDays must be a positive integer when provided");
  }

  return errors;
}

function parseFrontmatterLines(lines: string[]): DocumentFrontmatter {
  const frontmatter: DocumentFrontmatter = {};
  let currentSource: SourceBinding | undefined;
  let inSymbols = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("id:")) {
      frontmatter.id = trimmed.slice("id:".length).trim();
      inSymbols = false;
      continue;
    }

    if (trimmed.startsWith("owner:")) {
      frontmatter.owner = trimmed.slice("owner:".length).trim();
      inSymbols = false;
      continue;
    }

    if (trimmed.startsWith("lastReviewed:")) {
      frontmatter.lastReviewed = trimmed.slice("lastReviewed:".length).trim();
      inSymbols = false;
      continue;
    }

    if (trimmed.startsWith("ttlDays:")) {
      frontmatter.ttlDays = Number.parseInt(trimmed.slice("ttlDays:".length).trim(), 10);
      inSymbols = false;
      continue;
    }

    if (trimmed === "sources:") {
      frontmatter.sources ??= [];
      inSymbols = false;
      continue;
    }

    if (trimmed.startsWith("- path:")) {
      frontmatter.sources ??= [];
      currentSource = {
        path: trimmed.slice("- path:".length).trim()
      };
      frontmatter.sources.push(currentSource);
      inSymbols = false;
      continue;
    }

    if (trimmed === "symbols:") {
      currentSource ??= { path: "" };
      currentSource.symbols ??= [];
      inSymbols = true;
      continue;
    }

    if (inSymbols && trimmed.startsWith("- ") && currentSource) {
      currentSource.symbols ??= [];
      currentSource.symbols.push(trimmed.slice(2).trim());
      continue;
    }

    if (trimmed && !line.startsWith(" ")) {
      inSymbols = false;
    }
  }

  return frontmatter;
}

function mergeFrontmatter(base: DocumentFrontmatter, patch: DocumentFrontmatter): DocumentFrontmatter {
  return {
    ...base,
    ...patch,
    sources: mergeSources(base.sources ?? [], patch.sources ?? [])
  };
}

function mergeSources(base: SourceBinding[], patch: SourceBinding[]): SourceBinding[] | undefined {
  const byPath = new Map<string, SourceBinding>();

  for (const source of [...base, ...patch]) {
    const existing = byPath.get(source.path);
    byPath.set(source.path, {
      path: source.path,
      symbols: unique([...(existing?.symbols ?? []), ...(source.symbols ?? [])])
    });
  }

  const sources = [...byPath.values()].map((source) => ({
    path: source.path,
    ...(source.symbols?.length ? { symbols: source.symbols } : {})
  }));
  return sources.length ? sources : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
