import type { DriftFinding } from "@handong66/evidoc-core";

export type ReviewDecision = "accepted" | "false_positive" | "deferred" | "fixed";

export interface ReviewLogEntry {
  findingId: string;
  decision: ReviewDecision;
  reviewer: string;
  reviewedAt: string;
  expiresAt?: string;
  note?: string;
}

export function serializeReviewLogEntry(entry: ReviewLogEntry): string {
  return JSON.stringify(entry);
}

export function parseReviewLog(text: string): ReviewLogEntry[] {
  const entries: ReviewLogEntry[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    try {
      const parsed = JSON.parse(trimmed) as Partial<ReviewLogEntry>;
      if (
        typeof parsed.findingId === "string" &&
        isReviewDecision(parsed.decision) &&
        typeof parsed.reviewer === "string" &&
        typeof parsed.reviewedAt === "string"
      ) {
        entries.push({
          findingId: parsed.findingId,
          decision: parsed.decision,
          reviewer: parsed.reviewer,
          reviewedAt: parsed.reviewedAt,
          expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
          note: typeof parsed.note === "string" ? parsed.note : undefined
        });
      }
    } catch {
      continue;
    }
  }

  return entries;
}

export function appendReviewLogEntry(text: string, entry: ReviewLogEntry): string {
  const prefix = text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
  return `${prefix}${serializeReviewLogEntry(entry)}\n`;
}

export function isFindingReviewed(
  finding: DriftFinding,
  entries: ReviewLogEntry[],
  now = new Date()
): boolean {
  return entries.some((entry) => {
    if (entry.findingId !== finding.id) return false;
    if (entry.decision !== "accepted" && entry.decision !== "false_positive" && entry.decision !== "fixed") {
      return false;
    }
    if (!entry.expiresAt) return true;
    return Date.parse(entry.expiresAt) >= now.getTime();
  });
}

function isReviewDecision(value: unknown): value is ReviewDecision {
  return value === "accepted" || value === "false_positive" || value === "deferred" || value === "fixed";
}
