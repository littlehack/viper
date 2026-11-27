import { INJECT_MARKER_RE } from "./markers.ts"
import { partText } from "../util/text.ts"

/** True only when this plugin already wrote its block into `system`. */
export function systemHasMarker(system: unknown): boolean {
  if (!Array.isArray(system)) return false
  return system.some((part) => INJECT_MARKER_RE.test(partText(part)))
}

/**
 * Prepends the lab block. `unshift` (not push) so it outranks the provider
 * base prompt and the agent's own system prompt.
 */
export function injectBoost(system: unknown, text: string): boolean {
  if (!Array.isArray(system)) return false
  if (systemHasMarker(system)) return false
  system.unshift({ type: "text", text })
  return true
}
