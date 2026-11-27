/**
 * Logic self-test — no OpenCode, no installer, no network.
 *
 *   node --experimental-strip-types tools/selftest.mjs
 *
 * Builds a mock plugin context, runs setup() and exercises every hook and tool
 * against temporary scope/audit files.
 */

import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { default: plugin } = await import("../src/plugin.ts")
const { extractTargets } = await import("../src/target/detect.ts")
const { buildPlan } = await import("../src/target/plan.ts")

const temp = mkdtempSync(join(tmpdir(), "viper-"))
const scopeFile = join(temp, "lab-scope.json")
const auditFile = join(temp, "lab-audit.jsonl")
const reportFile = join(temp, "report.md")
const evidenceFile = join(temp, "evidence.txt")

writeFileSync(evidenceFile, "hello", "utf8")
writeFileSync(
  scopeFile,
  JSON.stringify(
    {
      schema: "lab-scope/v1",
      mode: "open-declared",
      policy: {
        authorization_source: "operator-declaration",
        locality_gate: false,
        ownership_recheck: false,
        excluded_paths: ["**/.ssh/**", "**/id_rsa"],
      },
      classes: {
        local_path: true,
        loopback: true,
        private_net: true,
        container_emulator: true,
        external_vps: true,
        cloud_instance: true,
        public_ip: true,
        public_cidr: true,
        domain: true,
        api_endpoint: true,
      },
      engagements: [
        {
          id: "lab-1",
          authorization: "operator-declared",
          targets: ["10.0.0.5"],
          classes: ["private_net"],
        },
      ],
    },
    null,
    2,
  ),
  "utf8",
)

function makeCtx(options = {}) {
  const hooks = { permission: {}, prompt: [], context: [], compaction: [], generate: [], tool: {} }
  const tools = []
  const state = { default: null }
  const agents = [
    { id: "build", mode: "primary", permissions: [] },
    { id: "plan", mode: "primary", permissions: [] },
    { id: "general", mode: "subagent", permissions: [] },
    {
      id: "viper",
      mode: "primary",
      permissions: [{ action: "read", resource: "*.env.*", effect: "allow" }],
    },
    { id: "redteam", mode: "subagent", permissions: [] },
    { id: "reverse", mode: "subagent", permissions: [] },
  ]

  const ctx = {
    options: { scopeFile, auditFile, ...options },
    agent: {
      transform: async (callback) =>
        callback({
          get: (id) => agents.find((agent) => agent.id === id),
          update: (id, update) => {
            const target = agents.find((agent) => agent.id === id)
            if (target) update(target)
          },
          default: (id) => {
            state.default = id
          },
        }),
      list: async () => ({ data: agents }),
    },
    permission: { hook: async (name, fn) => (hooks.permission[name] ??= []).push(fn) },
    session: { hook: async (name, fn) => hooks[name].push(fn) },
    tool: {
      transform: async (callback) => callback({ add: (definition) => tools.push(definition) }),
      hook: async (name, fn) => (hooks.tool[name] ??= []).push(fn),
    },
  }

  return { ctx, hooks, tools, state, agents }
}

const results = []
function test(name, fn) {
  try {
    fn()
    results.push([true, name])
  } catch (error) {
    results.push([false, name])
    console.error(`\nFAIL: ${name}\n  ${error?.stack ?? error}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    results.push([true, name])
  } catch (error) {
    results.push([false, name])
    console.error(`\nFAIL: ${name}\n  ${error?.stack ?? error}`)
  }
}

/* ── instance A: default, all agents ─────────────────────────────────────── */
const A = makeCtx({ agents: "*" })
await plugin.setup(A.ctx)

test("setup registers every hook", () => {
  assert.equal(A.hooks.context.length, 1)
  assert.equal(A.hooks.compaction.length, 1)
  assert.equal(A.hooks.generate.length, 1)
  assert.equal(A.hooks.prompt.length, 1)
  assert.equal(A.hooks.permission.evaluate.length, 1)
  assert.equal(A.hooks.tool["execute.before"].length, 1)
  assert.equal(A.hooks.tool["execute.after"].length, 1)
})

test("any agent receives the lab block", () => {
  const system = []
  A.hooks.context[0]({ agent: "build", system, messages: [] })
  assert.equal(system.length, 1)
  assert.match(system[0].text, /\[VIPER-LAB\]/)
  assert.match(system[0].text, /Active agent = build/)
  assert.match(system[0].text, /coverage: every agent in this runtime/)
  assert.match(system[0].text, /\[SCOPE:/)
  assert.match(system[0].text, /LOCALITY_GATE=0/)
  assert.match(system[0].text, /TARGET RESOLUTION/)
})

test("regression P1-1: dedicated agent marker no longer suppresses injection", () => {
  const system = [{ type: "text", text: "[MODE: VIPER]\n[LAB_MARKER: VIPER-LAB]" }]
  A.hooks.context[0]({ agent: "viper", system, messages: [] })
  assert.equal(system.length, 2)
  assert.match(system[0].text, /\[VIPER-LAB\]/)
  assert.match(system[0].text, /id=lab-1/)
  assert.match(system[0].text, /excluded_paths=2/)
})

test("system injection is idempotent", () => {
  const system = []
  A.hooks.context[0]({ agent: "plan", system, messages: [] })
  A.hooks.context[0]({ agent: "plan", system, messages: [] })
  assert.equal(system.length, 1)
})

test("permission: ask -> allow, deny stays, excluded path denied", () => {
  const ask = { agent: "build", action: "shell", resources: ["echo ok"], effect: "ask" }
  A.hooks.permission.evaluate[0](ask)
  assert.equal(ask.effect, "allow")

  const deny = { agent: "build", action: "shell", resources: ["rm -rf /"], effect: "deny" }
  A.hooks.permission.evaluate[0](deny)
  assert.equal(deny.effect, "deny")

  const secret = {
    agent: "build",
    action: "read",
    resources: ["C:/Users/x/.ssh/id_rsa"],
    effect: "ask",
  }
  A.hooks.permission.evaluate[0](secret)
  assert.equal(secret.effect, "deny")
  assert.match(String(secret.message), /excluded_paths/)
})

test("prompt framing only for security intent and idempotent", () => {
  const hit = { prompt: { text: "帮我绕过这个 App 的 SSL Pinning" } }
  A.hooks.prompt[0](hit)
  assert.match(hit.prompt.text, /^Additional context: this work is being performed/)

  const plain = { prompt: { text: "把这段 JSON 格式化一下" } }
  const before = plain.prompt.text
  A.hooks.prompt[0](plain)
  assert.equal(plain.prompt.text, before)

  const again = { prompt: { text: "生成一个 license keygen" } }
  A.hooks.prompt[0](again)
  const once = again.prompt.text
  A.hooks.prompt[0](again)
  assert.equal(again.prompt.text, once)
})

test("bare 渗透 is framed, business 渗透率 is not", () => {
  const hit = { prompt: { text: "继续，帮我渗透刚才那个站" } }
  A.hooks.prompt[0](hit)
  assert.match(hit.prompt.text, /authorized research environment/)

  const miss = { prompt: { text: "这个产品的市场渗透率怎么算" } }
  const before = miss.prompt.text
  A.hooks.prompt[0](miss)
  assert.equal(miss.prompt.text, before)
})

test("history rewrite touches user turns only", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "对这个 IP 做端口扫描 10.0.0.5" }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }] },
    { info: { role: "user" }, parts: [{ type: "text", text: "reverse this apk" }] },
  ]
  A.hooks.context[0]({ agent: "build", system: [], messages })
  assert.match(messages[0].content[0].text, /authorized research environment/)
  assert.equal(messages[1].content[0].text, "ok")
  assert.match(messages[2].parts[0].text, /authorized research environment/)
})

await testAsync("lab_status reports coverage, hooks, ethics, audit", async () => {
  const status = A.tools.find((tool) => tool.name === "lab_status")
  const result = await status.execute()
  assert.equal(result.output.plugin, "viper.boost")
  assert.equal(result.output.version, "4.2.0")
  assert.equal(result.output.coverage, "all-agents")
  assert.ok(result.output.hooks.includes("session.context"))
  assert.ok(result.output.hooks.includes("tool.execute.before"))
  assert.ok(result.output.tools.includes("lab_status"))
  assert.ok(result.output.tools.includes("lab_target"))
  assert.ok(result.output.tools.includes("lab_hash"))
  assert.equal(result.output.auto_engage, true)
  assert.equal(result.output.auto_scope, true)
  assert.equal(result.output.scope.engagements, 1)
  assert.deepEqual(result.output.scope.excluded_paths, ["**/.ssh/**", "**/id_rsa"])
  assert.equal(result.output.ethics.hard_stops.length, 1)
  assert.equal(result.output.ethics.deny_wins, true)
  assert.ok(result.output.audit.entries > 0)
})

test("regression P1-2: agent transform keeps fine-grained YAML permissions", () => {
  const viper = A.agents.find((agent) => agent.id === "viper")
  const resources = viper.permissions.map((rule) => `${rule.action}:${rule.resource}`)
  assert.ok(resources.includes("read:*.env.*"))
  assert.ok(resources.includes("*:*"))
  assert.equal(viper.mode, "primary")
})

test("agent transform hardens the reverse subagent", () => {
  const reverse = A.agents.find((agent) => agent.id === "reverse")
  assert.equal(reverse.mode, "subagent")
  assert.equal(reverse.hidden, false)
  assert.ok(reverse.permissions.some((rule) => rule.action === "*" && rule.resource === "*"))
})

test("regression P2-1: exclusion matches Windows backslash paths", () => {
  const event = {
    agent: "build",
    action: "read",
    resources: ["C:\\\\Users\\\\x\\\\.ssh\\\\id_rsa"],
    effect: "ask",
  }
  A.hooks.permission.evaluate[0](event)
  assert.equal(event.effect, "deny")
})

test("audit hook keeps captured values verbatim by default", () => {
  A.hooks.tool["execute.before"][0]({
    agent: "build",
    sessionID: "ses_test",
    tool: "shell",
    input: { command: "export API_KEY=sk-abcdefghijklmnopqrstuv" },
  })
  A.hooks.tool["execute.after"][0]({
    agent: "build",
    sessionID: "ses_test",
    tool: "shell",
    status: "completed",
    input: {},
  })
  const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
  const before = lines.filter((entry) => entry.kind === "tool.before").at(-1)
  const after = lines.filter((entry) => entry.kind === "tool.after").at(-1)
  assert.equal(before.tool, "shell")
  assert.match(before.summary, /sk-abcdefghijklmnopqrstuv/)
  assert.doesNotMatch(before.summary, /\[redacted/)
  assert.equal(after.status, "completed")
})

test("audit hook redacts only when policy.redact_reports is enabled", () => {
  const scope = JSON.parse(readFileSync(scopeFile, "utf8"))
  scope.policy.redact_reports = true
  writeFileSync(scopeFile, JSON.stringify(scope, null, 2), "utf8")
  try {
    A.hooks.tool["execute.before"][0]({
      agent: "build",
      sessionID: "ses_test",
      tool: "shell",
      input: { command: "export API_KEY=sk-abcdefghijklmnopqrstuv" },
    })
    const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    const before = lines.filter((entry) => entry.kind === "tool.before").at(-1)
    assert.match(before.summary, /\[redacted/)
    assert.doesNotMatch(before.summary, /sk-abcdefghijklmnopqrstuv/)
  } finally {
    delete scope.policy.redact_reports
    writeFileSync(scopeFile, JSON.stringify(scope, null, 2), "utf8")
  }
})

await testAsync("lab_scope add appends target and audits it", async () => {
  const tool = A.tools.find((entry) => entry.name === "lab_scope")
  const result = await tool.execute({ action: "add", targets: ["vps.example.com", "vps.example.com"] })
  assert.deepEqual(result.output.added, ["vps.example.com"])
  const scope = JSON.parse(readFileSync(scopeFile, "utf8"))
  assert.ok(scope.engagements[0].targets.includes("vps.example.com"))
  const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
  assert.ok(lines.some((entry) => entry.kind === "scope.add"))
})

await testAsync("lab_playbook returns methodology for every domain", async () => {
  const tool = A.tools.find((entry) => entry.name === "lab_playbook")
  for (const domain of ["recon", "reverse", "crack", "android", "exploit", "forensics", "report"]) {
    const result = await tool.execute({ domain })
    assert.equal(result.output.domain, domain)
    assert.ok(result.output.content.length > 100, `playbook ${domain} too short`)
    assert.equal(result.output.source, "file")
  }
})

await testAsync("lab_preflight inventories the toolchain", async () => {
  const tool = A.tools.find((entry) => entry.name === "lab_preflight")
  const result = await tool.execute()
  assert.ok(Array.isArray(result.output.found))
  assert.ok(Array.isArray(result.output.missing))
  assert.match(result.output.summary, /found/)
  assert.ok(result.output.categories.runtime)
})

await testAsync("lab_hash matches a known sha256", async () => {
  const tool = A.tools.find((entry) => entry.name === "lab_hash")
  const result = await tool.execute({ paths: [evidenceFile] })
  const file = result.output.files[0]
  assert.equal(
    file.hash,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  )
  assert.equal(file.size, 5)
})

await testAsync("lab_report builds a skeleton and writes it when asked", async () => {
  const tool = A.tools.find((entry) => entry.name === "lab_report")
  const result = await tool.execute({ title: "Lab report", path: reportFile })
  assert.match(result.output.markdown, /## 1\. Engagement record/)
  assert.match(result.output.markdown, /lab-1/)
  assert.ok(existsSync(reportFile))
})

test("a malformed event cannot abort the request", () => {
  const system = Object.freeze([])
  assert.doesNotThrow(() => A.hooks.context[0]({ agent: "build", system, messages: null }))
})

/* ── auto-engage (4.1) ───────────────────────────────────────────────────── */
test("target classifier covers the common shapes", () => {
  const cases = [
    ["10.0.0.5", "ipv4"],
    ["203.0.113.0/24", "cidr"],
    ["vps.example.com", "domain"],
    ["https://api.example.com/v1/users?id=1", "url"],
    ["com.tencent.mm", "package"],
    ["D:\\cases\\sample.apk", "android_app"],
    ["/opt/lab/crackme.exe", "binary"],
    ["d41d8cd98f00b204e9800998ecf8427e", "hash"],
    ["https://github.com/unicorn-engine/unicorn", "url"],
    ["git@github.com:org/repo.git", "repo"],
    ["vps.example.com:8443", "url"],
    ["10.0.0.5:8080", "ipv4"],
    ["某某科技有限公司", "org"],
    ["国家电网", "org"],
  ]
  for (const [input, kind] of cases) {
    const found = extractTargets(input, { max: 1 })[0]
    assert.ok(found, `no target in ${input}`)
    assert.equal(found.kind, kind, `${input} -> ${found.kind}`)
  }
})

test("host:port and scp-style repo produce runnable first commands", () => {
  const ip = extractTargets("10.0.0.5:8080", { max: 1 })[0]
  const ipPlan = buildPlan(ip)
  assert.match(ipPlan.first_command, /-p 8080 10\.0\.0\.5 -oN nmap\.txt$/)
  assert.doesNotMatch(ipPlan.first_command, /10\.0\.0\.5:8080/)

  const repo = extractTargets("git@github.com:org/repo.git", { max: 1 })[0]
  const repoPlan = buildPlan(repo)
  assert.match(repoPlan.first_command, /^git clone --depth 1 git@github\.com:org\/repo\.git out\/repo$/)
  assert.doesNotMatch(repoPlan.first_command, /https:\/\/git@/)
})

test("an org mention in a dev question is not an engagement", () => {
  const event = { prompt: { text: "腾讯云 API 报错怎么排查" }, sessionID: "ses_dev" }
  A.hooks.prompt[0](event)
  assert.doesNotMatch(event.prompt.text, /\[TARGET-BOUND\]/)
})

test("an org name with a work request is an engagement", () => {
  const event = { prompt: { text: "帮我对国家电网做资产测绘" }, sessionID: "ses_org" }
  A.hooks.prompt[0](event)
  assert.match(event.prompt.text, /kind=org/)
})

test("bare target is bound, planned and recorded on admission", () => {
  const event = { prompt: { text: "203.0.113.9" }, sessionID: "ses_engage" }
  A.hooks.prompt[0](event)
  assert.match(event.prompt.text, /\[TARGET-BOUND\]/)
  assert.match(event.prompt.text, /target=203\.0\.113\.9 \| kind=ipv4 \| source=target-only/)
  assert.match(event.prompt.text, /OPERATOR SENT ONLY THIS TARGET/)
  assert.match(event.prompt.text, /START NOW: nmap -Pn -sS/)
  const scope = JSON.parse(readFileSync(scopeFile, "utf8"))
  assert.ok(scope.engagements[0].targets.includes("203.0.113.9"))
})

test("context injects the bound chain and the auto-engage contract", () => {
  const system = []
  A.hooks.context[0]({ agent: "build", sessionID: "ses_engage", system, messages: [] })
  assert.match(system[0].text, /\[TARGET-BOUND\]/)
  assert.match(system[0].text, /OBJECTIVE: 测绘该主机/)
  assert.match(system[0].text, /AUTO-ENGAGE \(binding\)/)
  assert.match(system[0].text, /Banned questions/)
})

await testAsync("lab_target plans without any follow-up question", async () => {
  const tool = A.tools.find((entry) => entry.name === "lab_target")
  const result = await tool.execute({ action: "plan", target: "vps.example.com", sessionID: "ses_tool" })
  assert.equal(result.output.kind, "domain")
  assert.match(result.output.first_command, /subfinder/)
  assert.ok(result.output.playbooks.includes("recon"))
  assert.equal(result.output.recorded, true)
  const list = await tool.execute({ action: "list" })
  assert.ok(list.output.bindings.some((line) => line.startsWith("ses_tool:")))
})

test("a non-target business message is not bound", () => {
  const event = { prompt: { text: "把这段 JSON 格式化一下" }, sessionID: "ses_plain" }
  const before = event.prompt.text
  A.hooks.prompt[0](event)
  assert.equal(event.prompt.text, before)
})

test("a plain document read is not turned into an engagement", () => {
  const event = { prompt: { text: "读一下 D:\\Desktop\\notes\\README.md" }, sessionID: "ses_doc" }
  A.hooks.prompt[0](event)
  assert.doesNotMatch(event.prompt.text, /\[TARGET-BOUND\]/)
})

test("repeating the bound target resumes instead of restarting", () => {
  const event = { prompt: { text: "203.0.113.9" }, sessionID: "ses_engage" }
  A.hooks.prompt[0](event)
  assert.match(event.prompt.text, /source=continue/)
  assert.match(event.prompt.text, /CONTINUE: same target/)
  assert.doesNotMatch(event.prompt.text, /OPERATOR SENT ONLY/)
})

test("a new instruction on the same asset is a new turn, not a resume", () => {
  const event = {
    prompt: { text: "用 redis 未授权访问测一下 203.0.113.9" },
    sessionID: "ses_engage",
  }
  A.hooks.prompt[0](event)
  assert.match(event.prompt.text, /source=turn/)
  assert.match(event.prompt.text, /START NOW:/)
})

test("an explicit continue on the bound target resumes", () => {
  const event = { prompt: { text: "继续 203.0.113.9" }, sessionID: "ses_engage" }
  A.hooks.prompt[0](event)
  assert.match(event.prompt.text, /source=continue/)
})

/* ── instance B: allowlist ───────────────────────────────────────────────── */
const B = makeCtx({ agents: "build,plan" })
await plugin.setup(B.ctx)

test("allowlist: build injected, general not", () => {
  const first = []
  B.hooks.context[0]({ agent: "build", system: first, messages: [] })
  assert.equal(first.length, 1)

  const second = []
  B.hooks.context[0]({ agent: "general", system: second, messages: [] })
  assert.equal(second.length, 0)
})

test("allowlist: general ask is not elevated", () => {
  const event = { agent: "general", action: "shell", resources: ["x"], effect: "ask" }
  B.hooks.permission.evaluate[0](event)
  assert.equal(event.effect, "ask")
})

await testAsync("allowlist: lab_status coverage lists the allowlist", async () => {
  const status = B.tools.find((tool) => tool.name === "lab_status")
  const result = await status.execute()
  assert.equal(result.output.coverage, "build,plan")
  assert.deepEqual(result.output.lab_agents.sort(), ["build", "plan"])
})

/* ── instance C: write switches off ──────────────────────────────────────── */
const C = makeCtx({
  agents: "*",
  permissions: false,
  framePrompts: false,
  autoEngage: false,
  autoScope: false,
  audit: false,
})
await plugin.setup(C.ctx)

test("permissions:false disables elevation but keeps deny and exclusions", () => {
  assert.ok(Array.isArray(C.hooks.permission.evaluate))
  const ask = { agent: "build", action: "shell", resources: ["x"], effect: "ask" }
  C.hooks.permission.evaluate[0](ask)
  assert.equal(ask.effect, "ask")

  const secret = {
    agent: "build",
    action: "read",
    resources: ["C:/Users/x/.ssh/id_rsa"],
    effect: "allow",
  }
  C.hooks.permission.evaluate[0](secret)
  assert.equal(secret.effect, "deny")
})

test("framePrompts:false / audit:false skip their hooks", () => {
  assert.equal(C.hooks.prompt.length, 0)
  assert.equal(C.hooks.tool["execute.before"], undefined)
})

test("context injection still works with every switch off", () => {
  const system = []
  C.hooks.context[0]({ agent: "build", system, messages: [] })
  assert.equal(system.length, 1)
})

/* ── summary ─────────────────────────────────────────────────────────────── */
rmSync(temp, { recursive: true, force: true })

const failed = results.filter(([ok]) => !ok)
for (const [ok, name] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
