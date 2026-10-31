import { useMemo, useRef, useState } from 'react'
import type { ControlRoomContext } from '../types'
import type { PresetId } from '../../../lib/wasm'
import type { TracePoint } from '../../../lib/types'
import EquilibriumCanvas from '../../../components/EquilibriumCanvas'
import PortView from '../../../components/portview'
import JScope, { sumWaveforms, type RowDef } from './JScope'
import { PhoneInterlockTable } from './InterlockTable'
import { flatTopWindow, parseProgram, pulsePhase } from '../kaldera/phase'
import { PHASE_WORDS } from '../kaldera/words'
import { Fx, digits8 } from '../Fixed'
import { reportLabel } from '../reportLabel'
import { useSettings } from '../../../lib/settingsContext'

/* ─── JET / CODAS on a phone ──────────────────────────────────────
   The same white spreadsheet, less of it: a gray toolbar header, the
   status words in their coloured boxes, equilibrium beside the camera
   tile, the compact interlock table, one stacked jScope panel for the
   chosen channels, a three-line event log, and the toolbar pinned at
   the bottom. */

/** The phone channels, keyed as `phoneTraces` stores them (shared across looks). */
const CHANNELS: { key: string; word: string; row: RowDef }[] = [
  { key: 'ip', word: 'Ip', row: { label: 'I_{p}', unit: 'MA', series: [{ key: 'ip' }], ref: (p) => p.ip, yMin: 0 } },
  { key: 'w_th', word: 'Wth', row: { label: 'W_{th}', unit: 'MJ', series: [{ key: 'w_th' }], yMin: 0 } },
  { key: 'd_alpha', word: 'Dα', row: { label: 'D_{α}', unit: 'a.u.', series: [{ key: 'd_alpha', spikes: true }], yMin: 0 } },
  { key: 'ne_bar', word: 'ne / fGW', row: { label: 'n_{e}', unit: '1e20 m-3', series: [{ key: 'ne_bar' }, { key: 'f_greenwald', name: 'f_{GW}' }], ref: (p) => p.ne_target, yMin: 0 } },
  { key: 'p_input', word: 'Pin / Prad', row: { label: 'P_{in}', unit: 'MW', series: [{ key: 'p_input' }, { key: 'p_rad', name: 'P_{rad}' }], ref: (p) => sumWaveforms([p.p_nbi, p.p_ech, p.p_ich]), yMin: 0, digits: 1 } },
  { key: 'beta_n', word: 'βN', row: { label: 'β_{N}', unit: '', series: [{ key: 'beta_n' }], yMin: 0 } },
  { key: 'q95', word: 'q95', row: { label: 'q_{95}', unit: '', series: [{ key: 'q95' }], yMin: 0, yMax: 10 } },
  { key: 'v_loop', word: 'Vloop', row: { label: 'V_{loop}', unit: 'V', series: [{ key: 'v_loop' }] } },
  { key: 'te0', word: 'Te0', row: { label: 'T_{e0}', unit: 'keV', series: [{ key: 'te0' }, { key: 'te_ped', name: 'T_{e,ped}' }], yMin: 0 } },
  // the history carries no τ_E; it is W_th / P_loss, the same definition the engine reports
  { key: 'tau_e', word: 'τE', row: { label: 'τ_{E}', unit: 's', series: [{ key: 'w_th', value: (p: TracePoint) => (p.p_loss > 1e-3 ? p.w_th / p.p_loss : 0) }], yMin: 0, digits: 3 } },
  { key: 'h_factor', word: 'H98', row: { label: 'H_{98}', unit: '', series: [{ key: 'h_factor' }], yMin: 0 } },
  { key: 'psi_oh', word: 'ΨOH', row: { label: 'Ψ_{OH}', unit: 'V·s', series: [{ key: 'psi_oh' }, { key: 'i_ni', name: 'I_{NI}' }], yMin: 0, digits: 1 } },
  { key: 'disruption_risk', word: 'Hazard', row: { label: 'hazard', unit: '1/s', series: [{ key: 'disruption_risk' }], yMin: 0, digits: 3 } },
]
const BY_KEY = Object.fromEntries(CHANNELS.map((c) => [c.key, c]))

const SPEEDS = [2, 1, 0.75, 0.5]

/** A flat Win95 combo box: our text and arrow button, a transparent native select on top takes the tap. */
function Combo({ value, text, options, onChange, className, title }: {
  value: string; text: string; options: { id: string; label: string }[]; onChange: (id: string) => void; className?: string; title?: string
}) {
  return (
    <label className={`jp-combo ${className ?? ''}`} title={title}>
      <span className="jp-combo-box">
        <span className="jp-combo-v">{text}</span>
        <span className="jp-combo-arrow" aria-hidden>▼</span>
      </span>
      <select value={value} aria-label={title} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** `fit`: every text the word can show, so its box (and its neighbours) hold still when it changes (../Fixed). */
interface Word { text: string; on: boolean; cls: string; fit?: readonly string[] }

export default function Phone({ ctx, words, configCode }: { ctx: ControlRoomContext; words: Word[]; configCode: (cfg: string | undefined) => string }) {
  const { phoneTraces, setPhoneTraces } = useSettings()
  const s = ctx.displaySnapshot
  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const preset = ctx.presets.find((p) => p.id === ctx.activePreset)
  const plasma = !!s && s.ip > 0.05 && !s.disrupted
  const T = Math.max(ctx.duration, 1e-3)

  // ── status words: the phase word first, then the desktop's seven, then the hazard value ──
  const win = useMemo(() => flatTopWindow(parseProgram(ctx.programJson).ip), [ctx.programJson])
  const phase = pulsePhase(win, ctx.time, ctx.running, ctx.finished, s, ctx.scrubTime !== null)
  const hz = s?.disruption_risk ?? 0
  const state: Word[] = [
    { text: phase === 'DISRUPT' ? 'DISRUPT' : phase, on: phase !== 'STANDBY', cls: phase === 'DISRUPT' ? 'alarm' : phase === 'FLAT-TOP' ? 'ok' : 'blue', fit: PHASE_WORDS },
    ...words,
    { text: `HAZARD ${s ? hz.toFixed(3) : '---'}`, fit: ['HAZARD 8.888'], on: plasma || !!s?.disrupted, cls: s?.disrupted || hz >= 0.2 ? 'alarm' : hz >= 0.05 ? 'warn' : 'ok' },
  ]

  // ── traces ──
  const [listOpen, setListOpen] = useState(false)
  const shown = phoneTraces.filter((k) => BY_KEY[k])
  const shownKey = shown.join(',')
  const rows = useMemo(() => (shownKey ? shownKey.split(',').map((k) => BY_KEY[k].row) : []), [shownKey])
  const toggle = (k: string) => setPhoneTraces(phoneTraces.includes(k) ? phoneTraces.filter((x) => x !== k) : [...phoneTraces, k])

  // ── pinned toolbar: progress rule, playhead, scrubbing by the handle only ──
  const trackRef = useRef<HTMLDivElement>(null)
  const at = ctx.scrubTime !== null ? ctx.scrubTime / T : ctx.progress / 100
  const pct = `${(Math.max(0, Math.min(1, at)) * 100).toFixed(2)}%`
  const scrubFrom = (e: React.PointerEvent) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    ctx.controls.setScrubTime(Math.max(0, Math.min(T, ((e.clientX - r.left) / r.width) * T)))
  }
  const ticks = win ? [win[0], win[1]].filter((t) => t > 0 && t < T) : []

  const tDisp = ctx.scrubTime !== null ? ctx.scrubTime : ctx.time
  const lastEvents = ctx.events.slice(-3)

  return (
    <div data-layout="jet" data-phone="" className="jet-root">
      <header className="jp-head">
        <Combo className="jp-dev" title="Device" value={ctx.activeDevice} text={dev?.name ?? ctx.activeDevice}
          options={ctx.devices.map((d) => ({ id: d.id, label: d.name }))} onChange={ctx.onDeviceChange} />
        <Combo className="jp-scn" title="Scenario" value={ctx.activePreset} text={preset?.label ?? ctx.activePreset}
          options={ctx.presets} onChange={(id) => ctx.onPresetChange(id as PresetId)} />
        <span className="jp-read jp-read-pulse">
          <span className="jp-read-k">PULSE{ctx.hasCustomProgram ? ' *' : ''}</span>
          <span className="jp-read-v">{ctx.pulseNumber ?? '-----'}</span>
        </span>
        <span className="jp-read jp-read-t">
          <span className="jp-read-k">t [s]{ctx.scrubTime !== null ? ' R' : ''}</span>
          <Fx fit={digits8(ctx.duration.toFixed(2))} className="jp-read-v">{tDisp.toFixed(2)}</Fx>
        </span>
        <span className="jp-settings">{ctx.settingsNode}</span>
      </header>

      <div className="jp-words">
        {state.map((w) => (
          <span key={w.text.split(' ')[0]} className={`jet-word${w.on ? ` on ${w.cls}` : ''}`}>{w.fit ? <Fx fit={w.fit} align="center">{w.text}</Fx> : w.text}</span>
        ))}
      </div>

      <div className="jp-pair">
        <div className="jet-panel jet-panel-eq" data-tutorial="equilibrium">
          <div className="jet-title">Equilibrium  R-Z  {plasma ? (s?.is_limited ? 'LIMITED' : configCode(s?.magnetic_config)) : ''}</div>
          <div className="jet-eq">
            <EquilibriumCanvas snapshot={s} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
          </div>
        </div>
        <div className="jet-panel jet-panel-cam" data-tutorial="portview">
          <div className="jet-title">Camera  KL1</div>
          <div className="jet-cam">
            <PortView snapshot={ctx.plasmaSnapshot} limiterPoints={ctx.limiterPoints} deviceId={ctx.activeDevice}
              wallJson={ctx.wallJson} deviceR0={dev?.r0} deviceA={dev?.a} framing="wide" />
          </div>
        </div>
      </div>

      <div className="jet-panel jp-table" data-tutorial="status">
        <div className="jet-title">{dev?.name ?? ''} scalars / interlocks</div>
        <PhoneInterlockTable
          snapshot={s}
          device={dev}
          extra={ctx.showsFuelToggle ? (
            <Combo className="jp-fuel" title="Fuel" value={ctx.fuelType} text={`Fuel ${ctx.fuelType}`}
              options={[{ id: 'DD', label: 'DD' }, { id: 'DT', label: 'DT' }]} onChange={(v) => ctx.onFuelChange(v as 'DD' | 'DT')} />
          ) : null}
        />
      </div>

      <div className="jet-panel jp-scope" data-tutorial="traces">
        <div className="jp-bar">
          <span className="jp-bar-t">jScope  #{ctx.pulseNumber ?? '-'}  {shown.length}/{CHANNELS.length}</span>
          <span className="jet-grow" />
          <button className={`jet-btn jet-pbtn${listOpen ? ' down' : ''}`} aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
            {listOpen ? 'Done' : '+ Traces'}
          </button>
        </div>
        {listOpen && (
          <div className="jp-chan">
            {CHANNELS.map((c) => {
              const on = phoneTraces.includes(c.key)
              return (
                <button key={c.key} className={`jet-btn jet-pbtn${on ? ' down' : ''}`} aria-pressed={on} onClick={() => toggle(c.key)}>
                  {c.word}
                </button>
              )
            })}
          </div>
        )}
        {rows.length > 0 && (
          <div className="jp-scope-plot" style={{ height: rows.length * 80 + 18 }}>
            <JScope
              rows={rows}
              history={ctx.history}
              programJson={ctx.programJson}
              duration={ctx.duration}
              time={ctx.time}
              scrubTime={ctx.scrubTime}
              finished={ctx.finished}
              phone
            />
          </div>
        )}
      </div>

      <div className="jet-panel jp-log">
        <div className="jet-title">Event log  #{ctx.pulseNumber ?? '-'}  {ctx.events.length}</div>
        <div className="jet-log">
          {lastEvents.length === 0 && <div className="jet-ev"><span className="jet-ev-t" /><span className="jet-ev-tag" /><span className="jet-ev-text">---</span></div>}
          {lastEvents.map((ev) => (
            <div key={ev.id} className={`jet-ev sev-${ev.severity}`}>
              <span className="jet-ev-t">{ev.t.toFixed(3)}</span>
              <span className="jet-ev-tag">{ev.severity === 'info' ? '' : ev.severity.toUpperCase()}</span>
              <span className="jet-ev-text">{ev.text}</span>
            </div>
          ))}
        </div>
      </div>

      {ctx.report && (
        <div className="jet-panel jp-report">
          <div className="jet-title">Report  #{ctx.pulseNumber ?? '-'}  prog | achieved</div>
          <div className="jet-log">
            {ctx.report.map((r) => (
              <div key={r.label} className={`jet-rep sev-${r.status ?? 'info'}`}>
                <span className="jet-rep-l">{reportLabel(r.label)}</span>
                <span className="jet-rep-p">{r.programmed ?? ''}</span>
                <span className="jet-rep-a">{r.achieved}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="jp-dock" data-tutorial="controls">
        <div className="jp-line" ref={trackRef}>
          <span className="jp-line-fill" style={{ width: pct }} />
          {ticks.map((t, i) => <span key={i} className="jp-line-tick" style={{ left: `${(t / T) * 100}%` }} />)}
          <span
            className="jp-handle"
            data-scrub={ctx.finished}
            style={{ left: pct }}
            aria-label="Scrub"
            role={ctx.finished ? 'slider' : undefined}
            aria-valuemin={ctx.finished ? 0 : undefined}
            aria-valuemax={ctx.finished ? T : undefined}
            aria-valuenow={ctx.finished ? +(at * T).toFixed(2) : undefined}
            onPointerDown={(e) => { if (!ctx.finished) return; e.currentTarget.setPointerCapture(e.pointerId); scrubFrom(e) }}
            onPointerMove={(e) => { if (ctx.finished && e.currentTarget.hasPointerCapture(e.pointerId)) scrubFrom(e) }}
            onDoubleClick={() => ctx.controls.setScrubTime(null)}
          />
        </div>
        <div className="jp-dock-row">
          <button className={`jet-btn jp-key jp-run${ctx.running ? ' down' : ''}`} onClick={() => (ctx.running ? ctx.controls.pause() : ctx.controls.start())}>
            {ctx.running ? 'Pause' : 'Start'}
          </button>
          <button className="jet-btn jp-key" onClick={() => ctx.controls.reset()}>Reset</button>
          <Combo className="jp-key jp-speed" title="Speed" value={String(ctx.activeSpeed)} text={`Speed ${ctx.activeSpeed}x`}
            options={SPEEDS.map((v) => ({ id: String(v), label: `${v}x` }))} onChange={(v) => ctx.onSpeedChange(Number(v))} />
          <button className={`jet-btn jp-key${ctx.showPlanner ? ' down' : ''}`} onClick={ctx.togglePlanner}>Edit{ctx.hasCustomProgram ? ' *' : ''}</button>
        </div>
      </div>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
