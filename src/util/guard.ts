/**
 * Failure isolation for hook registration and hook execution.
 *
 * `createGuard` protects setup: a missing event on an older OpenCode build only
 * skips that one registration.
 * `guardCallback` protects execution: a malformed event can never abort a model
 * request or a tool call for the rest of the session.
 */

export type Guard = (label: string, register: () => Promise<unknown> | unknown) => Promise<boolean>

export function createGuard(registered: string[]): Guard {
  return async (label, register) => {
    try {
      await register()
      if (!registered.includes(label)) registered.push(label)
      return true
    } catch (error) {
      console.warn(`[viper.boost] skipped ${label}: ${String(error)}`)
      return false
    }
  }
}

export function guardCallback<T>(label: string, fn: (event: T) => void): (event: T) => void {
  return (event: T) => {
    try {
      fn(event)
    } catch (error) {
      console.warn(`[viper.boost] hook failed ${label}: ${String(error)}`)
    }
  }
}
