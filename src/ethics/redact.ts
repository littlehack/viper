/**
 * Optional secret redaction for the audit trail and generated reports.
 *
 * Default lab policy: values are recorded verbatim. The audit trail and the
 * generated reports are operator-owned evidence, so credentials, tokens and
 * keys captured during an engagement are persisted exactly as observed.
 *
 * Redaction stays available as an explicit opt-in (`policy.redact_reports:
 * true` in lab-scope.json) for reports that leave the engagement — sharing,
 * third-party review or publication.
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted:private-key]"],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted:api-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted:github-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted:aws-access-key]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted:slack-token]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted:jwt]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [redacted]"],
  [/((?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]"],
  [/([?&](?:token|key|sig|signature|password|secret)=)[^&\s]+/gi, "$1[redacted]"],
]

/** Unconditional redaction — only used when the operator opts in. */
export function redactSecrets(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text
  let out = text
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * Policy-aware redaction. `enabled` defaults to false, so the audit trail and
 * reports keep the observed value unless `policy.redact_reports` is true.
 */
export function redact(text: string, enabled = false): string {
  return enabled ? redactSecrets(text) : text
}

/** Apply the same policy to every string value of a shallow record. */
export function redactRecord(
  record: Record<string, unknown>,
  enabled = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record ?? {})) {
    out[key] = typeof value === "string" ? redact(value, enabled) : value
  }
  return out
}
