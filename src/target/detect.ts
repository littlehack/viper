/**
 * Target detection — the missing half of "give me a target and go".
 *
 * Everything here is pure: no fs, no network, no ctx. A string goes in, an
 * ordered list of typed targets comes out. The plugin uses it on the admission
 * stage (rewrite the operator's turn) and on every request (bind the session),
 * the `lab_target` tool exposes it to the model, and the self-test covers it.
 *
 * Design rules:
 *   - high precision over recall: a wrong target is worse than no target, since
 *     a wrong target silently aims the whole chain at the wrong asset;
 *   - deterministic order: URL, repo, hash, IP/CIDR, artifact, path, org,
 *     package, domain. The first entry is the one the plan binds to;
 *   - masked matching: once a span is claimed, it cannot be re-read as another
 *     kind (an IP inside a URL is not a second target).
 */

export type TargetKind =
  | "ipv4"
  | "ipv6"
  | "cidr"
  | "url"
  | "domain"
  | "org"
  | "android_app"
  | "binary"
  | "archive"
  | "package"
  | "path"
  | "hash"
  | "repo"

export interface Target {
  /** The exact substring the operator wrote. */
  raw: string
  kind: TargetKind
  /** Normalised value the chain is built from (no trailing punctuation). */
  value: string
  /** 0..1 — how sure the classifier is; used only for ordering inside a kind. */
  confidence: number
}

export interface ExtractOptions {
  /** Keep at most this many targets (default 8). */
  max?: number
  /** Also surface a Chinese company / institution name as `kind: "org"`. */
  allowOrg?: boolean
}

const CONFIDENCE: Record<TargetKind, number> = {
  url: 0.99,
  repo: 0.97,
  hash: 0.96,
  ipv4: 0.97,
  ipv6: 0.93,
  cidr: 0.96,
  android_app: 0.95,
  binary: 0.93,
  archive: 0.9,
  package: 0.86,
  path: 0.85,
  domain: 0.9,
  org: 0.7,
}

const TRAILING = /[.,;:!?，。；：、!?）)\]}>"'”’]+$/

const EXT_KIND: Record<string, TargetKind> = {
  apk: "android_app",
  aab: "android_app",
  xapk: "android_app",
  dex: "android_app",
  ipa: "android_app",
  exe: "binary",
  dll: "binary",
  sys: "binary",
  so: "binary",
  dylib: "binary",
  elf: "binary",
  bin: "binary",
  ko: "binary",
  o: "binary",
  class: "binary",
  jar: "binary",
  wasm: "binary",
  zip: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  img: "archive",
  iso: "archive",
  vmdk: "archive",
  qcow2: "archive",
  pcap: "archive",
  pcapng: "archive",
}

/** Extensions that must never be read as a domain (`notes.md`, `main.ts`, ...). */
const FILE_EXT = new Set([
  ...Object.keys(EXT_KIND),
  "md", "txt", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonl", "yml", "yaml",
  "toml", "ini", "cfg", "conf", "log", "csv", "xml", "html", "htm", "css", "scss",
  "py", "rb", "go", "rs", "java", "kt", "kts", "c", "h", "cc", "cpp", "hpp", "cs",
  "php", "sh", "ps1", "bat", "cmd", "sql", "vue", "svelte", "lock", "map", "svg",
])

const COMMON_TLD = new Set([
  "com", "net", "org", "io", "cn", "co", "me", "dev", "app", "cloud", "site",
  "info", "xyz", "top", "ai", "edu", "gov", "mil", "int", "biz", "tv", "cc",
  "ru", "jp", "hk", "tw", "sg", "kr", "de", "uk", "fr", "nl", "se", "no", "fi",
  "pl", "it", "es", "pt", "br", "mx", "ar", "au", "nz", "ca", "us", "ch", "at",
  "be", "dk", "ie", "il", "in", "id", "my", "ph", "th", "vn", "tr", "ua", "cz",
])

const PACKAGE_RE = /^(?:com|cn|org|net|io|me|dev|app|edu|gov|co)(?:\.[a-z0-9_]+){2,}$/
const ORG_RE =
  /[\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,30}(?:有限公司|股份有限公司|集团|科技|网络|信息|银行|医院|大学|学院|政府|管理局|委员会|工作室|研究院)/g

/**
 * Well-known organisations that are normally written without a legal suffix.
 * Exact-token matching only: `腾讯云 API 报错` yields no target because the
 * engagement gate also requires target-only or explicit org intent.
 */
const KNOWN_ORG = [
  "国家电网", "南方电网", "中国移动", "中国联通", "中国电信", "中国石油", "中国石化", "中国海油",
  "中国建筑", "中国中铁", "中国铁建", "中国交建", "中国电建", "中国中车", "中国航天", "中国航空",
  "中国银行", "工商银行", "建设银行", "农业银行", "交通银行", "招商银行",
  "腾讯", "阿里巴巴", "蚂蚁集团", "百度", "字节跳动", "京东", "美团", "拼多多", "网易", "小米",
  "华为", "滴滴", "快手", "携程", "哔哩哔哩", "比亚迪", "宁德时代", "大疆", "中兴", "海尔", "格力", "美的",
]

function clean(value: string): string {
  return value.trim().replace(TRAILING, "")
}

function pad(text: string): string[] {
  // code-unit array: keeps regex indices aligned with slicing
  return text.split("")
}

function masked(chars: string[], start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== " ") return false
  }
  return true
}

function mask(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) chars[index] = " "
}

function validIPv4(address: string): boolean {
  const parts = address.split(".")
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function validIPv6(address: string): boolean {
  if (!/^[0-9a-fA-F:]+$/.test(address)) return false
  if ((address.match(/:/g) ?? []).length < 2) return false
  if (address.includes(":::")) return false
  // `12:30:45` is a clock: all-digits groups and no `::`
  if (!address.includes("::") && !/[a-fA-F]/.test(address)) return false
  return true
}

/** Classify one already-isolated string (used by scope records and tools). */
export function classifyTarget(value: string): Target | null {
  const text = clean(String(value ?? ""))
  if (!text) return null
  const found = extractTargets(text, { max: 1 })
  if (found.length > 0) return found[0]
  return { raw: text, kind: "domain", value: text, confidence: 0.5 }
}

/**
 * Extract every target the operator named, in binding order.
 * The first element is what `buildPlan` turns into a chain.
 */
export function extractTargets(input: string, options: ExtractOptions = {}): Target[] {
  const text = String(input ?? "")
  if (!text.trim()) return []
  const max = Number.isFinite(options.max) ? Number(options.max) : 8
  const out: Target[] = []
  const seen = new Set<string>()
  const chars = pad(text)

  const add = (raw: string, kind: TargetKind, value: string): void => {
    const normalised = clean(value)
    if (!normalised) return
    const key = `${kind}:${normalised.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ raw: clean(raw), kind, value: normalised, confidence: CONFIDENCE[kind] })
  }

  const scan = (pattern: RegExp, handle: (match: RegExpExecArray) => void): void => {
    pattern.lastIndex = 0
    if (!pattern.global) {
      const single = pattern.exec(text)
      if (single) handle(single)
      return
    }
    let match: RegExpExecArray | null
    let guardCount = 0
    while ((match = pattern.exec(text)) !== null) {
      if (guardCount > 512) break
      guardCount += 1
      const start = match.index
      const end = start + match[0].length
      if (masked(chars, start, end)) continue
      handle(match)
      mask(chars, start, end)
    }
  }

  // 1. URL — claims everything inside it (host, port, path, query).
  scan(/\bhttps?:\/\/[^\s<>"'`()\[\]{}]+/gi, (match) => {
    const value = clean(match[0])
    if (value.length > 8) add(match[0], "url", value)
  })

  // 2. Repository references.
  scan(/\b(?:github|gitlab|gitee)\.(?:com|cn)[\\/][\w.-]+[\\/][\w.-]+/gi, (match) => {
    add(match[0], "repo", clean(match[0]))
  })
  scan(/\bgit@[\w.-]+:[\w.-]+\/[\w.-]+(?:\.git)?/gi, (match) => {
    add(match[0], "repo", clean(match[0]))
  })

  // 3. Evidence hashes (sha256 / sha1 / md5).
  scan(/\b[a-f0-9]{64}\b/gi, (match) => add(match[0], "hash", match[0].toLowerCase()))
  scan(/\b[a-f0-9]{40}\b/gi, (match) => add(match[0], "hash", match[0].toLowerCase()))
  scan(/\b[a-f0-9]{32}\b/gi, (match) => add(match[0], "hash", match[0].toLowerCase()))

  // 4. IPv4 / CIDR / host:port.
  scan(/(?<![\d.\w])(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?(?::(\d{1,5}))?(?![\d.])/g, (match) => {
    const address = match[1]
    if (!validIPv4(address)) return
    const prefix = match[2]
    const port = match[3]
    if (prefix !== undefined && Number(prefix) > 32) return
    if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return
    const value = clean(match[0])
    add(match[0], prefix !== undefined ? "cidr" : "ipv4", value)
  })

  // 5. IPv6 / IPv6 CIDR.
  scan(/(?<![\w:])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d{1,3})?(?![\w:])/g, (match) => {
    const value = clean(match[0])
    const [address, prefix] = value.split("/")
    if (!validIPv6(address)) return
    if (prefix !== undefined && Number(prefix) > 128) return
    add(match[0], prefix !== undefined ? "cidr" : "ipv6", value)
  })

  // 6. Artifacts (apk / exe / elf / so / jar / image / capture).
  scan(
    /(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/])?[^\s"'<>|*?]+\.(?:apk|aab|xapk|dex|ipa|exe|dll|sys|so|dylib|elf|bin|ko|o|class|jar|wasm|zip|7z|tar|gz|img|iso|vmdk|qcow2|pcap|pcapng)\b/gi,
    (match) => {
      const value = clean(match[0])
      const extension = value.split(".").pop()?.toLowerCase() ?? ""
      const kind = EXT_KIND[extension]
      if (kind) add(match[0], kind, value)
    },
  )

  // 7. Android package id (com.vendor.app) — before the domain pass, which
  //    would otherwise read `com.tencent.mm` as a hostname.
  for (const token of text.split(/[\s,，。；;、"'`()（）\[\]{}<>]+/)) {
    const value = clean(token)
    if (!PACKAGE_RE.test(value)) continue
    const last = value.split(".").pop() ?? ""
    if (COMMON_TLD.has(last) && value.split(".").length === 2) continue
    if (!/[a-z]/.test(last) || last.length < 2) continue
    const index = text.indexOf(value)
    if (index < 0 || masked(chars, index, index + value.length)) continue
    add(value, "package", value)
    mask(chars, index, index + value.length)
  }

  // 8. Filesystem paths (no recognised extension).
  scan(/(?:[A-Za-z]:\\[^\s"'<>|]+|\/(?:[\w.-]+\/)+[\w.-]+|\.{1,2}[\\/][^\s"'<>|]+)/g, (match) => {
    const value = clean(match[0])
    if (value.length < 3) return
    if (value.split(".").pop()?.toLowerCase() in EXT_KIND) return
    add(match[0], "path", value)
  })

  // 9. Domains — plus `host:port` and `host/path`, which are URLs in practice.
  scan(
    /(?<![\w.@-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w-])/gi,
    (match) => {
      const value = clean(match[1]).toLowerCase()
      if (value === "localhost") return
      const labels = value.split(".")
      const last = labels[labels.length - 1]
      if (FILE_EXT.has(last)) return
      if (labels.length < 2) return
      if (labels.some((label) => label.length === 0)) return
      if (/^\d+(?:\.\d+)+$/.test(value)) return

      const start = match.index
      const baseEnd = start + match[0].length
      const tail = text.slice(baseEnd)

      // `vps.example.com:8443/api` — a specific service, not a domain to enumerate.
      const portMatch = /^:(\d{1,5})(?!\d)/.exec(tail)
      if (portMatch) {
        const port = Number(portMatch[1])
        if (port >= 1 && port <= 65535) {
          const pathMatch = /^\/[^\s<>"'`()[\]{}]*/.exec(tail.slice(portMatch[0].length))
          const path = pathMatch ? clean(pathMatch[0]).replace(/\/+$/, "") : ""
          const scheme = [443, 8443, 9443].includes(port) ? "https" : "http"
          const consumed = portMatch[0].length + (path ? pathMatch![0].length : 0)
          mask(chars, baseEnd, baseEnd + consumed)
          add(text.slice(start, baseEnd + consumed), "url", `${scheme}://${value}:${port}${path}`)
          return
        }
      }

      // `example.com/api/v1` — no scheme, still a URL.
      const pathMatch = /^\/[^\s<>"'`()[\]{}]+/.exec(tail)
      if (pathMatch && pathMatch[0].length > 1) {
        const path = clean(pathMatch[0]).replace(/\/+$/, "")
        mask(chars, baseEnd, baseEnd + pathMatch[0].length)
        add(text.slice(start, baseEnd + pathMatch[0].length), "url", `https://${value}${path}`)
        return
      }

      add(match[0], "domain", value)
    },
  )

  // 10. Chinese company / institution names (opt-in, low confidence).
  if (options.allowOrg !== false) {
    for (const name of KNOWN_ORG) {
      let index = text.indexOf(name)
      while (index >= 0) {
        if (!masked(chars, index, index + name.length)) {
          add(name, "org", name)
          mask(chars, index, index + name.length)
        }
        index = text.indexOf(name, index + name.length)
      }
    }
    scan(ORG_RE, (match) => {
      const value = clean(match[0])
      if (value.length < 4) return
      add(match[0], "org", value)
    })
  }

  const limit = Math.max(1, max)
  return out
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit)
}

const LEADING_VERB =
  /^(?:帮我|帮忙|麻烦|请|给我|开始|继续|去|对|针对|研究|分析|测试|测一下|渗透|打点|扫|查|看看|看一下|搞一下|打一下|给)\s*/i

/**
 * True when the operator wrote essentially nothing but the target — the case
 * "只要我提供目标" is about. Then the default chain runs without any question.
 */
export function isTargetOnly(input: string, target: Target): boolean {
  const text = String(input ?? "")
  if (!text.trim()) return false
  let rest = text.replace(target.raw, " ")
  rest = rest.replace(LEADING_VERB, " ")
  rest = rest.replace(/[\s,，。；;、!！?？.。:：\-—~～"'`]+/g, "")
  rest = rest.replace(LEADING_VERB, "")
  return rest.length <= 8
}

/** One-line human summary, used by tool output and audit entries. */
export function describeTargets(targets: ReadonlyArray<Target>): string {
  if (targets.length === 0) return "none"
  return targets.map((target) => `${target.kind}:${target.value}`).join(", ")
}
