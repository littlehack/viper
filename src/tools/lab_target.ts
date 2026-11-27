import { addTargets, primaryEngagement, readScope, writeScope } from "../config/scope.ts"
import { classifyTarget, describeTargets, extractTargets } from "../target/detect.ts"
import { bindTarget, clearBinding, getBinding, listBindings, sessionKey } from "../target/binding.ts"
import { buildPlan, formatPlan } from "../target/plan.ts"
import type { ToolDeps } from "./deps.ts"

const ACTIONS = ["analyze", "plan", "bind", "list", "clear"] as const

/**
 * Turn any string the operator wrote into a bound engagement: classify the
 * target, render the default chain, bind the session, and record the asset.
 * This is the deterministic backstop for the prompt-level auto-engage path —
 * if the model is unsure, one call gives it the same block the plugin injects.
 */
export function labTargetTool(deps: ToolDeps) {
  return {
    name: "lab_target",
    description:
      "Classify a target (IP, CIDR, domain, URL, company, APK, binary, hash, repo, path), bind it to this session, record it in the scope audit trail, and return the default engagement chain with the exact first command. Use it when a target was named but no [TARGET-BOUND] block is present.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...ACTIONS] },
        target: { type: "string", description: "Raw target string as the operator wrote it." },
        sessionID: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        action: { type: "string" },
        target: { type: "string" },
        kind: { type: "string" },
        objective: { type: "string" },
        first_command: { type: "string" },
        playbooks: { type: "array", items: { type: "string" } },
        chain: { type: "array", items: { type: "string" } },
        success: { type: "array", items: { type: "string" } },
        bindings: { type: "array", items: { type: "string" } },
        recorded: { type: "boolean" },
        file: { type: "string" },
      },
      required: [
        "action",
        "target",
        "kind",
        "objective",
        "first_command",
        "playbooks",
        "chain",
        "success",
        "bindings",
        "recorded",
        "file",
      ],
      additionalProperties: false,
    },

    async execute(input: any) {
      const action = String(input?.action ?? "analyze")
      if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) throw new Error(`unknown action: ${action}`)

      const key = sessionKey(input?.sessionID)
      const file = deps.settings.scopeFile
      let recorded = false
      let target = null as ReturnType<typeof classifyTarget>

      if (action === "clear") {
        clearBinding(key)
        return {
          output: {
            action,
            target: "",
            kind: "",
            objective: "",
            first_command: "",
            playbooks: [],
            chain: [],
            success: [],
            bindings: listBindings().map((binding) => `${binding.session}:${binding.target.value}`),
            recorded: false,
            file,
          },
          content: `binding cleared for session ${key}`,
        }
      }

      if (action !== "list") {
        const raw = String(input?.target ?? "").trim()
        if (!raw) {
          const bound = getBinding(key)
          if (!bound) throw new Error("target is required for this action")
          target = bound.target
        } else {
          target = extractTargets(raw, { max: 1 })[0] ?? classifyTarget(raw)
        }
        if (!target) throw new Error("could not classify the target")
      }

      let plan = target ? buildPlan(target) : null

      if (target && (action === "bind" || action === "plan")) {
        bindTarget(key, target, "tool")
        if (deps.settings.autoScope && deps.fs) {
          try {
            const scope = readScope(file, deps.fs)
            const result = addTargets(scope, [target.value])
            if (result.added.length > 0) {
              writeScope(file, result.scope, deps.fs)
              deps.audit.append({
                ts: new Date().toISOString(),
                kind: "scope.auto",
                summary: `${target.kind}:${target.value}`,
              })
            }
            recorded = true
          } catch (error) {
            console.warn(`[unrestricted.boost] lab_target scope write failed: ${String(error)}`)
          }
        }
      }

      const scope = readScope(file, deps.fs)
      const primary = primaryEngagement(scope)
      const scopeTargets = Array.isArray(primary.targets) ? primary.targets.map(String) : []
      const bindings = listBindings().map(
        (binding) => `${binding.session}:${binding.target.kind}:${binding.target.value} (${binding.source})`,
      )

      const output = {
        action,
        target: target?.value ?? "",
        kind: target?.kind ?? "",
        objective: plan?.objective ?? "",
        first_command: plan?.first_command ?? "",
        playbooks: plan?.playbooks ?? [],
        chain: plan ? plan.chain.map((step, index) => `${index + 1}. ${step.goal} :: ${step.commands.join(" ; ")}`) : [],
        success: plan?.success ?? [],
        bindings,
        recorded,
        file,
      }

      const content = plan
        ? formatPlan(plan)
        : [
            `bindings: ${bindings.length ? bindings.join(" | ") : "none"}`,
            `scope targets: ${scopeTargets.length ? describeTargets(extractTargets(scopeTargets.join(" "), { max: 8 })) : "none"}`,
            `file: ${file}`,
          ].join("\n")

      return { output, content }
    },
  }
}
