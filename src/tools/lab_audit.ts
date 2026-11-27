import type { ToolDeps } from "./deps.ts"

/**
 * Read the execution audit trail (tool calls, permission exceptions, scope
 * changes). Inputs are stored as summaries, never as file contents; values are
 * verbatim unless `policy.redact_reports` is enabled.
 */
export function labAuditTool(deps: ToolDeps) {
  return {
    name: "lab_audit",
    description:
      "Read the most recent lab audit entries: tool executions, excluded-path denials and scope changes. Values are verbatim unless policy.redact_reports is enabled.",
    input: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        file: { type: "string" },
        enabled: { type: "boolean" },
        count: { type: "number" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ts: { type: "string" },
              kind: { type: "string" },
              agent: { type: "string" },
              sessionID: { type: "string" },
              tool: { type: "string" },
              status: { type: "string" },
              summary: { type: "string" },
            },
            additionalProperties: true,
          },
        },
      },
      required: ["file", "enabled", "count", "entries"],
      additionalProperties: false,
    },

    async execute(input: any) {
      const limit = Math.max(1, Math.min(Number(input?.limit ?? 50), 500))
      const entries = deps.audit.tail(limit)
      const stats = deps.audit.stats()

      return {
        output: {
          file: deps.settings.auditFile,
          enabled: stats.enabled,
          count: entries.length,
          entries,
        },
        content: [
          `audit: ${stats.enabled ? "on" : "off"} | ${stats.entries} entries | ${stats.bytes} bytes`,
          `file: ${deps.settings.auditFile}`,
          "",
          ...entries.map(
            (entry) =>
              `${entry.ts} ${entry.kind}${entry.tool ? ` ${entry.tool}` : ""}${entry.status ? ` [${entry.status}]` : ""}${entry.summary ? ` ${entry.summary}` : ""}`,
          ),
        ].join("\n"),
      }
    },
  }
}
