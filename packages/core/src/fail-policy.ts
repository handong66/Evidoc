export type FailOn = "none" | "broken" | "review_needed";

const FAIL_ON_POLICIES = new Set<FailOn>(["none", "broken", "review_needed"]);

export function parseFailOnPolicy(value: string | undefined, fallback: FailOn): FailOn {
  if (value === undefined || value === "") return fallback;
  if (FAIL_ON_POLICIES.has(value as FailOn)) return value as FailOn;
  throw new Error(`Invalid fail-on policy "${value}". Expected none, broken, or review_needed.`);
}
