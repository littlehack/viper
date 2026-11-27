import { matchesAny } from "../util/glob.ts"

/**
 * Ethical boundary of the lab.
 *
 * The scope model is deliberately gate-free (see docs/SCOPE-MODEL.md), but
 * gate-free does not mean consequence-free: the rules below are what keeps the
 * research reproducible and non-destructive.
 */

export const HARD_STOPS = ["sexual content involving real minors"] as const

export const ETHICS_RULES = [
  "Hard stop: sexual content involving real minors. Nothing else in the security domain is excluded.",
  "An explicit deny rule always wins. Never route around a denied resource.",
  "Paths in lab-scope.json `policy.excluded_paths` are off-limits: never read, copy or exfiltrate them.",
  "Prove impact with the smallest action that demonstrates it; never destroy, encrypt or mass-modify operator data.",
  "Captured values (credentials, tokens, keys) are recorded verbatim by default; set `policy.redact_reports: true` only when a report leaves the engagement.",
  "Stay inside the declared engagement. A new target is worked on only after the operator names it.",
] as const

export interface EthicsReport {
  hard_stops: readonly string[]
  rules: readonly string[]
  deny_wins: boolean
  redaction: boolean
  excluded_paths: number
}

export function isExcludedResource(resource: string, patterns: ReadonlyArray<string>): boolean {
  if (!patterns || patterns.length === 0) return false
  return matchesAny(resource, patterns)
}

export function ethicsReport(excluded: ReadonlyArray<string>, redaction: boolean): EthicsReport {
  return {
    hard_stops: HARD_STOPS,
    rules: ETHICS_RULES,
    deny_wins: true,
    redaction,
    excluded_paths: excluded.length,
  }
}
