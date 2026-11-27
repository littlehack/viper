import { AUDIT_PREVIEW_CHARS } from "../constants.ts"
import { redact } from "../ethics/redact.ts"

/** SystemPart is either `{type:"text",text}` or a bare string depending on the runtime build. */
export function partText(part: unknown): string {
  if (typeof part === "string") return part
  if (part && typeof (part as { text?: unknown }).text === "string") {
    return (part as { text: string }).text
  }
  return ""
}

export function truncate(text: string, max = AUDIT_PREVIEW_CHARS): string {
  if (typeof text !== "string") return ""
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** One-line summary of a tool input for the audit trail (verbatim unless redaction is opted in). */
export function summarizeInput(input: unknown, redactEnabled = false): string {
  if (input == null) return ""
  if (typeof input === "string") return redact(truncate(input), redactEnabled)
  if (typeof input !== "object") return redact(String(input), redactEnabled)

  const obj = input as Record<string, unknown>
  const keys = Object.keys(obj).slice(0, 12)
  let preview = ""
  try {
    preview = JSON.stringify(obj)
  } catch {
    preview = "[unserializable]"
  }
  return `keys=${keys.join(",") || "-"} preview=${redact(truncate(preview), redactEnabled)}`
}
