import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ControlRoomContext } from './types'
import type { Snapshot } from '../../lib/types'
import EquilibriumCanvas from '../../components/EquilibriumCanvas'
import PortView from '../../components/portview'
import SevenSeg from './diiid/SevenSeg'
import BoardPlot, { type Series } from './apollo/BoardPlot'
import LampKey, { type Lamp } from './apollo/LampKey'
import { clock, interpWaveform, parseProgram, pulsePhase, type Waveform } from './apollo/phase'
import DiagLines from './apollo/DiagLines'
import { useDiagnostics } from './useDiagnostics'
import { reconstructionValid } from '../../lib/pulseLog'
import { formatQ } from '../../lib/fusionPhysics'
import './apollo.css'

/** Console arrangement: 'A' three modules side by side; 'B' an annunciator
 *  strip of lamps across the top with the CRT and the controls beneath. */
const CONSOLE: 'A' | 'B' = 'A'

const WHITE = '#f2f2ee'
const CYAN = '#5fd7ff'
const LCD = '#f4f4f0'

const f2 = (v: number) => (isFinite(v) ? v.toFixed(2) : '—')
const f1 = (v: number) => (isFinite(v) ? v.toFixed(1) : '—')

/** Sum of several programmed waveforms, sampled on the union of their knots. */
function sumWaveforms(ws: (Waveform | undefined)[]): Waveform | undefined {
  const live = ws.filter((w): w is Waveform => !!w && w.length > 0)
  if (live.length === 0) return undefined
  const ts = Array.from(new Set(live.flatMap((w) => w.map((p) => p[0])))).sort((a, b) => a - b)
  return ts.map((t) => [t, live.reduce((acc, w) => acc + (interpWaveform(w, t) ?? 0), 0)])
}

// ── mission clock: seven-segment digits, or a word, under a tracked legend ──
function Clock({ n, label, digits, word, sub, color = LCD }: {
  n: string; label: string; digits?: string; word?: string; sub?: string[]; color?: string
}) {
  return (
    <div className="ap-clock">
      <span className="ap-num">{n}</span>
      <span className="ap-legend">{label}</span>
      {digits !== undefined
        ? <SevenSeg text={digits} color={color} size={34} ghost={0.08} />
        : <span className="ap-word" style={{ color }}>{word}</span>}
      <div className="ap-clock-sub">
        {sub?.map((s) => <span key={s} className="ap-legend">{s}</span>)}
      </div>
    </div>
  )
}

export default function Composition({ ctx }: { ctx: ControlRoomContext }) {
  const { displaySnapshot: s, history, running, finished, scrubTime, time, duration, programJson } = ctx
  const [showReport, setShowReport] = useState(false)

  // The big board and the shared canvases take the MOCR field: black.
  // The settings provider re-asserts its own theme on mount and on change,
  // so the attribute is held for as long as this composition is mounted.
  useEffect(() => {
    const el = document.documentElement
    const prev = el.getAttribute('data-theme')
    const assert = () => { if (el.getAttribute('data-theme') !== 'apollo') el.setAttribute('data-theme', 'apollo') }
    assert()
    const mo = new MutationObserver(assert)
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mo.disconnect()
      if (prev) el.setAttribute('data-theme', prev); else el.removeAttribute('data-theme')
    }
  }, [])

  // The report takes the log screen once it exists; a new pulse goes back to the log.
  useEffect(() => { setShowReport(!!ctx.report) }, [ctx.report])

  const device = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const prog = useMemo(() => parseProgram(programJson), [programJson])
  const plots = useMemo<{ number: string; title: ReactNode; unit: string; series: Series[]; xAxis?: boolean }[]>(() => [
    {
      number: '07', title: <>I<sub>P</sub></>, unit: 'MA',
      series: [
        { key: 'ip', color: WHITE, ref: prog.ip, fmt: f2, unit: 'MA', label: <>I<sub>P</sub></>, floor: 0 },
        { key: 'i_ni', color: CYAN, fmt: f2, unit: 'MA', label: <>I<sub>NI</sub></>, floor: 0 },
      ],
    },
    {
      number: '08', title: <>n<sub>e</sub></>, unit: '10²⁰ m⁻³',
      series: [
        { key: 'ne_bar', color: WHITE, ref: prog.ne_target, fmt: f2, unit: '', label: <>n<sub>e</sub></>, floor: 0 },
        { key: 'f_greenwald', color: CYAN, fmt: f2, unit: '', label: <>f<sub>GW</sub></>, floor: 0 },
      ],
    },
    {
      number: '09', title: <>W<sub>TH</sub></>, unit: 'MJ',
      series: [
        { key: 'w_th', color: WHITE, fmt: f2, unit: 'MJ', label: <>W<sub>TH</sub></>, floor: 0 },
        { key: 'beta_n', color: CYAN, fmt: f2, unit: '', label: <>β<sub>N</sub></>, floor: 0 },
      ],
    },
    {
      number: '10', title: <>P</>, unit: 'MW',
      series: [
        { key: 'p_input', color: WHITE, ref: sumWaveforms([prog.p_nbi, prog.p_ech, prog.p_ich]), fmt: f1, unit: 'MW', label: <>P<sub>IN</sub></>, floor: 0 },
        { key: 'p_rad', color: CYAN, fmt: f1, unit: 'MW', label: <>P<sub>RAD</sub></>, floor: 0 },
      ],
    },
    {
      number: '11', title: <>D<sub>α</sub></>, unit: 'AU', xAxis: true,
      series: [
        { key: 'd_alpha', color: WHITE, fmt: f2, unit: '', label: <>D<sub>α</sub></>, floor: 0, spikes: true },
        { key: 'disruption_risk', color: CYAN, fmt: (v) => (isFinite(v) ? (v * 100).toFixed(2) : '—'), unit: '%/S', label: <>HAZARD</>, floor: 0 },
      ],
    },
  ], [prog])

  // ── clock band values ──
  const phase = pulsePhase(programJson, time, running, finished, s, scrubTime !== null)
  const pulse = ctx.pulseNumber !== null ? String(ctx.pulseNumber).padStart(4, '0') : '----'
  const deviceName = device?.name ?? ctx.activeDevice
  const presetLabel = (ctx.presets.find((p) => p.id === ctx.activePreset)?.label ?? ctx.activePreset)
    
  const phaseColor = phase === 'DISRUPT' ? '#ff5a4a' : LCD

  // ── status lamps: real state only; anything a telemetry row already says is left out ──
  const ipOn = !!s && s.ip > 0.05
  const fgw = s?.f_greenwald ?? 0
  const q95 = s?.q95 ?? 99
  const radFrac = s && s.p_input > 0.1 ? s.p_rad / s.p_input : 0
  const fluxFrac = s && s.flux_budget ? (s.flux_consumed ?? 0) / s.flux_budget : 0
  const riskBeta = s?.risk_beta ?? 0
  const riskLocked = s?.risk_locked_mode ?? 0
  const hazard = s?.disruption_risk ?? 0
  const paused = !running && !finished && time > 0
  const lamps: [string, Lamp][] = [
    ['H-MODE', s?.in_hmode ? 'green' : 'off'],
    ['ELM', s?.elm_active ? 'amber' : s?.elm_suppressed && s?.in_hmode ? 'white' : 'off'],
    ['DIVERTED', ipOn && s && !s.is_limited ? 'green' : 'off'],
    ['HAZARD', hazard > 0.05 ? 'red' : hazard > 0.01 ? 'amber' : 'off'],
    ['DENSITY', ipOn && fgw >= 1 ? 'red' : ipOn && fgw >= 0.8 ? 'amber' : 'off'],
    ['Q95', ipOn && q95 < 2.5 ? 'red' : ipOn && q95 < 3 ? 'amber' : 'off'],
    ['BETA', riskBeta > 0.5 ? 'red' : riskBeta > 0.15 ? 'amber' : 'off'],
    ['RADIATION', ipOn && radFrac > 0.8 ? 'red' : ipOn && radFrac > 0.5 ? 'amber' : 'off'],
    ['OH\nSATURATED', s?.oh_saturated ? 'amber' : 'off'],
    ['FLUX', s?.flux_exhausted ? 'red' : fluxFrac > 0.85 ? 'amber' : 'off'],
    ['LOCKED', riskLocked > 0.5 ? 'red' : riskLocked > 0.15 ? 'amber' : 'off'],
    ['DISRUPTED', s?.disrupted ? 'red' : 'off'],
  ]

  // ── telemetry: 21 rows on a strict 3 x 7 grid of label / value / unit; IP, NE, WTH and HAZ are on the
  //    big board, the neutron rate is the bargraph at the foot of the screen ──
  const diag = useDiagnostics(s, reconstructionValid(s))
  const tele = (snap: Snapshot | null): [string, string, string][] => {
    const v = (x: number | undefined, d = 2) => (snap && x !== undefined && isFinite(x) ? x.toFixed(d) : '-.--')
    const pfus = !snap ? '-.--' : diag.pFus > 0.001 ? diag.pFus.toFixed(diag.pFus < 10 ? 3 : 1) : '0.000'
    const q = !snap ? '-.--' : diag.rate > 0 ? formatQ(diag.qPlasma).toUpperCase() : '0'
    return [
      ['Bt', v(snap?.bt), 'T'], ['Pin', v(snap?.p_input, 1), 'MW'], ['Vloop', v(snap?.v_loop), 'V'],
      ['Te0', v(snap?.te0), 'KEV'], ['POH', v(snap?.p_ohmic, 1), 'MW'], ['Ψ', v(snap?.flux_consumed, 1), 'VS'],
      ['τE', v(snap?.tau_e, 3), 'S'], ['Prad', v(snap?.p_rad, 1), 'MW'], ['Ψmax', v(snap?.flux_budget, 1), 'VS'],
      ['βN', v(snap?.beta_n), ''], ['Ploss', v(snap?.p_loss, 1), 'MW'], ['IBS', v(snap?.i_bootstrap), 'MA'],
      ['q95', v(snap?.q95), ''], ['Pα', v(snap?.p_alpha, 2), 'MW'], ['ICD', v(snap?.i_cd), 'MA'],
      ['fGW', v(snap?.f_greenwald), ''], ['Pfus', pfus, 'MW'], ['li', v(snap?.li), ''],
      ['Zeff', v(snap?.z_eff), ''], ['Q', q, ''], ['H98', v(snap?.h_factor), ''],
      ['λq', snap && diag.valid ? diag.lambdaQ.toFixed(1) : '-.--', 'MM'], ['fdet', snap && diag.valid ? diag.fDet.toFixed(2) : '-.--', ''], ['', '', ''],
    ]
  }
  const rows = tele(s)

  const sevColor: Record<string, string> = {
    info: '#f2f2ee', ok: '#8ef08e', minor: '#ffc04a', major: '#ff6a5a', invalid: '#e39cff',
  }
  const logLines = ctx.events.slice(-5)

  const canReset = !(running && ctx.hasCustomProgram)

  // ── console modules (shared by both arrangements) ──
  const statusKeys = lamps.map(([cap, lamp]) => <LampKey key={cap} caption={cap} lamp={lamp} />)

  const teleModule = (
    <div className="ap-mod ap-mod-tele">
      <div className="ap-mod-head"><span className="ap-plate">15</span><span className="ap-engr">TELEMETRY</span></div>
      <div className="ap-crt">
        <div className="ap-crt-screen ap-tele-screen">
          <div className="ap-tele-grid">
            {rows.map(([k, v, u]) => (
              <div key={k || 'blank'} className="ap-tele-row">
                <span className="ap-k">{k}</span><span className="ap-v">{v}</span><span className="ap-u">{u}</span>
              </div>
            ))}
          </div>
          <DiagLines d={s ? diag : null} />
        </div>
      </div>
    </div>
  )

  const ctlModule = (
    <div className="ap-mod ap-mod-ctl">
      <div className="ap-mod-head"><span className="ap-plate">16</span><span className="ap-engr">CONTROL</span></div>
      <div className="ap-ctl-rows">
        <div className="ap-ctl-row ap-ctl-row-6">
          <span className="ap-engr">RUN</span>
          <LampKey caption="START" lamp={running ? 'green' : 'off'} onClick={ctx.controls.start} disabled={running} />
          <LampKey caption="PAUSE" lamp={paused ? 'amber' : 'off'} onClick={ctx.controls.pause} disabled={!running} />
          <LampKey caption="RESET" lamp="off" onClick={ctx.controls.reset} disabled={!canReset} />
          <LampKey caption="LIVE" lamp={scrubTime !== null ? 'white' : 'off'} onClick={() => ctx.controls.setScrubTime(null)} disabled={scrubTime === null} />
          <LampKey caption="EDIT" lamp={ctx.showPlanner ? 'white' : 'off'} onClick={ctx.togglePlanner} />
          <LampKey caption="REPORT" lamp={showReport ? 'white' : 'off'} onClick={() => setShowReport((v) => !v)} disabled={!ctx.report} />
        </div>
        <div className="ap-ctl-row ap-ctl-row-6">
          <span className="ap-engr">SPEED</span>
          {[2, 1, 0.75, 0.5].map((sp) => (
            <LampKey key={sp} caption={`${sp}X`} lamp={ctx.activeSpeed === sp ? 'white' : 'off'} onClick={() => ctx.onSpeedChange(sp)} />
          ))}
          <span className="ap-engr ap-engr-r">SETTINGS</span>
          <span className="ap-slot">{ctx.settingsNode}</span>
        </div>
        <div className="ap-ctl-row ap-ctl-row-6">
          <span className="ap-engr">DEVICE</span>
          {ctx.devices.map((d) => (
            <LampKey key={d.id} caption={d.name.toUpperCase()} lamp={ctx.activeDevice === d.id ? 'white' : 'off'} onClick={() => ctx.onDeviceChange(d.id)} />
          ))}
        </div>
        <div className="ap-ctl-row ap-ctl-row-6">
          <span className="ap-engr">SCENARIO</span>
          {ctx.presets.map((p) => (
            <LampKey key={p.id} caption={p.label.toUpperCase().replace(' ', '\n')} lamp={ctx.activePreset === p.id ? 'white' : 'off'} onClick={() => ctx.onPresetChange(p.id)} />
          ))}
          {ctx.showsFuelToggle && (['DD', 'DT'] as const).map((f) => (
            <LampKey key={f} caption={f} lamp={ctx.fuelType === f ? 'white' : 'off'} onClick={() => ctx.onFuelChange(f)} />
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div data-layout="apollo" className="ap-root">
      {/* ── 01–05 mission clocks ── */}
      <header className="ap-clocks">
        <Clock n="01" label="PULSE" digits={pulse} />
        <Clock n="02" label="PET" digits={clock(time)} sub={['MIN', 'SEC', 'MS']} />
        <Clock n="03" label="REMAINING" digits={clock(duration - time)} sub={['MIN', 'SEC', 'MS']} />
        <Clock n="04" label="PHASE" word={phase} color={phaseColor} />
        <Clock n="05" label="PROGRAM" word={`${deviceName} ${presetLabel}`} />
      </header>

      {/* ── 06–13 big board ── */}
      <section className="ap-board">
        <div className="ap-tile ap-map">
          <EquilibriumCanvas snapshot={s} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
          <div className="ap-plot-title">R-Z <span className="ap-unit">M</span></div>
          <div className="ap-plot-num">06</div>
        </div>
        <div className="ap-plots">
          {plots.map((pl) => (
            <BoardPlot
              key={pl.number}
              number={pl.number}
              title={pl.title}
              unit={pl.unit}
              series={pl.series}
              history={history}
              duration={duration}
              time={time}
              running={running}
              finished={finished}
              scrubTime={scrubTime}
              onScrub={ctx.controls.setScrubTime}
              xAxis={pl.xAxis}
            />
          ))}
        </div>
        <div className="ap-right">
          <div className="ap-tile ap-port">
            <PortView
              snapshot={ctx.plasmaSnapshot}
              limiterPoints={ctx.limiterPoints}
              deviceId={ctx.activeDevice}
              wallJson={ctx.wallJson}
              deviceR0={device?.r0}
              deviceA={device?.a}
            />
            <div className="ap-plot-num">12</div>
          </div>
          <div className="ap-tile ap-log">
            <div className="ap-plot-title">{showReport && ctx.report ? 'REPORT' : 'LOG'}</div>
            <div className="ap-plot-num">13</div>
            <div className="ap-log-lines">
              {showReport && ctx.report ? (
                ctx.report.slice(0, 5).map((r, i) => (
                  <div key={i} className="ap-log-line" style={{ color: r.status === 'major' ? sevColor.major : r.status === 'minor' ? sevColor.minor : undefined }}>
                    <span className="ap-log-t">{r.label}</span><span className="ap-v">{r.programmed ?? ''}</span><span className="ap-v">{r.achieved}</span>
                  </div>
                ))
              ) : logLines.length === 0 ? (
                <div className="ap-log-line"><span className="ap-log-t">0.00</span><span>READY</span></div>
              ) : (
                logLines.map((e) => (
                  <div key={e.id} className="ap-log-line" style={{ color: sevColor[e.severity] }}>
                    <span className="ap-log-t">{e.t.toFixed(2)}</span><span>{e.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 14–16 console ── */}
      {CONSOLE === 'A' ? (
        <section className="ap-console ap-console-a">
          <div className="ap-mod ap-mod-status">
            <div className="ap-mod-head"><span className="ap-plate">14</span><span className="ap-engr">STATUS</span></div>
            <div className="ap-keys ap-keys-status">{statusKeys}</div>
          </div>
          {teleModule}
          {ctlModule}
        </section>
      ) : (
        <section className="ap-console ap-console-b">
          <div className="ap-annun">
            <div className="ap-mod-head"><span className="ap-plate">14</span><span className="ap-engr">STATUS</span></div>
            <div className="ap-keys ap-keys-strip">{statusKeys}</div>
          </div>
          <div className="ap-console-b-lower">
            {teleModule}
            {ctlModule}
          </div>
        </section>
      )}

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
