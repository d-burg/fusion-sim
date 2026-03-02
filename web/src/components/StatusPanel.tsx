import type { Snapshot } from '../lib/types'

interface Props {
  snapshot: Snapshot | null
}

export default function StatusPanel({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <div className="p-3 font-mono text-sm text-gray-600 flex items-center justify-center h-full">
        Awaiting discharge…
      </div>
    )
  }

  const s = snapshot

  return (
    <div className="p-3 font-mono text-sm space-y-3 h-full overflow-y-auto">
      {/* Mode badge */}
      <div className="flex items-center gap-2">
        <span
          className={`px-2 py-0.5 rounded text-xs font-bold ${
            s.disrupted
              ? 'bg-red-900 text-red-300'
              : s.in_hmode
                ? 'bg-cyan-900 text-cyan-300'
                : 'bg-gray-800 text-gray-300'
          }`}
        >
          {s.disrupted ? 'DISRUPTED' : s.in_hmode ? 'H-MODE' : 'L-MODE'}
        </span>
        {s.elm_active && (
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-900 text-amber-300 animate-pulse">
            ELM
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          {s.status}
        </span>
      </div>

      {/* Key parameters */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Param label="Iₚ" value={s.ip} unit="MA" />
        <Param label="Bₜ" value={s.bt} unit="T" />
        <Param label="Tₑ₀" value={s.te0} unit="keV" />
        <Param label="n̄ₑ" value={s.ne_bar} unit="10²⁰" />
        <Param label="Wₜₕ" value={s.w_th} unit="MJ" precision={2} />
        <Param label="τE" value={s.tau_e} unit="s" precision={3} />
        <Param label="q₉₅" value={s.q95} unit="" warn={s.q95 < 2.5} danger={s.q95 < 2.0} />
        <Param label="βN" value={s.beta_n} unit="" warn={s.beta_n > 2.5} danger={s.beta_n > 2.8} />
        <Param label="fGW" value={s.f_greenwald} unit="" warn={s.f_greenwald > 0.8} danger={s.f_greenwald > 0.9} />
        <Param label="H₉₈" value={s.h_factor} unit="" />
        <Param label="li" value={s.li} unit="" />
      </div>

      {/* Power balance bar */}
      <div className="space-y-1">
        <div className="text-xs text-gray-500">Power balance</div>
        <PowerBar label="Pₒₕ" value={s.p_ohmic} total={s.p_input} color="#6b7280" />
        <PowerBar label="Pₙᵦᵢ" value={s.prog_p_nbi} total={s.p_input} color="#3b82f6" />
        <PowerBar label="Pₑcₕ" value={s.prog_p_ech} total={s.p_input} color="#8b5cf6" />
        <PowerBar label="Pᵣₐd" value={s.p_rad} total={s.p_input} color="#ef4444" />
        <div className="flex justify-between text-[10px] text-gray-500 mt-1">
          <span>Pin = {s.p_input.toFixed(1)} MW</span>
          <span>Ploss = {s.p_loss.toFixed(1)} MW</span>
        </div>
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
  label: string
  value: number
  unit: string
  precision?: number
  warn?: boolean
  danger?: boolean
}) {
  const color = danger ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-gray-200'
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={color}>
        {value.toFixed(precision)}
        {unit && <span className="text-gray-600 ml-1">{unit}</span>}
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
  label: string
  value: number
  total: number
  color: string
}) {
  const frac = total > 0 ? Math.min(value / total, 1) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-8 text-right">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{ width: `${frac * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] text-gray-400 w-12 text-right">
        {value.toFixed(1)}
      </span>
    </div>
  )
}
