export const READ_ONLY_TOOLS = [
  "evidoc.agent_scan",
  "evidoc.get_drift_status",
  "evidoc.diagnose_drift",
  "evidoc.suggest_doc_fix",
  "evidoc.get_repo_contract",
  "evidoc.search_docs",
  "evidoc.check_worktree_drift",
  "evidoc.explain_drift",
  "evidoc.get_evidence_pack",
  "evidoc.draft_doc_patch",
  "evidoc.validate_patch"
] as const;

export const WRITE_TOOLS = ["evidoc.record_review"] as const;

export type EvidocMcpTool = (typeof READ_ONLY_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

export interface McpToolDefinition {
  name: EvidocMcpTool;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function isWriteToolAllowed(tool: EvidocMcpTool, allowWrites: boolean): boolean {
  return allowWrites || !WRITE_TOOLS.includes(tool as (typeof WRITE_TOOLS)[number]);
}

export function listMcpTools(): McpToolDefinition[] {
  return [
    {
      name: "evidoc.agent_scan",
      description:
        "Default agent entrypoint: run a fresh repo-local scan and return actionable evidence, freshness, read-parity, and next commands in one bundle.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.get_drift_status",
      description:
        "Return the Evidoc Agent Runtime Contract for the current repository. Use this before speaking about drift status in an agent reply.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.diagnose_drift",
      description:
        "Return Evidoc findings with runtime fingerprints and agent-actionable repair context without writing files.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.suggest_doc_fix",
      description:
        "Return evidence-bound documentation patch proposals plus the matching runtime fingerprint. Does not write files.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.get_repo_contract",
      description: "Read the local Evidoc pursuit goal and architecture contract when present.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.search_docs",
      description: "Search repository Markdown documents for a literal query.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" }, query: { type: "string" } },
        required: ["query"]
      }
    },
    {
      name: "evidoc.check_worktree_drift",
      description: "Run a read-only Evidoc scan for the current repository.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.explain_drift",
      description: "Explain a finding by id or by index from the current report.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" }, findingId: { type: "string" }, index: { type: "number" } }
      }
    },
    {
      name: "evidoc.get_evidence_pack",
      description: "Return a compact evidence pack for all current drift findings.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.draft_doc_patch",
      description: "Draft evidence-bound patch proposals without writing files.",
      inputSchema: { type: "object", properties: { root: { type: "string" } } }
    },
    {
      name: "evidoc.validate_patch",
      description: "Validate that a proposed patch is bound to a current finding and allowed path.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string" }, proposal: { type: "object" } },
        required: ["proposal"]
      }
    },
    {
      name: "evidoc.record_review",
      description: "Append a human review decision to .evidoc/review-log.jsonl.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string" },
          findingId: { type: "string" },
          decision: { type: "string" },
          reviewer: { type: "string" },
          expiresAt: { type: "string" },
          note: { type: "string" }
        },
        required: ["findingId", "decision", "reviewer"]
      }
    }
  ];
}
