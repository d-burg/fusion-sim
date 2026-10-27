import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Snapshot } from '../../../lib/types'
import { getDevice } from '../../../lib/wasm'
import {
  computeDivertorHeatFlux, computeFusion, DivertorThermalModel, formatQ, neutronSignalLevel,
  type DivertorState, type FusionState,
} from '../../../lib/fusionPhysics'
import { divertorInfo, neutronDiagnosticInfo } from '../../../components/infoContent'
import InfoHint from './InfoHint'

/** Tungsten recrystallization thresholds, as on the current status panel. */
const W_RECRYST_TEMP = 1300
const W_RECRYST_QFLUX = 10
const Q_SCALE = 25

/** "1.1E13" — plain figures, no superscripts (illegible at 8 px). */
function sci(v: number): string {
  if (v <= 0) return '—'
  const e = Math.floor(Math.log10(v))
  return `${(v / Math.pow(10, e)).toFixed(1)}E${e}`
}

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

/** EMA so the digits do not jitter with ELMs (α ≈ 0.04 per frame, ~400 ms). */
function useSmooth(raw: number, floor: number): number {
  const ref = useRef(0)
  if (raw === 0 && ref.current < floor) ref.current = 0
  else ref.current += 0.04 * (raw - ref.current)
  return ref.current
}

export type Tone = 'ok' | 'warn' | 'bad' | undefined

/** One bar: a hairline track with a thin fill, the label at left and the values at right. */
function Bar({ label, fill, tone, right }: { label: ReactNode; fill: number; tone?: Tone; right: ReactNode }) {
  return (
    <div className="kd-bar">
      <div className="kd-bar-row">
        <span className="kd-bar-l">{label}</span>
        <span className="kd-bar-r">{right}</span>
      </div>
      <div className="kd-bar-track"><div className="kd-bar-fill" data-tone={tone} style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} /></div>
    </div>
  )
}

/**
 * The divertor and neutron rows of the current status panel, in this
 * grammar: two bars under the scalar grid. State is a word, never a dot.
 */
export default function Diagnostics({ snapshot, valid }: { snapshot: Snapshot | null; valid: boolean }) {
  const device = useDevice(snapshot)

  const fusion = useMemo<FusionState | null>(() => (snapshot && device ? computeFusion(snapshot, device) : null), [snapshot, device])

  // The thermal model is stateful: keep it across frames, reset it with the device.
  const modelRef = useRef<DivertorThermalModel | null>(null)
  const prevT = useRef(0)
  useEffect(() => {
    if (snapshot?.device_id) { modelRef.current = new DivertorThermalModel(snapshot.device_id); prevT.current = 0 }
  }, [snapshot?.device_id])

  const divertor = useMemo<DivertorState | null>(() => {
    if (!snapshot || !device) return null
    const state = computeDivertorHeatFlux(snapshot, device)
    let model = modelRef.current
    if (!model || model['deviceId'] !== device.id) { model = new DivertorThermalModel(device.id); modelRef.current = model }
    const t = snapshot.time ?? 0
    const dt = t > prevT.current ? t - prevT.current : 0
    prevT.current = t
    if (snapshot.ip < 0.01 || dt < 0 || dt > 2.0) model.reset()
    state.t_surface = dt > 0 && dt < 2.0 ? model.step(state.q_interELM, state.elm_q, state.tau_elm, dt) : model.t_surface
    return state
  }, [snapshot, device])

  const rate = useSmooth(fusion?.neutron_rate ?? 0, 1e5)
  const qPlasma = useSmooth(fusion?.q_plasma ?? 0, 1e-8)
  const pFus = useSmooth(fusion?.p_fus ?? 0, 1e-8)

  const q = divertor?.q_peak ?? 0
  const lambda = divertor?.lambda_q ?? 0
  const fDet = divertor?.f_detach ?? 0
  const tS = divertor?.t_surface ?? 0
  const isW = (divertor?.wall_material ?? 'W') === 'W'
  // white below 5 MW/m², amber 5–10, red above 10 or past the tungsten recrystallization temperature
  const divTone: Tone = (isW && tS > W_RECRYST_TEMP) || q > W_RECRYST_QFLUX ? 'bad' : q > 5 ? 'warn' : undefined
  const diverted = valid && !!snapshot && !snapshot.is_limited
  const regime = !diverted ? '—' : fDet >= 0.6 ? 'DETACHED' : fDet >= 0.3 ? 'PARTIAL' : 'ATTACHED'
  const regimeTone: Tone = regime === 'DETACHED' ? 'bad' : regime === 'PARTIAL' ? 'warn' : undefined
  const divRight = <>{q.toFixed(1)} MW/M² . <span className="kd-g">λ</span>Q {valid ? lambda.toFixed(1) : '—'} MM . F DET {valid ? fDet.toFixed(2) : '—'} . <span data-tone={regimeTone}>{regime}</span></>

  const active = rate > 1e10
  const pFusStr = pFus > 0.001 ? (pFus < 1 ? `${(pFus * 1000).toFixed(0)} KW` : `${pFus.toFixed(1)} MW`) : '— MW'
  const neuRight = <>{sci(rate)} N/S . Q <span data-tone={qPlasma >= 1 ? 'ok' : undefined}>{rate > 0 ? formatQ(qPlasma).toUpperCase() : '—'}</span> . P FUS {pFusStr} . <span data-tone={active ? 'ok' : undefined}>{active ? 'ACTIVE' : 'IDLE'}</span></>

  return (
    <div className="kd-bars">
      <Bar
        label={<InfoHint title="Divertor thermal loading" content={divertorInfo}>Q⊥ DIVERTOR</InfoHint>}
        fill={q / Math.max(Q_SCALE, q * 1.2)}
        tone={divTone}
        right={divRight}
      />
      <Bar
        label={<InfoHint title="Neutron diagnostic" content={neutronDiagnosticInfo}>NEUTRONS</InfoHint>}
        fill={neutronSignalLevel(rate)}
        tone={active ? 'ok' : undefined}
        right={neuRight}
      />
    </div>
  )
}
