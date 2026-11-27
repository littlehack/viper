import type { Guard } from "../util/guard.ts"
import type { ToolDeps } from "./deps.ts"
import { labStatusTool } from "./lab_status.ts"
import { labScopeTool } from "./lab_scope.ts"
import { labTargetTool } from "./lab_target.ts"
import { labPlaybookTool } from "./lab_playbook.ts"
import { labPreflightTool } from "./lab_preflight.ts"
import { labAuditTool } from "./lab_audit.ts"
import { labHashTool } from "./lab_hash.ts"
import { labReportTool } from "./lab_report.ts"

export function createResearchTools(deps: ToolDeps) {
  return [
    labStatusTool(deps),
    labScopeTool(deps),
    labTargetTool(deps),
    labPlaybookTool(),
    labPreflightTool(deps),
    labAuditTool(deps),
    labHashTool(deps),
    labReportTool(deps),
  ]
}

export async function registerTools(ctx: any, deps: ToolDeps, guard: Guard): Promise<void> {
  const tools = createResearchTools(deps)
  deps.toolNames = tools.map((tool: any) => String(tool.name))

  await guard("tool.transform", () =>
    ctx.tool.transform((editor: any) => {
      for (const tool of tools) editor.add(tool)
    }),
  )
}
