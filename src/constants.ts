/**
 * Global constants.
 *
 * Kept dependency-free so every other module can import it without pulling in
 * node builtins (OpenCode resolves some builtins lazily at runtime).
 */

export const PLUGIN_ID = "unrestricted.boost"
export const PLUGIN_VERSION = "4.1.0"
export const API_VERSION = "opencode-v2"

const HOME = process.env.USERPROFILE || process.env.HOME || "."

export const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? `${process.env.XDG_CONFIG_HOME}/opencode`
  : `${HOME}/.config/opencode`

export const DEFAULT_SCOPE_FILE = `${CONFIG_DIR}/lab-scope.json`
export const DEFAULT_AUDIT_FILE = `${CONFIG_DIR}/lab-audit.jsonl`

/** Rotate the audit log once it grows past this size (old file kept as .1). */
export const AUDIT_MAX_BYTES = 2 * 1024 * 1024
/** How much of a tool input is copied into the audit trail (optional redaction, then truncated). */
export const AUDIT_PREVIEW_CHARS = 160

export const SCOPE_CLASSES = [
  "local_path",
  "loopback",
  "private_net",
  "container_emulator",
  "external_vps",
  "cloud_instance",
  "public_ip",
  "public_cidr",
  "domain",
  "api_endpoint",
] as const
