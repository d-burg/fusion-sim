/** localStorage key: 'done' once the visitor has been through the first-run card. */
export const FIRSTRUN_KEY = 'tok-sym-firstrun'
/** Window event that shows the first-run card again (fired from the settings menu, heard by ControlRoom). */
export const FIRSTRUN_EVENT = 'tok-sym:firstrun'

export function firstRunPending(): boolean {
  try { return localStorage.getItem(FIRSTRUN_KEY) !== 'done' } catch { return false }
}

export function markFirstRunDone() {
  try { localStorage.setItem(FIRSTRUN_KEY, 'done') } catch { /* private mode: the card simply shows again */ }
}

/** Clear the key and ask the control room to show the first-run card again. */
export function reopenFirstRun() {
  try { localStorage.removeItem(FIRSTRUN_KEY) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(FIRSTRUN_EVENT))
}
