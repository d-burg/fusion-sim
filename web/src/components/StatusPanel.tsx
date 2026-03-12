import React, { useEffect, useMemo, useState } from 'react'
import type { Snapshot } from '../lib/types'
import type { ProcessedProfile } from '../lib/types'
import ProfilePanel from './ProfilePanel'
import InfoPopup from './InfoPopup'
import { plasmaParamsInfo, stabilityInfo, powerBalanceInfo } from './infoContent'

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

  if (!snapshot) {
    return (
      <div className="p-3 font-mono text-sm text-gray-600 flex items-center justify-center h-full">
        Awaiting discharge…
      </div>
    )
  }

  const s = snapshot

  return (
    <div className="px-3 py-1.5 font-mono text-xs h-full overflow-y-auto flex flex-col">
      {/* Top row: mode badge + disruption risk */}
      <div className="flex items-center gap-2 mb-1 shrink-0">
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
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
        <DisruptionRisk risk={s.disruption_risk} snapshot={s} />

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
      <>
      {/* Params & Stability side by side */}
      <div className="grid grid-cols-2 gap-x-4 mb-1">
        {/* Column 1: Key parameters */}
        <div>
          <div className="text-[10px] text-gray-500 mb-0.5 flex items-center gap-1">
            Plasma parameters
            <InfoPopup title="Plasma Parameters" position="right">{plasmaParamsInfo}</InfoPopup>
          </div>
          <Param label={<>I<sub>p</sub></>} value={s.ip} unit="MA" />
          <Param label={<>B<sub>t</sub></>} value={s.bt} unit="T" />
          <Param label={<>T<sub>e0</sub></>} value={s.te0} unit="keV" />
          <Param label={<>n̄<sub>e</sub></>} value={s.ne_bar} unit="10²⁰" />
          <Param label={<>W<sub>th</sub></>} value={s.w_th} unit="MJ" precision={2} />
          <Param label={<>τ<sub>E</sub></>} value={s.tau_e} unit="s" precision={3} />
        </div>

        {/* Column 2: Stability & confinement */}
        <div>
          <div className="text-[10px] text-gray-500 mb-0.5 flex items-center gap-1">
            Stability
            <InfoPopup title="Stability Limits" position="left">{stabilityInfo}</InfoPopup>
          </div>
          <Param label={<>q<sub>95</sub></>} value={s.q95} unit="" warn={s.q95 < 2.5} danger={s.q95 < 2.0} />
          <Param label={<>β<sub>N</sub></>} value={s.beta_n} unit="" warn={s.beta_n > 2.5} danger={s.beta_n > 2.8} />
          <Param label={<>f<sub>GW</sub></>} value={s.f_greenwald} unit="" warn={s.f_greenwald > 0.8} danger={s.f_greenwald > 0.9} />
          <Param label={<>H<sub>98</sub></>} value={s.h_factor} unit="" />
          <Param label={<>l<sub>i</sub></>} value={s.li} unit="" />
          <Param label={<>V<sub>loop</sub></>} value={s.diagnostics.v_loop} unit="V" precision={3} />
        </div>
      </div>

      {/* Power balance: compact 2×2 grid below params/stability */}
      <div className="border-t border-gray-800 pt-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] text-gray-500 flex items-center gap-1">
            Power balance
            <InfoPopup title="Power Balance" position="right">{powerBalanceInfo}</InfoPopup>
          </span>
          <span className="text-[10px] text-gray-500">
            Pin={s.p_input.toFixed(1)} Ploss={s.p_loss.toFixed(1)} MW
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <PowerBar label={<>P<sub>OH</sub></>} value={s.p_ohmic} total={s.p_input} color="#6b7280" />
          <PowerBar label={<>P<sub>NBI</sub></>} value={s.prog_p_nbi} total={s.p_input} color="#3b82f6" />
          <PowerBar label={<>P<sub>ECH</sub></>} value={s.prog_p_ech} total={s.p_input} color="#8b5cf6" />
          <PowerBar label={<>P<sub>rad</sub></>} value={s.p_rad} total={s.p_input} color="#ef4444" />
        </div>
      </div>
      </>
      )}
    </div>
  )
}

/** Compact disruption risk indicator with risk factor breakdown. */
function DisruptionRisk({ risk, snapshot }: { risk: number; snapshot: Snapshot }) {
  const pct = Math.min(risk * 100, 100)
  const barColor =
    pct > 80 ? '#ef4444' : pct > 60 ? '#f97316' : pct > 30 ? '#eab308' : '#22c55e'

  // Risk factor values (same metrics used by the disruption model)
  const factors: { label: React.ReactNode; value: number; warn: number; danger: number; invert?: boolean }[] = [
    { label: <span>f<sub>GW</sub></span>, value: snapshot.f_greenwald, warn: 0.8, danger: 0.9 },
    { label: <span>β<sub>N</sub></span>, value: snapshot.beta_n, warn: 2.5, danger: 2.8 },
    { label: <span>q<sub>95</sub></span>, value: snapshot.q95, warn: 2.5, danger: 2.0, invert: true },
    { label: <span>P<sub>rad</sub>/P<sub>in</sub></span>, value: snapshot.p_input > 0 ? snapshot.p_rad / snapshot.p_input : 0, warn: 0.7, danger: 0.85 },
  ]

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {/* Risk bar */}
      <div className="flex items-center gap-1.5 shrink-0">
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

      {/* Risk factors inline */}
      <div className="flex items-center gap-2 text-[10px] min-w-0">
        {factors.map((f, idx) => {
          const isDanger = f.invert ? f.value < f.danger : f.value > f.danger
          const isWarn = f.invert ? f.value < f.warn : f.value > f.warn
          const color = isDanger ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-gray-500'
          return (
            <span key={idx} className={`${color} whitespace-nowrap`}>
              {f.label}={f.value.toFixed(2)}
            </span>
          )
        })}
      </div>
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
  return (
    <div className="flex justify-between leading-snug">
      <span className="text-gray-500">{label}</span>
      <span className={color}>
        {value.toFixed(precision)}
        {unit && <span className="text-gray-600 ml-0.5 text-[10px]">{unit}</span>}
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
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-500 w-7 text-right shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{ width: `${frac * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] text-gray-400 w-8 text-right shrink-0">
        {value.toFixed(1)}
      </span>
    </div>
  )
}
