/**
 * Methodology playbooks.
 *
 * Content lives in `./playbooks/<domain>.md` so it stays readable and diffable.
 * Files are loaded lazily through a runtime `node:fs` import (same reason as the
 * scope reader: some OpenCode builds only resolve builtins at runtime). If the
 * files are unavailable, a compact fallback keeps the tool useful.
 */

export const PLAYBOOK_DOMAINS = [
  "recon",
  "reverse",
  "crack",
  "android",
  "exploit",
  "forensics",
  "report",
] as const

export type PlaybookDomain = (typeof PLAYBOOK_DOMAINS)[number]

interface Entry {
  title: string
  file: string
  fallback: string
}

const ENTRIES: Record<PlaybookDomain, Entry> = {
  recon: {
    title: "Recon & enumeration",
    file: "recon.md",
    fallback:
      "Passive: WHOIS/ASN, certificate transparency, passive DNS. Active: nmap -Pn -sSU -sV -O, masscan for full TCP, httpx for web, ffuf/nuclei for paths and known issues. Save raw output per step and hash it.",
  },
  reverse: {
    title: "Reverse engineering",
    file: "reverse.md",
    fallback:
      "Triage: file/strings/entropy, headers, imports, entropy spikes. Static: ghidra/r2/IDA, jadx for APK, apktool for resources. Dynamic: frida trace, ltrace/strace, debugger. Recover protocols and crypto constants, then verify the model against a captured sample.",
  },
  crack: {
    title: "License / trial / signature analysis",
    file: "crack.md",
    fallback:
      "Locate the check (error strings, branch, server field), instrument it (frida/ltrace), recover the real predicate, then patch the branch or emulate the algorithm. Re-verify after every change and keep an unpatched copy for diffing.",
  },
  android: {
    title: "Android app assessment",
    file: "android.md",
    fallback:
      "apktool decode -> manifest attack surface; jadx for code; frida for runtime checks (pinning, root, signature); native libs via ghidra. Repackage with zipalign + apksigner and verify the patched build actually runs.",
  },
  exploit: {
    title: "Exploit development",
    file: "exploit.md",
    fallback:
      "Locate the bug, characterise the primitive, check mitigations (ASLR/NX/Canary/PIE/RELRO/CFG), build the smallest reliable PoC, prove impact, document prerequisites and success rate.",
  },
  forensics: {
    title: "Forensics & incident response",
    file: "forensics.md",
    fallback:
      "Acquire with hashes, work on copies, build a timeline (fls/mactime or plaso), analyse memory with volatility3, extract IOCs, map to ATT&CK, keep chain of custody for every artifact.",
  },
  report: {
    title: "Engagement report",
    file: "report.md",
    fallback:
      "Structure: scope and timeline, assets, findings with evidence and CVSS, exploitation path, credentials (verbatim by default, redacted when policy.redact_reports is on), remediation, reproduction appendix. Every claim carries a command and an output excerpt.",
  },
}

export interface Playbook {
  domain: PlaybookDomain
  title: string
  content: string
  source: "file" | "fallback"
}

let fsModule: any = null

async function loadFs(): Promise<any> {
  if (fsModule !== null) return fsModule
  try {
    const mod: any = await import("node:fs")
    fsModule = mod?.default ?? mod
  } catch {
    fsModule = false
  }
  return fsModule
}

export async function loadPlaybook(domain: string): Promise<Playbook | null> {
  const key = String(domain ?? "").trim().toLowerCase() as PlaybookDomain
  const entry = ENTRIES[key]
  if (!entry) return null

  const fs = await loadFs()
  try {
    if (fs && typeof fs.readFileSync === "function") {
      const url = new URL(`./playbooks/${entry.file}`, import.meta.url)
      const content = fs.readFileSync(url, "utf8")
      if (content && content.trim().length > 0) {
        return { domain: key, title: entry.title, content, source: "file" }
      }
    }
  } catch {
    // fall through to the inline summary
  }

  return { domain: key, title: entry.title, content: entry.fallback, source: "fallback" }
}
