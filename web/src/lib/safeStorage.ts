/**
 * localStorage access that never throws. With storage blocked (private mode,
 * blocked site data, a sandboxed frame) even touching `window.localStorage`
 * can throw; these helpers swallow that and report null / false instead.
 */
export function safeGet(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

/** Returns false when the value could not be stored. */
export function safeSet(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true } catch { return false }
}

export function safeRemove(key: string): void {
  try { window.localStorage.removeItem(key) } catch { /* storage unavailable */ }
}
