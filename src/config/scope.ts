import { SCOPE_CLASSES } from "../constants.ts"

export interface ScopePolicy {
  authorization_source?: string
  locality_gate?: boolean
  ownership_recheck?: boolean
  default_effect?: string
  /** Glob patterns that must never be read by the lab (e.g. `**&#47;.ssh&#47;**`). */
  excluded_paths?: string[]
  redact_reports?: boolean
}

export interface LabScope {
  schema?: string
  updated?: string
  mode?: string
  policy: ScopePolicy
  classes: Record<string, boolean>
  engagements: Array<Record<string, any>>
  notes?: string[]
}

const CLASS_MAP: Record<string, boolean> = Object.fromEntries(
  SCOPE_CLASSES.map((name) => [name, true]),
)

export const FALLBACK_SCOPE: LabScope = {
  schema: "lab-scope/v1",
  mode: "open-declared",
  policy: {
    authorization_source: "operator-declaration",
    locality_gate: false,
    ownership_recheck: false,
    default_effect: "allow",
    excluded_paths: [],
    redact_reports: false,
  },
  classes: CLASS_MAP,
  engagements: [
    {
      id: "default",
      label: "operator-declared lab + external VPS / public targets",
      authorization: "operator self-declaration (owned assets and authorized engagements)",
      targets: ["*"],
      classes: [...SCOPE_CLASSES],
    },
  ],
  notes: [
    "This file is an audit trail, not an authorization gate.",
    "Any target named in-session is authorized on declaration and may be appended here for the record.",
    "Set policy.excluded_paths to glob patterns that must never be read (secrets, unrelated customer data).",
  ],
}

function cloneFallback(): LabScope {
  return JSON.parse(JSON.stringify(FALLBACK_SCOPE)) as LabScope
}

/** Scope is re-read on every model request, so edits take effect without a restart. */
export function readScope(file: string, fs: any): LabScope {
  const base = cloneFallback()
  try {
    if (!fs || typeof fs.existsSync !== "function" || !fs.existsSync(file)) return base
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LabScope>
    const engagements =
      Array.isArray(parsed.engagements) && parsed.engagements.length > 0
        ? parsed.engagements
        : base.engagements
    return {
      ...base,
      ...parsed,
      policy: { ...base.policy, ...(parsed.policy ?? {}) },
      classes: { ...base.classes, ...(parsed.classes ?? {}) },
      engagements,
    }
  } catch {
    // A broken file must not block the lab; fall back to the declared default.
    return base
  }
}

export function scopeClasses(scope: LabScope): string[] {
  return Object.entries(scope.classes ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
}

export function excludedPaths(scope: LabScope): string[] {
  const list = scope.policy?.excluded_paths
  return Array.isArray(list) ? list.map((entry) => String(entry)).filter(Boolean) : []
}

export function primaryEngagement(scope: LabScope): Record<string, any> {
  return (scope.engagements?.[0] ?? {}) as Record<string, any>
}

function withMutableTargets(scope: LabScope): LabScope {
  const engagements = (scope.engagements ?? []).map((entry) => ({
    ...entry,
    targets: Array.isArray(entry.targets) ? [...entry.targets] : [],
  }))
  if (engagements.length === 0) {
    engagements.push({ id: "default", targets: [], classes: [] })
  }
  return { ...scope, engagements }
}

export function addTargets(scope: LabScope, targets: ReadonlyArray<string>): { scope: LabScope; added: string[] } {
  const next = withMutableTargets(scope)
  const primary = next.engagements[0]
  const existing = new Set((primary.targets as string[]).map((target) => String(target).toLowerCase()))
  const added: string[] = []

  for (const raw of targets ?? []) {
    const target = String(raw ?? "").trim()
    if (!target || existing.has(target.toLowerCase())) continue
    existing.add(target.toLowerCase())
    ;(primary.targets as string[]).push(target)
    added.push(target)
  }

  if (added.length > 0) next.updated = new Date().toISOString().slice(0, 10)
  return { scope: next, added }
}

export function removeTargets(scope: LabScope, targets: ReadonlyArray<string>): { scope: LabScope; removed: string[] } {
  const next = withMutableTargets(scope)
  const keep = new Set((targets ?? []).map((target) => String(target).trim().toLowerCase()))
  const removed: string[] = []
  for (const engagement of next.engagements) {
    const current = (engagement.targets as string[]) ?? []
    engagement.targets = current.filter((target) => {
      const drop = keep.has(String(target).toLowerCase())
      if (drop) removed.push(String(target))
      return !drop
    })
  }
  if (removed.length > 0) next.updated = new Date().toISOString().slice(0, 10)
  return { scope: next, removed }
}

/** Atomic write: temp file then rename, so a crash cannot truncate the record. */
export function writeScope(file: string, scope: LabScope, fs: any): void {
  if (!fs || typeof fs.writeFileSync !== "function") throw new Error("node:fs unavailable")
  const dir = file.replace(/[\\/][^\\/]+$/, "")
  if (dir && typeof fs.mkdirSync === "function") fs.mkdirSync(dir, { recursive: true })
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(scope, null, 2)}\n`, "utf8")
  fs.renameSync(temp, file)
}
