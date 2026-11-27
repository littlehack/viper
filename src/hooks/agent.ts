import type { Settings } from "../config/settings.ts"
import type { Guard } from "../util/guard.ts"

export interface PermissionRule {
  action: string
  resource: string
  effect: string
}

/**
 * Merge instead of overwrite: the agent Markdown files are the source of truth
 * for fine-grained rules (e.g. `read *.env.*`), the plugin only guarantees the
 * baseline `*&#47;*` + external-directory entries. Explicit `deny` entries are
 * preserved.
 */
export function mergePermissions(existing: ReadonlyArray<Partial<PermissionRule>> | undefined): PermissionRule[] {
  const seen = new Set<string>()
  const keep: PermissionRule[] = []

  for (const rule of existing ?? []) {
    const action = String(rule?.action ?? "")
    const resource = String(rule?.resource ?? "")
    if (!action || !resource) continue
    if (action === "*" && resource === "*") continue
    if (action === "external_directory") continue
    const key = `${action}\u0000${resource}`
    if (seen.has(key)) continue
    seen.add(key)
    keep.push({ action, resource, effect: String(rule?.effect ?? "allow") })
  }

  return [
    { action: "*", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "allow" },
    ...keep,
  ]
}

function harden(agent: any, mode: string, color: string): void {
  agent.mode = mode
  agent.hidden = false
  agent.color = color
  agent.permissions = mergePermissions(agent.permissions)
}

export async function registerAgentTransform(ctx: any, settings: Settings, guard: Guard): Promise<void> {
  await guard("agent.transform", () =>
    ctx.agent.transform((editor: any) => {
      if (editor.get("viper")) {
        editor.update("viper", (agent: any) => harden(agent, "primary", "#EF4444"))
        if (settings.setDefault) editor.default("viper")
      }

      if (editor.get("redteam")) {
        editor.update("redteam", (agent: any) => harden(agent, "subagent", "#F97316"))
      }

      if (editor.get("reverse")) {
        editor.update("reverse", (agent: any) => harden(agent, "subagent", "#38BDF8"))
      }
    }),
  )
}
