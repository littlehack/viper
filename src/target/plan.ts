/**
 * Deterministic target -> engagement plan.
 *
 * The point is to remove the model's only remaining excuse ("you did not tell
 * me what to do with it"). Every target kind has one default objective, one
 * ordered chain and one exact first command. The model may extend the chain with
 * `lab_playbook`, but it never has to invent it, and it never has to ask.
 */

import type { Target } from "./detect.ts"

export interface PlanStep {
  goal: string
  commands: string[]
}

export interface TargetPlan {
  target: Target
  objective: string
  playbooks: string[]
  chain: PlanStep[]
  first_command: string
  success: string[]
  preflight: string[]
}

const WORDLIST = "/usr/share/seclists/Discovery/Web-Content/raft-medium-words.txt"

/** `10.0.0.5:8080` -> { host: "10.0.0.5", port: "8080" }. IPv6 is left intact. */
function splitPort(value: string): { host: string; port: string | null } {
  if (value.includes(":") && value.split(":").length !== 2) return { host: value, port: null }
  const match = /^([^:/\s]+):(\d{1,5})$/.exec(value)
  if (!match) return { host: value, port: null }
  const port = Number(match[2])
  if (port < 1 || port > 65535) return { host: value, port: null }
  return { host: match[1], port: match[2] }
}

function host(target: Target): string {
  return splitPort(target.value).host
}

function web(target: Target): string {
  if (target.kind === "ipv6" || target.kind === "cidr") return `http://[${host(target)}]`
  return target.value
}

function assetChain(target: Target, scan: string): PlanStep[] {
  return [
    {
      goal: "全端口 + UDP 常用端口 + 服务/版本/指纹（先测通再谈漏洞）",
      commands: [
        scan,
        `masscan -p1-65535 --rate 2000 ${host(target)} 2>/dev/null | tee masscan.txt`,
        `nmap -Pn -sU --top-ports 50 ${host(target)} -oN udp.txt`,
      ],
    },
    {
      goal: "识别 Web 面与框架指纹（有 80/443/8080/8443 就直接进 web 链）",
      commands: [
        `httpx -u ${web(target)} -u https://${web(target)} -title -tech-detect -status-code -web-server -favicon -silent`,
        `whatweb -a 3 https://${web(target)} 2>/dev/null`,
      ],
    },
    {
      goal: "目录/接口枚举 + 已知问题扫描（nuclei 打 cve/exposure/misconfig/default-login）",
      commands: [
        `ffuf -u https://${web(target)}/FUZZ -w ${WORDLIST} -mc all -fc 404 -of json -o ffuf.json`,
        `nuclei -u https://${web(target)} -severity critical,high,medium -tags cve,exposure,misconfig,default-login -jsonl -o nuclei.jsonl`,
        `nuclei -u https://${web(target)} -t http/technologies/ -jsonl -o tech.jsonl`,
      ],
    },
    {
      goal: "按服务把指纹接到专项（Redis/Docker/K8s/ES/Mongo/MySQL/MSSQL/SMB/RDP/VPN/CI/管理面板）",
      commands: [
        `nmap -Pn -sV --script "default and safe" -p <按上一步开放的端口> ${host(target)} -oN scripts.txt`,
        `redis-cli -h ${host(target)} ping 2>/dev/null; curl -s http://${host(target)}:2375/version`,
      ],
    },
    {
      goal: "以已确认的问题为入口取权限，逐跳记录命令与回显（未确认不强打）",
      commands: [
        `# 按漏洞类型选：sqlmap / 未授权 API / 默认口令 / CVE PoC；每条留原始请求`,
      ],
    },
    {
      goal: "证据与报告：哈希、时间线、复现命令",
      commands: [`lab_hash paths=["masscan.txt","nuclei.jsonl","ffuf.json"]`, `lab_report title="${host(target)} engagement"`],
    },
  ]
}

function kindPlan(target: Target): Omit<TargetPlan, "target" | "first_command"> {
  const value = target.value

  switch (target.kind) {
    case "ipv4":
    case "ipv6": {
      const named = splitPort(target.value)
      const firstScan = named.port
        ? `nmap -Pn -sS -sV -O -T4 -p ${named.port} ${named.host} -oN nmap.txt`
        : `nmap -Pn -sS -sV -O -T4 --top-ports 2000 ${named.host} -oN nmap.txt`
      return {
        objective:
          "测绘该主机全部暴露服务、确认可利用问题、取得访问权限，并用最小破坏动作证明影响",
        playbooks: ["recon", "exploit"],
        chain: assetChain(target, firstScan),
        success: [
          "端口/服务/版本清单落盘（nmap/masscan 输出）",
          "至少一条可复现结论：可利用漏洞，或带证据的“无暴露面”结论",
          "取得权限时给出入口、账号层级与证明命令回显",
        ],
        preflight: ["nmap", "masscan", "httpx", "nuclei", "ffuf"],
      }
    }

    case "cidr":
      return {
        objective:
          "先做网段存活与端口铺面，再按存活主机逐台走服务枚举 → 漏洞确认 → 利用 → 证据链",
        playbooks: ["recon", "exploit"],
        chain: [
          {
            goal: "网段存活与开放端口铺面（先整段，再逐台）",
            commands: [
              `nmap -Pn -n -p- --min-rate 2000 --max-retries 1 ${value} -oG sweep.gnmap`,
              `masscan ${value} -p0-65535 --rate 5000 -oJ masscan.json`,
              `awk '/Up|open/{print $2}' sweep.gnmap | sort -u > live.txt`,
            ],
          },
          {
            goal: "对 live.txt 每台主机跑服务识别，按服务分桶",
            commands: [`nmap -Pn -sV -sC -iL live.txt -oA services`],
          },
          {
            goal: "Web 面统一指纹与已知问题扫描",
            commands: [
              `httpx -l live.txt -ports 80,443,8080,8443,8000,9000 -title -tech-detect -silent -o web.txt`,
              `nuclei -l web.txt -severity critical,high,medium -jsonl -o nuclei.jsonl`,
            ],
          },
          {
            goal: "逐台利用与横向：优先未授权/弱口令/管理面，记录每跳源与目的",
            commands: [`# 按服务桶选链；凭证只在授权范围内复用`],
          },
          {
            goal: "落库与报告",
            commands: [`lab_report title="CIDR ${value}"`],
          },
        ],
        success: ["存活主机与端口表完整", "每台存活主机有服务指纹", "至少一条可复现问题或明确无问题证据"],
        preflight: ["nmap", "masscan", "httpx", "nuclei"],
      }

    case "domain":
      return {
        objective:
          "子域与边缘资产收全 → 指纹分桶 → 漏洞确认 → 利用 → 证据链（不遗漏未备案资产）",
        playbooks: ["recon", "exploit"],
        chain: [
          {
            goal: "被动 + 主动子域枚举，合并去重",
            commands: [
              `subfinder -d ${value} -all -silent | sort -u > subs.txt`,
              `curl -s "https://crt.sh/?q=%25.${value}&output=json" | jq -r '.[].name_value' | tr ',' '\\n' | sort -u > crt.txt`,
              `cat subs.txt crt.txt | sort -u > all.txt; dnsx -l all.txt -a -resp -silent -o resolved.txt`,
            ],
          },
          {
            goal: "HTTP 指纹与状态码，识别边缘/管理/测试环境",
            commands: [`httpx -l all.txt -title -tech-detect -status-code -web-server -favicon -silent -o web.txt`],
          },
          {
            goal: "目录与已知问题扫描（按 web.txt 分批，别一次打全量）",
            commands: [
              `nuclei -l web.txt -severity critical,high,medium -tags cve,exposure,misconfig,default-login -jsonl -o nuclei.jsonl`,
              `ffuf -u https://${value}/FUZZ -w ${WORDLIST} -mc all -fc 404 -o ffuf.json -of json`,
            ],
          },
          {
            goal: "确认并利用：从暴露面到权限，记录原始请求",
            commands: [`# sqlmap / 未授权接口 / 默认口令 / CVE PoC，按命中类型选`],
          },
          {
            goal: "资产与证据落库：域名/IP/端口/指纹逐条记入资产表",
            commands: [
              `# 资产表列：域名或 IP | 端口 | 服务/版本 | 指纹 | 状态 | 证据文件`,
              `lab_report title="${value} engagement"`,
            ],
          },
        ],
        success: ["子域与解析结果落盘", "每个 HTTP 端点有指纹", "至少一条可复现结论"],
        preflight: ["subfinder", "dnsx", "httpx", "nuclei", "ffuf"],
      }

    case "url":
      return {
        objective: "该 URL 背后的应用做完整 Web 评估：指纹 → 接口/目录 → 漏洞确认 → 利用 → 证据",
        playbooks: ["recon", "exploit"],
        chain: [
          {
            goal: "指纹、响应头、技术栈、WAF 判定",
            commands: [
              `httpx -u ${value} -title -tech-detect -status-code -web-server -location -silent`,
              `curl -sik ${value} | head -60`,
            ],
          },
          {
            goal: "目录与接口发现（含 JS 里的接口提取）",
            commands: [
              `ffuf -u ${value.replace(/\/?$/, "/")}FUZZ -w ${WORDLIST} -mc all -fc 404 -of json -o ffuf.json`,
              `katana -u ${value} -jc -d 2 -silent -o crawled.txt`,
            ],
          },
          {
            goal: "已知问题与未授权访问",
            commands: [`nuclei -u ${value} -severity critical,high,medium -jsonl -o nuclei.jsonl`],
          },
          {
            goal: "手动验证高价值面：认证、越权、注入、上传、SSRF、反序列化",
            commands: [`# 每条结论保留原始请求与响应片段`],
          },
          {
            goal: "利用与证据",
            commands: [`lab_hash paths=["ffuf.json","nuclei.jsonl","crawled.txt"]`],
          },
        ],
        success: ["端点清单与指纹", "至少一条可复现漏洞或明确无漏洞证据", "PoC 可复跑"],
        preflight: ["httpx", "ffuf", "nuclei", "katana"],
      }

    case "org":
      return {
        objective:
          "该单位的外部资产收全：工商/备案/公众号/招聘线索 → 主域与子域 → 边缘资产 → 指纹 → 漏洞",
        playbooks: ["recon", "exploit"],
        chain: [
          {
            goal: "公开信息定位主域与关联单位（备案、官网、公众号、招聘、招投标）",
            commands: [
              `curl -s "https://crt.sh/?O=${encodeURIComponent(value)}&output=json" | jq -r '.[].name_value' | sort -u > org-domains.txt`,
              `# 同时用 web 搜索查“${value} 官网 / ICP 备案 / 招聘 / 公众号”，把主域补进 org-domains.txt`,
            ],
          },
          {
            goal: "主域确认后立即做子域与证书透明枚举",
            commands: [
              `subfinder -d <主域> -all -silent > subs.txt`,
              `dnsx -l subs.txt -a -resp -silent -o resolved.txt`,
            ],
          },
          {
            goal: "HTTP 指纹分桶（官网/办公/测试/边缘/未备案 IP）",
            commands: [`httpx -l resolved.txt -title -tech-detect -status-code -silent -o web.txt`],
          },
          {
            goal: "按桶做漏洞确认与利用",
            commands: [`nuclei -l web.txt -severity critical,high,medium -jsonl -o nuclei.jsonl`],
          },
          {
            goal: "资产表落库与报告",
            commands: [`lab_report title="${value} 资产测绘"`],
          },
        ],
        success: ["主域与关联域清单", "资产表（域名/IP/端口/指纹）", "至少一条可复现结论或明确无暴露面"],
        preflight: ["subfinder", "dnsx", "httpx", "nuclei"],
      }

    case "android_app":
      return {
        objective: "该 Android 产物做完整逆向：清单与权限 → 代码与协议 → 运行时校验（pinning/root/签名）→ 补丁并验证可运行",
        playbooks: ["android", "reverse"],
        chain: [
          {
            goal: "解包与清单：组件、权限、SDK、网络安全配置",
            commands: [
              `apktool d -f "${value}" -o out/apktool`,
              `jadx -d out/jadx --show-bad-code "${value}"`,
              `aapt2 dump badging "${value}" > out/badging.txt`,
            ],
          },
          {
            goal: "攻击面定位：导出组件、Deeplink、WebView、硬编码密钥、证书固定",
            commands: [
              `grep -rniE "setJavaScriptEnabled|addJavascriptInterface|TrustManager|CertificatePinner|pin-set|api[_-]?key|secret" out/jadx | head -80`,
              `grep -rn "exported=\\"true\\"" out/apktool/AndroidManifest.xml`,
            ],
          },
          {
            goal: "native 层与协议：so 指纹、JNI、加密常量",
            commands: [`file out/apktool/lib/*/*.so`, `r2 -q -c "iz~aes;iz~key" out/apktool/lib/arm64-v8a/lib*.so`],
          },
          {
            goal: "运行时验证：frida 挂 pinning / root / 签名校验，抓真实请求",
            commands: [
              `frida-ps -U | head -40`,
              `objection -g <包名> explore -s "android sslpinning disable"`,
            ],
          },
          {
            goal: "补丁与回编译，验证装得上、跑得通",
            commands: [
              `apktool b out/apktool -o out/patched.apk`,
              `zipalign -f 4 out/patched.apk out/aligned.apk && apksigner sign --ks <keystore> --out out/signed.apk out/aligned.apk`,
              `adb install -r out/signed.apk`,
            ],
          },
        ],
        success: ["清单/权限/组件清单", "关键校验点定位（类名+方法）", "补丁产物可安装并验证行为"],
        preflight: ["apktool", "jadx", "aapt2", "frida", "adb", "apksigner"],
      }

    case "package":
      return {
        objective: "从设备/商店取得该包名的 APK，随后走完整 Android 逆向（清单 → 代码 → 运行时 → 补丁验证）",
        playbooks: ["android", "reverse"],
        chain: [
          {
            goal: "定位并拉取 APK（已连设备）",
            commands: [
              `adb shell pm path ${value}`,
              `adb shell pm path ${value} | sed 's/package://' | xargs -I{} adb pull {} out/base.apk`,
            ],
          },
          {
            goal: "解包、反编译、清单",
            commands: [`jadx -d out/jadx "${value}" 2>/dev/null || jadx -d out/jadx out/base.apk`, `apktool d -f out/base.apk -o out/apktool`],
          },
          {
            goal: "走 android_app 链的定位 / 运行时 / 补丁步骤",
            commands: [`# 见 /apk 或 lab_playbook domain="android"`],
          },
        ],
        success: ["APK 落地并哈希", "清单与关键校验点", "可复现的运行时证据"],
        preflight: ["adb", "jadx", "apktool", "frida"],
      }

    case "binary":
      return {
        objective: "该二进制做完整逆向：格式与加固 → 字符串/导入/交叉引用 → 关键逻辑 → 动态验证 → 补丁或 PoC",
        playbooks: ["reverse"],
        chain: [
          {
            goal: "分诊：格式、架构、加固、熵、导入导出",
            commands: [
              `file "${value}"; strings -n 6 "${value}" | head -200`,
              `checksec --file="${value}" 2>/dev/null || rabin2 -I "${value}"`,
            ],
          },
          {
            goal: "静态：函数/字符串交叉引用，定位校验与协议",
            commands: [
              `r2 -q -c "aaa; izz~pass;izz~key;axt @ str.*" "${value}"`,
              `# 或用 IDA/Ghidra 载入：lab_preflight 后选可用那个`,
            ],
          },
          {
            goal: "动态：strace/ltrace/frida 观察真实行为与参数",
            commands: [`frida-trace -f "${value}" -i "open*" -i "connect" -i "strcmp"`, `ltrace -f -s 200 "${value}" 2>&1 | head -100`],
          },
          {
            goal: "补丁或 PoC：最小改动，保留原件用于 diff",
            commands: [`cp "${value}" "${value}.orig"`, `# 改完用 cmp -l 或 radiff2 验证只改了预期字节`],
          },
          {
            goal: "证据与复现",
            commands: [`lab_hash paths=["${value}","${value}.orig"]`],
          },
        ],
        success: ["格式/加固结论", "关键函数与校验逻辑定位", "补丁或 PoC 可复跑，原件保留"],
        preflight: ["file", "strings", "r2", "rabin2", "frida", "ltrace"],
      }

    case "archive":
      return {
        objective: "该归档做内容清点与取证/逆向分诊：文件树 → 可疑产物 → 逐项分析",
        playbooks: ["forensics", "reverse"],
        chain: [
          {
            goal: "哈希、清单、去重",
            commands: [`7z l "${value}" > out/listing.txt`, `mkdir -p out/extract && 7z x -oout/extract "${value}"`, `lab_hash paths=["${value}"]`],
          },
          {
            goal: "文件类型分布与异常项",
            commands: [`find out/extract -type f -exec file {} + | sort | uniq -c | sort -rn | head -40`],
          },
          {
            goal: "对可执行/脚本/配置逐项走 binary / 源码链",
            commands: [`# 按 file 结果选链`],
          },
        ],
        success: ["完整清单与哈希", "可疑项逐一定性", "结论带证据路径"],
        preflight: ["7z", "file"],
      }

    case "path":
      return {
        objective: "该路径做库存与静态分析：文件树、密钥/接口/配置、可执行物 → 逐项结论",
        playbooks: ["reverse"],
        chain: [
          {
            goal: "库存",
            commands: [`find "${value}" -maxdepth 3 -type f | head -200`, `du -sh "${value}"`],
          },
          {
            goal: "高价值内容：密钥、令牌、端点、证书",
            commands: [
              `grep -rniE "(api[_-]?key|secret|token|password|BEGIN [A-Z ]*PRIVATE KEY|https?://)" "${value}" | head -120`,
            ],
          },
          {
            goal: "按文件类型分流到 reverse / android / forensics",
            commands: [`# file 结果决定链`],
          },
        ],
        success: ["文件树与规模", "敏感面清单（位置引用）", "逐项结论"],
        preflight: ["file", "grep"],
      }

    case "hash":
      return {
        objective: "该哈希做样本定性：情报查询 → 本地命中 → 家族/行为结论 → IOC 与检测建议",
        playbooks: ["forensics", "reverse"],
        chain: [
          {
            goal: "情报查询（MalwareBazaar / VirusTotal / 本地库）",
            commands: [
              `curl -s https://mb-api.abuse.ch/api/v1/ -d "query=get_info&hash=${value}" | jq .`,
              `grep -ril "${value}" . 2>/dev/null | head -20`,
            ],
          },
          {
            goal: "若拿到样本：分诊 + 家族比对",
            commands: [`lab_hash paths=["<样本路径>"]`, `# 走 binary / forensics 链`],
          },
          {
            goal: "结论与检测",
            commands: [`# 家族、行为、IOC、YARA/规则建议；证据引用哈希`],
          },
        ],
        success: ["情报结论或明确“无公开情报”", "样本行为与家族判断", "IOC/检测项"],
        preflight: ["curl", "jq"],
      }

    case "repo":
      return {
        objective: "该仓库做代码审计：克隆 → 依赖与密钥 → 危险 sink → 可复现 PoC",
        playbooks: ["reverse", "recon"],
        chain: [
          {
            goal: "克隆与清点",
            commands: [
              `git clone --depth 1 ${/^git@/.test(value) ? value : `https://${value.replace(/^https?:\/\//, "")}`} out/repo`,
              `cd out/repo && git log --oneline -5`,
            ],
          },
          {
            goal: "密钥与依赖",
            commands: [`trufflehog filesystem out/repo --only-verified`, `cd out/repo && (npm audit || pip-audit || govulncheck ./...) 2>/dev/null | head -60`],
          },
          {
            goal: "危险 sink 与鉴权缺口",
            commands: [
              `cd out/repo && grep -rnE "(exec\\(|eval\\(|system\\(|pickle\\.loads|deserialize|innerHTML|raw\\()" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" . | head -80`,
              `semgrep --config auto out/repo 2>/dev/null | head -120`,
            ],
          },
          {
            goal: "PoC 与修复建议",
            commands: [`# 对每条可疑点写最小复现，标注文件:行`],
          },
        ],
        success: ["仓库结构与风险面", "至少一条可复现问题或明确无问题", "修复建议带文件:行"],
        preflight: ["git", "semgrep", "trufflehog"],
      }

    default:
      return {
        objective: "对该目标做资产测绘与安全评估，产出可复现结论",
        playbooks: ["recon"],
        chain: [
          { goal: "确认目标形态与可达性", commands: [`curl -sik ${value} | head -40`] },
          { goal: "指纹与暴露面", commands: [`httpx -u ${value} -title -tech-detect -status-code`] },
          { goal: "按指纹接漏洞与利用链", commands: [`# lab_playbook domain="recon"`] },
        ],
        success: ["目标形态明确", "至少一条可复现结论"],
        preflight: ["curl", "httpx"],
      }
  }
}

export function buildPlan(target: Target): TargetPlan {
  const base = kindPlan(target)
  const first = base.chain[0]?.commands?.[0] ?? ""
  return { target, first_command: first, ...base }
}

/** Plain-text rendering for prompt blocks and tool output. */
export function formatPlan(plan: TargetPlan): string {
  const lines: string[] = []
  lines.push(`target=${plan.target.value} | kind=${plan.target.kind} | confidence=${plan.target.confidence.toFixed(2)}`)
  lines.push(`objective: ${plan.objective}`)
  lines.push(`playbooks: ${plan.playbooks.join(", ")}`)
  lines.push("chain:")
  plan.chain.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.goal}`)
    for (const command of step.commands) lines.push(`     $ ${command}`)
  })
  lines.push(`first command: ${plan.first_command}`)
  if (plan.preflight.length) lines.push(`preflight: lab_preflight (${plan.preflight.join(", ")})`)
  lines.push("success:")
  for (const item of plan.success) lines.push(`  - ${item}`)
  return lines.join("\n")
}
