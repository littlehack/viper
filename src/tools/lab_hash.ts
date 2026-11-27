import type { ToolDeps } from "./deps.ts"

const ALGORITHMS = ["sha256", "sha1", "md5"] as const

/** Streams the file so multi-GB evidence images do not have to fit in memory. */
async function hashFile(fs: any, file: string, algorithm: string): Promise<string> {
  const mod: any = await import("node:crypto")
  const createHash = mod?.createHash ?? mod?.default?.createHash
  if (typeof createHash !== "function") throw new Error("node:crypto unavailable")

  const hash = createHash(algorithm)
  if (fs && typeof fs.createReadStream === "function") {
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(file)
      stream.on("data", (chunk: any) => hash.update(chunk))
      stream.on("error", reject)
      stream.on("end", () => resolve())
    })
    return hash.digest("hex")
  }

  return hash.update(fs.readFileSync(file)).digest("hex")
}

/**
 * Evidence hashing for chain of custody: hash artifacts before and after work
 * so the report can prove nothing changed.
 */
export function labHashTool(deps: ToolDeps) {
  return {
    name: "lab_hash",
    description:
      "Hash evidence files (default sha256) with size, for chain-of-custody records and report appendices.",
    input: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, minItems: 1 },
        algorithm: { type: "string", enum: [...ALGORITHMS] },
      },
      required: ["paths"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        algorithm: { type: "string" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              size: { type: "number" },
              hash: { type: "string" },
              error: { type: "string" },
            },
            required: ["path", "size"],
            additionalProperties: false,
          },
        },
      },
      required: ["algorithm", "files"],
      additionalProperties: false,
    },

    async execute(input: any) {
      const algorithm = String(input?.algorithm ?? "sha256")
      if (!ALGORITHMS.includes(algorithm as (typeof ALGORITHMS)[number])) {
        throw new Error(`unsupported algorithm: ${algorithm}`)
      }
      const paths: string[] = Array.isArray(input?.paths) ? input.paths.map((path: unknown) => String(path)) : []
      if (paths.length === 0) throw new Error("paths are required")
      if (!deps.fs) throw new Error("node:fs unavailable")

      const files: Array<{ path: string; size: number; hash?: string; error?: string }> = []
      for (const path of paths) {
        try {
          const stat = deps.fs.statSync(path)
          const digest = await hashFile(deps.fs, path, algorithm)
          files.push({ path, size: Number(stat.size), hash: digest })
        } catch (error: any) {
          files.push({ path, size: 0, error: String(error?.message ?? error) })
        }
      }

      return {
        output: { algorithm, files },
        content: files
          .map((file) =>
            file.error
              ? `${file.path}\tERROR\t${file.error}`
              : `${file.hash}  ${file.path}  (${file.size} bytes, ${algorithm})`,
          )
          .join("\n"),
      }
    },
  }
}
