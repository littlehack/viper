/**
 * unrestricted.boost — OpenCode V2 plugin, agent-agnostic edition (v4.0.1)
 * ============================================================================
 * Module map (see docs/ARCHITECTURE.md):
 *   config/    settings + scope file access
 *   prompt/    intent detection, framing, system-block construction
 *   hooks/     agent / permission / session / audit registrations
 *   tools/     lab_status, lab_scope, lab_target, lab_playbook, lab_preflight,
 *              lab_audit, lab_hash, lab_report
 *   target/    target extraction, default chain per target kind, session binding
 *   ethics/    hard stops, exclusions, optional redaction
 *   util/      guards, globbing, text helpers, audit log
 *
 * Configuration (opencode.json plugin options, or environment variables):
 *   options.agents        "*" or "build,plan,my-agent"   default "*"        LAB_AGENTS
 *   options.permissions   false disables ask -> allow    default true       LAB_PERMISSIONS=off
 *   options.setDefault    true makes unrestricted default default false     LAB_SET_DEFAULT=1
 *   options.framePrompts  false disables prompt framing  default true       LAB_FRAME_PROMPTS=off
 *   options.autoEngage    false disables target binding  default true       LAB_AUTO_ENGAGE=off
 *   options.autoScope     false disables scope records   default true       LAB_AUTO_SCOPE=off
 *   options.audit         false disables the audit trail default true       LAB_AUDIT=off
 *   options.scopeFile     lab-scope.json path                              LAB_SCOPE_FILE
 *   options.auditFile     audit JSONL path                                 LAB_AUDIT_FILE
 */

import { PLUGIN_ID } from "./constants.ts"
import { resolveSettings } from "./config/settings.ts"
import { readScope } from "./config/scope.ts"
import { createGuard } from "./util/guard.ts"
import { createAuditLog } from "./util/audit-log.ts"
import { registerAgentTransform } from "./hooks/agent.ts"
import { registerPermission } from "./hooks/permission.ts"
import { registerSession } from "./hooks/session.ts"
import { registerAudit } from "./hooks/audit.ts"
import { registerTools } from "./tools/index.ts"

/**
 * Resolve `Plugin.define` at runtime. Keeping the import dynamic means the
 * plugin still loads (in identity mode) if the package is missing, instead of
 * taking the whole config down.
 */
async function resolvePlugin(): Promise<{ define: (definition: any) => any }> {
  try {
    const mod: any = await import("@opencode/plugin")
    if (typeof mod?.Plugin?.define === "function") return mod.Plugin
    if (typeof mod?.define === "function") return { define: mod.define }
  } catch (error) {
    console.warn(`[unrestricted.boost] @opencode/plugin unavailable: ${String(error)}`)
  }
  return { define: (definition: any) => definition }
}

const Plugin: any = await resolvePlugin()

export default Plugin.define({
  id: PLUGIN_ID,

  async setup(ctx: any) {
    const settings = resolveSettings(ctx?.options)
    const registered: string[] = []
    const guard = createGuard(registered)

    // node builtins are resolved at runtime: some OpenCode packaging paths only
    // allow that. Losing fs degrades scope/audit persistence but never injection.
    let fs: any = null
    try {
      const mod: any = await import("node:fs")
      fs = mod?.default ?? mod
    } catch (error) {
      console.warn(`[unrestricted.boost] node:fs unavailable: ${String(error)}`)
    }

    // Redaction is opt-in. The flag lives in lab-scope.json and is re-read on
    // each audit append, so flipping it needs no restart.
    const redactEnabled = (): boolean =>
      Boolean(readScope(settings.scopeFile, fs).policy?.redact_reports)

    const audit = createAuditLog(settings.auditFile, fs, settings.audit, redactEnabled)
    const deps = { settings, fs, audit, ctx, registered, toolNames: [] as string[] }

    await registerAgentTransform(ctx, settings, guard)
    await registerPermission(ctx, settings, fs, guard, audit)
    await registerSession(ctx, settings, fs, guard, audit)
    await registerAudit(ctx, settings, guard, audit, redactEnabled)
    await registerTools(ctx, deps, guard)

    audit.append({
      ts: new Date().toISOString(),
      kind: "plugin.setup",
      summary: `coverage=${settings.all ? "all-agents" : [...settings.allow].join(",")} hooks=${registered.length}`,
    })

    return () => {
      // Registrations are released by OpenCode; nothing to clean up here.
    }
  },
})
