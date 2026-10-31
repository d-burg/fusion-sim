import { safeRemove, safeSet } from './safeStorage'

/** localStorage key: 'done' once the visitor has been through the first-run card. */
export const FIRSTRUN_KEY = 'tok-sym-firstrun'
/** Window event that shows the first-run card again (fired from the settings menu, heard by ControlRoom). */
export const FIRSTRUN_EVENT = 'tok-sym:firstrun'

export function firstRunPending(): boolean {
  // Storage blocked: report "not pending" so the card does not reappear on every page.
  try { return window.localStorage.getItem(FIRSTRUN_KEY) !== 'done' } catch { return false }
}

export function markFirstRunDone() {
  safeSet(FIRSTRUN_KEY, 'done')
}

/** Clear the key and ask the control room to show the first-run card again. */
export function reopenFirstRun() {
  safeRemove(FIRSTRUN_KEY)
  window.dispatchEvent(new CustomEvent(FIRSTRUN_EVENT))
}
