import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { ControlRoomContext } from '../types'
import type { TracePoint } from '../../../lib/types'
import EquilibriumCanvas from '../../../components/EquilibriumCanvas'
import PortView from '../../../components/portview'
import SevenSeg from '../diiid/SevenSeg'
import BoardPlot, { type Series } from './BoardPlot'
import LampKey, { type Lamp } from './LampKey'
import { PhoneDiagLines } from './DiagLines'
import { clock, flatTopWindow, interpWaveform, parseProgram, pulsePhase, type Waveform } from './phase'
import { useDiagnostics } from '../useDiagnostics'
import { reconstructionValid } from '../../../lib/pulseLog'
import { formatQ } from '../../../lib/fusionPhysics'
import { useSettings, DEFAULT_PHONE_TRACES } from '../../../lib/settingsContext'

const WHITE = '#f2f2ee'
const CYAN = '#5fd7ff'
const LCD = '#f4f4f0'
const SPEEDS = [2, 1, 0.75, 0.5]
const SEV: Record<string, string> = { info: '#f2f2ee', ok: '#8ef08e', minor: '#ffc04a', major: '#ff6a5a', invalid: '#e39cff' }

const f2 = (v: number) => (isFinite(v) ? v.toFixed(2) : '—')
const f1 = (v: number) => (isFinite(v) ? v.toFixed(1) : '—')
const f3 = (v: number) => (isFinite(v) ? v.toFixed(3) : '—')

function sumWaveforms(ws: (Waveform | undefined)[]): Waveform | undefined {
  const live = ws.filter((w): w is Waveform => !!w && w.length > 0)
  if (live.length === 0) return undefined
  const ts = Array.from(new Set(live.flatMap((w) => w.map((p) => p[0])))).sort((a, b) => a - b)
  return ts.map((t) => [t, live.reduce((acc, w) => acc + (interpWaveform(w, t) ?? 0), 0)])
}

/** A sage console key whose caption is ours; a transparent native select on top takes the tap. */
function PickKey({ value, caption, options, onChange, className }: {
  value: string; caption: string; options: { id: string; label: string }[]; onChange: (id: string) => void; className?: string
}) {
  return (
    <label className={`ap-key ap-key-off ap-key-btn app-pick ${className ?? ''}`}>
      <span>{caption}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  )
}

interface Channel { key: string; cap: string; number: string; title: ReactNode; unit: string; series: Series[] }

/** The MOCR on a phone: one clock row, the status lamps, the pair, a small CRT, the board plots, the console pinned. */
export default function Phone({ ctx }: { ctx: ControlRoomContext }) {
  const { displaySnapshot: s, history, running, finished, scrubTime, time, duration, programJson } = ctx
  const { phoneTraces, setPhoneTraces } = useSettings()
  const [more, setMore] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [seenReport, setSeenReport] = useState(ctx.report)
  if (seenReport !== ctx.report) { setSeenReport(ctx.report); if (!ctx.report) setShowReport(false) }

  const device = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const preset = ctx.presets.find((p) => p.id === ctx.activePreset)
  const prog = useMemo(() => parseProgram(programJson), [programJson])
  const T = duration > 0 ? duration : 10

  // ── clock band ──
  const phase = pulsePhase(programJson, time, running, finished, s, scrubTime !== null)
  const pulse = ctx.pulseNumber !== null ? String(ctx.pulseNumber).padStart(4, '0') : '----'

  // ── the eight lamps that carry real state ──
  const ipOn = !!s && s.ip > 0.05
  const fgw = s?.f_greenwald ?? 0
  const q95 = s?.q95 ?? 99
  const hazard = s?.disruption_risk ?? 0
  const lamps: [string, Lamp][] = [
    ['H-MODE', s?.in_hmode ? 'green' : 'off'],
    ['ELM', s?.elm_active ? 'amber' : s?.elm_suppressed && s?.in_hmode ? 'white' : 'off'],
    ['DIVERTED', ipOn && s && !s.is_limited ? 'green' : 'off'],
    ['HAZARD', hazard > 0.05 ? 'red' : hazard > 0.01 ? 'amber' : 'off'],
    ['DENSITY', ipOn && fgw >= 1 ? 'red' : ipOn && fgw >= 0.8 ? 'amber' : 'off'],
    ['Q95', ipOn && q95 < 2.5 ? 'red' : ipOn && q95 < 3 ? 'amber' : 'off'],
    ['OH\nSATURATED', s?.oh_saturated ? 'amber' : 'off'],
    ['DISRUPTED', s?.disrupted ? 'red' : 'off'],
  ]

  // ── telemetry ──
  const valid = reconstructionValid(s)
  const diag = useDiagnostics(s, valid)
  const v = (x: number | undefined, d = 2) => (s && x !== undefined && isFinite(x) ? x.toFixed(d) : '-.--')
  const rv = (x: number | undefined, d = 2) => (valid ? v(x, d) : '-.--')
  const pfus = !s ? '-.--' : diag.pFus > 0.001 ? diag.pFus.toFixed(diag.pFus < 10 ? 3 : 1) : '0.000'
  const qStr = !s ? '-.--' : diag.rate > 0 ? formatQ(diag.qPlasma).toUpperCase() : '0'
  const fluxFrac = s && s.flux_budget ? (s.flux_consumed ?? 0) / s.flux_budget : 0
  const fluxTone = s?.flux_exhausted ? 'bad' : fluxFrac > 0.85 ? 'warn' : undefined
  const hazTone = hazard > 0.05 ? 'bad' : hazard > 0.01 ? 'warn' : undefined
  const essential: [string, string, string][] = [
    ['Ip', v(s?.ip), 'MA'], ['ne', v(s?.ne_bar), 'E20'],
    ['Wth', v(s?.w_th), 'MJ'], ['βN', rv(s?.beta_n), ''],
    ['q95', rv(s?.q95), ''], ['fGW', rv(s?.f_greenwald), ''],
  ]
  const rest: [string, string, string][] = [
    ['Bt', v(s?.bt), 'T'], ['Te0', v(s?.te0), 'KEV'],
    ['Pin', v(s?.p_input, 1), 'MW'], ['POH', v(s?.p_ohmic, 1), 'MW'],
    ['Prad', v(s?.p_rad, 1), 'MW'], ['Ploss', v(s?.p_loss, 1), 'MW'],
    ['Pα', v(s?.p_alpha), 'MW'], ['Vloop', v(s?.v_loop), 'V'],
    ['τE', rv(s?.tau_e, 3), 'S'], ['H98', rv(s?.h_factor), ''],
    ['li', rv(s?.li), ''], ['Zeff', v(s?.z_eff), ''],
    ['IBS', v(s?.i_bootstrap), 'MA'], ['ICD', v(s?.i_cd), 'MA'],
    ['Ψ', v(s?.flux_consumed, 1), 'VS'], ['Ψmax', v(s?.flux_budget, 1), 'VS'],
    ['λq', s && diag.valid ? diag.lambdaQ.toFixed(1) : '-.--', 'MM'], ['fdet', s && diag.valid ? diag.fDet.toFixed(2) : '-.--', ''],
  ]

  // ── board plots: every channel the phone can show, numbered after the desktop board ──
  const channels = useMemo<Channel[]>(() => {
    const one = (key: keyof TracePoint, label: ReactNode, unit: string, fmt = f2, extra: Partial<Series> = {}): Series =>
      ({ key, color: WHITE, fmt, unit, label, floor: 0, ...extra })
    const list: Omit<Channel, 'number'>[] = [
      { key: 'ip', cap: 'IP', title: <>I<sub>P</sub></>, unit: 'MA', series: [one('ip', <>I<sub>P</sub></>, 'MA', f2, { ref: prog.ip })] },
      { key: 'w_th', cap: 'WTH', title: <>W<sub>TH</sub></>, unit: 'MJ', series: [one('w_th', <>W<sub>TH</sub></>, 'MJ')] },
      { key: 'd_alpha', cap: 'D-ALPHA', title: <>D<sub>α</sub></>, unit: 'AU', series: [one('d_alpha', <>D<sub>α</sub></>, '', f2, { spikes: true })] },
      { key: 'ne_bar', cap: 'NE / FGW', title: <>n<sub>e</sub></>, unit: '10²⁰ m⁻³', series: [
        one('ne_bar', <>n<sub>e</sub></>, '', f2, { ref: prog.ne_target }),
        { key: 'f_greenwald', color: CYAN, fmt: f2, unit: '', label: <>f<sub>GW</sub></>, floor: 0 },
      ] },
      { key: 'p_input', cap: 'PIN / PRAD', title: <>P</>, unit: 'MW', series: [
        one('p_input', <>P<sub>IN</sub></>, 'MW', f1, { ref: sumWaveforms([prog.p_nbi, prog.p_ech, prog.p_ich]) }),
        { key: 'p_rad', color: CYAN, fmt: f1, unit: 'MW', label: <>P<sub>RAD</sub></>, floor: 0 },
      ] },
      { key: 'beta_n', cap: 'BETA N', title: <>β<sub>N</sub></>, unit: '', series: [one('beta_n', <>β<sub>N</sub></>, '')] },
      { key: 'q95', cap: 'Q95', title: <>q<sub>95</sub></>, unit: '', series: [one('q95', <>q<sub>95</sub></>, '')] },
      { key: 'v_loop', cap: 'VLOOP', title: <>V<sub>LOOP</sub></>, unit: 'V', series: [one('v_loop', <>V<sub>LOOP</sub></>, 'V')] },
      { key: 'te0', cap: 'TE0', title: <>T<sub>E0</sub></>, unit: 'KEV', series: [one('te0', <>T<sub>E0</sub></>, 'KEV')] },
      { key: 'tau_e', cap: 'TAU E', title: <>τ<sub>E</sub></>, unit: 'S', series: [one('w_th', <>τ<sub>E</sub></>, 'S', f3, { get: (h) => (h.p_loss > 0.01 ? h.w_th / h.p_loss : 0) })] },
      { key: 'h_factor', cap: 'H98', title: <>H<sub>98</sub></>, unit: '', series: [one('h_factor', <>H<sub>98</sub></>, '')] },
      { key: 'psi_oh', cap: 'PSI OH', title: <>Ψ<sub>OH</sub></>, unit: 'VS', series: [one('psi_oh', <>Ψ<sub>OH</sub></>, 'VS', f1)] },
      { key: 'disruption_risk', cap: 'HAZARD', title: <>HAZARD</>, unit: '%/S', series: [
        one('disruption_risk', <>HAZ</>, '%/S', f2, { get: (h) => h.disruption_risk * 100 }),
      ] },
      { key: 'li', cap: 'LI', title: <>l<sub>i</sub></>, unit: '', series: [one('li', <>l<sub>i</sub></>, '')] },
      { key: 'te_ped', cap: 'TE PED', title: <>T<sub>E,PED</sub></>, unit: 'KEV', series: [one('te_ped', <>T<sub>E,PED</sub></>, 'KEV')] },
      { key: 'i_ni', cap: 'I NI', title: <>I<sub>NI</sub></>, unit: 'MA', series: [one('i_ni', <>I<sub>NI</sub></>, 'MA')] },
    ]
    return list.map((c, i) => ({ ...c, number: String(17 + i).padStart(2, '0') }))
  }, [prog])
  const byKey = useMemo(() => Object.fromEntries(channels.map((c) => [c.key, c])), [channels])
  const picked = phoneTraces.filter((k) => byKey[k])
  const shown = (picked.length ? picked : DEFAULT_PHONE_TRACES).map((k) => byKey[k]).filter(Boolean)
  const toggle = (k: string) => {
    if (picked.includes(k)) { if (picked.length > 1) setPhoneTraces(picked.filter((x) => x !== k)) }
    else setPhoneTraces([...picked, k])
  }

  // ── pinned console: timeline line, playhead, and scrubbing by the handle only ──
  const trackRef = useRef<HTMLDivElement>(null)
  const at = scrubTime !== null ? scrubTime / T : ctx.progress / 100
  const pct = `${(Math.max(0, Math.min(1, at)) * 100).toFixed(2)}%`
  const scrubFrom = (e: React.PointerEvent) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    ctx.controls.setScrubTime(Math.max(0, Math.min(T, ((e.clientX - r.left) / r.width) * T)))
  }
  const win = useMemo(() => flatTopWindow(prog.ip), [prog])
  const ticks = win ? [win[0], win[1]].filter((t) => t > 0 && t < T) : []
  const canReset = !(running && ctx.hasCustomProgram)
  const speedText = (sp: number) => `${sp}X`

  const logLines = ctx.events.slice(-2)
  const hasReport = !!ctx.report && ctx.report.length > 0

  return (
    <div data-layout="apollo" data-phone="" className="ap-root">
      {/* ── 01–04 clock band, one row ── */}
      <header className="app-clocks">
        <div className="app-clock">
          <span className="ap-legend">01 PULSE</span>
          <SevenSeg text={pulse} color={LCD} size={18} ghost={0.08} />
        </div>
        <div className="app-clock">
          <span className="ap-legend">02 PET</span>
          <SevenSeg text={clock(scrubTime ?? time)} color={scrubTime !== null ? CYAN : LCD} size={18} ghost={0.08} />
        </div>
        <div className="app-clock app-clock-phase">
          <span className="ap-legend">04 PHASE</span>
          <span className="app-phase" style={{ color: phase === 'DISRUPT' ? '#ff5a4a' : LCD }}>{phase}</span>
        </div>
        <span className="app-settings">{ctx.settingsNode}</span>
      </header>

      {/* ── 14 status lamps beside 05 program ── */}
      <section className="ap-console app-status" data-tutorial="status">
        <div className="app-lamps">
          {lamps.map(([cap, lamp]) => <LampKey key={cap} caption={cap} lamp={lamp} />)}
        </div>
        <div className="app-program">
          <PickKey className="app-pick-dev" value={ctx.activeDevice} caption={(device?.name ?? ctx.activeDevice).toUpperCase()}
            options={ctx.devices.map((d) => ({ id: d.id, label: d.name }))} onChange={ctx.onDeviceChange} />
          <PickKey className="app-pick-scn" value={ctx.activePreset} caption={(preset?.label ?? ctx.activePreset).toUpperCase()}
            options={ctx.presets} onChange={(id) => ctx.onPresetChange(id as typeof ctx.activePreset)} />
        </div>
      </section>

      {/* ── 06 R-Z map beside 12 port view ── */}
      <section className="app-pair">
        <div className="ap-tile ap-map app-eq" data-tutorial="equilibrium">
          <EquilibriumCanvas snapshot={s} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
          <div className="ap-plot-title">R-Z <span className="ap-unit">M</span></div>
          <div className="ap-plot-num">06</div>
          {ipOn && s && <div className="app-eq-cfg">{s.is_limited ? 'LIMITED' : 'DIVERTED'}</div>}
        </div>
        <div className="ap-tile ap-port app-port" data-tutorial="portview">
          <PortView
            snapshot={ctx.plasmaSnapshot}
            limiterPoints={ctx.limiterPoints}
            deviceId={ctx.activeDevice}
            wallJson={ctx.wallJson}
            deviceR0={device?.r0}
            deviceA={device?.a}
            framing="wide"
          />
          <div className="ap-plot-num">12</div>
        </div>
      </section>

      {/* ── 15 telemetry CRT ── */}
      <section className="ap-console app-tele">
        <div className="app-mod-head">
          <span className="ap-plate">15</span><span className="ap-engr">TELEMETRY</span>
          <span className="app-fill" />
          {ctx.showsFuelToggle && (['DD', 'DT'] as const).map((fu) => (
            <LampKey key={fu} caption={fu} lamp={ctx.fuelType === fu ? 'white' : 'off'} onClick={() => ctx.onFuelChange(fu)} />
          ))}
          <LampKey caption={more ? 'LESS' : 'MORE'} lamp={more ? 'white' : 'off'} onClick={() => setMore(!more)} />
        </div>
        <div className="ap-crt">
          <div className="ap-crt-screen app-crt-screen">
            <PhoneDiagLines d={diag} live={!!s} />
            <div className="app-fus">
              <span>PFUS <b>{pfus}</b> <i>MW</i></span>
              <span>Q <b>{qStr}</b></span>
            </div>
            <div className="app-fus">
              <span>HAZARD <b data-tone={hazTone}>{s ? (hazard * 100).toFixed(2) : '-.--'}</b> <i>%/S</i></span>
              <span>Ψ <b data-tone={fluxTone}>{v(s?.flux_consumed, 1)}/{v(s?.flux_budget, 1)}</b> <i>VS</i></span>
            </div>
            <div className="app-tele-grid">
              {(more ? [...essential, ...rest] : essential).map(([k, val, u]) => (
                <div key={k} className="ap-tele-row"><span className="ap-k">{k}</span><span className="ap-v">{val}</span><span className="ap-u">{u}</span></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── big board plots ── */}
      <section className="app-board" data-tutorial="traces">
        <div className="ap-console app-board-head">
          <span className="ap-plate">07</span><span className="ap-engr">BOARD {shown.length}/{channels.length}</span>
          <span className="app-fill" />
          <LampKey caption={listOpen ? 'DONE' : '+ TRACES'} lamp={listOpen ? 'white' : 'off'} onClick={() => setListOpen(!listOpen)} />
        </div>
        {listOpen && (
          <div className="ap-console app-chan">
            {channels.map((c) => (
              <button key={c.key} type="button" aria-pressed={picked.includes(c.key)}
                className={`ap-key ap-key-btn ${picked.includes(c.key) ? 'ap-key-white' : 'ap-key-off'}`} onClick={() => toggle(c.key)}>
                <span>{c.cap}</span>
              </button>
            ))}
          </div>
        )}
        {shown.map((c, i) => (
          <BoardPlot
            key={c.key}
            number={c.number}
            title={c.title}
            unit={c.unit}
            series={c.series}
            history={history}
            duration={duration}
            time={time}
            running={running}
            finished={finished}
            scrubTime={scrubTime}
            onScrub={ctx.controls.setScrubTime}
            xAxis={i === shown.length - 1}
            phone
          />
        ))}
      </section>

      {/* ── 13 log, two lines; the report on demand ── */}
      <section className="ap-tile ap-log app-log">
        <div className="app-log-head">
          <span className="ap-plot-title">{showReport && hasReport ? 'REPORT' : 'LOG'}</span>
          <span className="ap-plot-num">13</span>
        </div>
        <div className="ap-log-lines app-log-lines">
          {showReport && ctx.report ? (
            ctx.report.map((r, i) => (
              <div key={i} className="ap-log-line" style={{ color: r.status === 'major' ? SEV.major : r.status === 'minor' ? SEV.minor : undefined }}>
                <span className="app-log-k">{r.label}</span><span className="ap-v">{r.programmed ?? ''}</span><span className="ap-v">{r.achieved}</span>
              </div>
            ))
          ) : logLines.length === 0 ? (
            <div className="ap-log-line"><span className="ap-log-t">0.00</span><span>READY</span></div>
          ) : (
            logLines.map((e) => (
              <div key={e.id} className="ap-log-line" style={{ color: SEV[e.severity] }}>
                <span className="ap-log-t">{e.t.toFixed(2)}</span><span className="app-log-x">{e.text}</span>
              </div>
            ))
          )}
        </div>
        {hasReport && (
          <div className="ap-console app-log-keys">
            <LampKey caption="REPORT" lamp={showReport ? 'white' : 'off'} onClick={() => setShowReport(!showReport)} />
          </div>
        )}
      </section>

      {/* ── 16 control, pinned ── */}
      <div className="ap-console app-keys" data-tutorial="controls">
        <div className="app-line" ref={trackRef}>
          <span className="app-line-fill" style={{ width: pct }} />
          {ticks.map((t, i) => <span key={i} className="app-line-tick" style={{ left: `${(t / T) * 100}%` }} />)}
          <span
            className="app-handle"
            data-scrub={finished}
            style={{ left: pct }}
            aria-label="Scrub"
            role={finished ? 'slider' : undefined}
            aria-valuemin={finished ? 0 : undefined}
            aria-valuemax={finished ? T : undefined}
            aria-valuenow={finished ? +(at * T).toFixed(2) : undefined}
            onPointerDown={(e) => { if (!finished) return; e.currentTarget.setPointerCapture(e.pointerId); scrubFrom(e) }}
            onPointerMove={(e) => { if (finished && e.currentTarget.hasPointerCapture(e.pointerId)) scrubFrom(e) }}
            onDoubleClick={() => ctx.controls.setScrubTime(null)}
          />
        </div>
        <div className="app-keyrow">
          <LampKey caption={running ? 'PAUSE' : 'START'} lamp={running ? 'green' : !running && !finished && time > 0 ? 'amber' : 'off'}
            onClick={() => (running ? ctx.controls.pause() : ctx.controls.start())} />
          <LampKey caption="RESET" lamp="off" onClick={ctx.controls.reset} disabled={!canReset} />
          <PickKey className="app-speed" value={String(ctx.activeSpeed)} caption={`SPEED ${speedText(ctx.activeSpeed)}`}
            options={SPEEDS.map((sp) => ({ id: String(sp), label: speedText(sp) }))} onChange={(sp) => ctx.onSpeedChange(Number(sp))} />
          <LampKey caption={ctx.hasCustomProgram ? 'EDIT*' : 'EDIT'} lamp={ctx.showPlanner ? 'white' : 'off'} onClick={ctx.togglePlanner} />
        </div>
      </div>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
