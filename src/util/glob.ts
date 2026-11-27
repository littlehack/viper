/**
 * Minimal, dependency-free glob matching used by lab-scope exclusions.
 *
 * Supported: `*` (a path segment), `**` (any depth), `?` (one character).
 * Matching is case-insensitive and path separators are normalised to `/`,
 * so `**&#47;.ssh&#47;**` matches `C:\Users\x\.ssh\id_rsa` as well as
 * `/home/x/.ssh/id_ed25519`.
 */

function normalize(value: string): string {
  return String(value ?? "").replace(/\\/g, "/")
}

export function globToRegExp(pattern: string): RegExp {
  const source = normalize(pattern).replace(/^\.\//, "")
  let out = "^"
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === "*") {
      if (source[i + 1] === "*") {
        out += ".*"
        i++
      } else {
        out += "[^/]*"
      }
      continue
    }
    if (ch === "?") {
      out += "[^/]"
      continue
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`${out}$`, "i")
}

export function matchesAny(value: string, patterns: ReadonlyArray<string>): boolean {
  const subject = normalize(value)
  for (const pattern of patterns ?? []) {
    if (!pattern) continue
    try {
      if (globToRegExp(pattern).test(subject)) return true
    } catch {
      // An invalid pattern must never block work; ignore it.
    }
  }
  return false
}
