/**
 * Display thresholds shared by every look, the classic page, the event log
 * and the end-of-pulse report, so a quantity is banded the same way
 * everywhere. Pure functions only: lib/pulseLog (unit-tested without React
 * or wasm) reads them directly, and pages/compositions/useDiagnostics
 * re-exports them for the looks.
 */
export type Tone = 'ok' | 'warn' | 'bad' | undefined

/* ─── Disruption hazard ──────────────────────────────────── */

/** Hazard bands in %/s (the engine's disruption_risk is a probability per second). */
export const HAZARD_WARN = 1
export const HAZARD_BAD = 10

/** Hazard as percent per second. */
export const hazardPct = (risk: number) => risk * 100

/** Amber from 1 %/s, red from 10 %/s. */
export function hazardTone(risk: number | undefined): Tone {
  if (risk === undefined || !isFinite(risk)) return undefined
  const v = hazardPct(risk)
  return v >= HAZARD_BAD ? 'bad' : v >= HAZARD_WARN ? 'warn' : undefined
}

/** Hazard in %/s with at most two decimals: "0.04", "12.5", "100". The unit is the caller's. */
export function fmtHazard(risk: number | undefined, dash = '—'): string {
  if (risk === undefined || !isFinite(risk)) return dash
  const v = Math.max(0, hazardPct(risk))
  return v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)
}

/* ─── β limit ────────────────────────────────────────────── */

/** No-wall limit used when l_i is missing or implausible. */
export const BETA_N_FALLBACK = 2.8
/** βN is "approaching" the limit above this fraction of it. */
export const BETA_WARN_FRAC = 0.9

const liOf = (s: { li?: number } | null | undefined) => {
  const li = s?.li
  return li !== undefined && isFinite(li) && li >= 0.3 ? li : null
}

/** No-wall β limit βN = 4·l_i; 2.8 when l_i is missing or below 0.3. */
export function betaLimit(s: { li?: number } | null | undefined): number {
  const li = liOf(s)
  return li === null ? BETA_N_FALLBACK : 4 * li
}

/** The limit as text: "4·l_i = 3.6", or "2.8" on the fallback. */
export function betaLimitText(s: { li?: number } | null | undefined): string {
  const lim = betaLimit(s).toFixed(1)
  return liOf(s) === null ? lim : `4·l_i = ${lim}`
}

/** Amber above 0.9 of the no-wall limit, red at or above it. */
export function betaTone(betaN: number | undefined, s: { li?: number } | null | undefined): Tone {
  if (betaN === undefined || !isFinite(betaN)) return undefined
  const lim = betaLimit(s)
  return betaN >= lim ? 'bad' : betaN > BETA_WARN_FRAC * lim ? 'warn' : undefined
}

/* ─── Divertor ───────────────────────────────────────────── */

export type Regime = 'ATTACHED' | 'PARTIAL' | 'DETACHED' | '—'

/** Attached divertor flagged above this peak q⊥ (MW/m²). */
export const Q_ATTACHED_WARN = 5

/** Partial and detached are operating points, not faults: only an attached divertor at high q⊥ is flagged. */
export function regimeTone(regime: Regime, qPeak: number): Tone {
  return regime === 'ATTACHED' && qPeak > Q_ATTACHED_WARN ? 'warn' : undefined
}

/** Tungsten surface: "HOT" from 1000 °C; "RECRYSTALLIZATION" once above 1200 °C for 0.5 s of simulation time. */
export const T_WARN = 1000
export const W_RECRYST_TEMP = 1200
export const W_RECRYST_HOLD = 0.5
