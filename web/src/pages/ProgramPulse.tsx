import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getDevice,
  getPreset,
  type PresetId,
  type WaveformPoint,
  type PulseProgram,
} from '../lib/wasm'

// ── Preset metadata ──────────────────────────────────────────────
const ALL_PRESETS: { id: PresetId; name: string; desc: string; color: string }[] = [
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
    desc: 'Over-fuelled plasma — pushes past the Greenwald limit. Will it disrupt?',
    color: 'red',
  },
]

// CENTAUR uses negative-triangularity edge mode, not conventional H/L-mode
const CENTAUR_PRESETS: typeof ALL_PRESETS = [
  {
    id: 'hmode',
    name: 'NT-edge',
    desc: 'Negative-triangularity edge mode — ELM-free high confinement',
    color: 'cyan',
  },
  {
    id: 'density_limit',
    name: 'Density Limit',
    desc: 'Over-fuelled plasma — pushes past the Greenwald limit. Will it disrupt?',
    color: 'red',
  },
]

// SPARC defaults to the quasi-continuous exhaust regime rather than the Type-I
// ELMy Primary Reference Discharge — see SPARC_SCOPING.md §11.
const SPARC_PRESETS: typeof ALL_PRESETS = [
  {
    id: 'hmode',
    name: 'QCE',
    desc: 'Quasi-continuous exhaust — heavy fuelling and full shaping stabilise the Type-I ELMs. Q ≈ 5, ELM-free.',
    color: 'cyan',
  },
  {
    id: 'lmode',
    name: 'L-mode',
    desc: 'Modest ICRF, low density, no seeding — stays below the L-H threshold',
    color: 'amber',
  },
  {
    id: 'density_limit',
    name: 'Density Limit',
    desc: 'Over-fuelled plasma — pushes past the Greenwald limit. Will it disrupt?',
    color: 'red',
  },
]

function getPresets(deviceId: string) {
  if (deviceId === 'sparc') return SPARC_PRESETS
  return deviceId === 'centaur' ? CENTAUR_PRESETS : ALL_PRESETS
}

// ── Mini sparkline SVG for a waveform ────────────────────────────
// Uses a wide viewBox (600px) to minimize aspect ratio distortion
// when the SVG is scaled to fill its container.
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

  const w = 600 // wide viewBox to match typical rendered aspect ratio
  const h = height
  const pad = 2
  const toX = (t: number) => pad + (t / duration) * (w - 2 * pad)
  const toY = (v: number) => pad + (h - 2 * pad) - ((v - vMin) / (vMax - vMin)) * (h - 2 * pad)

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p[0]).toFixed(1)} ${toY(p[1]).toFixed(1)}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
      <path
        className="trace-sweep"
        pathLength={1}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── Waveform row in the detail panel ─────────────────────────────
function WaveformRow({
  label,
  unit,
  title,
  points,
  duration,
  color,
}: {
  label: string
  unit: string
  title: string
  points: WaveformPoint[]
  duration: number
  color: string
}) {
  const peak = Math.max(...points.map((p) => p[1]))
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-20 text-right text-xs text-gray-500 shrink-0 cursor-help"
        title={unit ? `${title} (${unit})` : title}
      >
        {label}
        {unit && <span className="text-gray-600 ml-1">({unit})</span>}
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
export default function ProgramPulse() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()

  const device = useMemo(() => (deviceId ? getDevice(deviceId) : null), [deviceId])
  const [selected, setSelected] = useState<PresetId>('hmode')

  // Load the selected preset's waveforms
  const program: PulseProgram | null = useMemo(
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
    selected === 'hmode' ? '#e0a23a' : selected === 'lmode' ? '#56B4E9' : '#c8553d'

  return (
    <div className="page-enter min-h-screen flex flex-col">
      {/* ── Top nav ── */}
      <nav className="flex items-center justify-between px-6 sm:px-10 py-3 border-b border-gray-800">
        <button
          onClick={() => navigate('/')}
          className="font-mono text-[10px] tracking-[0.18em] uppercase text-gray-500 hover:text-cyan-400 transition-colors cursor-pointer"
        >
          ← Device selection
        </button>
        <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-gray-300">
          fusionsimulator<span className="text-gray-600">.io</span>
        </span>
      </nav>

      <main className="flex-1 w-full max-w-5xl mx-auto px-6 sm:px-10 py-12">
        {/* Header */}
        <div className="panel-title mb-2">
          <span className="panel-num">02 · </span>Program pulse
        </div>
        <h1 className="font-mono text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
          {device.name}
        </h1>
        <p className="text-gray-500 text-sm font-mono mb-10">
          Select a scenario, review the waveforms, then run.
        </p>

        {/* Scenario selector — hairline-tiled */}
        <div className="panel-title pb-2 mb-px">Scenario</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--c-line)] border-y border-gray-800 mb-10">
          {getPresets(deviceId ?? '').map((p) => {
            const isSelected = p.id === selected
            return (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`relative p-4 text-left transition-colors cursor-pointer
                  ${isSelected ? 'bg-[var(--c-raised)]' : 'bg-gray-900 hover:bg-[var(--c-raised)]'}`}
              >
                {isSelected && <div className="absolute top-0 left-0 right-0 h-0.5 bg-cyan-500" />}
                <h3 className={`font-mono text-[11px] uppercase tracking-wider mb-1.5 ${isSelected ? 'text-cyan-400' : 'text-gray-300'}`}>
                  {p.name}
                </h3>
                <p className="text-gray-500 text-xs leading-relaxed">{p.desc}</p>
              </button>
            )
          })}
        </div>

        {/* Waveform detail */}
        {program && (
          <div className="mb-10">
            <div className="flex items-baseline justify-between mb-3 border-b border-gray-800 pb-2">
              <h2 className="panel-title">Programmed waveforms</h2>
              <span className="text-xs text-gray-500 font-mono tabular-nums">
                Duration {program.duration.toFixed(1)} s
              </span>
            </div>

            <div className="space-y-2" key={selected}>
              <WaveformRow label="Iₚ" unit="MA" title="Plasma current" points={program.ip} duration={program.duration} color={accentColor} />
              <WaveformRow label="Bₜ" unit="T" title="Toroidal magnetic field" points={program.bt} duration={program.duration} color={accentColor} />
              <WaveformRow label="n̄ₑ" unit="10²⁰m⁻³" title="Line-averaged electron density" points={program.ne_target} duration={program.duration} color={accentColor} />
              <WaveformRow label="P_NBI" unit="MW" title="Neutral beam injection power" points={program.p_nbi} duration={program.duration} color={accentColor} />
              <WaveformRow label="P_ECH" unit="MW" title="Electron cyclotron heating power" points={program.p_ech} duration={program.duration} color={accentColor} />
              <WaveformRow label="P_ICH" unit="MW" title="Ion cyclotron heating power" points={program.p_ich} duration={program.duration} color={accentColor} />
              <WaveformRow label="κ" unit="" title="Elongation" points={program.kappa} duration={program.duration} color={accentColor} />
              <WaveformRow label="δ" unit="" title="Triangularity" points={program.delta} duration={program.duration} color={accentColor} />
            </div>
          </div>
        )}

        {/* Run button */}
        <button
          onClick={() => navigate(`/run/${deviceId}?preset=${selected}`)}
          className="bg-cyan-600 px-8 py-3 text-base cursor-pointer"
        >
          ▶ Run pulse
        </button>
      </main>
    </div>
  )
}
