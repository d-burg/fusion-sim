import type { Snapshot } from '../lib/types'

interface Props {
  snapshot: Snapshot | null
}

function riskColor(risk: number): string {
  if (risk < 0.3) return 'var(--c-ok)'
  if (risk < 0.6) return 'var(--c-warn)'
  return 'var(--c-bad)'
}

/** Same scale, but the AA-safe alarm red for small text. */
function riskInkColor(risk: number): string {
  if (risk < 0.3) return 'var(--c-ok)'
  if (risk < 0.6) return 'var(--c-warn)'
  return 'var(--c-bad-ink)'
}

export default function DisruptionGauge({ snapshot }: Props) {
  const risk = snapshot?.disruption_risk ?? 0
  const pct = Math.min(risk * 100, 100)
  const color = riskColor(risk)
  const inkColor = riskInkColor(risk)
  const disrupted = snapshot?.disrupted ?? false

  return (
    <div className="flex flex-col items-center gap-3 p-3 h-full">
      <span className="panel-title">Disruption risk</span>

      {/* Vertical bar gauge */}
      <div className="flex-1 w-10 relative rounded-md overflow-hidden bg-gray-800 border border-gray-700">
        {/* Fill from bottom */}
        <div
          className="absolute bottom-0 left-0 right-0 transition-all duration-150"
          style={{
            height: `${pct}%`,
            backgroundColor: color,
          }}
        />
        {/* Tick marks */}
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            className="absolute left-0 right-0 border-t border-gray-600"
            style={{ bottom: `${tick}%` }}
          />
        ))}
      </div>

      {/* Numeric readout */}
      <div
        className="text-2xl font-mono font-semibold tabular-nums"
        style={{ color: inkColor }}
      >
        {disrupted ? 'DISRUPTED' : `${pct.toFixed(0)}%`}
      </div>

      {/* Risk factor indicators */}
      {snapshot && (
        <div className="text-xs text-gray-500 space-y-0.5 w-full">
          <RiskRow label="fGW" value={snapshot.f_greenwald} limit={0.85} />
          <RiskRow label="βN" value={snapshot.beta_n} limit={2.8} />
          <RiskRow label="q95" value={snapshot.q95} limit={2.0} invert />
          <RiskRow label="Prad/Pin" value={snapshot.p_rad / Math.max(snapshot.p_input, 0.01)} limit={0.8} />
        </div>
      )}
    </div>
  )
}

function RiskRow({
  label,
  value,
  limit,
  invert = false,
}: {
  label: string
  value: number
  limit: number
  invert?: boolean
}) {
  const danger = invert ? value < limit : value > limit * 0.9
  const critical = invert ? value < limit * 1.1 : value > limit
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span
        className={`font-mono tabular-nums ${
          critical
            ? 'text-red-400 font-medium'
            : danger
              ? 'text-yellow-400'
              : 'text-gray-400'
        }`}
      >
        {value.toFixed(2)}
      </span>
    </div>
  )
}
