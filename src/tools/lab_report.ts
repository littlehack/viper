import { excludedPaths, primaryEngagement, readScope, scopeClasses } from "../config/scope.ts"
import { ETHICS_RULES, HARD_STOPS } from "../ethics/policy.ts"
import { API_VERSION, PLUGIN_ID, PLUGIN_VERSION } from "../constants.ts"
import type { ToolDeps } from "./deps.ts"

function safeCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

/**
 * Builds an engagement report skeleton from the scope record and the audit
 * trail. Findings are intentionally left empty: the operator/executor fills
 * them with verified content.
 */
export function labReportTool(deps: ToolDeps) {
  return {
    name: "lab_report",
    description:
      "Generate a markdown engagement report skeleton from lab-scope.json and the audit trail. Optionally write it to a path.",
    input: {
      type: "object",
      properties: {
        title: { type: "string" },
        path: { type: "string" },
      },
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        path: { type: "string" },
        markdown: { type: "string" },
      },
      required: ["path", "markdown"],
      additionalProperties: false,
    },

    async execute(input: any) {
      const scope = readScope(deps.settings.scopeFile, deps.fs)
      const primary = primaryEngagement(scope)
      const targets: string[] = Array.isArray(primary.targets) ? primary.targets.map(String) : []
      const classes = scopeClasses(scope)
      const excluded = excludedPaths(scope)
      const entries = deps.audit.tail(200)
      const generated = new Date().toISOString()

      const lines: string[] = [
        `# ${String(input?.title ?? "Security research engagement")}`,
        "",
        `- generated: ${generated}`,
        `- plugin: ${PLUGIN_ID} ${PLUGIN_VERSION} (${API_VERSION})`,
        `- scope file: ${deps.settings.scopeFile}`,
        "",
        "## 1. Engagement record",
        "",
        `- id: ${safeCell(primary.id ?? "default")}`,
        `- authorization: ${safeCell(primary.authorization ?? "operator-declared")}`,
        `- mode: ${safeCell(scope.mode ?? "open-declared")}`,
        `- locality_gate: ${Boolean(scope.policy?.locality_gate)}`,
        `- ownership_recheck: ${Boolean(scope.policy?.ownership_recheck)}`,
        `- classes: ${classes.join(", ")}`,
        "",
        "### Targets",
        "",
        ...(targets.length ? targets.map((target) => `- ${target}`) : ["- (none declared)"]),
        "",
        "## 2. Ethics boundary",
        "",
        ...HARD_STOPS.map((stop) => `- HARD STOP: ${stop}`),
        "",
        ...ETHICS_RULES.map((rule) => `- ${rule}`),
        "",
        `- excluded paths: ${excluded.length ? excluded.join(", ") : "none"}`,
        "",
        "## 3. Activity timeline",
        "",
        "| time (UTC) | kind | tool | agent | status | detail |",
        "|---|---|---|---|---|---|",
        ...(entries.length
          ? entries.map(
              (entry) =>
                `| ${safeCell(entry.ts)} | ${safeCell(entry.kind)} | ${safeCell(entry.tool)} | ${safeCell(entry.agent)} | ${safeCell(entry.status)} | ${safeCell(entry.summary)} |`,
            )
          : ["| - | - | - | - | - | no audit entries |"]),
        "",
        "## 4. Findings",
        "",
        "<!-- One section per verified finding: severity (CVSS vector), asset, evidence, impact, reproduction, remediation. -->",
        "",
        "## 5. Reproduction appendix",
        "",
        "- Commands are taken from the activity timeline above.",
        "- Hash every artifact with `lab_hash` and paste the digest next to its path.",
        "- Captured values are recorded verbatim; set `policy.redact_reports: true` when this report leaves the engagement.",
        "",
        "## 6. Remediation",
        "",
        "<!-- Ordered by severity; each item names who changes what. -->",
        "",
      ]

      const markdown = lines.join("\n")
      let written = ""
      const target = input?.path ? String(input.path) : ""
      if (target) {
        if (!deps.fs) throw new Error("node:fs unavailable, cannot write the report")
        deps.fs.writeFileSync(target, markdown, "utf8")
        written = target
        deps.audit.append({
          ts: new Date().toISOString(),
          kind: "report.write",
          summary: target,
        })
      }

      return { output: { path: written, markdown }, content: markdown }
    },
  }
}
