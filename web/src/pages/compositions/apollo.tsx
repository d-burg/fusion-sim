import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ControlRoomContext } from './types'
import type { Snapshot } from '../../lib/types'
import EquilibriumCanvas from '../../components/EquilibriumCanvas'
import PortView from '../../components/portview'
import DotText from './apollo/dotmatrix'
import BoardPlot, { type Series } from './apollo/BoardPlot'
import LampKey, { type Lamp } from './apollo/LampKey'
import { clock, interpWaveform, parseProgram, pulsePhase, type Waveform } from './apollo/phase'
import './apollo.css'

const WHITE = '#f2f2ee'
const CYAN = '#5fd7ff'

const f2 = (v: number) => (isFinite(v) ? v.toFixed(2) : '—')
const f1 = (v: number) => (isFinite(v) ? v.toFixed(1) : '—')

/** Sum of several programmed waveforms, sampled on the union of their knots. */
function sumWaveforms(ws: (Waveform | undefined)[]): Waveform | undefined {
  const live = ws.filter((w): w is Waveform => !!w && w.length > 0)
  if (live.length === 0) return undefined
  const ts = Array.from(new Set(live.flatMap((w) => w.map((p) => p[0])))).sort((a, b) => a - b)
  return ts.map((t) => [t, live.reduce((acc, w) => acc + (interpWaveform(w, t) ?? 0), 0)])
}

// ── mission clock ───────────────────────────────────────────────────
function Clock({ n, label, value, sub, pitch = 4 }: { n: string; label: string; value: string; sub?: [string, number][]; pitch?: number }) {
  return (
    <div className="ap-clock">
      <span className="ap-num">{n}</span>
      <DotText text={label} pitch={2} color="#cfd0c8" off="" className="ap-clock-label" />
      <DotText text={value} pitch={pitch} />
      <div className="ap-clock-sub" style={{ width: 47 * pitch }}>
        {sub?.map(([s, x]) => (
          <DotText key={s} text={s} pitch={2} color="#cfd0c8" off="" className="ap-clock-subword" style={{ left: x * pitch }} />
        ))}
      </div>
    </div>
  )
}

// ── CRT text tile ───────────────────────────────────────────────────
function Crt({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`ap-crt${className ? ` ${className}` : ''}`}>
      <div className="ap-crt-screen">{children}</div>
    </div>
  )
}

export default function Composition({ ctx }: { ctx: ControlRoomContext }) {
  const { displaySnapshot: s, history, running, finished, scrubTime, time, duration, programJson } = ctx
  const [logView, setLogView] = useState<'log' | 'rpt'>('log')

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

  // The report replaces the log once it exists; a new pulse goes back to the log.
  useEffect(() => { setLogView(ctx.report ? 'rpt' : 'log') }, [ctx.report])

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
        { key: 'd_alpha', color: WHITE, fmt: f2, unit: '', label: <>D<sub>α</sub></>, floor: 0 },
        { key: 'disruption_risk', color: CYAN, fmt: (v) => (isFinite(v) ? (v * 100).toFixed(2) : '—'), unit: '%/S', label: <>HAZ</>, floor: 0 },
      ],
    },
  ], [prog])

  // ── clock band values ──
  const phase = pulsePhase(programJson, time, running, finished, s, scrubTime !== null)
  const pulse = ctx.pulseNumber !== null ? String(ctx.pulseNumber).padStart(4, '0') : '----'
  const deviceName = device?.name ?? ctx.activeDevice
  const presetLabel = (ctx.presets.find((p) => p.id === ctx.activePreset)?.label ?? ctx.activePreset)
    .replace(/density limit/i, 'DENS LIM')
  // Centres of the MM, SS and MMM groups of "MM:SS.MMM", in dot columns.
  const clockSub: [string, number][] = [['MIN', 5.5], ['SEC', 20.5], ['MS', 38.5]]

  // ── status lamps ──
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
    ['RUN', running ? 'green' : 'off'],
    ['H-MODE', s?.in_hmode ? 'green' : 'off'],
    ['L-MODE', ipOn && !s?.in_hmode ? 'white' : 'off'],
    ['ELM', s?.elm_active ? 'amber' : s?.elm_suppressed && s?.in_hmode ? 'white' : 'off'],
    ['DIVERT', ipOn && s && !s.is_limited ? 'green' : 'off'],
    ['LIMITER', ipOn && s?.is_limited ? 'white' : 'off'],
    ['NEUTRON', (s?.diagnostics.neutron_rate ?? 0) > 1e12 ? 'green' : 'off'],
    ['ALPHA', (s?.p_alpha ?? 0) > 0.05 ? 'green' : 'off'],
    ['DENSITY', ipOn && fgw >= 1 ? 'red' : ipOn && fgw >= 0.8 ? 'amber' : 'off'],
    ['Q95', ipOn && q95 < 2.5 ? 'red' : ipOn && q95 < 3 ? 'amber' : 'off'],
    ['BETA', riskBeta > 0.5 ? 'red' : riskBeta > 0.15 ? 'amber' : 'off'],
    ['RAD', ipOn && radFrac > 0.8 ? 'red' : ipOn && radFrac > 0.5 ? 'amber' : 'off'],
    ['OH SAT', s?.oh_saturated ? 'amber' : 'off'],
    ['FLUX', s?.flux_exhausted ? 'red' : fluxFrac > 0.85 ? 'amber' : 'off'],
    ['LOCKED', riskLocked > 0.5 ? 'red' : riskLocked > 0.15 ? 'amber' : 'off'],
    ['DISRUPT', s?.disrupted ? 'red' : hazard > 0.01 ? 'amber' : 'off'],
  ]

  // ── telemetry columns ──
  const tele = (snap: Snapshot | null): [string, string, string][][] => {
    const v = (x: number | undefined, d = 2) => (snap && x !== undefined && isFinite(x) ? x.toFixed(d) : '-.--')
    const neut = snap?.diagnostics.neutron_rate ?? 0
    return [
      [
        ['IP', v(snap?.ip), 'MA'],
        ['BT', v(snap?.bt), 'T'],
        ['NE', v(snap?.ne_bar), 'E20'],
        ['TE0', v(snap?.te0), 'KEV'],
        ['WTH', v(snap?.w_th), 'MJ'],
        ['TAUE', v(snap?.tau_e, 3), 'S'],
        ['BETAN', v(snap?.beta_n), ''],
        ['Q95', v(snap?.q95), ''],
        ['LI', v(snap?.li), ''],
        ['H98', v(snap?.h_factor), ''],
        ['FGW', v(snap?.f_greenwald), ''],
        ['ZEFF', v(snap?.z_eff), ''],
      ],
      [
        ['PIN', v(snap?.p_input, 1), 'MW'],
        ['POH', v(snap?.p_ohmic, 1), 'MW'],
        ['PRAD', v(snap?.p_rad, 1), 'MW'],
        ['PLOSS', v(snap?.p_loss, 1), 'MW'],
        ['PALPHA', v(snap?.p_alpha, 2), 'MW'],
        ['VLOOP', v(snap?.v_loop), 'V'],
        ['PSI', v(snap?.flux_consumed, 1), 'VS'],
        ['PSIMAX', v(snap?.flux_budget, 1), 'VS'],
        ['IBS', v(snap?.i_bootstrap), 'MA'],
        ['ICD', v(snap?.i_cd), 'MA'],
        ['NEUT', snap ? neut.toExponential(1).replace('e+', 'E').replace('e', 'E') : '-.--', '/S'],
        ['HAZ', v(hazard * 100, 2), '%/S'],
      ],
    ]
  }
  const columns = tele(s)

  const sevColor: Record<string, string> = {
    info: '#a8d8ff', ok: '#8ef08e', minor: '#ffc04a', major: '#ff6a5a', invalid: '#e39cff',
  }
  const logLines = ctx.events.slice(-11)

  const canReset = !(running && ctx.hasCustomProgram)

  return (
    <div data-layout="apollo" className="ap-root">
      {/* ── 01–05 mission clocks ── */}
      <header className="ap-clocks">
        <Clock n="01" label="PULSE" value={pulse} />
        <Clock n="02" label="PET" value={clock(time)} sub={clockSub} />
        <Clock n="03" label="REM" value={clock(duration - time)} sub={clockSub} />
        <Clock n="04" label="PHASE" value={phase} />
        <Clock n="05" label="PROG" value={`${deviceName} ${presetLabel}`} />
      </header>

      {/* ── 06–12 big board ── */}
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
      </section>

      {/* ── 13–16 console ── */}
      <section className="ap-console">
        <div className="ap-mod ap-mod-status">
          <div className="ap-mod-head"><span className="ap-plate">13</span><span className="ap-engr">STATUS</span></div>
          <div className="ap-keys ap-keys-status">
            {lamps.map(([cap, lamp]) => <LampKey key={cap} caption={cap} lamp={lamp} />)}
          </div>
        </div>

        <div className="ap-mod ap-mod-tele">
          <div className="ap-mod-head"><span className="ap-plate">14</span><span className="ap-engr">TELEMETRY</span></div>
          <Crt>
            <div className="ap-crt-cols">
              {columns.map((col, ci) => (
                <table key={ci}>
                  <tbody>
                    {col.map(([k, v, u]) => (
                      <tr key={k}><td>{k}</td><td className="ap-v">{v}</td><td className="ap-u">{u}</td></tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          </Crt>
        </div>

        <div className="ap-mod ap-mod-log">
          <div className="ap-mod-head">
            <span className="ap-plate">15</span><span className="ap-engr">LOG</span>
            <span className="ap-head-keys">
              <LampKey caption="LOG" lamp={logView === 'log' ? 'white' : 'off'} onClick={() => setLogView('log')} />
              <LampKey caption="RPT" lamp={logView === 'rpt' ? 'white' : 'off'} onClick={() => setLogView('rpt')} disabled={!ctx.report} />
            </span>
          </div>
          <Crt className="ap-crt-log">
            {logView === 'rpt' && ctx.report ? (
              <table>
                <tbody>
                  {ctx.report.map((r, i) => (
                    <tr key={i} style={{ color: r.status === 'major' ? sevColor.major : r.status === 'minor' ? sevColor.minor : undefined }}>
                      <td>{r.label}</td><td className="ap-v">{r.programmed ?? ''}</td><td className="ap-v">{r.achieved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <tbody>
                  {logLines.length === 0 && <tr><td className="ap-v">0.00</td><td>READY</td></tr>}
                  {logLines.map((e) => (
                    <tr key={e.id} style={{ color: sevColor[e.severity] }}>
                      <td className="ap-v">{e.t.toFixed(2)}</td><td>{e.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Crt>
        </div>

        <div className="ap-mod ap-mod-ctl">
          <div className="ap-mod-head"><span className="ap-plate">16</span><span className="ap-engr">CONTROL</span></div>
          <div className="ap-ctl-rows">
            <div className="ap-ctl-row">
              <span className="ap-engr">RUN</span>
              <LampKey caption="START" lamp={running ? 'green' : 'off'} onClick={ctx.controls.start} disabled={running} />
              <LampKey caption="PAUSE" lamp={paused ? 'amber' : 'off'} onClick={ctx.controls.pause} disabled={!running} />
              <LampKey caption="RESET" lamp="off" onClick={ctx.controls.reset} disabled={!canReset} />
              <LampKey caption="LIVE" lamp={scrubTime !== null ? 'white' : 'off'} onClick={() => ctx.controls.setScrubTime(null)} disabled={scrubTime === null} />
              <LampKey caption="EDIT" lamp={ctx.showPlanner ? 'amber' : 'off'} onClick={ctx.togglePlanner} />
            </div>
            <div className="ap-ctl-row">
              <span className="ap-engr">SPEED</span>
              {[2, 1, 0.75, 0.5].map((sp) => (
                <LampKey key={sp} caption={`${sp}X`} lamp={ctx.activeSpeed === sp ? 'white' : 'off'} onClick={() => ctx.onSpeedChange(sp)} />
              ))}
            </div>
            <div className="ap-ctl-row">
              <span className="ap-engr">DEVICE</span>
              {ctx.devices.map((d) => (
                <LampKey key={d.id} caption={d.name.toUpperCase()} lamp={ctx.activeDevice === d.id ? 'green' : 'off'} onClick={() => ctx.onDeviceChange(d.id)} />
              ))}
            </div>
            <div className="ap-ctl-row">
              <span className="ap-engr">SCEN</span>
              {ctx.presets.map((p) => (
                <LampKey key={p.id} caption={p.label.toUpperCase().replace(' ', '\n')} lamp={ctx.activePreset === p.id ? 'green' : 'off'} onClick={() => ctx.onPresetChange(p.id)} />
              ))}
              {ctx.showsFuelToggle && (['DD', 'DT'] as const).map((f) => (
                <LampKey key={f} caption={f} lamp={ctx.fuelType === f ? 'white' : 'off'} onClick={() => ctx.onFuelChange(f)} />
              ))}
            </div>
            <div className="ap-ctl-row ap-ctl-row-set">
              <span className="ap-engr">SET</span>
              <span className="ap-slot">{ctx.settingsNode}</span>
            </div>
          </div>
        </div>
      </section>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
