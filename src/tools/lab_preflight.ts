import type { ToolDeps } from "./deps.ts"

/**
 * Toolchain inventory: which research binaries exist on this host.
 * Read-only — it stats PATH entries, it never executes anything.
 */
const TOOLCHAIN: Record<string, string[]> = {
  recon: ["nmap", "masscan", "naabu", "httpx", "ffuf", "feroxbuster", "gobuster", "nuclei", "subfinder", "amass", "dnsx", "whois", "dig", "nslookup", "curl"],
  reverse: ["jadx", "apktool", "frida", "frida-ps", "objection", "ghidra", "r2", "radare2", "gdb", "lldb", "objdump", "strings", "xxd", "upx", "binwalk"],
  exploit: ["python3", "python", "msfconsole", "msfvenom", "sqlmap", "hydra", "netexec", "impacket-smbserver", "impacket-secretsdump", "chisel", "ligolo-ng", "pwntools", "certipy", "responder"],
  android: ["adb", "aapt", "aapt2", "zipalign", "apksigner", "java", "keytool"],
  forensics: ["vol", "volatility3", "tshark", "tcpdump", "fls", "icat", "mmls", "plaso", "log2timeline.py", "foremost"],
  crypto: ["openssl", "hashcat", "john", "gpg"],
  runtime: ["node", "bun", "deno", "docker", "git", "jq", "go", "cargo"],
}

/**
 * Directories that are scanned in addition to PATH. The lab bootstrap puts
 * prebuilt binaries here so they are usable before a shell restart picks up
 * the new user PATH.
 */
function extraDirs(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  const dirs = [
    process.env.LAB_TOOLS_DIR || "",
    "D:/Tools/sec/bin",
    home ? `${home}/Tools/sec/bin` : "",
    home ? `${home}/.local/bin` : "",
  ]
  return dirs.filter(Boolean)
}

function locate(fs: any, name: string): string | null {
  if (!fs || typeof fs.statSync !== "function") return null
  const pathValue = process.env.PATH || process.env.Path || ""
  const delimiter = process.platform === "win32" ? ";" : ":"
  const dirs = [...pathValue.split(delimiter), ...extraDirs()].map((dir) => dir.trim()).filter(Boolean)
  const extensions =
    process.platform === "win32"
      ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""]

  for (const dir of dirs) {
    const base = dir.replace(/[\\/]+$/, "")
    for (const extension of extensions) {
      const candidate = `${base}/${name}${extension}`
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // keep looking
      }
    }
  }
  return null
}

export function labPreflightTool(deps: ToolDeps) {
  return {
    name: "lab_preflight",
    description:
      "Inventory the local research toolchain (recon, reverse, exploit, android, forensics, crypto, runtime). Read-only PATH scan; nothing is executed.",
    input: { type: "object", properties: {}, additionalProperties: false },
    output: {
      type: "object",
      properties: {
        platform: { type: "string" },
        arch: { type: "string" },
        summary: { type: "string" },
        found: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              path: { type: "string" },
              category: { type: "string" },
            },
            required: ["name", "path", "category"],
            additionalProperties: false,
          },
        },
        missing: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              category: { type: "string" },
            },
            required: ["name", "category"],
            additionalProperties: false,
          },
        },
        categories: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              found: { type: "number" },
              missing: { type: "number" },
            },
            required: ["found", "missing"],
            additionalProperties: false,
          },
        },
      },
      required: ["platform", "arch", "summary", "found", "missing", "categories"],
      additionalProperties: false,
    },

    async execute() {
      const found: Array<{ name: string; path: string; category: string }> = []
      const missing: Array<{ name: string; category: string }> = []
      const categories: Record<string, { found: number; missing: number }> = {}

      for (const [category, names] of Object.entries(TOOLCHAIN)) {
        categories[category] = { found: 0, missing: 0 }
        for (const name of names) {
          const path = locate(deps.fs, name)
          if (path) {
            found.push({ name, path, category })
            categories[category].found++
          } else {
            missing.push({ name, category })
            categories[category].missing++
          }
        }
      }

      const summary = `${found.length} found / ${missing.length} missing across ${Object.keys(TOOLCHAIN).length} categories`
      return {
        output: {
          platform: process.platform,
          arch: process.arch,
          summary,
          found,
          missing,
          categories,
        },
        content: [
          `toolchain: ${summary}`,
          ...Object.entries(categories).map(
            ([category, counts]) => `${category}: ${counts.found} found, ${counts.missing} missing`,
          ),
          "",
          `found: ${found.map((entry) => entry.name).join(", ") || "none"}`,
          `missing: ${missing.map((entry) => entry.name).join(", ") || "none"}`,
        ].join("\n"),
      }
    },
  }
}
