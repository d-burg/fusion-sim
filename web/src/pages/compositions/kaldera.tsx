import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ControlRoomContext } from './types'
import type { Snapshot, TracePoint } from '../../lib/types'
import PortView from '../../components/portview'
import Hero from './kaldera/Hero'
import Strips, { type Pts, type Strip } from './kaldera/Strips'
import Timeline, { type Station } from './kaldera/Timeline'
import { flatTopWindow, parseProgram, pulsePhase, type Waveform } from './kaldera/phase'
import { reconstructionValid } from '../../lib/pulseLog'
import { equilibriumInfo, plasmaParamsInfo, powerBalanceInfo, stabilityInfo, traceDescriptions } from '../../components/infoContent'
import InfoHint from './kaldera/InfoHint'
import Diagnostics, { type Tone } from './kaldera/Diagnostics'
import { createDisplayClock, type DisplayClock } from './kaldera/displayClock'
import './kaldera.css'

const f2 = (v: number | undefined) => (v !== undefined && isFinite(v) ? v.toFixed(2) : '—')
const f1 = (v: number | undefined) => (v !== undefined && isFinite(v) ? v.toFixed(1) : '—')

/** Scenario names as abbreviations, never phrases. */
const PRESET_WORD: Record<string, string> = { hmode: 'H-MODE', lmode: 'L-MODE', density_limit: 'N-LIMIT' }

/** Sum of several programmed waveforms, sampled on the union of their knots. */
function sumWaveforms(ws: (Waveform | undefined)[]): Waveform | undefined {
  const live = ws.filter((w): w is Waveform => !!w && w.length > 0)
  if (live.length === 0) return undefined
  const at = (w: Waveform, t: number) => {
    if (t <= w[0][0]) return w[0][1]
    if (t >= w[w.length - 1][0]) return w[w.length - 1][1]
    for (let i = 1; i < w.length; i++) if (t <= w[i][0]) { const [t0, v0] = w[i - 1], [t1, v1] = w[i]; return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0) }
    return w[w.length - 1][1]
  }
  const ts = Array.from(new Set(live.flatMap((w) => w.map((p) => p[0])))).sort((a, b) => a - b)
  return ts.map((t) => [t, live.reduce((acc, w) => acc + at(w, t), 0)])
}

interface ReadoutProps {
  value: string
  unit?: string
  caption: ReactNode
  hint?: { title: string; content: ReactNode }
  /** Warning / danger band of the value (the caption never tints). */
  tone?: Tone
  /** Hover link to a strip: lit when the strip is hot, lights the strip when hovered. */
  link?: string
  hot?: boolean
  onHot?: (id: string | null) => void
}

/** VALUE over a tiny caption, with air around it; the caption may carry a hint. */
function Readout({ value, unit, caption, hint, tone, link, hot, onHot }: ReadoutProps) {
  return (
    <div
      className="kd-ro"
      data-hot={!!link && !!hot}
      onMouseEnter={link && onHot ? () => onHot(link) : undefined}
      onMouseLeave={link && onHot ? () => onHot(null) : undefined}
    >
      <div className="kd-ro-v" data-tone={tone}>{value}{unit && value !== '—' ? <span className="kd-ro-u"> {unit}</span> : null}</div>
      <div className="kd-ro-c">{hint ? <InfoHint title={hint.title} content={hint.content}>{caption}</InfoHint> : caption}</div>
    </div>
  )
}

/** EMA with a ~300 ms time constant at 60 fps, so a band tint does not flicker on ELMs. */
function useEma(raw: number | undefined, alpha = 0.05): number | undefined {
  const ref = useRef<number | null>(null)
  if (raw === undefined || !isFinite(raw)) { ref.current = null; return undefined }
  ref.current = ref.current === null ? raw : ref.current + alpha * (raw - ref.current)
  return ref.current
}

/**
 * Presentation-side smoothing of the pulse time. The simulation hands over
 * time in 15 ms sub-steps batched unevenly per render (measured: 0.030 s hops
 * after 11–68 ms of wall clock), so the playhead moved in bursts. Between
 * received values the displayed time is extrapolated at the pulse speed from
 * the last (wallTime, simTime) pair in a requestAnimationFrame loop, capped at
 * one observed step ahead and stepping back by at most one step if it ran
 * ahead. The value lives in a DisplayClock outside React's render path, so the
 * subscribers (playhead, hairline, time text, strip cursor) move every painted
 * frame. Exact while paused, scrubbing or finished.
 */
function useDisplayClock(time: number, exact: number, live: boolean, speed: number): DisplayClock {
  const clock = useRef<DisplayClock | null>(null)
  if (!clock.current) clock.current = createDisplayClock(exact)
  const last = useRef({ wall: 0, sim: time, step: 0.03 })
  if (time !== last.current.sim) {
    const d = time - last.current.sim
    if (d > 0 && d < 0.5) last.current.step = Math.min(0.1, Math.max(0.015, d))
    last.current = { wall: performance.now(), sim: time, step: last.current.step }
  }
  useEffect(() => { if (!live) clock.current?.set(exact) }, [live, exact])
  useEffect(() => {
    if (!live) return
    const c = clock.current
    if (!c) return
    let raf = 0
    const tick = () => {
      const { wall, sim, step } = last.current
      const target = Math.min(sim + ((performance.now() - wall) / 1000) * speed, sim + step)
      c.set(Math.max(target, Math.min(c.get(), sim + step)))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live, speed])
  return clock.current
}

/** Band of a smoothed value: amber past `warn`, red past `bad`; `below` flips the sense (q95). */
function band(v: number | undefined, warn: number, bad: number, below = false): Tone {
  if (v === undefined) return undefined
  if (below) return v < bad ? 'bad' : v < warn ? 'warn' : undefined
  return v > bad ? 'bad' : v > warn ? 'warn' : undefined
}

/** Greek glyphs escape the page-wide uppercase transform (β would become B). */
const G = ({ children }: { children: ReactNode }) => <span className="kd-g">{children}</span>

const STAB = { title: 'Stability', content: stabilityInfo }
const POWER = { title: 'Power balance', content: powerBalanceInfo }

/** Configuration word from the engine's enum name. */
function configWord(s: Snapshot | null): string {
  if (!s) return '—'
  if (s.is_limited) return 'LIMITED'
  const c = s.magnetic_config || ''
  if (/upper/i.test(c)) return 'USN'
  if (/double/i.test(c)) return 'DN'
  if (/lower/i.test(c)) return 'LSN'
  if (/limit/i.test(c)) return 'LIMITED'
  return c.toUpperCase() || '—'
}

/** A text link in tracked caps; the active one is a white filled square. */
function Link({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return <button className="kd-link" data-on={on} onClick={onClick}>{children}</button>
}

export default function Composition({ ctx }: { ctx: ControlRoomContext }) {
  const { displaySnapshot: s, history, running, finished, scrubTime, time, duration, programJson } = ctx

  // The blue-black field for whatever shared chrome is mounted here (planner drawer, settings).
  useEffect(() => {
    const el = document.documentElement
    const prev = el.getAttribute('data-theme')
    el.setAttribute('data-theme', 'kaldera')
    return () => { if (prev === null) el.removeAttribute('data-theme'); else el.setAttribute('data-theme', prev) }
  }, [])

  const program = useMemo(() => parseProgram(programJson), [programJson])
  const win = useMemo(() => flatTopWindow(program.ip), [program])
  const pinRef = useMemo(() => sumWaveforms([program.p_nbi, program.p_ech, program.p_ich]), [program])
  const T = duration > 0 ? duration : 10

  const phase = pulsePhase(win, time, running, finished, s, scrubTime !== null)
  const pulseNo = ctx.pulseNumber === null ? '— — — —' : String(ctx.pulseNumber).padStart(4, '0')

  // ELMs are transient: hold the word for the last 0.3 s of history.
  let elming = false
  for (let i = history.length - 1; i >= 0 && history[i].t > time - 0.3; i--) if (history[i].elm_active) { elming = true; break }
  const valid = reconstructionValid(s)
  const clock = useDisplayClock(time, scrubTime ?? time, running && !finished && scrubTime === null, ctx.activeSpeed)
  const [hot, setHot] = useState<string | null>(null)
  const ro = (link: string) => ({ link, hot: hot === link, onHot: setHot })
  // threshold bands on smoothed values, only while the reconstruction is valid
  const betaS = useEma(valid ? s?.beta_n : undefined)
  const q95S = useEma(valid ? s?.q95 : undefined)
  const fgwS = useEma(valid ? s?.f_greenwald : undefined)
  const stateWord = s?.disrupted ? 'DISRUPTED' : elming ? 'ELMING' : s?.in_hmode ? 'H-MODE' : valid ? 'L-MODE' : finished && scrubTime === null ? 'COMPLETE' : 'STANDBY'
  // Reconstructed quantities mean nothing without a plasma: blank them rather than show the engine's fill values.
  const rv = (v: number | undefined) => (valid ? v : undefined)

  const stations: Station[] = useMemo(() => {
    const st: Station[] = [{ label: 'RAMP-UP', t: 0 }]
    if (win) { st.push({ label: 'FLAT-TOP', t: win[0] }); if (win[1] < T) st.push({ label: 'RAMP-DOWN', t: win[1] }) }
    st.push({ label: 'END', t: T })
    return st
  }, [win, T])

  const pick = (k: keyof TracePoint): Pts => history.map((p) => [p.t, Number(p[k])] as [number, number])
  const strips: Strip[] = useMemo(() => [
    { id: 'ip', label: 'IP', hint: traceDescriptions.ip, unit: 'MA', pts: pick('ip'), ref: program.ip },
    { id: 'ne', label: 'N̄E', hint: traceDescriptions.ne_bar, pts: pick('ne_bar'), ref: program.ne_target, second: { label: 'F GW', hint: traceDescriptions.f_greenwald, pts: pick('f_greenwald'), own: true }, blank: !valid },
    { id: 'wth', label: 'W TH', hint: traceDescriptions.w_th, unit: 'MJ', pts: pick('w_th') },
    { id: 'pin', label: 'P IN', hint: traceDescriptions.p_input, unit: 'MW', pts: pick('p_input'), ref: pinRef, second: { label: 'P RAD', hint: traceDescriptions.p_rad, pts: pick('p_rad') }, digits: 1 },
    { id: 'da', label: 'D α', node: <>D <G>α</G></>, hint: traceDescriptions.d_alpha, pts: pick('d_alpha'), elm: history.map((p) => !!p.elm_active) },
  // history is mutated in place by the simulation hook; key on its length and last time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [history, history.length, history.length ? history[history.length - 1].t : 0, program, pinRef, valid])

  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const lastEvent = ctx.events.length ? ctx.events[ctx.events.length - 1] : null
  const speeds = [0.5, 0.75, 1, 2]

  return (
    <div data-layout="kaldera" className="kd-root">
      <nav className="kd-nav">
        <div className="kd-nav-l">
          <span className="kd-brand">CONTROL ROOM</span>
          <span className="kd-group">
            {ctx.devices.map((d) => <Link key={d.id} on={d.id === ctx.activeDevice} onClick={() => ctx.onDeviceChange(d.id)}>{d.name}</Link>)}
          </span>
        </div>
        <div className="kd-nav-c">
          <span className="kd-cap">SPEED</span>
          <span className="kd-group">
            {speeds.map((sp, i) => (
              <span key={sp} className="kd-group-item">
                {i > 0 && <span className="kd-dot">.</span>}
                <Link on={ctx.activeSpeed === sp} onClick={() => ctx.onSpeedChange(sp)}>{sp === 1 ? '1' : sp === 2 ? '2' : sp.toFixed(2).replace(/0$/, '')}</Link>
              </span>
            ))}
          </span>
        </div>
        <div className="kd-nav-r">
          <span className="kd-group">
            {ctx.presets.map((p) => <Link key={p.id} on={p.id === ctx.activePreset} onClick={() => ctx.onPresetChange(p.id)}>{PRESET_WORD[p.id] ?? p.label}</Link>)}
          </span>
          {ctx.showsFuelToggle && (
            <span className="kd-group kd-group-tight">
              {(['DD', 'DT'] as const).map((f) => <Link key={f} on={ctx.fuelType === f} onClick={() => ctx.onFuelChange(f)}>{f}</Link>)}
            </span>
          )}
          <span className="kd-group">
            <Link on={ctx.showPlanner} onClick={ctx.togglePlanner}>EDIT{ctx.hasCustomProgram ? ' *' : ''}</Link>
            <Link onClick={ctx.controls.reset}>RESET</Link>
          </span>
          <span className="kd-settings">{ctx.settingsNode}</span>
        </div>
      </nav>

      <main className="kd-main">
        <div className="kd-rule kd-rule-1" aria-hidden="true" />
        <div className="kd-rule kd-rule-2" aria-hidden="true" />
        <div className="kd-col-l">
          <div className="kd-head"><span className="kd-num">01</span> . <InfoHint title="Plasma parameters" content={plasmaParamsInfo}>PLASMA</InfoHint></div>
          <div className="kd-scalars">
            <Readout value={f2(s?.ip)} unit="MA" caption={<>I<sub>P</sub></>} {...ro('ip')} />
            <Readout value={f2(s?.ne_bar)} unit="10²⁰ M⁻³" caption={<>N̄<sub>E</sub></>} {...ro('ne')} />
            <Readout value={f2(s?.w_th)} unit="MJ" caption={<>W<sub>TH</sub></>} {...ro('wth')} />
            <Readout value={f2(rv(s?.beta_n))} caption={<><G>β</G><sub>N</sub></>} hint={STAB} tone={band(betaS, 2.5, 2.8)} />
            <Readout value={f2(rv(s?.q95))} caption={<>Q<sub>95</sub></>} hint={STAB} tone={band(q95S, 2.5, 2.0, true)} />
            <Readout value={f2(rv(s?.f_greenwald))} caption={<>F<sub>GW</sub></>} hint={STAB} tone={band(fgwS, 0.8, 0.9)} {...ro('ne')} />
            <Readout value={f1(s?.p_input)} unit="MW" caption={<>P<sub>IN</sub></>} hint={POWER} {...ro('pin')} />
            <Readout value={f1(s?.p_rad)} unit="MW" caption={<>P<sub>RAD</sub></>} hint={POWER} {...ro('pin')} />
            <Readout value={f2(rv(s?.te0))} unit="KEV" caption={<>T<sub>E0</sub></>} />
            <Readout value={f2(rv(s?.tau_e))} unit="S" caption={<><G>τ</G><sub>E</sub></>} />
            <Readout value={f2(rv(s?.h_factor))} caption={<>H<sub>98</sub></>} />
            <Readout value={f2(s?.v_loop)} unit="V" caption={<>V<sub>LOOP</sub></>} />
          </div>
          <Diagnostics snapshot={s} valid={valid} />
          <div className="kd-title">
            <div className="kd-title-cap">PULSE</div>
            <h1 className="kd-h1">{pulseNo} <span className="kd-h1-dot">.</span> <span className="kd-phase" data-tone={phase === 'DISRUPT' ? 'bad' : undefined}>{phase}</span></h1>
            <div className="kd-state" data-state={stateWord}>
              {stateWord}
              {s?.oh_saturated && <span className="kd-flag">OH SAT</span>}
              {s?.flux_exhausted && <span className="kd-flag">FLUX</span>}
            </div>
          </div>
        </div>

        <div className="kd-eq">
          <div className="kd-eq-cap">
            <div className="kd-head"><span className="kd-num">02</span> . <InfoHint title="Equilibrium" content={equilibriumInfo}>EQUILIBRIUM . R–Z</InfoHint></div>
            <span className="kd-eq-sub">{configWord(s)}  .  B<sub>T</sub> {f2(s?.bt)} T</span>
          </div>
          <Hero snapshot={s} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
        </div>

        <div className="kd-col-r">
          <div className="kd-head kd-port-cap"><span className="kd-num">03</span> . PORT VIEW</div>
          <div className="kd-port">
            <PortView
              snapshot={ctx.plasmaSnapshot}
              limiterPoints={ctx.limiterPoints}
              deviceId={ctx.activeDevice}
              wallJson={ctx.wallJson}
              deviceR0={dev?.r0}
              deviceA={dev?.a}
            />
          </div>
        </div>
      </main>

      <Strips
        strips={strips}
        stations={stations}
        duration={T}
        clock={clock}
        scrubTime={scrubTime}
        onScrub={finished ? ctx.controls.setScrubTime : undefined}
        hot={hot}
        onHot={setHot}
      />

      <Timeline
        stations={stations}
        duration={T}
        clock={clock}
        scrubTime={scrubTime}
        running={running}
        finished={finished}
        onStart={ctx.controls.start}
        onPause={ctx.controls.pause}
        onReset={ctx.controls.reset}
        onScrub={ctx.controls.setScrubTime}
      />

      <footer className="kd-foot">
        <span className="kd-event" data-sev={lastEvent?.severity ?? 'info'}>
          {lastEvent ? `${lastEvent.t.toFixed(3)} S . ${lastEvent.text}` : ''}
        </span>
        <span className="kd-foot-r">{T.toFixed(1)} S</span>
      </footer>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
