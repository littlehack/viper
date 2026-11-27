import { addTargets, primaryEngagement, readScope, writeScope } from "../config/scope.ts"
import { isBoostAgent, type Settings } from "../config/settings.ts"
import { buildBoost } from "../prompt/boost.ts"
import { buildTargetBlock, hasTargetBlock } from "../prompt/engage.ts"
import { frameText, rewriteMessages } from "../prompt/frame.ts"
import { injectBoost } from "../prompt/inject.ts"
import { matchesIntent } from "../prompt/intent.ts"
import { bindTarget, getBinding, sessionKey } from "../target/binding.ts"
import { classifyTarget, extractTargets, isTargetOnly, type Target } from "../target/detect.ts"
import { buildPlan } from "../target/plan.ts"
import type { AuditLog } from "../util/audit-log.ts"
import { guardCallback, type Guard } from "../util/guard.ts"

/**
 * Admission-stage target binding + prompt framing, then request-stage context
 * injection. `onContext` is wrapped by `guardCallback`: a bad event degrades one
 * request, it never aborts the session.
 *
 * Auto-engage is the whole point of 4.1: the operator writes a target (nothing
 * else), and by the time the model reads the turn it already carries the bound
 * asset, the objective, the ordered chain and the exact first command.
 */

function eventSession(event: any): string {
  return sessionKey(event?.sessionID ?? event?.sessionId ?? event?.session?.id)
}

/** Structured assets always engage; local documents only on explicit security intent. */
const EXTERNAL_KINDS = new Set([
  "ipv4",
  "ipv6",
  "cidr",
  "url",
  "domain",
  "org",
  "package",
  "hash",
  "repo",
  "android_app",
  "binary",
  "archive",
])

const DOC_PATH =
  /\.(md|markdown|txt|json|jsonl|ya?ml|toml|ini|cfg|conf|log|csv|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|php|sh|ps1|bat|cmd|sql)$/i

/** "继续 / 下一步 / go on" — same target, no new assignment. */
const CONTINUE_RE = /^(继续|接着|下一步|往下|go\s*on|continue|resume|next\b)/i

/** Words that make an org name a work item rather than a passing mention. */
const ORG_INTENT =
  /(公司|集团|企业|单位|机构|甲方|客户|目标|资产|测绘|渗透|红队|攻击面|备案|工商|官网|招聘|域名)/

function shouldEngage(text: string, target: Target): boolean {
  // An org name is only an engagement when the message is basically the name or
  // asks for work on it — "腾讯云 API 报错" is a dev question, not a target.
  if (target.kind === "org") return isTargetOnly(text, target) || ORG_INTENT.test(text)
  if (EXTERNAL_KINDS.has(target.kind)) return true
  // A path to a document/source file is only a target when the request itself is
  // security work; otherwise a plain "read this README" must not become an engagement.
  if (target.kind === "path" && DOC_PATH.test(target.value)) return matchesIntent(text)
  return isTargetOnly(text, target) || matchesIntent(text)
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ""
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message: any = messages[index]
    const role = message?.role ?? message?.info?.role
    if (role !== "user") continue
    const parts = Array.isArray(message.content)
      ? message.content
      : Array.isArray(message.parts)
        ? message.parts
        : []
    const text = parts
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n")
    if (text.trim()) return text
  }
  return ""
}

/** First non-wildcard target already recorded in the scope audit trail. */
function scopeTarget(scope: any): Target | null {
  const primary = primaryEngagement(scope)
  const targets = Array.isArray(primary.targets) ? primary.targets.map(String) : []
  const value = targets.find((entry) => entry.trim() && entry.trim() !== "*")
  return value ? classifyTarget(value) : null
}

/** Append the target to lab-scope.json. Never throws; returns "recorded". */
function recordScope(settings: Settings, fs: any, audit: AuditLog, target: Target): boolean {
  if (!settings.autoScope) return false
  try {
    if (!fs || typeof fs.readFileSync !== "function") return false
    const scope = readScope(settings.scopeFile, fs)
    const result = addTargets(scope, [target.value])
    if (result.added.length === 0) return true
    writeScope(settings.scopeFile, result.scope, fs)
    audit.append({
      ts: new Date().toISOString(),
      kind: "scope.auto",
      summary: `${target.kind}:${target.value}`,
    })
    return true
  } catch (error) {
    console.warn(`[viper.boost] auto scope record failed: ${String(error)}`)
    return false
  }
}

export async function registerSession(
  ctx: any,
  settings: Settings,
  fs: any,
  guard: Guard,
  audit: AuditLog,
): Promise<void> {
  if (settings.framePrompts || settings.autoEngage) {
    const onPrompt = guardCallback("session.prompt", (event: any) => {
      const text = event?.prompt?.text
      if (typeof text !== "string" || !text) return

      // 1. Research framing (unchanged, idempotent).
      let next = String(frameText(text) ?? text)

      // 2. Target binding: detect, bind, audit, attach the chain.
      if (settings.autoEngage && !hasTargetBlock(next)) {
        const target = extractTargets(text, { max: 1 })[0]
        if (target && shouldEngage(text, target)) {
          const only = isTargetOnly(text, target)
          const key = eventSession(event)
          const prior = getBinding(key)
          const same =
            prior !== null && prior.target.value.toLowerCase() === target.value.toLowerCase()
          // Only a bare repeat or an explicit "继续" resumes; a new instruction on the
          // same asset is a new turn with its own first command.
          const source = same && (only || CONTINUE_RE.test(text.trim()))
            ? "continue"
            : only
              ? "target-only"
              : "turn"
          bindTarget(key, target, source)
          const recorded = recordScope(settings, fs, audit, target)
          const plan = buildPlan(target)
          next = `${next}\n\n${buildTargetBlock(plan, { source, autoScope: recorded })}`
        }
      }

      event.prompt.text = next
    })
    await guard("session.prompt", () => ctx.session.hook("prompt", onPrompt))
  }

  const onContext = guardCallback("session.context", (event: any) => {
    if (!isBoostAgent(event?.agent, settings)) return
    const scope = readScope(settings.scopeFile, fs)
    const key = eventSession(event)

    // Binding priority: session -> latest user turn -> scope record.
    let binding = settings.autoEngage ? getBinding(key) : null
    let source = binding?.source ?? "turn"

    if (!binding && settings.autoEngage) {
      const turnText = lastUserText(event.messages)
      const fromTurn = extractTargets(turnText, { max: 1 })[0]
      const gated = fromTurn && shouldEngage(turnText, fromTurn) ? fromTurn : null
      const target = gated ?? scopeTarget(scope)
      if (target) {
        binding = bindTarget(key, target, gated ? "turn" : "scope")
        source = binding.source
        if (gated) recordScope(settings, fs, audit, target)
      }
    }

    const plan = binding ? buildPlan(binding.target) : null
    injectBoost(
      event.system,
      buildBoost(scope, String(event?.agent ?? ""), settings, plan, source),
    )
    if (event.messages) rewriteMessages(event.messages)
  })

  await guard("session.context", () => ctx.session.hook("context", onContext))
  // Compaction and transient generation requests share the session hook
  // identity; keep the lab context so summaries cannot wash it out.
  await guard("session.compaction", () => ctx.session.hook("compaction", onContext))
  await guard("session.generate", () => ctx.session.hook("generate", onContext))
}
