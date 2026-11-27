/**
 * Markers are split on purpose.
 *
 * - INJECT_MARKER: written into the system block by this plugin. Used to keep
 *   injection idempotent.
 * - QUOTE_MARKER: appears inside the agent definitions themselves. It is only
 *   used to avoid re-framing text that already carries the contract — it must
 *   NOT suppress injection, otherwise the two dedicated agents would never
 *   receive the live engagement record.
 */
export const INJECT_MARKER_RE = /\[(?:VIPER-LAB|UNRESTRICTED-LAB|UNRESEARCH-LAB)\]/

export const QUOTE_MARKER_RE = /\[(?:MODE:\s*VIPER|MODE:\s*UNRESTRICTED|MODE:\s*REDTEAM-EXECUTOR)\]/

export const ANY_MARKER_RE =
  /\[(?:VIPER-LAB|UNRESTRICTED-LAB|UNRESEARCH-LAB|MODE:\s*VIPER|MODE:\s*UNRESTRICTED|MODE:\s*REDTEAM-EXECUTOR)\]/
