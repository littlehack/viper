import type { Settings } from "../config/settings.ts"
import type { AuditLog } from "../util/audit-log.ts"

export interface ToolDeps {
  settings: Settings
  fs: any
  audit: AuditLog
  ctx: any
  /** Hook labels that registered successfully (live array, read by lab_status). */
  registered: string[]
  /** Names of the lab tools registered by this plugin (live array). */
  toolNames: string[]
}
