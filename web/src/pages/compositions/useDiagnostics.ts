import { useMemo, useState } from 'react'
import type { Snapshot, TracePoint } from '../../lib/types'
import { getDevice } from '../../lib/wasm'
import {
  computeDivertorHeatFlux, computeFusion, DivertorThermalModel, neutronSignalLevel,
  type DivertorState, type FusionState,
} from '../../lib/fusionPhysics'
import { regimeTone as regimeToneOf, T_WARN, W_RECRYST_HOLD, W_RECRYST_TEMP, type Regime, type Tone } from '../../lib/limits'

// The shared thresholds (hazard 1 / 10 %/s, the no-wall β limit 4·l_i, the
// divertor and tungsten words) are defined once in lib/limits, which the
// event log and the report also read; every look takes them from here.
export {
  HAZARD_WARN, HAZARD_BAD, hazardPct, hazardTone, fmtHazard,
  BETA_N_FALLBACK, BETA_WARN_FRAC, betaLimit, betaLimitText, betaTone,
  Q_ATTACHED_WARN, regimeTone, T_WARN, W_RECRYST_TEMP, W_RECRYST_HOLD,
  type Regime,
} from '../../lib/limits'

/** Peak q⊥ above which the divertor bar turns red (MW/m²). */
export const W_RECRYST_QFLUX = 10
/** Full scale of the divertor heat-flux bar (MW/m²) and of the surface-temperature bar (°C). */
export const Q_SCALE = 25
export const T_SCALE = 2000

export type DiagTone = Tone
export type TWord = 'NOMINAL' | 'HOT' | 'RECRYSTALLIZATION'
export type NWord = 'ACTIVE' | 'BACKGROUND'

/** Whether an ELM occurred in the last `hold` seconds of history before `time`: the flag itself lasts a few ms. */
export function elmRecent(history: TracePoint[], time: number, hold = 0.3): boolean {
  for (let i = history.length - 1; i >= 0 && history[i].t > time - hold; i--) if (history[i].elm_active && history[i].t <= time + 1e-9) return true
  return false
}

export interface Diagnostics {
  valid: boolean
  /** Divertor peak perpendicular heat flux (MW/m²), its bar fill (0–1) and state. */
  q: number
  qFill: number
  qTone: DiagTone
  lambdaQ: number
  fDet: number
  regime: Regime
  regimeTone: DiagTone
  /** Tungsten wall: the surface-temperature bar is shown only when true. */
  isW: boolean
  tSurf: number
  tFill: number
  tTone: DiagTone
  /** HOT from 1000 °C; RECRYSTALLIZATION once above 1200 °C for 0.5 s (tungsten only). */
  tWord: TWord
  /** Neutron rate (n/s), the log signal level (0–1), and whether it counts as active. */
  rate: number
  nFill: number
  active: boolean
  nWord: NWord
  pFus: number
  /** Q = P_fus / P_ext, smoothed; null when P_ext < 0.5 MW (shown as a dash). */
  qPlasma: number | null
}

/** "1.1E13" — plain figures, no superscripts (illegible at 8 px). */
export function sci(v: number): string {
  if (v <= 0) return '—'
  let e = Math.floor(Math.log10(v))
  // carry a mantissa that rounds to 10: 9.96e12 is 1.0E13, never 10.0E12 (constant length)
  let m = Math.round((v / Math.pow(10, e)) * 10) / 10
  if (m >= 10) { m /= 10; e += 1 }
  return `${m.toFixed(1)}E${e}`
}

/** "420 KW" / "12.3 MW" / "—". Unit case is the caller's. */
export function fmtPfus(p: number): string {
  return p > 0.001 ? (p < 1 ? `${(p * 1000).toFixed(0)} kW` : `${p.toFixed(1)} MW`) : '—'
}

type Device = NonNullable<ReturnType<typeof getDevice>>

/** Device for the physics helpers, with the snapshot's fuel mass carried over. */
function useDevice(snapshot: Snapshot | null) {
  const id = snapshot?.device_id, mass = snapshot?.mass_number
  return useMemo(() => {
    if (!id) return null
    const base = getDevice(id)
    if (!base) return null
    return mass != null && mass !== base.mass_number ? { ...base, mass_number: mass } : base
  }, [id, mass])
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** EMA so the digits do not jitter with ELMs (α ≈ 0.04 per frame, ~400 ms). */
class Smooth {
  v = 0
  private floor: number
  constructor(floor: number) { this.floor = floor }
  step(raw: number): number {
    if (raw === 0 && this.v < this.floor) this.v = 0
    else this.v += 0.04 * (raw - this.v)
    return this.v
  }
}

/**
 * The per-page state the diagnostics carry across frames: the divertor
 * thermal model (rebuilt with the device) and the EMA filters. Held in a
 * plain object so the per-frame update stays out of React refs.
 */
class DiagnosticsTracker {
  private model: DivertorThermalModel | null = null
  private deviceId = ''
  private prevT = 0
  /** Sim time the surface went above the recrystallization temperature, while it stays there. */
  private hotSince: number | null = null
  private rate = new Smooth(1e5)
  private qPlasma = new Smooth(1e-8)
  private pFus = new Smooth(1e-8)

  update(snapshot: Snapshot | null, device: Device | null) {
    const fusion: FusionState | null = snapshot && device ? computeFusion(snapshot, device) : null
    let divertor: DivertorState | null = null
    if (snapshot && device) {
      divertor = computeDivertorHeatFlux(snapshot, device)
      if (!this.model || this.deviceId !== device.id) {
        this.model = new DivertorThermalModel(device.id); this.deviceId = device.id; this.prevT = 0
      }
      const model = this.model
      const t = snapshot.time ?? 0
      const dt = t > this.prevT ? t - this.prevT : 0
      this.prevT = t
      if (snapshot.ip < 0.01 || dt < 0 || dt > 2.0) model.reset()
      divertor.t_surface = dt > 0 && dt < 2.0 ? model.step(divertor.q_interELM, divertor.elm_q, divertor.tau_elm, dt) : model.t_surface
      // the hold restarts whenever the surface drops below the threshold or the clock goes back (scrub, new pulse)
      if (divertor.t_surface > W_RECRYST_TEMP) { if (this.hotSince === null || t < this.hotSince) this.hotSince = t }
      else this.hotSince = null
    } else {
      this.hotSince = null
    }
    const now = snapshot?.time ?? 0
    const qRaw = fusion?.q_plasma ?? null
    return {
      divertor,
      recryst: this.hotSince !== null && now - this.hotSince >= W_RECRYST_HOLD,
      rate: this.rate.step(fusion?.neutron_rate ?? 0),
      qPlasma: qRaw === null ? null : this.qPlasma.step(qRaw),
      pFus: this.pFus.step(fusion?.p_fus ?? 0),
    }
  }
}

/**
 * Divertor and fusion diagnostics shared by every look, so the numbers agree
 * everywhere: device lookup, the stateful divertor thermal model, EMA
 * smoothing of the fusion figures, and the state thresholds.
 */
export function useDiagnostics(snapshot: Snapshot | null, valid: boolean): Diagnostics {
  const device = useDevice(snapshot)
  const [tracker] = useState(() => new DiagnosticsTracker())
  const { divertor, recryst: recrystHeld, rate, qPlasma, pFus } = useMemo(() => tracker.update(snapshot, device), [tracker, snapshot, device])

  const q = divertor?.q_peak ?? 0
  const lambdaQ = divertor?.lambda_q ?? 0
  const fDet = divertor?.f_detach ?? 0
  const tSurf = divertor?.t_surface ?? 0
  const isW = (divertor?.wall_material ?? 'W') === 'W'
  const recryst = isW && recrystHeld
  // plain below 5 MW/m², amber 5–10, red above 10 or once the tungsten is recrystallizing
  const qTone: DiagTone = recryst || q > W_RECRYST_QFLUX ? 'bad' : q > 5 ? 'warn' : undefined
  const tWord: TWord = recryst ? 'RECRYSTALLIZATION' : tSurf >= T_WARN ? 'HOT' : 'NOMINAL'
  const tTone: DiagTone = tWord === 'RECRYSTALLIZATION' ? 'bad' : tWord === 'HOT' ? 'warn' : undefined
  const diverted = valid && !!snapshot && !snapshot.is_limited
  const regime: Regime = !diverted ? '—' : fDet >= 0.6 ? 'DETACHED' : fDet >= 0.3 ? 'PARTIAL' : 'ATTACHED'
  const regimeTone: DiagTone = regimeToneOf(regime, q)
  const active = rate > 1e10

  return {
    valid,
    q, qFill: q / Math.max(Q_SCALE, q * 1.2), qTone, lambdaQ, fDet, regime, regimeTone,
    isW, tSurf, tFill: clamp01(tSurf / T_SCALE), tTone, tWord,
    rate, nFill: clamp01(neutronSignalLevel(rate)), active, nWord: active ? 'ACTIVE' : 'BACKGROUND', pFus, qPlasma,
  }
}
