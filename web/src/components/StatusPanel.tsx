import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot } from '../lib/types'
import type { ProcessedProfile } from '../lib/types'
import ProfilePanel from './ProfilePanel'
import InfoPopup from './InfoPopup'
import { plasmaParamsInfo, stabilityInfo, powerBalanceInfo, divertorInfo, neutronDiagnosticInfo } from './infoContent'
import { getDevice } from '../lib/wasm'
import { computeFusion, computeDivertorHeatFlux, formatNeutronRate, formatQ, neutronSignalLevel, type FusionState, type DivertorState } from '../lib/fusionPhysics'

interface Props {
  snapshot: Snapshot | null
  finished: boolean
  processedProfiles: ProcessedProfile[] | null
  profileTeMax: number
  profileNeMax: number
  profilePMax: number
  displayTime: number | null
}

export default function StatusPanel({
  snapshot,
  finished,
  processedProfiles,
  profileTeMax,
  profileNeMax,
  profilePMax,
  displayTime,
}: Props) {
  const [showProfiles, setShowProfiles] = useState(false)
  const [showPressure, setShowPressure] = useState(false)
  const [showThomson, setShowThomson] = useState(true)

  // Reset profile view when discharge resets
  useEffect(() => {
    if (!finished) {
      setShowProfiles(false)
    }
  }, [finished])

  // Can show profiles only after discharge finishes and profiles are processed
  const canShowProfiles = finished && processedProfiles !== null && processedProfiles.length > 0

  // Compute profile index from displayTime
  const profileIndex = useMemo(() => {
    if (!processedProfiles || processedProfiles.length === 0 || displayTime == null) return 0
    // Find nearest profile frame to displayTime
    let bestIdx = 0
    let bestDist = Math.abs(processedProfiles[0].time - displayTime)
    for (let i = 1; i < processedProfiles.length; i++) {
      const dist = Math.abs(processedProfiles[i].time - displayTime)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    return bestIdx
  }, [processedProfiles, displayTime])

  // Device lookup for fusion computation
  const device = useMemo(
    () => (snapshot ? getDevice(snapshot.device_id) : null),
    [snapshot?.device_id]
  )

  // Fusion state (P_fus, Q, neutron rate)
  const fusion = useMemo<FusionState | null>(() => {
    if (!snapshot || !device) return null
    return computeFusion(snapshot, device)
  }, [snapshot, device])

  // Divertor heat flux
  const divertor = useMemo<DivertorState | null>(() => {
    if (!snapshot || !device) return null
    return computeDivertorHeatFlux(snapshot, device)
  }, [snapshot, device])

  if (!snapshot) {
    return (
      <div className="p-3 font-mono text-sm text-gray-600 flex items-center justify-center h-full">
        Awaiting discharge…
      </div>
    )
  }

  const s = snapshot

  return (
    <div className="px-3 py-1 font-mono text-xs h-full overflow-y-auto flex flex-col">
      {/* Top row: mode badge + disruption risk */}
      <div className="flex items-center gap-2 mb-0.5 shrink-0">
        <span
          className={`px-1.5 py-px rounded text-[10px] font-bold shrink-0 ${
            s.disrupted
              ? 'bg-red-900 text-red-300'
              : s.in_hmode
                ? 'bg-cyan-900 text-cyan-300'
                : 'bg-gray-800 text-gray-300'
          }`}
        >
          {s.disrupted ? 'DISRUPTED' : s.in_hmode ? 'H-MODE' : 'L-MODE'}
        </span>
        {/* Disruption risk bar */}
        <DisruptionRisk risk={s.disruption_risk} />

        {/* Profile toggle + status */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {canShowProfiles && (
            <>
              <button
                onClick={() => setShowProfiles(!showProfiles)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                  showProfiles
                    ? 'bg-purple-700 text-purple-200'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {showProfiles ? 'Params' : 'Profiles'}
              </button>
              {showProfiles && (
                <>
                  <label className="flex items-center gap-0.5 text-[10px] text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showThomson}
                      onChange={(e) => setShowThomson(e.target.checked)}
                      className="w-2.5 h-2.5 cursor-pointer"
                    />
                    TS
                  </label>
                  <label className="flex items-center gap-0.5 text-[10px] text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPressure}
                      onChange={(e) => setShowPressure(e.target.checked)}
                      className="w-2.5 h-2.5 cursor-pointer"
                    />
                    P
                  </label>
                </>
              )}
            </>
          )}
          <span className="text-[10px] text-gray-500">
            {s.status}
          </span>
        </div>
      </div>

      {/* Profile view or Params view */}
      {showProfiles && canShowProfiles ? (
        <div className="flex-1 min-h-0">
          <ProfilePanel
            profiles={processedProfiles}
            currentIndex={profileIndex}
            teMax={profileTeMax}
            neMax={profileNeMax}
            pMax={profilePMax}
            showThomson={showThomson}
            showPressure={showPressure}
          />
        </div>
      ) : (
      <div className="flex-1 flex flex-col justify-between">
      {/* Params & Stability */}
      <div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
          <span className="flex items-center gap-1">
            Plasma parameters
            <InfoPopup title="Plasma Parameters" position="right">{plasmaParamsInfo}</InfoPopup>
          </span>
          <span className="flex items-center gap-1 ml-auto">
            Stability
            <InfoPopup title="Stability Limits" position="left">{stabilityInfo}</InfoPopup>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
          <Param label={<>I<sub>p</sub></>} value={s.ip} unit="MA" />
          <Param label={<>T<sub>e0</sub></>} value={s.te0} unit="keV" />
          <Param label={<>q<sub>95</sub></>} value={s.q95} unit="" warn={s.q95 < 2.5} danger={s.q95 < 2.0} />

          <Param label={<>B<sub>t</sub></>} value={s.bt} unit="T" />
          <Param label={<>n̄<sub>e</sub></>} value={s.ne_bar} unit="10²⁰" />
          <Param label={<>β<sub>N</sub></>} value={s.beta_n} unit="" warn={s.beta_n > 2.5} danger={s.beta_n > 2.8} />

          <Param label={<>W<sub>th</sub></>} value={s.w_th} unit="MJ" />
          <Param label={<>τ<sub>E</sub></>} value={s.tau_e} unit="s" />
          <Param label={<>f<sub>GW</sub></>} value={s.f_greenwald} unit="" warn={s.f_greenwald > 0.8} danger={s.f_greenwald > 0.9} />

          <Param label={<>H<sub>98</sub></>} value={s.h_factor} unit="" />
          <Param label={<>l<sub>i</sub></>} value={s.li} unit="" />
          <Param label={<>V<sub>loop</sub></>} value={s.diagnostics.v_loop} unit="V" />
        </div>
      </div>

      {/* ── Power & Fusion ─────────────────────────────────────── */}
      <div className="border-t border-gray-800 pt-1.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-gray-500 flex items-center gap-1">
            Power &amp; Fusion
            <InfoPopup title="Power Balance &amp; Fusion" position="right">{powerBalanceInfo}</InfoPopup>
          </span>
        </div>

        {/* Input / Output two-column power balance */}
        <PowerBalance snapshot={s} fusion={fusion} />
      </div>

      {/* Divertor thermal loading */}
      <DivertorLoading divertor={divertor} />

      {/* Neutron diagnostic + Q display side by side */}
      <div className="flex gap-2 border-t border-gray-800 pt-1.5">
        <NeutronDiagnostic fusion={fusion} />
        <QDisplay fusion={fusion} />
      </div>
      </div>
      )}
    </div>
  )
}

// ── Power Balance: Input vs Output columns ───────────────────────────

function PowerBalance({ snapshot: s, fusion }: { snapshot: Snapshot; fusion: FusionState | null }) {
  const isDT = fusion?.fuel_type === 'DT'
  const pFus = fusion?.p_fus ?? 0
  const pAlpha = fusion?.p_alpha ?? 0

  // Input side: external heating + alpha heating (for DT)
  const inputItems: { label: React.ReactNode; value: number; color: string }[] = [
    { label: <><sub>OH</sub></>, value: s.p_ohmic, color: '#6b7280' },
    { label: <><sub>NBI</sub></>, value: s.prog_p_nbi, color: '#3b82f6' },
    { label: <><sub>ECH</sub></>, value: s.prog_p_ech, color: '#8b5cf6' },
  ]
  if (s.prog_p_ich > 0.01) {
    inputItems.push({ label: <><sub>ICH</sub></>, value: s.prog_p_ich, color: '#f59e0b' })
  }
  if (isDT && pAlpha > 0.01) {
    inputItems.push({ label: <><sub>α</sub></>, value: pAlpha, color: '#10b981' })
  }

  // Total input = external + alpha (for DT, alpha heats the plasma)
  const pInputTotal = s.p_input + (isDT ? pAlpha : 0)

  // Output side
  const dWdt = Math.max(s.p_input - s.p_loss - s.p_rad, -s.p_input)
  const outputItems: { label: React.ReactNode; value: number; color: string }[] = [
    { label: <><sub>rad</sub></>, value: s.p_rad, color: '#ef4444' },
    { label: <><sub>loss</sub></>, value: s.p_loss, color: '#f97316' },
  ]
  if (Math.abs(dWdt) > 0.01) {
    outputItems.push({ label: <>dW/dt</>, value: Math.abs(dWdt), color: '#eab308' })
  }

  const pOutputTotal = s.p_rad + s.p_loss + Math.max(dWdt, 0)

  // Use the same max for both columns so bars are comparable
  const maxPower = Math.max(pInputTotal, pOutputTotal, 0.1)

  return (
    <div className="grid grid-cols-2 gap-x-4">
      {/* Input column */}
      <div>
        <div className="text-[10px] text-gray-600 leading-none mb-1">INPUT</div>
        {inputItems.map((item, i) => (
          <PowerBar key={i} label={<>P{item.label}</>} value={item.value} total={maxPower} color={item.color} />
        ))}
      </div>

      {/* Output column */}
      <div>
        <div className="text-[10px] text-gray-600 leading-none mb-1">OUTPUT</div>
        {outputItems.map((item, i) => (
          <PowerBar key={i} label={<>P{item.label}</>} value={item.value} total={maxPower} color={item.color} />
        ))}
      </div>

      {/* Shared P_in / P_out totals row */}
      <div className="col-span-2 flex justify-between text-[10px] text-gray-500 border-t border-gray-800/50 pt-1 mt-0.5 leading-tight">
        <span>P<sub>in</sub> <span className="tabular-nums">{pInputTotal.toFixed(1)} MW</span></span>
        <span>P<sub>out</sub> <span className="tabular-nums">{pOutputTotal.toFixed(1)} MW</span></span>
      </div>
    </div>
  )
}

// ── Q_plasma display ─────────────────────────────────────────────────

function QDisplay({ fusion }: { fusion: FusionState | null }) {
  const rawQ = fusion?.q_plasma ?? 0
  const rawPFus = fusion?.p_fus ?? 0
  const fuelType = fusion?.fuel_type ?? 'DD'

  // EMA smoothing — prevents ELM-driven jitter and P_fus toggling
  const smoothQ = useRef(0)
  const smoothPFus = useRef(0)
  const alpha = 0.04

  if (rawQ === 0 && smoothQ.current < 1e-8) {
    smoothQ.current = 0
    smoothPFus.current = 0
  } else {
    smoothQ.current += alpha * (rawQ - smoothQ.current)
    smoothPFus.current += alpha * (rawPFus - smoothPFus.current)
  }

  const q = smoothQ.current
  const pFus = smoothPFus.current

  // Color coding for Q
  const qColor = q >= 10 ? 'text-emerald-400'
    : q >= 1 ? 'text-cyan-400'
    : q >= 0.01 ? 'text-gray-300'
    : 'text-gray-500'

  const borderColor = q >= 10 ? 'border-emerald-500/40 bg-emerald-500/5'
    : q >= 1 ? 'border-cyan-500/40 bg-cyan-500/5'
    : 'border-gray-700/50 bg-gray-800/50'

  // Format P_fus — always show to prevent layout jumps
  const pFusStr = pFus > 0.001
    ? (pFus < 1 ? (pFus * 1000).toFixed(0) + ' kW' : pFus.toFixed(1) + ' MW')
    : '—'

  return (
    <div className={`rounded border px-2.5 py-1.5 text-center min-w-[72px] shrink-0 ${borderColor}`}>
      <div className="text-[10px] text-gray-500 leading-tight">Q<sub>plasma</sub></div>
      <div className={`text-lg font-bold tabular-nums leading-tight ${qColor}`}>
        {formatQ(q)}
      </div>
      <div className="text-[10px] text-gray-600 leading-none">{fuelType}</div>
      <div className="text-[9px] text-gray-600 leading-none mt-0.5 tabular-nums">
        P<sub>fus</sub> {pFusStr}
      </div>
    </div>
  )
}

// ── Neutron Diagnostic ───────────────────────────────────────────────

function NeutronDiagnostic({ fusion }: { fusion: FusionState | null }) {
  const rawRate = fusion?.neutron_rate ?? 0
  const rawPower = fusion?.neutron_power ?? 0

  // EMA smoothing to eliminate ELM-driven jitter.
  // α ≈ 0.04 at ~60 fps gives a ~400ms time constant — smooths
  // the 2ms ELM spikes and prevents text width changes.
  const smoothRate = useRef(0)
  const smoothPower = useRef(0)
  const alpha = 0.04

  // Update smoothed values every render
  if (rawRate === 0 && smoothRate.current < 1e5) {
    // Reset when plasma is off
    smoothRate.current = 0
    smoothPower.current = 0
  } else {
    smoothRate.current += alpha * (rawRate - smoothRate.current)
    smoothPower.current += alpha * (rawPower - smoothPower.current)
  }

  const rate = smoothRate.current
  const power = smoothPower.current
  const signal = neutronSignalLevel(rate)

  // Signal level bars (8 segments)
  const numBars = 8
  const activeBars = Math.round(signal * numBars)

  // Glow animation for active detector
  const isActive = rate > 1e10

  // Format power — always show to prevent layout shifts
  const powerStr = power > 0.0001
    ? (power < 1 ? (power * 1000).toFixed(0) + ' kW' : power.toFixed(1) + ' MW')
    : '—'

  return (
    <div className="flex-1 rounded border border-gray-700/50 bg-gray-800/30 px-2.5 py-1.5 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-1 mb-1">
        <span className={`text-[11px] ${isActive ? 'text-yellow-500' : 'text-gray-600'}`}>☢</span>
        <span className="text-[10px] text-gray-500">Neutron diagnostic</span>
        <InfoPopup title="Neutron Diagnostics" position="left">{neutronDiagnosticInfo}</InfoPopup>
        {isActive && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse shrink-0" />
        )}
      </div>

      {/* Signal bar */}
      <div className="flex gap-0.5 mb-1">
        {Array.from({ length: numBars }, (_, i) => {
          const barActive = i < activeBars
          const barColor = i < 3 ? '#22c55e' : i < 6 ? '#eab308' : '#ef4444'
          return (
            <div
              key={i}
              className="flex-1 h-2.5 rounded-sm transition-all duration-300"
              style={{
                backgroundColor: barActive ? barColor : '#1f2937',
                opacity: barActive ? 1 : 0.3,
              }}
            />
          )
        })}
      </div>

      {/* Values — fixed-layout flex to prevent side-to-side jitter */}
      <div className="flex items-center justify-between">
        <span className={`text-[11px] tabular-nums ${isActive ? 'text-gray-200' : 'text-gray-500'}`}>
          {rate > 0 ? formatNeutronRate(rate) : '—'} n/s
        </span>
        <span className="text-[10px] text-gray-500 tabular-nums">
          {powerStr}
        </span>
      </div>
    </div>
  )
}

// ── Divertor Thermal Loading ─────────────────────────────────────────

/** Tungsten recrystallization temperature threshold (°C). */
const W_RECRYST_TEMP = 1300

/** Tungsten recrystallization heat flux threshold (MW/m²) — approximate steady-state limit. */
const W_RECRYST_QFLUX = 10

function DivertorLoading({ divertor }: { divertor: DivertorState | null }) {
  const q = divertor?.q_peak ?? 0
  const lambda = divertor?.lambda_q ?? 0
  const fDet = divertor?.f_detach ?? 0
  const tSurface = divertor?.t_surface ?? 0
  const wallMat = divertor?.wall_material ?? 'W'
  const isW = wallMat === 'W'

  // ── Heat flux bar ──
  const maxQ = 25
  const fracQ = Math.min(q / maxQ, 1)
  const qBarColor = q > 15 ? '#ef4444' : q > W_RECRYST_QFLUX ? '#f97316' : q > 5 ? '#eab308' : '#22c55e'

  // ── Temperature bar (tungsten only) ──
  // Scale: 0 to 2000 °C
  const maxTemp = 2000
  const fracT = Math.min(tSurface / maxTemp, 1)
  const tempBarColor = tSurface > W_RECRYST_TEMP ? '#ef4444' : tSurface > 1000 ? '#f97316' : tSurface > 600 ? '#eab308' : '#22c55e'
  const isTempWarning = isW && tSurface > W_RECRYST_TEMP

  // Flash state for warning light
  const isWarning = (isW && q > W_RECRYST_QFLUX) || isTempWarning
  const [flashOn, setFlashOn] = useState(true)
  useEffect(() => {
    if (!isWarning) return
    const id = setInterval(() => setFlashOn(v => !v), 400)
    return () => clearInterval(id)
  }, [isWarning])

  return (
    <div className="border-t border-gray-800 pt-1.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] text-gray-500 flex items-center gap-1">
          Divertor
          <InfoPopup title="Divertor Thermal Loading" position="right">{divertorInfo}</InfoPopup>
        </span>
        <span className="text-[10px] text-gray-600 tabular-nums">
          λ<sub>q</sub>={lambda.toFixed(1)} mm
        </span>
        <span className="text-[10px] text-gray-600 tabular-nums ml-auto">
          f<sub>det</sub>={fDet.toFixed(2)}
        </span>
      </div>

      {/* Heat flux bar */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-500 w-6 text-right shrink-0">q<sub>⊥</sub></span>
        <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{ width: `${fracQ * 100}%`, backgroundColor: qBarColor }}
          />
          {/* Threshold marker at 10 MW/m² for tungsten machines */}
          {isW && (
            <div
              className="absolute top-0 h-full w-px bg-gray-500/50"
              style={{ left: `${(W_RECRYST_QFLUX / maxQ) * 100}%` }}
            />
          )}
        </div>
        <span className="text-[10px] tabular-nums w-12 text-right shrink-0"
          style={{ color: qBarColor }}
        >
          {q.toFixed(1)}
        </span>
        <span className="text-[9px] text-gray-600 shrink-0">MW/m²</span>
      </div>

      {/* Surface temperature bar — tungsten machines only */}
      {isW && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-gray-500 w-6 text-right shrink-0">T<sub>s</sub></span>
          <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{ width: `${fracT * 100}%`, backgroundColor: tempBarColor }}
            />
            {/* Recrystallization threshold marker */}
            <div
              className="absolute top-0 h-full w-px bg-gray-500/50"
              style={{ left: `${(W_RECRYST_TEMP / maxTemp) * 100}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums w-12 text-right shrink-0"
            style={{ color: tempBarColor }}
          >
            {tSurface.toFixed(0)}
          </span>
          <span className="text-[9px] text-gray-600 shrink-0">°C</span>
        </div>
      )}

      {/* Warning indicator for tungsten recrystallization */}
      {isWarning && (
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor: flashOn ? '#ef4444' : '#7f1d1d',
              boxShadow: flashOn ? '0 0 6px #ef4444' : 'none',
              transition: 'all 0.15s',
            }}
          />
          <span className="text-[9px] text-red-400/80">W recrystallization risk</span>
        </div>
      )}
    </div>
  )
}

// ── Existing helper components ────────────────────────────────────────

/** Compact disruption risk indicator. */
function DisruptionRisk({ risk }: { risk: number }) {
  const pct = Math.min(risk * 100, 100)
  const barColor =
    pct > 80 ? '#ef4444' : pct > 60 ? '#f97316' : pct > 30 ? '#eab308' : '#22c55e'

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <span className="text-[10px] text-gray-500">Disruption risk</span>
      <div className="w-24 h-2.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      <span
        className="text-[10px] font-bold tabular-nums w-8"
        style={{ color: barColor }}
      >
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function Param({
  label,
  value,
  unit,
  precision = 2,
  warn = false,
  danger = false,
}: {
  label: React.ReactNode
  value: number
  unit: string
  precision?: number
  warn?: boolean
  danger?: boolean
}) {
  const color = danger ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-gray-200'
  const formatted = value.toFixed(precision)
  return (
    <div className="flex justify-between items-baseline leading-none py-px">
      <span className="text-gray-500">{label}</span>
      <span className={`${color} tabular-nums`}>
        <span className="inline-block min-w-[3.5em] text-right">{formatted}</span>
        <span className="text-gray-600 ml-0.5 text-[10px] inline-block min-w-[2.5em]">{unit}</span>
      </span>
    </div>
  )
}

function PowerBar({
  label,
  value,
  total,
  color,
}: {
  label: React.ReactNode
  value: number
  total: number
  color: string
}) {
  const frac = total > 0 ? Math.min(value / total, 1) : 0
  return (
    <div className="flex items-center gap-1.5 leading-none py-0.5">
      <span className="text-[10px] text-gray-500 w-8 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{ width: `${frac * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] text-gray-400 w-8 text-right shrink-0 tabular-nums">
        {value.toFixed(1)}
      </span>
    </div>
  )
}
