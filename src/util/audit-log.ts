import { AUDIT_MAX_BYTES } from "../constants.ts"
import { redact } from "../ethics/redact.ts"

export interface AuditEntry {
  ts: string
  kind: string
  agent?: string
  sessionID?: string
  tool?: string
  status?: string
  summary?: string
  meta?: Record<string, unknown>
}

export interface AuditStats {
  file: string
  enabled: boolean
  entries: number
  bytes: number
}

export interface AuditLog {
  append(entry: AuditEntry): void
  tail(limit: number): AuditEntry[]
  stats(): AuditStats
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0)
}

export function createAuditLog(
  file: string,
  fs: any,
  enabled: boolean,
  /** Read live from lab-scope.json: false keeps the observed values verbatim. */
  redactEnabled: () => boolean = () => false,
): AuditLog {
  const usable = () => enabled && fs && typeof fs.appendFileSync === "function"

  const shouldRedact = (): boolean => {
    try {
      return Boolean(redactEnabled())
    } catch {
      return false
    }
  }

  const size = (): number => {
    try {
      return fs.statSync(file).size
    } catch {
      return 0
    }
  }

  const read = (): string => {
    try {
      return fs.readFileSync(file, "utf8")
    } catch {
      return ""
    }
  }

  return {
    append(entry) {
      if (!usable()) return
      try {
        if (size() > AUDIT_MAX_BYTES) fs.renameSync(file, `${file}.1`)
        const record: AuditEntry = {
          ...entry,
          ts: entry.ts || new Date().toISOString(),
          summary: entry.summary ? redact(entry.summary, shouldRedact()) : entry.summary,
        }
        fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8")
      } catch (error) {
        console.warn(`[viper.boost] audit append failed: ${String(error)}`)
      }
    },

    tail(limit) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500))
      const all = lines(read())
      const out: AuditEntry[] = []
      for (const line of all.slice(-safeLimit)) {
        try {
          out.push(JSON.parse(line) as AuditEntry)
        } catch {
          // Skip a truncated tail line instead of failing the whole read.
        }
      }
      return out
    },

    stats() {
      return {
        file,
        enabled,
        entries: enabled ? lines(read()).length : 0,
        bytes: enabled ? size() : 0,
      }
    },
  }
}
