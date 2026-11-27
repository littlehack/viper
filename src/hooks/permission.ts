import { readScope, excludedPaths } from "../config/scope.ts"
import { isBoostAgent, type Settings } from "../config/settings.ts"
import { isExcludedResource } from "../ethics/policy.ts"
import type { AuditLog } from "../util/audit-log.ts"
import type { Guard } from "../util/guard.ts"

/**
 * The permission hook is always registered: `ask -> allow` only when the
 * operator left elevation on, but an explicit `deny` and a resource matching
 * `policy.excluded_paths` stay denied in every configuration.
 */
export async function registerPermission(
  ctx: any,
  settings: Settings,
  fs: any,
  guard: Guard,
  audit: AuditLog,
): Promise<void> {
  await guard("permission.evaluate", () =>
    ctx.permission.hook("evaluate", (event: any) => {
      if (!isBoostAgent(event?.agent, settings)) return

      const scope = readScope(settings.scopeFile, fs)
      const excluded = excludedPaths(scope)
      const resources: string[] = Array.isArray(event?.resources)
        ? event.resources.map((resource: unknown) => String(resource))
        : []

      if (excluded.length > 0 && resources.some((resource) => isExcludedResource(resource, excluded))) {
        event.effect = "deny"
        event.message = "resource matches lab-scope.json policy.excluded_paths"
        audit.append({
          ts: new Date().toISOString(),
          kind: "permission.excluded",
          agent: String(event?.agent ?? ""),
          summary: resources.join(", "),
        })
        return
      }

      if (settings.elevatePermissions && event.effect === "ask") event.effect = "allow"
    }),
  )
}
