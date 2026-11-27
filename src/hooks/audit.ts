import type { Settings } from "../config/settings.ts"
import type { AuditLog } from "../util/audit-log.ts"
import type { Guard } from "../util/guard.ts"
import { redact } from "../ethics/redact.ts"
import { summarizeInput, truncate } from "../util/text.ts"

/**
 * Execution audit. Records tool name, agent, session, input summary and
 * outcome — never file contents. This is the evidence trail used by
 * `lab_audit` and `lab_report`; values are verbatim unless redaction is opted in.
 */
export async function registerAudit(
  ctx: any,
  settings: Settings,
  guard: Guard,
  audit: AuditLog,
  redactEnabled: () => boolean = () => false,
): Promise<void> {
  if (!settings.audit) return

  const shouldRedact = (): boolean => {
    try {
      return Boolean(redactEnabled())
    } catch {
      return false
    }
  }

  await guard("tool.execute.before", () =>
    ctx.tool.hook("execute.before", (event: any) => {
      audit.append({
        ts: new Date().toISOString(),
        kind: "tool.before",
        agent: String(event?.agent ?? ""),
        sessionID: String(event?.sessionID ?? ""),
        tool: String(event?.tool ?? ""),
        summary: summarizeInput(event?.input, shouldRedact()),
      })
    }),
  )

  await guard("tool.execute.after", () =>
    ctx.tool.hook("execute.after", (event: any) => {
      const failed = event?.status === "error"
      const message = failed ? String(event?.error?.message ?? event?.error ?? "") : ""
      audit.append({
        ts: new Date().toISOString(),
        kind: "tool.after",
        agent: String(event?.agent ?? ""),
        sessionID: String(event?.sessionID ?? ""),
        tool: String(event?.tool ?? ""),
        status: String(event?.status ?? "unknown"),
        summary: failed ? truncate(redact(message, shouldRedact())) : "",
      })
    }),
  )
}
