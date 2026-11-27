/**
 * Per-session target binding.
 *
 * The operator names a target once; every later turn in that session keeps
 * working on it, and compaction cannot lose it because the binding lives in
 * the plugin, not in the transcript. Keyed by session id when the host exposes
 * one, `*` (the current-session fallback) otherwise.
 */

import type { Target } from "./detect.ts"

export interface Binding {
  session: string
  target: Target
  at: string
  /** `turn` (operator message), `scope` (lab-scope.json), `tool` (lab_target). */
  source: string
}

const MAX_BINDINGS = 64
const store = new Map<string, Binding>()

export function sessionKey(raw: unknown): string {
  const value = String(raw ?? "").trim()
  return value || "*"
}

export function bindTarget(session: unknown, target: Target, source: string): Binding {
  const key = sessionKey(session)
  const binding: Binding = {
    session: key,
    target,
    at: new Date().toISOString(),
    source,
  }
  store.delete(key)
  store.set(key, binding)
  while (store.size > MAX_BINDINGS) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  return binding
}

export function getBinding(session: unknown): Binding | null {
  return store.get(sessionKey(session)) ?? store.get("*") ?? null
}

export function clearBinding(session: unknown): void {
  store.delete(sessionKey(session))
}

export function listBindings(): Binding[] {
  return [...store.values()].sort((left, right) => right.at.localeCompare(left.at))
}
