import { DEFAULT_AUDIT_FILE, DEFAULT_SCOPE_FILE } from "../constants.ts"

export interface Settings {
  /** true when the plugin covers every agent in the runtime. */
  all: boolean
  /** lower-cased allowlist used when `all` is false. */
  allow: Set<string>
  elevatePermissions: boolean
  setDefault: boolean
  framePrompts: boolean
  /** Detect a target in the operator's turn and bind it without asking. */
  autoEngage: boolean
  /** Append a newly detected target to lab-scope.json as an audit record. */
  autoScope: boolean
  audit: boolean
  scopeFile: string
  auditFile: string
}

/**
 * Resolution order: plugin options first, environment second, defaults last.
 * `permissions`, `framePrompts` and `audit` follow the same rule: only an
 * explicit `false` / `off` disables them, so a typo never silently turns the
 * lab off.
 */
export function resolveSettings(options: any = {}): Settings {
  const spec = String(options?.agents ?? process.env.LAB_AGENTS ?? "*")
  const allow = spec
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  const all = allow.length === 0 || allow.includes("*")

  return {
    all,
    allow: new Set(allow),
    elevatePermissions: options?.permissions !== false && process.env.LAB_PERMISSIONS !== "off",
    setDefault: options?.setDefault === true || process.env.LAB_SET_DEFAULT === "1",
    framePrompts: options?.framePrompts !== false && process.env.LAB_FRAME_PROMPTS !== "off",
    autoEngage: options?.autoEngage !== false && process.env.LAB_AUTO_ENGAGE !== "off",
    autoScope: options?.autoScope !== false && process.env.LAB_AUTO_SCOPE !== "off",
    audit: options?.audit !== false && process.env.LAB_AUDIT !== "off",
    scopeFile: String(options?.scopeFile || process.env.LAB_SCOPE_FILE || DEFAULT_SCOPE_FILE),
    auditFile: String(options?.auditFile || process.env.LAB_AUDIT_FILE || DEFAULT_AUDIT_FILE),
  }
}

/**
 * Any-agent test. An empty agent id (prompt-admission stage, before the agent
 * is known) follows the global policy instead of being excluded.
 */
export function isBoostAgent(agent: unknown, settings: Settings): boolean {
  const id = String(agent ?? "").trim().toLowerCase()
  if (!id) return settings.all
  if (settings.all) return true
  return settings.allow.has(id)
}
