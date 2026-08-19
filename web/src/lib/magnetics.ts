/**
 * Regime → synthetic-magnetics mapping, shared by the MagneticsPanel and its
 * tests. See MagneticsPanel.tsx for the full physics provenance notes.
 */
import type { TracePoint } from './types'

/* ─── Display constants ─────────────────────────────────── */

export const F_MAX_KHZ = 200 // spectrogram vertical range
export const SPEC_COLS = 240 // spectrogram columns across the window
export const SPEC_ROWS = 96 // frequency bins
export const WINDOW_S = 12 // spectrogram window (s of sim time)
export const TRACE_SAMPLES = 360 // Mirnov trace samples across its window

export type Regime = 'none' | 'lmode' | 'elmy' | 'qce' | 'eda'

export interface ModeState {
  regime: Regime
  fQcm: number // kHz
  bandwidth: number // kHz
  amplitude: number // 0..1, coherent mode amplitude
  broadband: number // 0..1, turbulence floor
}

/**
 * The subset of plasma state the synthesis needs. Both the live `Snapshot`
 * and the lightweight `TracePoint` history entries satisfy it, so the same
 * derivation drives the live readout and the history-rendered spectrogram.
 */
export interface MagneticsInputs {
  ip: number
  te0: number
  te_ped: number
  beta_n: number
  f_greenwald: number
  in_hmode: boolean
  elm_suppressed: boolean
  p_loss: number
  p_rad: number
}

/**
 * Derive the edge-fluctuation state from the simulated plasma.
 *
 * The QCM frequency is not held fixed: AUG reports f_QCM·R₀/c_s ∝ 1/β_pol², so
 * it is scaled here by the sound speed (√Te_ped) and inversely by a poloidal-
 * beta proxy. The absolute anchor is ~95 kHz, C-Mod-like, for SPARC.
 */
export function deriveMode(s: MagneticsInputs | null): ModeState {
  if (!s || s.ip < 0.1) {
    return { regime: 'none', fQcm: 0, bandwidth: 0, amplitude: 0, broadband: 0 }
  }

  // Sound-speed scaling: c_s ∝ √(Te_ped). Pedestal temperature falls back to a
  // fraction of the core value when there is no pedestal (L-mode).
  const tePed = s.te_ped > 0.05 ? s.te_ped : s.te0 * 0.15
  const csScale = Math.sqrt(Math.max(tePed, 0.05) / 4.0) // normalised to a 4 keV pedestal

  // Poloidal beta proxy from β_N — the published scaling is 1/β_pol², softened
  // here to 1/β_pol so the band drifts visibly without sliding off the axis.
  const betaProxy = Math.max(s.beta_n, 0.3) / 1.0
  const fQcm = 95 * csScale / betaProxy

  // Turbulence floor rises with heating power crossing the edge.
  const broadband = Math.min(1, Math.max(0.08, (s.p_loss - s.p_rad) / 40))

  if (!s.in_hmode) {
    // L-mode: broadband edge turbulence only. No coherent pedestal mode,
    // because there is no pedestal.
    return { regime: 'lmode', fQcm: 0, bandwidth: 0, amplitude: 0, broadband: broadband * 1.3 }
  }

  if (s.elm_suppressed) {
    // ELM-free H-mode carried by the QCM. Bandwidth is the discriminator:
    // a narrow, coherent band is EDA; a broader one is QCE. Higher edge
    // density (the thing that drives QCE) broadens it. The 0.44 split puts
    // the default SPARC scenario (f_GW ≈ 0.46) on the QCE side — consistent
    // with the scenario's name — while genuinely lower-density operation
    // (user turns the fuelling down) reads as EDA.
    const wide = s.f_greenwald > 0.44
    return {
      regime: wide ? 'qce' : 'eda',
      fQcm,
      bandwidth: wide ? 6 + 18 * Math.min(1, s.f_greenwald) : 4,
      amplitude: Math.min(1, 0.45 + 0.55 * Math.min(1, s.te_ped / 4)),
      broadband,
    }
  }

  // ELMy H-mode: modest inter-ELM turbulence, broadband burst at each crash.
  return { regime: 'elmy', fQcm: 0, bandwidth: 0, amplitude: 0, broadband: broadband * 0.6 }
}

/** Colormap for spectrogram power (0..1) — dark navy → cyan → amber → white. */
export function specColor(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v))
  if (t < 0.35) {
    const u = t / 0.35
    return [8 + 10 * u, 12 + 40 * u, 28 + 70 * u]
  }
  if (t < 0.62) {
    const u = (t - 0.35) / 0.27
    return [18 + 30 * u, 52 + 150 * u, 98 + 110 * u]
  }
  if (t < 0.85) {
    const u = (t - 0.62) / 0.23
    return [48 + 200 * u, 202 + 20 * u, 208 - 150 * u]
  }
  const u = (t - 0.85) / 0.15
  return [248, 222 + 33 * u, 58 + 197 * u]
}

/**
 * Deterministic 2-integer hash → [0, 1). Seeded from quantised sim time, so
 * the noise field is a fixed function of the discharge — scrubbing backwards
 * shows the *same* speckle, and pausing freezes it.
 */
export function hash2(a: number, b: number): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Last history index with t <= target (binary search), or -1. */
export function historyIndexAt(history: TracePoint[], target: number): number {
  let lo = 0
  let hi = history.length - 1
  if (hi < 0 || history[0].t > target) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (history[mid].t <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

