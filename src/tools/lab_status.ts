import { API_VERSION, PLUGIN_ID, PLUGIN_VERSION } from "../constants.ts"
import { excludedPaths, readScope, scopeClasses } from "../config/scope.ts"
import { PLAYBOOK_DOMAINS } from "../capabilities/playbooks.ts"
import { ETHICS_RULES, HARD_STOPS } from "../ethics/policy.ts"
import type { ToolDeps } from "./deps.ts"

/**
 * Health/self-check tool. Answers "is the lab actually active in this runtime,
 * for which agents, with which hooks and which scope" without reading logs.
 */
export function labStatusTool(deps: ToolDeps) {
  return {
    name: "lab_status",
    description:
      "Report whether the unrestricted lab plugin is active, which agents are covered, which hooks and tools registered, the active scope policy and the audit trail location.",
    input: { type: "object", properties: {}, additionalProperties: false },
    output: {
      type: "object",
      properties: {
        plugin: { type: "string" },
        version: { type: "string" },
        api: { type: "string" },
        coverage: { type: "string" },
        lab_agents: { type: "array", items: { type: "string" } },
        auto_engage: { type: "boolean" },
        auto_scope: { type: "boolean" },
        hooks: { type: "array", items: { type: "string" } },
        tools: { type: "array", items: { type: "string" } },
        playbooks: { type: "array", items: { type: "string" } },
        scope: {
          type: "object",
          properties: {
            file: { type: "string" },
            mode: { type: "string" },
            locality_gate: { type: "boolean" },
            ownership_recheck: { type: "boolean" },
            classes: { type: "array", items: { type: "string" } },
            engagements: { type: "number" },
            excluded_paths: { type: "array", items: { type: "string" } },
          },
          required: [
            "file",
            "mode",
            "locality_gate",
            "ownership_recheck",
            "classes",
            "engagements",
            "excluded_paths",
          ],
          additionalProperties: false,
        },
        ethics: {
          type: "object",
          properties: {
            hard_stops: { type: "array", items: { type: "string" } },
            rules: { type: "array", items: { type: "string" } },
            deny_wins: { type: "boolean" },
            redaction: { type: "boolean" },
            excluded_paths: { type: "number" },
          },
          required: ["hard_stops", "rules", "deny_wins", "redaction", "excluded_paths"],
          additionalProperties: false,
        },
        audit: {
          type: "object",
          properties: {
            file: { type: "string" },
            enabled: { type: "boolean" },
            entries: { type: "number" },
            bytes: { type: "number" },
          },
          required: ["file", "enabled", "entries", "bytes"],
          additionalProperties: false,
        },
      },
      required: [
        "plugin",
        "version",
        "api",
        "coverage",
        "lab_agents",
        "auto_engage",
        "auto_scope",
        "hooks",
        "tools",
        "playbooks",
        "scope",
        "ethics",
        "audit",
      ],
      additionalProperties: false,
    },

    async execute() {
      // `agent.list` is a runtime API; if it is unavailable the health report
      // still works, it just cannot enumerate the covered agents.
      let ids: string[] = []
      try {
        const agents = await deps.ctx.agent.list()
        ids = (agents?.data ?? []).map((agent: any) => String(agent.id))
      } catch (error) {
        console.warn(`[viper.boost] agent.list failed: ${String(error)}`)
      }
      const covered = deps.settings.all
        ? ids
        : ids.filter((id) => deps.settings.allow.has(id.toLowerCase()))

      const scope = readScope(deps.settings.scopeFile, deps.fs)
      const classes = scopeClasses(scope)
      const excluded = excludedPaths(scope)
      const coverage = deps.settings.all ? "all-agents" : [...deps.settings.allow].join(",")
      const stats = deps.audit.stats()

      const output = {
        plugin: PLUGIN_ID,
        version: PLUGIN_VERSION,
        api: API_VERSION,
        coverage,
        lab_agents: covered,
        auto_engage: deps.settings.autoEngage,
        auto_scope: deps.settings.autoScope,
        hooks: [...deps.registered],
        tools: [...deps.toolNames],
        playbooks: [...PLAYBOOK_DOMAINS],
        scope: {
          file: deps.settings.scopeFile,
          mode: String(scope.mode ?? "open-declared"),
          locality_gate: Boolean(scope.policy?.locality_gate),
          ownership_recheck: Boolean(scope.policy?.ownership_recheck),
          classes,
          engagements: Array.isArray(scope.engagements) ? scope.engagements.length : 0,
          excluded_paths: excluded,
        },
        ethics: {
          hard_stops: [...HARD_STOPS],
          rules: [...ETHICS_RULES],
          deny_wins: true,
          redaction: Boolean(scope.policy?.redact_reports),
          excluded_paths: excluded.length,
        },
        audit: {
          file: deps.settings.auditFile,
          enabled: stats.enabled,
          entries: stats.entries,
          bytes: stats.bytes,
        },
      }

      return {
        output,
        content: [
          `${PLUGIN_ID} ${PLUGIN_VERSION} active (${API_VERSION})`,
          `coverage: ${coverage}`,
          `auto-engage: ${deps.settings.autoEngage ? "on" : "off"} | auto-scope: ${deps.settings.autoScope ? "on" : "off"}`,
          `covered agents: ${covered.join(", ") || "none"}`,
          `hooks: ${output.hooks.join(", ") || "none"}`,
          `tools: ${output.tools.join(", ") || "none"}`,
          `scope classes: ${classes.join(", ") || "none"}`,
          `excluded paths: ${excluded.length ? excluded.join(", ") : "none"}`,
          `audit: ${stats.enabled ? `${stats.entries} entries / ${stats.bytes} bytes` : "off"} (${deps.settings.auditFile})`,
        ].join("\n"),
      }
    },
  }
}
