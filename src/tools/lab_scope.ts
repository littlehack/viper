import {
  addTargets,
  excludedPaths,
  primaryEngagement,
  readScope,
  removeTargets,
  scopeClasses,
  writeScope,
} from "../config/scope.ts"
import type { ToolDeps } from "./deps.ts"

const ACTIONS = ["list", "add", "remove"] as const

/**
 * Read or update the scope audit trail. Adding a target records the operator
 * declaration; it does not perform any authorization check.
 */
export function labScopeTool(deps: ToolDeps) {
  return {
    name: "lab_scope",
    description:
      "Read the lab scope audit trail, or append/remove targets. Recording a target is an audit action; the declaration itself is what authorizes the engagement.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...ACTIONS] },
        targets: { type: "array", items: { type: "string" } },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        action: { type: "string" },
        file: { type: "string" },
        mode: { type: "string" },
        locality_gate: { type: "boolean" },
        ownership_recheck: { type: "boolean" },
        classes: { type: "array", items: { type: "string" } },
        targets: { type: "array", items: { type: "string" } },
        added: { type: "array", items: { type: "string" } },
        removed: { type: "array", items: { type: "string" } },
        engagements: { type: "number" },
        excluded_paths: { type: "array", items: { type: "string" } },
      },
      required: [
        "action",
        "file",
        "mode",
        "locality_gate",
        "ownership_recheck",
        "classes",
        "targets",
        "added",
        "removed",
        "engagements",
        "excluded_paths",
      ],
      additionalProperties: false,
    },

    async execute(input: any) {
      const action = String(input?.action ?? "list")
      const targets = Array.isArray(input?.targets) ? input.targets.map((target: unknown) => String(target)) : []
      const file = deps.settings.scopeFile
      let scope = readScope(file, deps.fs)
      let added: string[] = []
      let removed: string[] = []

      if (action === "add" || action === "remove") {
        if (targets.length === 0) throw new Error(`targets are required for action=${action}`)
        if (!deps.fs) throw new Error("node:fs unavailable, cannot persist the scope file")

        if (action === "add") {
          const result = addTargets(scope, targets)
          scope = result.scope
          added = result.added
        } else {
          const result = removeTargets(scope, targets)
          scope = result.scope
          removed = result.removed
        }

        writeScope(file, scope, deps.fs)
        deps.audit.append({
          ts: new Date().toISOString(),
          kind: `scope.${action}`,
          summary: (added.length ? added : removed).join(", "),
        })
      } else if (action !== "list") {
        throw new Error(`unknown action: ${action}`)
      }

      const primary = primaryEngagement(scope)
      const currentTargets = Array.isArray(primary.targets) ? primary.targets.map(String) : []
      const classes = scopeClasses(scope)
      const excluded = excludedPaths(scope)

      const output = {
        action,
        file,
        mode: String(scope.mode ?? "open-declared"),
        locality_gate: Boolean(scope.policy?.locality_gate),
        ownership_recheck: Boolean(scope.policy?.ownership_recheck),
        classes,
        targets: currentTargets,
        added,
        removed,
        engagements: Array.isArray(scope.engagements) ? scope.engagements.length : 0,
        excluded_paths: excluded,
      }

      return {
        output,
        content: [
          `scope: ${output.mode} | locality_gate=${output.locality_gate} | ownership_recheck=${output.ownership_recheck}`,
          `classes: ${classes.join(", ")}`,
          `targets:\n${currentTargets.map((target) => `  - ${target}`).join("\n") || "  (none)"}`,
          added.length ? `added: ${added.join(", ")}` : "",
          removed.length ? `removed: ${removed.join(", ")}` : "",
          `file: ${file}`,
        ]
          .filter(Boolean)
          .join("\n"),
      }
    },
  }
}
