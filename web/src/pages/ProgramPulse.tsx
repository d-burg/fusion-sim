import { useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  getDevice,
  getDevices,
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
  paramRange,
  channelAvailable,
} from '../lib/program'
import WaveformDrawer from '../components/WaveformDrawer'
import { useSettings, LOOKS } from '../lib/settingsContext'
import { StandardNav } from './DeviceSelect'
import './standard.css'

// ── Scenarios: a word each, with a few tracked-caps words as the caption ──
type Scenario = { id: PresetId; name: string; cap: ReactNode }
const G = ({ children }: { children: ReactNode }) => <span className="sp-g">{children}</span>

const ALL_PRESETS: Scenario[] = [
  { id: 'hmode', name: 'H-MODE', cap: 'NBI . L–H . FLAT-TOP' },
  { id: 'lmode', name: 'L-MODE', cap: 'OHMIC . LOW NBI' },
  { id: 'density_limit', name: 'N-LIMIT', cap: 'PAST GREENWALD' },
]

// CENTAUR uses negative-triangularity edge mode, not conventional H/L-mode
const CENTAUR_PRESETS: Scenario[] = [
  { id: 'hmode', name: 'NT-EDGE', cap: <>NEG. <G>δ</G> . ELM-FREE</> },
  { id: 'density_limit', name: 'N-LIMIT', cap: 'PAST GREENWALD' },
]

function getPresets(deviceId: string) {
  return deviceId === 'centaur' ? CENTAUR_PRESETS : ALL_PRESETS
}

const CONFIGS: [MagneticConfig, string, string][] = [
  ['LowerSingleNull', 'LOWER SINGLE NULL', 'LSN'],
  ['DoubleNull', 'DOUBLE NULL', 'DN'],
  ['UpperSingleNull', 'UPPER SINGLE NULL', 'USN'],
]

// ── Programmed-waveform strip chart ──────────────────────────────
// A stack of time-aligned strips on one shared time axis, as the control
// room's strips: one hairline frame, hairline separators, the label inside
// top-left and the value top-right, white lines with dot markers at the
// breakpoints (they are the data), a faint grid at the phase boundaries,
// and the phases as station words under the time axis.

type Channel = {
  key: string
  label: ReactNode
  unit: string
  title: string
  points: WaveformPoint[]
  /** Set when the channel can be redrawn; absent channels are display-only. */
  param?: ScalarParam
}

type Station = { label: string; t: number }

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
const STRIP_H = 60 // about the row height at 1440 x 900, so the top pad clears the label
const PAD_TOP = 15
const PAD_BOT = 5

function Strip({
  ch,
  duration,
  phases,
  edited,
  onEdit,
  onReset,
}: {
  ch: Channel
  duration: number
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
  const toX = (t: number) => (t / duration) * VB_W
  const toY = (v: number) => PAD_TOP + (STRIP_H - PAD_TOP - PAD_BOT) * (1 - (v - lo) / range)
  const d = ch.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p[0]).toFixed(1)} ${toY(p[1]).toFixed(2)}`)
    .join(' ')
  const line = edited ? 'var(--sp-warm)' : 'rgba(255,255,255,0.85)'

  return (
    <div className="sp-strip" data-editable={!!onEdit} data-edited={edited} data-off={!programmed}>
      <svg viewBox={`0 0 ${VB_W} ${STRIP_H}`} preserveAspectRatio="none" className="sp-strip-svg" aria-hidden="true">
        {/* The grid: the phase boundaries and the zero baseline only */}
        {phases && [phases.start, phases.end].map((t) => (
          <line key={`ph-${t}`} x1={toX(t)} x2={toX(t)} y1={0} y2={STRIP_H} stroke="rgba(255,255,255,0.14)" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={0} x2={VB_W} y1={toY(0)} y2={toY(0)} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" />
        {programmed && (
          <>
            <path d={d} fill="none" stroke={line} strokeWidth={1} strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
            {/* Breakpoints: zero-length round-capped dashes stay circular
                under the non-uniform scaling, unlike <circle>. */}
            {ch.points.map((p, i) => (
              <path
                key={i}
                d={`M ${toX(p[0]).toFixed(1)} ${toY(p[1]).toFixed(2)} h 0.001`}
                stroke={edited ? 'var(--sp-warm)' : '#fff'}
                strokeWidth={3.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        )}
      </svg>
      {/* The whole strip opens the editor; the word at the right is the visible affordance. */}
      {onEdit && <button type="button" className="sp-strip-hit" onClick={onEdit} aria-label={`Edit ${ch.title}`} />}
      <div className="sp-strip-label" title={ch.unit ? `${ch.title} (${ch.unit})` : ch.title}>{ch.label}</div>
      <div className="sp-strip-right">
        <span className="sp-strip-v">
          {programmed ? <>{extremum.toFixed(Math.abs(extremum) >= 10 ? 1 : 2)}{ch.unit ? <> <G>{ch.unit}</G></> : ''}</> : '—'}
        </span>
        {onEdit && !edited && (
          <button type="button" className="sp-edit" onClick={onEdit} aria-label={`Edit ${ch.title}`}>EDIT</button>
        )}
        {edited && <span className="sp-edited">EDITED</span>}
        {edited && onReset && (
          <button
            type="button"
            className="sp-edit"
            onClick={(e) => { e.stopPropagation(); onReset() }}
            aria-label={`Reset ${ch.title} to preset`}
          >
            RESET
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
  deviceId,
}: {
  program: PulseProgram
  overrides: Record<string, OverrideValue>
  onEdit: (param: ScalarParam) => void
  onReset: (key: string) => void,
  deviceId?: string
}) {
  const duration = program.duration
  const phases = flatTop(program.ip)
  const pct = (t: number) => `${((t / duration) * 100).toFixed(2)}%`

  const stations: Station[] = [{ label: 'RAMP-UP', t: 0 }]
  if (phases) {
    stations.push({ label: 'FLAT-TOP', t: phases.start })
    if (phases.end < duration) stations.push({ label: 'RAMP-DOWN', t: phases.end })
  }
  stations.push({ label: 'END', t: duration })
  const anchor = (i: number) => (i === 0 ? 'start' : i === stations.length - 1 ? 'end' : 'mid')

  const param = (key: string) => SCALAR_PARAMS.find((p) => p.key === key)

  const allChannels: Channel[] = [
    { key: 'ip', label: <>I<sub>p</sub></>, unit: 'MA', title: 'Plasma current', points: program.ip, param: param('ip') },
    { key: 'bt', label: <>B<sub>T</sub></>, unit: 'T', title: 'Toroidal magnetic field', points: program.bt },
    { key: 'ne', label: <><G>n̄</G><sub>e</sub></>, unit: '10²⁰ m⁻³', title: 'Line-averaged electron density', points: program.ne_target, param: param('ne') },
    { key: 'nbi', label: <>P<sub>NBI</sub></>, unit: 'MW', title: 'Neutral beam injection power', points: program.p_nbi, param: param('p_nbi') },
    { key: 'ech', label: <>P<sub>ECH</sub></>, unit: 'MW', title: 'Electron cyclotron heating power', points: program.p_ech, param: param('p_ech') },
    { key: 'ich', label: <>P<sub>ICH</sub></>, unit: 'MW', title: 'Ion cyclotron heating power', points: program.p_ich },
    { key: 'd2_puff', label: <><G>Γ</G> D<sub>2</sub></>, unit: '10²⁰/s', title: 'Deuterium gas puff rate', points: program.d2_puff ?? [], param: param('d2_puff') },
    { key: 'n2_puff', label: <><G>Γ</G> N</>, unit: '10²⁰ atoms/s', title: 'Nitrogen seeding rate', points: program.n2_puff ?? [], param: param('n2_puff') },
    { key: 'neon_puff', label: <G>Γ Ne</G>, unit: '10²⁰ atoms/s', title: 'Neon seeding rate', points: program.neon_puff ?? [], param: param('neon_puff') },
    { key: 'argon_puff', label: <G>Γ Ar</G>, unit: '10²⁰ atoms/s', title: 'Argon seeding rate', points: program.argon_puff ?? [], param: param('argon_puff') },
    { key: 'kappa', label: <G>κ</G>, unit: '', title: 'Elongation', points: program.kappa, param: param('kappa') },
    { key: 'delta', label: <G>δ</G>, unit: '', title: 'Triangularity', points: program.delta, param: param('delta') },
  ]
  // Seeding strips only for the gas lines this machine has.
  const channels = allChannels.filter((c) => channelAvailable(c.key, deviceId))

  return (
    <div className="sp-chart">
      {/* Equal-height rows that fill whatever height the page gives the chart;
          the SVGs stretch with them (non-uniform scaling, non-scaling strokes).
          Below 1.75rem per row the chart scrolls rather than crushing. */}
      <div className="sp-rows">
        {channels.map((ch) => {
          const p = ch.param
          const ov = p ? overrides[p.key] : undefined
          return (
            <Strip
              key={ch.key}
              ch={ch}
              duration={duration}
              phases={phases}
              edited={ov !== undefined && ov !== null}
              onEdit={p ? () => onEdit(p) : undefined}
              onReset={p ? () => onReset(p.key) : undefined}
            />
          )
        })}
      </div>

      {/* Shared time axis: the station times, then the line with its stations */}
      <div className="sp-axis">
        {stations.map((s, i) => (
          <span key={s.label} className="sp-axis-t" data-anchor={anchor(i)} style={{ left: pct(s.t) }}>
            {s.t.toFixed(2)}{i === stations.length - 1 ? <G> s</G> : ''}
          </span>
        ))}
      </div>
      <div className="sp-stations">
        <div className="sp-stations-line" aria-hidden="true" />
        {stations.map((s, i) => (
          <div key={s.label} className="sp-station" data-anchor={anchor(i)} style={{ left: pct(s.t) }}>
            <div className="sp-station-tick" aria-hidden="true" />
            <div className="sp-station-label">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Setup column pieces ──────────────────────────────────────────
function Section({ n, title, children }: { n: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="sp-sec">
      <div className="sp-head"><span className="sp-num">{n}</span> . {title}</div>
      {children}
    </div>
  )
}

/** One list row: the word, a white square when active, a tiny caption at right. */
function Row({ on, onClick, word, cap }: { on: boolean; onClick: () => void; word: ReactNode; cap?: ReactNode }) {
  return (
    <button type="button" className="sp-row" data-on={on} onClick={onClick} aria-pressed={on}>
      <span className="sp-row-word">{word}</span>
      {cap && <span className="sp-row-cap">{cap}</span>}
    </button>
  )
}

// ── Main page ────────────────────────────────────────────────────
export default function ProgramPulse() {
  const { deviceId } = useParams<{ deviceId: string }>()
  // Keyed on the device so switching machines from the nav starts a fresh setup.
  return <ProgramPage key={deviceId ?? ''} deviceId={deviceId} />
}

function ProgramPage({ deviceId }: { deviceId: string | undefined }) {
  const navigate = useNavigate()

  const device = useMemo(() => (deviceId ? getDevice(deviceId) : null), [deviceId])
  const devices = useMemo(() => getDevices(), [])
  const [selected, setSelected] = useState<PresetId>('hmode')

  // Edits layered over the preset. An override is either a scalar flat-top
  // value or a redrawn waveform; the programme handed to the simulator is
  // rebuilt from the preset every render, so nothing is ever edited in place.
  const [overrides, setOverrides] = useState<Record<string, OverrideValue>>({})
  const [durationOverride, setDurationOverride] = useState<number | null>(null)
  const { look, setLook } = useSettings()
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

  const deviceLinks = (
    <span className="sp-group">
      {devices.map((d) => (
        <Link key={d.id} to={`/program/${d.id}`} className="sp-link" data-on={d.id === deviceId}>{d.name}</Link>
      ))}
    </span>
  )

  if (!device) {
    return (
      <div data-page="program" className="page-enter min-h-screen flex flex-col">
        <StandardNav left={deviceLinks} />
        <div className="sp-head" style={{ padding: '40px 64px' }}>UNKNOWN DEVICE . {deviceId}</div>
      </div>
    )
  }

  // Numbered captions run down the setup column and on to the chart.
  const hasConfig = deviceId === 'diiid'
  const N = { scenario: '01', config: '02', look: hasConfig ? '03' : '02', duration: hasConfig ? '04' : '03', chart: hasConfig ? '05' : '04' }
  const scenario = getPresets(deviceId ?? '').find((p) => p.id === selected)

  return (
    <div data-page="program" className="page-enter min-h-screen md:tall:h-screen flex flex-col md:tall:overflow-hidden pb-20 md:tall:pb-0">
      <StandardNav left={deviceLinks} />

      {/* Two columns from md up. The no-scroll, fills-the-viewport version needs
          height too (the `tall` variant): a landscape phone is md-wide but only
          ~390px tall, and there the page scrolls with Run fixed to the foot. */}
      <main className="sp-main flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[23rem_1fr] gap-px">
        <aside className="sp-aside min-h-0 md:tall:overflow-y-auto flex flex-col">
          <div className="sp-title">
            <div className="sp-title-cap">DEVICE</div>
            <h1 className="sp-h1">{device.name} <span className="sp-h1-dot">.</span> PROGRAM</h1>
          </div>

          <Section n={N.scenario} title="SCENARIO">
            <div className="sp-list">
              {getPresets(deviceId ?? '').map((p) => (
                <Row key={p.id} on={p.id === selected} onClick={() => selectScenario(p.id)} word={p.name} cap={p.cap} />
              ))}
            </div>
          </Section>

          {/* Magnetic configuration: DIII-D runs all three divertor shapes */}
          {hasConfig && (
            <Section n={N.config} title="MAGNETIC CONFIGURATION">
              <div className="sp-list">
                {CONFIGS.map(([cfg, word, cap]) => (
                  <Row
                    key={cfg}
                    on={(configOverride ?? 'LowerSingleNull') === cfg}
                    onClick={() => setConfigOverride(cfg === 'LowerSingleNull' ? null : cfg)}
                    word={word}
                    cap={cap}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Control-room look: which composition /run renders; remembered in settings */}
          <Section n={N.look} title="CONTROL ROOM LOOK">
            <div className="sp-list">
              {LOOKS.map((l) => (
                <Row key={l.id} on={look === l.id} onClick={() => setLook(l.id)} word={l.label} />
              ))}
            </div>
          </Section>

          {program && (
            <Section n={N.duration} title="DURATION">
              <div className="sp-dur">
                <label className="sp-ro">
                  <span className="sp-dur-v">
                    <input
                      type="number"
                      min={1}
                      max={durationMax}
                      step={0.5}
                      value={program.duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="sp-dur-in"
                      aria-label="Pulse duration in seconds"
                    />
                    <span className="sp-ro-u sp-g">s</span>
                  </span>
                  <span className="sp-ro-c"><G>t</G><sub>end</sub> . MAX {durationMax} <G>s</G></span>
                </label>
                {/* Kept in the layout while hidden so nothing shifts. */}
                <button
                  type="button"
                  onClick={resetAll}
                  aria-hidden={!modified}
                  tabIndex={modified ? 0 : -1}
                  className={`sp-link sp-dotted${modified ? '' : ' sp-hidden'}`}
                >
                  RESET
                </button>
              </div>
            </Section>
          )}

          {/* Run: always on screen. When the viewport is both md-wide and tall it
              is pinned to the foot of this column; otherwise (phones in either
              orientation) it sits in an opaque bar fixed to the foot of the viewport. */}
          <div className="sp-runbar fixed bottom-0 inset-x-0 z-40 p-3 md:tall:static md:tall:z-auto md:tall:p-0 md:tall:mt-auto">
            <button type="button" className="sp-run" onClick={handleRun}>
              <span className="sp-run-circle" aria-hidden="true"><span className="sp-run-glyph" /></span>
              <span className="sp-run-word">RUN{modified && <> . <em>EDITED</em></>}</span>
            </button>
          </div>
        </aside>

        <section className="sp-chart-col min-h-0 flex flex-col">
          {program && base && (
            <>
              <div className="sp-chart-head">
                <div className="sp-head"><span className="sp-num">{N.chart}</span> . PROGRAMMED WAVEFORMS</div>
                <div className="sp-head-r">{device.name} . {scenario?.name} . {program.duration.toFixed(1)} <G>s</G></div>
              </div>
              <div className="h-[30rem] md:tall:h-auto md:tall:flex-1 min-h-0">
                <ProgramChart deviceId={deviceId}
                  key={selected}
                  program={program}
                  overrides={overrides}
                  onEdit={setEditing}
                  onReset={resetChannel}
                />
              </div>
            </>
          )}
        </section>
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
            min={paramRange(editing, device).min}
            max={paramRange(editing, device).max}
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
