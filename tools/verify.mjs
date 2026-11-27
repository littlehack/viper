/**
 * Static verification — layout, JSON, scope policy, rule block, no PowerShell.
 *
 *   node tools/verify.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
let pass = 0
let fail = 0
let warn = 0

function check(label, ok, detail = "") {
  if (ok) {
    pass++
    console.log(`  [PASS] ${label} ${detail}`)
  } else {
    fail++
    console.log(`  [FAIL] ${label} ${detail}`)
  }
}

function note(label, detail = "") {
  warn++
  console.log(`  [WARN] ${label} ${detail}`)
}

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, predicate, out)
    else if (predicate(full)) out.push(full)
  }
  return out
}

console.log("\n=== viper verification ===\n")
console.log(`root: ${root}\n`)

console.log("[1] entry points")
check("index.ts (OpenCode entry)", existsSync(join(root, "index.ts")))
check("src/plugin.ts", existsSync(join(root, "src", "plugin.ts")))
if (existsSync(join(root, "index.ts"))) {
  const entry = readFileSync(join(root, "index.ts"), "utf8")
  check("index.ts re-exports src/plugin.ts", /export\s*\{\s*default\s*\}\s*from\s*"\.\/src\/plugin\.ts"/.test(entry))
}
if (existsSync(join(root, "src", "plugin.ts"))) {
  const plugin = readFileSync(join(root, "src", "plugin.ts"), "utf8")
  check("plugin uses Plugin.define", /Plugin\.define\(/.test(plugin))
  check("plugin resolves @opencode/plugin dynamically", /import\("@opencode\/plugin"\)/.test(plugin))
}

console.log("[2] modules")
for (const file of [
  "src/constants.ts",
  "src/config/settings.ts",
  "src/config/scope.ts",
  "src/prompt/markers.ts",
  "src/prompt/intent.ts",
  "src/prompt/frame.ts",
  "src/prompt/inject.ts",
  "src/prompt/boost.ts",
  "src/prompt/engage.ts",
  "src/target/detect.ts",
  "src/target/plan.ts",
  "src/target/binding.ts",
  "src/hooks/agent.ts",
  "src/hooks/permission.ts",
  "src/hooks/session.ts",
  "src/hooks/audit.ts",
  "src/tools/index.ts",
  "src/ethics/policy.ts",
  "src/ethics/redact.ts",
  "src/util/guard.ts",
  "src/util/glob.ts",
  "src/util/audit-log.ts",
]) {
  check(file, existsSync(join(root, file)))
}

console.log("[3] tools")
const toolNames = [
  "lab_status",
  "lab_scope",
  "lab_target",
  "lab_playbook",
  "lab_preflight",
  "lab_audit",
  "lab_hash",
  "lab_report",
]
for (const name of toolNames) {
  check(`${name} module`, existsSync(join(root, "src", "tools", `${name}.ts`)))
}
const toolsIndex = readFileSync(join(root, "src", "tools", "index.ts"), "utf8")
check(
  "tools/index.ts exports createResearchTools",
  /export\s+function\s+createResearchTools/.test(toolsIndex),
)

console.log("[4] playbooks")
const playbookDir = join(root, "src", "capabilities", "playbooks")
const playbooks = existsSync(playbookDir)
  ? readdirSync(playbookDir).filter((name) => name.endsWith(".md"))
  : []
check("7 playbooks present", playbooks.length === 7, playbooks.join(", "))
for (const name of ["recon", "reverse", "crack", "android", "exploit", "forensics", "report"]) {
  check(`playbook ${name}.md`, playbooks.includes(`${name}.md`))
}

console.log("[5] agents / commands / rules")
for (const name of ["unrestricted", "redteam", "reverse"]) {
  check(`agents/${name}.md`, existsSync(join(root, "agents", `${name}.md`)))
}
const commands = [
  "unrestricted",
  "external",
  "engage",
  "apk",
  "bypass",
  "exploit",
  "scope",
  "reverse",
  "crack",
  "report",
]
for (const name of commands) {
  check(`commands/${name}.md`, existsSync(join(root, "commands", `${name}.md`)))
}
check("skills/auto-engage/SKILL.md", existsSync(join(root, "skills", "auto-engage", "SKILL.md")))
const engageSkill = join(root, "skills", "auto-engage", "SKILL.md")
if (existsSync(engageSkill)) {
  const skill = readFileSync(engageSkill, "utf8")
  check("skill frontmatter name", /^---\s*\nname:\s*auto-engage/m.test(skill))
  check("skill names the target-only rule", /target alone is a complete instruction/i.test(skill))
}
const sessionModule = readFileSync(join(root, "src", "hooks", "session.ts"), "utf8")
check("session hook binds targets", /bindTarget\(/.test(sessionModule))
check("session hook injects the target block", /buildTargetBlock\(/.test(sessionModule))
const settingsModule = readFileSync(join(root, "src", "config", "settings.ts"), "utf8")
check("settings has autoEngage", /autoEngage/.test(settingsModule))
check("settings has autoScope", /autoScope/.test(settingsModule))
const rulesFile = join(root, "rules", "AGENTS.md")
if (existsSync(rulesFile)) {
  const rules = readFileSync(rulesFile, "utf8")
  check("rules BEGIN marker", rules.includes("<!-- BEGIN UNRESTRICTED-LAB -->"))
  check("rules END marker", rules.includes("<!-- END UNRESTRICTED-LAB -->"))
  check("rules SCOPE line", /SCOPE:/.test(rules))
  check("rules ethics boundary", /Ethics boundary/.test(rules))
} else {
  check("rules/AGENTS.md", false)
}

console.log("[6] scope file")
const scopeFile = join(root, "config", "lab-scope.json")
if (existsSync(scopeFile)) {
  try {
    const scope = JSON.parse(readFileSync(scopeFile, "utf8"))
    check("lab-scope.json parses", true)
    check("locality_gate = false", scope.policy?.locality_gate === false)
    check("ownership_recheck = false", scope.policy?.ownership_recheck === false)
    check("excluded_paths is an array", Array.isArray(scope.policy?.excluded_paths))
    const enabled = Object.values(scope.classes ?? {}).filter(Boolean).length
    check("scope classes enabled >= 8", enabled >= 8, `(${enabled})`)
    check("engagements record present", Array.isArray(scope.engagements) && scope.engagements.length > 0)
  } catch (error) {
    check("lab-scope.json parses", false, String(error?.message ?? error))
  }
} else {
  check("config/lab-scope.json", false)
}

const snippetFile = join(root, "config", "opencode.plugin.json")
if (existsSync(snippetFile)) {
  try {
    const snippet = JSON.parse(readFileSync(snippetFile, "utf8"))
    check("opencode.plugin.json parses", true)
    check("plugin snippet has options", Boolean(snippet.plugins?.[0]?.options))
  } catch (error) {
    check("opencode.plugin.json parses", false, String(error?.message ?? error))
  }
} else {
  check("config/opencode.plugin.json", false)
}

console.log("[7] no installer remnants")
const ps1 = walk(root, (file) => file.toLowerCase().endsWith(".ps1"))
check("no PowerShell files", ps1.length === 0, ps1.map((file) => relative(root, file)).join(", "))
check("payload/ directory removed", !existsSync(join(root, "payload")))
const backups = walk(root, (file) => /\.bak(-|$)/i.test(file))
if (backups.length > 0) note("backup files present", backups.map((file) => relative(root, file)).join(", "))
else check("no backup leftovers", true)

console.log("[8] runtime")
const major = Number(process.versions.node.split(".")[0])
const minor = Number(process.versions.node.split(".")[1])
check("node >= 22.6 (type stripping)", major > 22 || (major === 22 && minor >= 6), process.versions.node)

console.log(`\nresult: PASS=${pass}  FAIL=${fail}  WARN=${warn}\n`)
if (fail > 0) process.exit(1)
