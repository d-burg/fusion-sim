import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getDevice,
  getPreset,
  type PresetId,
  type WaveformPoint,
  type DischargeProgram,
} from '../lib/wasm'

// ── Preset metadata ──────────────────────────────────────────────
const PRESETS: { id: PresetId; name: string; desc: string; color: string }[] = [
  {
    id: 'hmode',
    name: 'Standard H-mode',
    desc: 'Ip ramp → NBI → L-H transition → H-mode flat-top → rampdown',
    color: 'cyan',
  },
  {
    id: 'lmode',
    name: 'L-mode',
    desc: 'Ohmic heating + modest NBI, stays in L-mode confinement',
    color: 'amber',
  },
  {
    id: 'density_limit',
    name: 'Density Limit',
    desc: 'Over-fuelled shot — pushes past the Greenwald limit. Will it disrupt?',
    color: 'red',
  },
]

// ── Mini sparkline SVG for a waveform ────────────────────────────
function Sparkline({
  points,
  duration,
  color = '#22d3ee',
  height = 32,
}: {
  points: WaveformPoint[]
  duration: number
  color?: string
  height?: number
}) {
  if (points.length < 2) return null

  const vals = points.map((p) => p[1])
  const vMin = Math.min(...vals, 0)
  const vMax = Math.max(...vals) * 1.1 || 1

  const w = 200
  const h = height
  const toX = (t: number) => (t / duration) * w
  const toY = (v: number) => h - ((v - vMin) / (vMax - vMin)) * h

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p[0]).toFixed(1)} ${toY(p[1]).toFixed(1)}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

// ── Waveform row in the detail panel ─────────────────────────────
function WaveformRow({
  label,
  unit,
  points,
  duration,
  color,
}: {
  label: string
  unit: string
  points: WaveformPoint[]
  duration: number
  color: string
}) {
  const peak = Math.max(...points.map((p) => p[1]))
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-right text-xs text-gray-500 shrink-0">
        {label}
        <span className="text-gray-600 ml-1">({unit})</span>
      </div>
      <div className="flex-1 bg-gray-950 rounded px-2 py-1">
        <Sparkline points={points} duration={duration} color={color} />
      </div>
      <div className="w-14 text-right text-xs text-gray-400 font-mono shrink-0">
        {peak.toFixed(1)}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────
export default function ProgramDischarge() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()

  const device = useMemo(() => (deviceId ? getDevice(deviceId) : null), [deviceId])
  const [selected, setSelected] = useState<PresetId>('hmode')

  // Load the selected preset's waveforms
  const program: DischargeProgram | null = useMemo(
    () => (deviceId ? getPreset(deviceId, selected) : null),
    [deviceId, selected],
  )

  if (!device) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-400">
        Unknown device: {deviceId}
      </div>
    )
  }

  const accentColor =
    selected === 'hmode' ? '#22d3ee' : selected === 'lmode' ? '#fbbf24' : '#ef4444'

  return (
    <div className="min-h-screen flex flex-col items-center p-8 max-w-5xl mx-auto">
      {/* Back link */}
      <button
        onClick={() => navigate('/')}
        className="self-start text-gray-500 hover:text-cyan-400 text-sm mb-6 cursor-pointer"
      >
        ← Back to device selection
      </button>

      {/* Header */}
      <h1 className="text-3xl font-bold mb-1">
        Program Discharge —{' '}
        <span className="text-cyan-400">{device.name}</span>
      </h1>
      <p className="text-gray-500 text-sm mb-8">
        Select a scenario, review the waveforms, then run.
      </p>

      {/* Preset selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full mb-8">
        {PRESETS.map((p) => {
          const isSelected = p.id === selected
          const borderClass =
            p.color === 'cyan'
              ? isSelected ? 'border-cyan-500' : 'border-gray-700 hover:border-cyan-700'
              : p.color === 'amber'
                ? isSelected ? 'border-amber-500' : 'border-gray-700 hover:border-amber-700'
                : isSelected ? 'border-red-500' : 'border-gray-700 hover:border-red-700'

          return (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`bg-gray-900 border rounded-lg p-4 text-left transition-all duration-150 cursor-pointer ${borderClass}`}
            >
              <h3 className="text-sm font-semibold text-white mb-1">{p.name}</h3>
              <p className="text-gray-500 text-xs leading-relaxed">{p.desc}</p>
            </button>
          )
        })}
      </div>

      {/* Waveform detail panel */}
      {program && (
        <div className="w-full bg-gray-900 border border-gray-700 rounded-xl p-5 mb-8">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-300">
              Programmed Waveforms
            </h2>
            <span className="text-xs text-gray-500 font-mono">
              Duration: {program.duration.toFixed(1)} s
            </span>
          </div>

          <div className="space-y-2">
            <WaveformRow label="Iₚ" unit="MA" points={program.ip} duration={program.duration} color={accentColor} />
            <WaveformRow label="Bₜ" unit="T" points={program.bt} duration={program.duration} color={accentColor} />
            <WaveformRow label="n̄ₑ" unit="10²⁰m⁻³" points={program.ne_target} duration={program.duration} color={accentColor} />
            <WaveformRow label="P_NBI" unit="MW" points={program.p_nbi} duration={program.duration} color={accentColor} />
            <WaveformRow label="P_ECH" unit="MW" points={program.p_ech} duration={program.duration} color={accentColor} />
            <WaveformRow label="P_ICH" unit="MW" points={program.p_ich} duration={program.duration} color={accentColor} />
            <WaveformRow label="κ" unit="" points={program.kappa} duration={program.duration} color={accentColor} />
            <WaveformRow label="δ" unit="" points={program.delta} duration={program.duration} color={accentColor} />
          </div>
        </div>
      )}

      {/* Run button */}
      <button
        onClick={() => navigate(`/run/${deviceId}?preset=${selected}`)}
        className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-lg font-bold
                   transition-colors cursor-pointer shadow-lg shadow-cyan-600/20
                   hover:shadow-cyan-500/30"
      >
        ▶ Run Discharge
      </button>
    </div>
  )
}
