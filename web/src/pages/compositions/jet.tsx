import { useEffect, useMemo, useRef } from 'react'
import type { ControlRoomContext } from './types'
import type { PresetId } from '../../lib/wasm'
import EquilibriumCanvas from '../../components/EquilibriumCanvas'
import PortView from '../../components/portview'
import JScope, { sumWaveforms, type RowDef } from './jet/JScope'
import InterlockTable from './jet/InterlockTable'
import './jet.css'

/* ─── JET / CODAS wall, light direction ──────────────────────────
   A wall of jScope windows on white, a spreadsheet of interlocks and
   scalars, status words in coloured boxes, the pulse number in plain
   bold digits, the port view as the camera tile. */

const THEME = 'jet'

/** Keep html[data-theme] on this composition's token block while mounted.
 *  The settings provider re-asserts its own theme on mount, so an observer
 *  puts ours back; the previous value is restored on unmount. */
function useJetTheme() {
  useEffect(() => {
    const el = document.documentElement
    const prev = el.getAttribute('data-theme')
    el.setAttribute('data-theme', THEME)
    const mo = new MutationObserver(() => {
      if (el.getAttribute('data-theme') !== THEME) el.setAttribute('data-theme', THEME)
    })
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mo.disconnect()
      if (prev === null) el.removeAttribute('data-theme')
      else el.setAttribute('data-theme', prev)
    }
  }, [])
}

const ROWS_A: RowDef[] = [
  { label: 'Ip', unit: 'MA', series: [{ key: 'ip' }], ref: (p) => p.ip, yMin: 0 },
  { label: 'ne', unit: '1e20 m-3', series: [{ key: 'ne_bar' }, { key: 'ne_ped', name: 'ped' }], ref: (p) => p.ne_target, yMin: 0 },
  { label: 'Pin', unit: 'MW', series: [{ key: 'p_input' }, { key: 'p_rad', name: 'Prad' }], ref: (p) => sumWaveforms([p.p_nbi, p.p_ech, p.p_ich]), yMin: 0, digits: 1 },
  { label: 'Wth', unit: 'MJ', series: [{ key: 'w_th' }], yMin: 0 },
  { label: 'Te0', unit: 'keV', series: [{ key: 'te0' }, { key: 'te_ped', name: 'ped' }], yMin: 0 },
  { label: 'Vloop', unit: 'V', series: [{ key: 'v_loop' }] },
]

const ROWS_B: RowDef[] = [
  { label: 'Dalpha', unit: 'a.u.', series: [{ key: 'd_alpha' }], yMin: 0 },
  { label: 'betaN', unit: '', series: [{ key: 'beta_n' }], yMin: 0 },
  { label: 'q95', unit: '', series: [{ key: 'q95' }, { key: 'li', name: 'li' }], yMin: 0, yMax: 10 },
  { label: 'H98', unit: '', series: [{ key: 'h_factor' }, { key: 'f_greenwald', name: 'fGW' }], yMin: 0 },
  { label: 'PsiOH', unit: 'V.s', series: [{ key: 'psi_oh' }, { key: 'i_ni', name: 'Ini' }], yMin: 0, digits: 1 },
  { label: 'hazard', unit: '1/s', series: [{ key: 'disruption_risk' }], yMin: 0, digits: 3 },
]

const SPEEDS = [2, 1, 0.75, 0.5]

/** Magnetic configuration as the short code a status word can carry. */
function configCode(cfg: string | undefined): string {
  const c = (cfg ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (c.includes('lowersingle')) return 'LSN'
  if (c.includes('uppersingle')) return 'USN'
  if (c.includes('double')) return 'DN'
  if (c.includes('limit')) return 'LIM'
  return (cfg ?? '').toUpperCase().slice(0, 6) || 'DIV'
}

export default function Composition({ ctx }: { ctx: ControlRoomContext }) {
  useJetTheme()
  const s = ctx.displaySnapshot
  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const plasma = !!s && s.ip > 0.05 && !s.disrupted
  const simStatus = s?.status ?? 'Ready'

  const words = useMemo(() => [
    { text: 'PLASMA', on: plasma, cls: 'ok' },
    { text: s?.in_hmode ? 'H-MODE' : 'L-MODE', on: plasma, cls: s?.in_hmode ? 'ok' : 'blue' },
    { text: 'ELMING', on: plasma && !!s?.elm_active, cls: 'warn' },
    { text: s?.is_limited ? 'LIMITED' : configCode(s?.magnetic_config), on: plasma, cls: 'blue' },
    { text: 'OH SAT', on: !!s?.oh_saturated, cls: 'warn' },
    { text: 'FLUX', on: !!s?.flux_exhausted, cls: 'alarm' },
    { text: 'DISRUPTED', on: !!s?.disrupted, cls: 'alarm' },
  ], [s, plasma])

  const tDisp = ctx.scrubTime !== null ? ctx.scrubTime : ctx.time

  return (
    <div data-layout="jet" className="jet-root">
      {/* ── toolbar ── */}
      <div className="jet-toolbar">
        <button className="jet-btn" onClick={ctx.running ? ctx.controls.pause : ctx.controls.start}>
          {ctx.running ? 'Pause' : 'Start'}
        </button>
        <button className="jet-btn" onClick={ctx.controls.reset}>Reset</button>
        <span className="jet-sep" />
        <label>Speed
          <select value={ctx.activeSpeed} onChange={(e) => ctx.onSpeedChange(Number(e.target.value))}>
            {SPEEDS.map((v) => <option key={v} value={v}>{v}x</option>)}
          </select>
        </label>
        <span className="jet-sep" />
        <button className={`jet-btn${ctx.showPlanner ? ' down' : ''}`} onClick={ctx.togglePlanner}>Edit</button>
        <span className="jet-sep" />
        <label>Device
          <select value={ctx.activeDevice} onChange={(e) => ctx.onDeviceChange(e.target.value)}>
            {ctx.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>Scenario
          <select value={ctx.activePreset} onChange={(e) => ctx.onPresetChange(e.target.value as PresetId)}>
            {ctx.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {ctx.showsFuelToggle && (
          <label>Fuel
            <select value={ctx.fuelType} onChange={(e) => ctx.onFuelChange(e.target.value as 'DD' | 'DT')}>
              <option value="DD">DD</option>
              <option value="DT">DT</option>
            </select>
          </label>
        )}
        {ctx.hasCustomProgram && <span className="jet-flag">PROG EDITED</span>}
        <span className="jet-grow" />
        <span className="jet-settings">{ctx.settingsNode}</span>
      </div>

      {/* ── header strip: pulse, time, status words ── */}
      <div className="jet-head">
        <span className="jet-pulse">
          <span className="jet-pulse-lbl">PULSE</span>
          <span className="jet-digits">{ctx.pulseNumber ?? '-----'}</span>
        </span>
        <span className="jet-time">
          <span className="jet-pulse-lbl">t</span>
          <span className="jet-digits">{tDisp.toFixed(2)}</span>
          <span className="jet-time-of">/ {ctx.duration.toFixed(1)} s</span>
        </span>
        <span className="jet-mode">{dev?.name ?? ctx.activeDevice} &nbsp;{simStatus.toUpperCase()}{ctx.scrubTime !== null ? ' REPLAY' : ''}</span>
        <span className="jet-grow" />
        <span className="jet-words">
          {words.map((w) => (
            <span key={w.text} className={`jet-word${w.on ? ` on ${w.cls}` : ''}`}>{w.text}</span>
          ))}
        </span>
      </div>

      {/* ── wall ── */}
      <div className="jet-wall">
        <div className="jet-col-left">
          <div className="jet-panel jet-panel-table">
            <div className="jet-title">{dev?.name ?? ''} scalars / interlocks</div>
            <InterlockTable snapshot={s} device={dev} />
          </div>
          <div className="jet-panel jet-panel-eq">
            <div className="jet-title">Equilibrium  R-Z  {plasma ? configCode(s?.magnetic_config) : ''}</div>
            <div className="jet-eq">
              <EquilibriumCanvas snapshot={s} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
            </div>
          </div>
        </div>

        <div className="jet-col-mid">
          <div className="jet-panel jet-panel-scope">
            <div className="jet-title">jScope  PLASMA  #{ctx.pulseNumber ?? '-'}</div>
            <JScope
              rows={ROWS_A}
              history={ctx.history}
              programJson={ctx.programJson}
              duration={ctx.duration}
              time={ctx.time}
              scrubTime={ctx.scrubTime}
              finished={ctx.finished}
              onScrub={ctx.controls.setScrubTime}
            />
          </div>
          <div className="jet-panel jet-panel-scope">
            <div className="jet-title">jScope  EDGE / MHD  #{ctx.pulseNumber ?? '-'}</div>
            <JScope
              rows={ROWS_B}
              history={ctx.history}
              programJson={ctx.programJson}
              duration={ctx.duration}
              time={ctx.time}
              scrubTime={ctx.scrubTime}
              finished={ctx.finished}
              onScrub={ctx.controls.setScrubTime}
            />
          </div>
        </div>

        <div className="jet-col-right">
          <div className="jet-panel jet-panel-cam">
            <div className="jet-title">Camera  KL1  port view</div>
            <div className="jet-cam">
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
          <div className="jet-panel jet-panel-log">
            <div className="jet-title">Event log  #{ctx.pulseNumber ?? '-'}</div>
            <EventList ctx={ctx} />
          </div>
        </div>
      </div>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}

function useAutoScroll(n: number) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [n])
  return ref
}

function EventList({ ctx }: { ctx: ControlRoomContext }) {
  const listRef = useAutoScroll(ctx.events.length + (ctx.report ? 1 : 0))
  return (
    <div className="jet-log" ref={listRef}>
      {ctx.events.map((ev) => (
        <div key={ev.id} className={`jet-ev sev-${ev.severity}`}>
          <span className="jet-ev-t">{ev.t.toFixed(3)}</span>
          <span className="jet-ev-tag">{ev.severity === 'info' ? '' : ev.severity.toUpperCase()}</span>
          <span className="jet-ev-text">{ev.text}</span>
        </div>
      ))}
      {ctx.report && (
        <>
          <div className="jet-report-h">REPORT  prog | achieved</div>
          {ctx.report.map((r) => (
            <div key={r.label} className={`jet-rep sev-${r.status ?? 'info'}`}>
              <span className="jet-rep-l">{r.label}</span>
              <span className="jet-rep-p">{r.programmed ?? ''}</span>
              <span className="jet-rep-a">{r.achieved}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
