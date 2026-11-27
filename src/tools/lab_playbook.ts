import { loadPlaybook, PLAYBOOK_DOMAINS } from "../capabilities/playbooks.ts"

/**
 * Returns the methodology for one research domain so the executor does not have
 * to re-derive a checklist (and so the checklist is reviewable in the repo).
 */
export function labPlaybookTool() {
  return {
    name: "lab_playbook",
    description:
      "Return the lab methodology playbook for a research domain: recon, reverse, crack, android, exploit, forensics, report.",
    input: {
      type: "object",
      properties: {
        domain: { type: "string", enum: [...PLAYBOOK_DOMAINS] },
      },
      required: ["domain"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        domain: { type: "string" },
        title: { type: "string" },
        source: { type: "string" },
        content: { type: "string" },
        available: { type: "array", items: { type: "string" } },
      },
      required: ["domain", "title", "source", "content", "available"],
      additionalProperties: false,
    },

    async execute(input: any) {
      const domain = String(input?.domain ?? "")
      const playbook = await loadPlaybook(domain)
      if (!playbook) throw new Error(`unknown domain: ${domain}`)

      return {
        output: {
          domain: playbook.domain,
          title: playbook.title,
          source: playbook.source,
          content: playbook.content,
          available: [...PLAYBOOK_DOMAINS],
        },
        content: `# ${playbook.title}\n\n${playbook.content}`,
      }
    },
  }
}
