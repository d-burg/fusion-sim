import { useEffect, useMemo, useState } from 'react'
import type { ControlRoomContext } from './types'
import type { TracePoint } from '../../lib/types'
import PortView from '../../components/portview'
import Hero from './kaldera/Hero'
import Strips, { type Pts, type Strip } from './kaldera/Strips'
import Timeline, { type Station } from './kaldera/Timeline'
import { flatTopWindow, parseProgram, pulsePhase } from './kaldera/phase'
import { reconstructionValid } from '../../lib/pulseLog'
import { equilibriumInfo, plasmaParamsInfo, traceDescriptions } from '../../components/infoContent'
import InfoHint from './kaldera/InfoHint'
import Diagnostics from './kaldera/Diagnostics'
import { f1, f2, PRESET_WORD, sumWaveforms, Readout, useEma, useDisplayClock, band, G, ReportPanel, STAB, POWER, configWord, Link } from './kaldera/shared'
import { betaLimit, BETA_WARN_FRAC, elmRecent, fmtHazard, HAZARD_BAD, HAZARD_WARN } from './useDiagnostics'
import { FIT, Fx, q95Disp } from './Fixed'
import { CONFIG_WORDS, STATE_WORDS } from './kaldera/words'
import { usePhone } from './usePhone'
import Phone from './kaldera/Phone'
import './kaldera.css'

export default function Composition({ ctx }: { ctx: ControlRoomContext }) {
  const { displaySnapshot: s, history, running, finished, scrubTime, time, duration, programJson } = ctx
  // Readout slot widths: large machines (JET, ITER) carry two-digit MA and three-digit MJ.
  const big = (ctx.devices.find((d) => d.id === ctx.activeDevice)?.r0 ?? 0) > 2.5
  const phone = usePhone()

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
  const elming = elmRecent(history, time)
  const valid = reconstructionValid(s)
  const clock = useDisplayClock(time, scrubTime ?? time, running && !finished && scrubTime === null, ctx.activeSpeed)
  const [hot, setHot] = useState<string | null>(null)
  const ro = (link: string) => ({ link, hot: hot === link, onHot: setHot })
  // threshold bands on smoothed values, only while the reconstruction is valid
  const betaS = useEma(valid ? s?.beta_n : undefined)
  const q95S = useEma(valid ? s?.q95 : undefined)
  const fgwS = useEma(valid ? s?.f_greenwald : undefined)
  const hazS = useEma(valid ? (s?.disruption_risk ?? 0) * 100 : undefined)
  // βN is banded against the no-wall limit 4·l_i, as in the log and the other looks
  const betaLim = betaLimit(s)
  const betaTone = band(betaS, BETA_WARN_FRAC * betaLim, betaLim)
  const hazTone = band(hazS, HAZARD_WARN, HAZARD_BAD)
  // The report opens with each finished pulse; CLOSE hides it until the next one (or REPORT re-opens it).
  const [reportClosed, setReportClosed] = useState(false)
  const [wasFinished, setWasFinished] = useState(finished)
  if (finished !== wasFinished) { setWasFinished(finished); setReportClosed(false) }
  const showReport = finished && !!ctx.report && ctx.report.length > 0 && !reportClosed
  const stateWord = s?.disrupted ? 'DISRUPTED' : s?.in_hmode ? 'H-MODE' : valid ? 'L-MODE' : finished && scrubTime === null ? 'END' : 'STANDBY'
  // ELMING rides beside H-MODE, never in its place
  const elmWord = stateWord === 'H-MODE' && elming
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
    { id: 'ip', label: 'IP', node: <>I<sub>p</sub></>, hint: traceDescriptions.ip, unit: 'MA', pts: pick('ip'), ref: program.ip },
    { id: 'ne', label: 'N̄E', node: <><G>n̄</G><sub>e</sub></>, hint: traceDescriptions.ne_bar, pts: pick('ne_bar'), ref: program.ne_target, second: { label: 'F GW', node: <><G>f</G><sub>GW</sub></>, hint: traceDescriptions.f_greenwald, pts: pick('f_greenwald'), own: true }, blank: !valid },
    { id: 'wth', label: 'W TH', node: <>W<sub>th</sub></>, hint: traceDescriptions.w_th, unit: 'MJ', pts: pick('w_th') },
    { id: 'pin', label: 'P IN', node: <>P<sub>in</sub></>, hint: traceDescriptions.p_input, unit: 'MW', pts: pick('p_input'), ref: pinRef, second: { label: 'P RAD', node: <>P<sub>rad</sub></>, hint: traceDescriptions.p_rad, pts: pick('p_rad') }, digits: 1 },
    { id: 'da', label: 'D α', node: <>D <G>α</G></>, hint: traceDescriptions.d_alpha, pts: pick('d_alpha'), elm: history.map((p) => !!p.elm_active) },
  // history is mutated in place by the simulation hook; key on its length and last time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [history, history.length, history.length ? history[history.length - 1].t : 0, program, pinRef, valid])

  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const lastEvent = ctx.events.length ? ctx.events[ctx.events.length - 1] : null
  const speeds = [0.5, 0.75, 1, 2]

  if (phone) {
    return (
      <Phone
        ctx={ctx}
        view={{
          valid, clock, phase, pulseNo, stateWord, elming: elmWord, stations, T, program, pinRef, speeds,
          tones: { beta: betaTone, q95: band(q95S, 2.5, 2.0, true), fgw: band(fgwS, 0.8, 0.9), haz: hazTone },
          showReport, onCloseReport: () => setReportClosed(true), onToggleReport: () => setReportClosed(showReport),
        }}
      />
    )
  }

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
          <div className="kd-status" data-tutorial="status">
          <div className="kd-head"><span className="kd-num">01</span> . <InfoHint title="Plasma parameters" content={plasmaParamsInfo}>PLASMA</InfoHint></div>
          <div className="kd-scalars">
            <Readout value={f2(s?.ip)} fit={big ? "88.88" : "8.88"} unit="MA" caption={<>I<sub>p</sub></>} {...ro('ip')} />
            <Readout value={f2(s?.ne_bar)} fit="8.88" unit="10²⁰ m⁻³" caption={<><G>n̄</G><sub>e</sub></>} {...ro('ne')} />
            <Readout value={f2(s?.w_th)} fit={big ? "888.88" : "8.88"} unit="MJ" caption={<>W<sub>th</sub></>} {...ro('wth')} />
            <Readout value={f2(rv(s?.beta_n))} fit="8.88" caption={<><G>β</G><sub>N</sub></>} hint={STAB} tone={betaTone} />
            <Readout value={f2(q95Disp(rv(s?.q95)))} fit="88.88" caption={<><G>q</G><sub>95</sub></>} hint={STAB} tone={band(q95S, 2.5, 2.0, true)} />
            <Readout value={f2(rv(s?.f_greenwald))} fit="8.88" caption={<><G>f</G><sub>GW</sub></>} hint={STAB} tone={band(fgwS, 0.8, 0.9)} {...ro('ne')} />
            <Readout value={f1(s?.p_input)} fit={big ? "888.8" : "88.8"} unit="MW" caption={<>P<sub>in</sub></>} hint={POWER} {...ro('pin')} />
            <Readout value={f1(s?.p_rad)} fit={big ? "888.8" : "88.8"} unit="MW" caption={<>P<sub>rad</sub></>} hint={POWER} {...ro('pin')} />
            <Readout value={f2(rv(s?.te0))} fit={big ? "88.88" : "8.88"} unit="keV" caption={<>T<sub>e0</sub></>} />
            <Readout value={f2(rv(s?.tau_e))} fit="8.88" unit="s" caption={<><G>τ</G><sub>E</sub></>} />
            <Readout value={f2(rv(s?.h_factor))} fit="8.88" caption={<>H<sub>98</sub></>} />
            <Readout value={f2(s?.v_loop)} fit="-88.88" unit="V" caption={<>V<sub>loop</sub></>} />
          </div>
          <Diagnostics snapshot={s} valid={valid} />
          </div>
          <div className="kd-title">
            <div className="kd-title-cap">PULSE</div>
            <h1 className="kd-h1">{pulseNo} <span className="kd-h1-dot">.</span> <span className="kd-phase" data-tone={phase === 'DISRUPTED' ? 'bad' : undefined}>{phase}</span></h1>
            <div className="kd-state" data-state={stateWord}>
              <Fx fit={STATE_WORDS} align="start">{stateWord}</Fx>
              <Fx fit="ELMING" align="start" className="kd-elm">{elmWord ? 'ELMING' : ''}</Fx>
              {s?.oh_saturated && <span className="kd-flag">OH SATURATED</span>}
              {s?.flux_exhausted && <span className="kd-flag">FLUX EXHAUSTED</span>}
              <span className="kd-haz">HAZARD <Fx fit={FIT.hazardPct} className="kd-haz-v" data-tone={hazTone}>{valid ? fmtHazard(s?.disruption_risk) : '—'}</Fx>{valid ? <> <G>%/s</G></> : ''}</span>
            </div>
          </div>
        </div>

        <div className="kd-eq" data-tutorial="equilibrium">
          <div className="kd-eq-cap">
            <div className="kd-head"><span className="kd-num">02</span> . <InfoHint title="Equilibrium" content={equilibriumInfo}>EQUILIBRIUM . R–Z</InfoHint></div>
            <span className="kd-eq-sub"><Fx fit={CONFIG_WORDS} align="start">{configWord(s)}</Fx>  .  B<sub>T</sub> <Fx fit="8.88">{f2(s?.bt)}</Fx> T</span>
          </div>
          <Hero snapshot={s} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
        </div>

        <div className="kd-col-r">
          <div className="kd-head kd-port-cap"><span className="kd-num">03</span> . PORT VIEW</div>
          <div className="kd-port" data-tutorial="portview">
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

      {showReport && ctx.report && <ReportPanel rows={ctx.report} pulseNo={pulseNo} onClose={() => setReportClosed(true)} />}

      <footer className="kd-foot">
        {/* the event text is prose with symbols and units in it: shown as written, not in caps */}
        <span className="kd-event kd-g" data-sev={lastEvent?.severity ?? 'info'}>
          {lastEvent ? `${lastEvent.t.toFixed(3)} s . ${lastEvent.text}` : ''}
        </span>
        <span className="kd-foot-r">
          {finished && ctx.report && ctx.report.length > 0 && (
            <button className="kd-report-open" data-on={showReport} onClick={() => setReportClosed(showReport)}>REPORT</button>
          )}
          {T.toFixed(1)} <G>s</G>
        </span>
      </footer>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
