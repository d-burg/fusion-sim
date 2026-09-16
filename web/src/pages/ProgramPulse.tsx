import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getDevice,
  getPreset,
  type PresetId,
  type WaveformPoint,
  type PulseProgram,
} from '../lib/wasm'
import {
  buildProgram,
  DURATION_MAX,
  SCALAR_PARAMS,
  type MagneticConfig,
  type OverrideValue,
  type ProgramHandoff,
  type ScalarParam,
} from '../lib/program'
import WaveformDrawer from '../components/WaveformDrawer'

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
    name: 'Density limit',
    desc: 'Over-fuelled plasma that pushes past the Greenwald limit. Will it disrupt?',
    color: 'red',
  },
]

// CENTAUR uses negative-triangularity edge mode, not conventional H/L-mode
const CENTAUR_PRESETS: typeof ALL_PRESETS = [
  {
    id: 'hmode',
    name: 'NT-edge',
    desc: 'Negative-triangularity edge mode with ELM-free high confinement',
    color: 'cyan',
  },
  {
    id: 'density_limit',
    name: 'Density limit',
    desc: 'Over-fuelled plasma that pushes past the Greenwald limit. Will it disrupt?',
    color: 'red',
  },
]

function getPresets(deviceId: string) {
  return deviceId === 'centaur' ? CENTAUR_PRESETS : ALL_PRESETS
}

// ── Programmed-waveform strip chart ──────────────────────────────
// A stack of time-aligned strips on one shared time axis, the way a pulse
// schedule is shown on a plasma-control-system display. Each strip is
// scaled from zero to its own peak so the shape of the programme is honest;
// the breakpoints that define the piecewise-linear programme are drawn as
// markers, because they are the data. The x-scale is shared, so ticks and
// phase boundaries line up across every strip.

type Channel = {
  key: string
  symbol: React.ReactNode
  unit: string
  title: string
  points: WaveformPoint[]
  /** Set when the channel can be redrawn; absent channels are display-only. */
  param?: ScalarParam
}

/** Shared column template: symbol, plot, readout. */
const COLS = 'grid-cols-[6rem_1fr_9rem]'

/** Tick spacing that gives roughly 5–10 ticks across the pulse. */
function tickStep(duration: number): number {
  const candidates = [0.5, 1, 2, 5, 10, 20, 50]
  return candidates.find((c) => duration / c <= 10) ?? 100
}

/** Ramp-up end and ramp-down start, taken from the Ip programme. */
function flatTop(ip: WaveformPoint[]): { start: number; end: number } | null {
  const max = Math.max(...ip.map((p) => p[1]))
  if (!(max > 0)) return null
  const near = ip.filter((p) => p[1] >= 0.98 * max)
  if (near.length === 0) return null
  const start = near[0][0]
  const end = near[near.length - 1][0]
  return end > start ? { start, end } : null
}

const VB_W = 1000 // viewBox width; preserveAspectRatio="none" stretches it
const STRIP_H = 36

function Strip({
  ch,
  duration,
  ticks,
  phases,
  edited,
  onEdit,
  onReset,
}: {
  ch: Channel
  duration: number
  ticks: number[]
  phases: { start: number; end: number } | null
  edited: boolean
  onEdit?: () => void
  onReset?: () => void
}) {
  const vals = ch.points.map((p) => p[1])
  const programmed = vals.some((v) => v !== 0)
  // Scale from zero to the channel's extremum, keeping the sign so a
  // negative-triangularity programme reads as a dip below the baseline
  // rather than being mistaken for an unprogrammed channel.
  const lo = Math.min(0, ...vals) * 1.08
  const hi = Math.max(0, ...vals) * 1.08
  const range = hi - lo || 1
  const extremum = vals.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0)
  const padY = 4
  const toX = (t: number) => (t / duration) * VB_W
  const toY = (v: number) => padY + (STRIP_H - 2 * padY) * (1 - (v - lo) / range)
  const d = ch.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p[0]).toFixed(1)} ${toY(p[1]).toFixed(2)}`)
    .join(' ')

  const symbol = (
    <div
      className={`text-sm text-right ${onEdit ? '' : 'cursor-help'} ${programmed ? 'text-gray-300' : 'text-gray-600'}`}
      title={onEdit ? undefined : ch.unit ? `${ch.title} (${ch.unit})` : ch.title}
    >
      {ch.symbol}
    </div>
  )

  const plot = (
    <svg
      viewBox={`0 0 ${VB_W} ${STRIP_H}`}
      preserveAspectRatio="none"
      className="w-full block"
      style={{ height: STRIP_H }}
      aria-label={`${ch.title} programme`}
    >
      {/* Shared time grid */}
      {ticks.map((t) => (
        <line
          key={t}
          x1={toX(t)} x2={toX(t)} y1={0} y2={STRIP_H}
          stroke="var(--c-line)" vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* Flat-top boundaries, slightly stronger */}
      {phases && [phases.start, phases.end].map((t) => (
        <line
          key={`ph-${t}`}
          x1={toX(t)} x2={toX(t)} y1={0} y2={STRIP_H}
          stroke="var(--c-line-strong)" vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* Zero baseline */}
      <line
        x1={0} x2={VB_W} y1={toY(0)} y2={toY(0)}
        stroke="var(--c-line)" vectorEffect="non-scaling-stroke"
      />
      {programmed && (
        <>
          <path
            d={d}
            fill="none"
            stroke={edited ? 'var(--c-accent)' : 'var(--c-ink-dim)'}
            strokeWidth={1.25}
            strokeLinejoin="miter"
            vectorEffect="non-scaling-stroke"
          />
          {/* Breakpoints: zero-length round-capped dashes stay circular
              under the non-uniform scaling, unlike <circle>. */}
          {ch.points.map((p, i) => (
            <path
              key={i}
              d={`M ${toX(p[0]).toFixed(1)} ${toY(p[1]).toFixed(2)} h 0.001`}
              stroke={edited ? 'var(--c-accent)' : 'var(--c-ink)'}
              strokeWidth={4}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      )}
    </svg>
  )

  return (
    <div className={`grid ${COLS} items-center gap-3 bg-gray-900 py-1.5 px-3`}>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          title={`Edit ${ch.title}`}
          aria-label={`Edit ${ch.title}`}
          className="col-span-2 grid grid-cols-subgrid items-center gap-3 cursor-pointer
                     hover:bg-[var(--c-raised)] transition-colors"
        >
          {symbol}
          {plot}
        </button>
      ) : (
        <>
          {symbol}
          {plot}
        </>
      )}

      <div className="flex items-center justify-end gap-2 text-xs tabular-nums whitespace-nowrap">
        {programmed ? (
          <span>
            <span className="font-mono text-gray-300">{extremum.toFixed(Math.abs(extremum) >= 10 ? 1 : 2)}</span>
            {ch.unit && <span className="text-gray-500 ml-1">{ch.unit}</span>}
          </span>
        ) : (
          <span className="text-gray-600">not programmed</span>
        )}
        {edited && <span className="text-xs text-amber-400">edited</span>}
        {edited && onReset && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReset() }}
            aria-label={`Reset ${ch.title} to preset`}
            title={`Reset ${ch.title} to preset`}
            className="text-gray-500 hover:text-gray-300 transition-colors cursor-pointer leading-none"
          >
            ↺
          </button>
        )}
      </div>
    </div>
  )
}

function ProgramChart({
  program,
  overrides,
  onEdit,
  onReset,
}: {
  program: PulseProgram
  overrides: Record<string, OverrideValue>
  onEdit: (param: ScalarParam) => void
  onReset: (key: string) => void
}) {
  const duration = program.duration
  const step = tickStep(duration)
  const ticks: number[] = []
  for (let t = 0; t <= duration + 1e-9; t += step) ticks.push(+t.toFixed(3))
  const phases = flatTop(program.ip)
  const pct = (t: number) => `${((t / duration) * 100).toFixed(2)}%`

  const param = (key: string) => SCALAR_PARAMS.find((p) => p.key === key)

  const channels: Channel[] = [
    { key: 'ip', symbol: <><i>I</i><sub>p</sub></>, unit: 'MA', title: 'Plasma current', points: program.ip, param: param('ip') },
    { key: 'bt', symbol: <><i>B</i><sub>t</sub></>, unit: 'T', title: 'Toroidal magnetic field', points: program.bt },
    { key: 'ne', symbol: <><i>n̄</i><sub>e</sub></>, unit: '10²⁰ m⁻³', title: 'Line-averaged electron density', points: program.ne_target, param: param('ne') },
    { key: 'nbi', symbol: <><i>P</i><sub>NBI</sub></>, unit: 'MW', title: 'Neutral beam injection power', points: program.p_nbi, param: param('p_nbi') },
    { key: 'ech', symbol: <><i>P</i><sub>ECH</sub></>, unit: 'MW', title: 'Electron cyclotron heating power', points: program.p_ech, param: param('p_ech') },
    { key: 'ich', symbol: <><i>P</i><sub>ICH</sub></>, unit: 'MW', title: 'Ion cyclotron heating power', points: program.p_ich },
    { key: 'd2_puff', symbol: <><i>Γ</i><sub>D₂</sub></>, unit: '10²⁰/s', title: 'Deuterium gas puff rate', points: program.d2_puff ?? [], param: param('d2_puff') },
    { key: 'neon_puff', symbol: <><i>Γ</i><sub>Ne</sub></>, unit: '10²⁰/s', title: 'Neon seeding rate', points: program.neon_puff ?? [], param: param('neon_puff') },
    { key: 'kappa', symbol: <i>κ</i>, unit: '', title: 'Elongation', points: program.kappa, param: param('kappa') },
    { key: 'delta', symbol: <i>δ</i>, unit: '', title: 'Triangularity', points: program.delta, param: param('delta') },
  ]

  return (
    <div className="border-y border-gray-800">
      {/* Phase header, aligned to the plot column */}
      {phases && (
        <div className={`grid ${COLS} gap-3 px-3 pt-2 pb-1 text-xs text-gray-500`}>
          <div />
          <div className="relative h-4">
            <span className="absolute" style={{ left: 0 }}>ramp-up</span>
            <span className="absolute" style={{ left: pct(phases.start), paddingLeft: '0.4rem' }}>flat-top</span>
            <span className="absolute" style={{ left: pct(phases.end), paddingLeft: '0.4rem' }}>ramp-down</span>
          </div>
          <div />
        </div>
      )}

      <div className="grid gap-px bg-[var(--c-line)]">
        {channels.map((ch) => {
          const p = ch.param
          const ov = p ? overrides[p.key] : undefined
          return (
            <Strip
              key={ch.key}
              ch={ch}
              duration={duration}
              ticks={ticks}
              phases={phases}
              edited={ov !== undefined && ov !== null}
              onEdit={p ? () => onEdit(p) : undefined}
              onReset={p ? () => onReset(p.key) : undefined}
            />
          )
        })}
      </div>

      {/* Shared time axis */}
      <div className={`grid ${COLS} gap-3 px-3 pt-1.5 pb-2 text-xs text-gray-500`}>
        <div className="text-right"><i>t</i> (s)</div>
        <div className="relative h-4 font-mono tabular-nums">
          {ticks.map((t, i) => (
            <span
              key={t}
              className="absolute"
              style={{
                left: pct(t),
                transform: i === ticks.length - 1 ? 'translateX(-100%)' : i === 0 ? 'none' : 'translateX(-50%)',
              }}
            >
              {t}
            </span>
          ))}
        </div>
        <div />
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

  // Edits layered over the preset. An override is either a scalar flat-top
  // value or a redrawn waveform; the programme handed to the simulator is
  // rebuilt from the preset every render, so nothing is ever edited in place.
  const [overrides, setOverrides] = useState<Record<string, OverrideValue>>({})
  const [durationOverride, setDurationOverride] = useState<number | null>(null)
  const [configOverride, setConfigOverride] = useState<MagneticConfig | null>(null)
  const [editing, setEditing] = useState<ScalarParam | null>(null)

  // Load the selected preset's waveforms
  const base: PulseProgram | null = useMemo(
    () => (deviceId ? getPreset(deviceId, selected) : null),
    [deviceId, selected],
  )

  const program: PulseProgram | null = useMemo(
    () => (base ? buildProgram(base, overrides, durationOverride, configOverride) : null),
    [base, overrides, durationOverride, configOverride],
  )

  const modified =
    Object.keys(overrides).length > 0 || durationOverride !== null || configOverride !== null

  const durationMax = DURATION_MAX[deviceId ?? ''] ?? 30

  const selectScenario = (id: PresetId) => {
    setSelected(id)
    setOverrides({})
    setDurationOverride(null)
    setConfigOverride(null)
    setEditing(null)
  }

  const resetAll = () => {
    setOverrides({})
    setDurationOverride(null)
    setConfigOverride(null)
  }

  const resetChannel = (key: string) => {
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const setDuration = (raw: string) => {
    const v = parseFloat(raw)
    if (!Number.isFinite(v) || !base) return
    const clamped = Math.min(Math.max(v, 1), durationMax)
    setDurationOverride(clamped === base.duration ? null : clamped)
  }

  const handleRun = () => {
    if (!modified || !program) {
      navigate(`/run/${deviceId}?preset=${selected}`)
      return
    }
    const handoff: ProgramHandoff = {
      programJson: JSON.stringify(program),
      presetId: selected,
      overrides,
      durationOverride,
      configOverride,
    }
    navigate(`/run/${deviceId}?preset=${selected}`, { state: handoff })
  }

  if (!device) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-400">
        Unknown device: {deviceId}
      </div>
    )
  }

  return (
    <div className="page-enter min-h-screen flex flex-col">
      {/* ── Top nav ── */}
      <nav className="flex items-center justify-between px-6 sm:px-10 py-3 border-b border-gray-800">
        <button
          onClick={() => navigate('/')}
          className="text-sm text-gray-500 hover:text-cyan-400 transition-colors cursor-pointer"
        >
          ← Device selection
        </button>
        <span className="font-mono text-xs tracking-[0.16em] text-gray-300">
          fusionsimulator<span className="text-gray-600">.io</span>
        </span>
      </nav>

      <main className="flex-1 w-full max-w-5xl mx-auto px-6 sm:px-10 py-12">
        {/* Header */}
        <h1 className="font-mono text-3xl sm:text-4xl font-bold tracking-tight text-white mb-10">
          {device.name}
        </h1>

        {/* Scenario selector — hairline-tiled */}
        <div className="panel-title pb-2 mb-px">Scenario</div>
        <div className={`grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-px bg-[var(--c-line)] border-y border-gray-800 ${deviceId === 'diiid' ? 'mb-6' : 'mb-10'}`}>
          {getPresets(deviceId ?? '').map((p) => {
            const isSelected = p.id === selected
            return (
              <button
                key={p.id}
                onClick={() => selectScenario(p.id)}
                className={`relative p-4 text-left transition-colors cursor-pointer
                  ${isSelected ? 'bg-[var(--c-raised)]' : 'bg-gray-900 hover:bg-[var(--c-raised)]'}`}
              >
                {isSelected && <div className="absolute top-0 left-0 right-0 h-0.5 bg-cyan-500" />}
                <h3 className={`text-sm font-medium mb-1.5 ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                  {p.name}
                </h3>
                <p className={`text-sm leading-relaxed ${isSelected ? 'text-gray-400' : 'text-gray-500'}`}>{p.desc}</p>
              </button>
            )
          })}
        </div>

        {/* Magnetic configuration — DIII-D runs all three divertor shapes */}
        {deviceId === 'diiid' && (
          <div className="mb-10">
            <div className="panel-title pb-2 mb-px">Magnetic configuration</div>
            <div className="inline-grid grid-cols-3 gap-px bg-[var(--c-line)] border-y border-gray-800">
              {([
                ['LowerSingleNull', 'Lower single null'],
                ['DoubleNull', 'Double null'],
                ['UpperSingleNull', 'Upper single null'],
              ] as [MagneticConfig, string][]).map(([cfg, label]) => {
                const isSelected = (configOverride ?? 'LowerSingleNull') === cfg
                return (
                  <button
                    key={cfg}
                    type="button"
                    onClick={() => setConfigOverride(cfg === 'LowerSingleNull' ? null : cfg)}
                    className={`relative px-5 py-2 text-sm transition-colors cursor-pointer
                      ${isSelected ? 'bg-[var(--c-raised)] text-white' : 'bg-gray-900 text-gray-400 hover:bg-[var(--c-raised)]'}`}
                  >
                    {isSelected && <div className="absolute top-0 left-0 right-0 h-0.5 bg-cyan-500" />}
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Waveform detail */}
        {program && base && (
          <div className="mb-10">
            <div className="flex items-center justify-between gap-6 mb-2">
              <h2 className="panel-title">Programmed waveforms</h2>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">Select a channel to redraw it</span>
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  Duration
                  <input
                    type="number"
                    min={1}
                    max={durationMax}
                    step={0.5}
                    value={program.duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="font-mono tabular-nums text-sm w-16 bg-gray-900 border border-gray-700 px-1.5 py-0.5
                               text-gray-300 focus:outline-none focus:border-gray-500"
                  />
                  s
                </label>
                {/* Kept in the layout while hidden so the chart never shifts. */}
                <button
                  type="button"
                  onClick={resetAll}
                  aria-hidden={!modified}
                  tabIndex={modified ? 0 : -1}
                  className={`text-sm text-gray-500 hover:text-gray-300 transition-colors cursor-pointer
                    ${modified ? '' : 'invisible'}`}
                >
                  Reset to preset
                </button>
              </div>
            </div>

            <ProgramChart
              key={selected}
              program={program}
              overrides={overrides}
              onEdit={setEditing}
              onReset={resetChannel}
            />
          </div>
        )}

        {/* Run button */}
        <button
          onClick={handleRun}
          className="bg-cyan-600 px-8 py-3 text-base cursor-pointer"
        >
          ▶ {modified ? 'Run edited pulse' : 'Run pulse'}
        </button>
      </main>

      {/* Channel editor */}
      {editing && base && program && (() => {
        const baseWf = base[editing.waveformKey] as WaveformPoint[]
        if (!baseWf || baseWf.length < 2) return null
        const wf = program[editing.waveformKey] as WaveformPoint[]
        // The drawer works on the effective time axis. Overrides are stored on
        // the preset's axis, because buildProgram rescales every channel when
        // the duration is overridden — store the drawing pre-scaled so the
        // round trip returns exactly what was drawn.
        const timeScale =
          durationOverride !== null && base.duration > 0 ? durationOverride / base.duration : 1
        return (
          <WaveformDrawer
            waveform={wf}
            baseWaveform={baseWf}
            duration={program.duration}
            label={editing.label}
            unit={editing.unit}
            color="#e0a23a"
            min={editing.min}
            max={editing.max}
            onSave={(drawn) => {
              const stored: WaveformPoint[] =
                timeScale === 1 ? drawn : drawn.map(([t, v]) => [t / timeScale, v])
              setOverrides({ ...overrides, [editing.key]: stored })
              setEditing(null)
            }}
            onClose={() => setEditing(null)}
          />
        )
      })()}
    </div>
  )
}
