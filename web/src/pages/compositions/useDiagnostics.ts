import { useMemo, useState } from 'react'
import type { Snapshot } from '../../lib/types'
import { getDevice } from '../../lib/wasm'
import {
  computeDivertorHeatFlux, computeFusion, DivertorThermalModel, neutronSignalLevel,
  type DivertorState, type FusionState,
} from '../../lib/fusionPhysics'

/** Tungsten recrystallization thresholds, as on the current status panel. */
export const W_RECRYST_TEMP = 1300
export const W_RECRYST_QFLUX = 10
/** Full scale of the divertor heat-flux bar (MW/m²) and of the surface-temperature bar (°C). */
export const Q_SCALE = 25
export const T_SCALE = 2000
/** Surface temperature above which the bar turns amber (°C). */
export const T_WARN = 600

export type DiagTone = 'ok' | 'warn' | 'bad' | undefined
export type Regime = 'ATTACHED' | 'PARTIAL' | 'DETACHED' | '—'

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
  /** Neutron rate (n/s), the log signal level (0–1), and whether it counts as active. */
  rate: number
  nFill: number
  active: boolean
  pFus: number
  qPlasma: number
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
    }
    return {
      divertor,
      rate: this.rate.step(fusion?.neutron_rate ?? 0),
      qPlasma: this.qPlasma.step(fusion?.q_plasma ?? 0),
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
  const { divertor, rate, qPlasma, pFus } = useMemo(() => tracker.update(snapshot, device), [tracker, snapshot, device])

  const q = divertor?.q_peak ?? 0
  const lambdaQ = divertor?.lambda_q ?? 0
  const fDet = divertor?.f_detach ?? 0
  const tSurf = divertor?.t_surface ?? 0
  const isW = (divertor?.wall_material ?? 'W') === 'W'
  // plain below 5 MW/m², amber 5–10, red above 10 or past the tungsten recrystallization temperature
  const qTone: DiagTone = (isW && tSurf > W_RECRYST_TEMP) || q > W_RECRYST_QFLUX ? 'bad' : q > 5 ? 'warn' : undefined
  const tTone: DiagTone = tSurf > W_RECRYST_TEMP ? 'bad' : tSurf > T_WARN ? 'warn' : undefined
  const diverted = valid && !!snapshot && !snapshot.is_limited
  const regime: Regime = !diverted ? '—' : fDet >= 0.6 ? 'DETACHED' : fDet >= 0.3 ? 'PARTIAL' : 'ATTACHED'
  const regimeTone: DiagTone = regime === 'DETACHED' ? 'bad' : regime === 'PARTIAL' ? 'warn' : undefined

  return {
    valid,
    q, qFill: q / Math.max(Q_SCALE, q * 1.2), qTone, lambdaQ, fDet, regime, regimeTone,
    isW, tSurf, tFill: clamp01(tSurf / T_SCALE), tTone,
    rate, nFill: clamp01(neutronSignalLevel(rate)), active: rate > 1e10, pFus, qPlasma,
  }
}
