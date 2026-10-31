/**
 * The displayed pulse time, kept outside React's render path so the playhead,
 * the hairline and the strips' cursor can be moved every painted frame.
 */
export interface DisplayClock {
  get(): number
  set(t: number): void
  subscribe(fn: (t: number) => void): () => void
}

export function createDisplayClock(initial: number): DisplayClock {
  let value = initial
  const subs = new Set<(t: number) => void>()
  return {
    get: () => value,
    set(t) { if (t !== value) { value = t; subs.forEach((f) => f(t)) } },
    subscribe(f) { subs.add(f); return () => { subs.delete(f) } },
  }
}
