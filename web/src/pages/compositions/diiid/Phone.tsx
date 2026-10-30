import { useMemo, useRef, useState } from 'react'
import type { ControlRoomContext } from '../types'
import EquilibriumCanvas from '../../../components/EquilibriumCanvas'
import PortView from '../../../components/portview'
import StripChart from './StripChart'
import SevenSeg from './SevenSeg'
import { PhoneBars } from './DiagBars'
import { statusCells, type Cell } from './statusCells'
import { useWallCharts, PHONE_CHANNELS, GREEN, YELLOW, CYAN, RED, MAGENTA } from './charts'
import { useDiagnostics } from '../useDiagnostics'
import { flatTopWindow, parseProgram, pulsePhase } from '../kaldera/phase'
import { reconstructionValid } from '../../../lib/pulseLog'
import { formatQ } from '../../../lib/fusionPhysics'
import { useSettings } from '../../../lib/settingsContext'

const SEV: Record<string, string> = { info: '#bbbbbb', ok: GREEN, minor: YELLOW, major: RED, invalid: MAGENTA }
const SPEEDS = [2, 1, 0.75, 0.5]
const speedText = (s: number) => (s === 1 ? '1' : s === 2 ? '2' : s.toFixed(2).replace(/^0/, '')) + '×'
const clock = (t: number) => Math.max(0, t).toFixed(2).padStart(5, ' ')
const f = (v: number | undefined, d = 2) => (v === undefined || !isFinite(v) ? '--' : v.toFixed(d))

/** A word that opens a native picker: the visible text is ours, a transparent select on top takes the tap. */
function PickWord({ value, label, options, onChange, className }: {
  value: string; label: string; options: { id: string; label: string }[]; onChange: (id: string) => void; className?: string
}) {
  return (
    <label className={`dcp-pick ${className ?? ''}`}>
      <span className="dcp-pick-v">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** The DIII-D wall on a phone: the same black field, white-box strips and state cells, stacked. */
export default function Phone({ ctx }: { ctx: ControlRoomContext }) {
  const { phoneTraces, setPhoneTraces } = useSettings()
  const { T, phone } = useWallCharts(ctx)
  const snap = ctx.displaySnapshot
  const h = ctx.history
  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const preset = ctx.presets.find((p) => p.id === ctx.activePreset)

  // ── state line: eight cells that carry real state ──
  let elming = false
  for (let i = h.length - 1; i >= 0 && h[i].t > ctx.time - 0.3; i--) if (h[i].elm_active) { elming = true; break }
  const win = useMemo(() => flatTopWindow(parseProgram(ctx.programJson).ip), [ctx.programJson])
  const phase = pulsePhase(win, ctx.time, ctx.running, ctx.finished, snap, ctx.scrubTime !== null)
  const by: Record<string, Cell> = {}
  for (const c of statusCells(snap, ctx.running, ctx.fuelType, elming)) by[c.k] = c
  const state: Cell[] = [
    { k: 'PHASE', v: phase, lamp: phase === 'DISRUPT' ? 'bad' : phase === 'FLAT-TOP' ? 'ok' : phase === 'STANDBY' ? 'off' : 'info' },
    by.STATUS, by.MODE, by.ELM,
    { ...by.CONFIGURATION, k: 'CONFIG' }, by.OH, { ...by['Ψ_OH'], k: 'FLUX Ψ_OH' }, { ...by.RISK, k: 'HAZARD' },
  ]

  // ── diagnostics and readouts ──
  const valid = reconstructionValid(snap)
  const diag = useDiagnostics(snap, valid)
  // Reconstructed quantities mean nothing without a plasma: blank them rather than show the engine's fill values.
  const rv = (v: number | undefined) => (valid ? v : undefined)
  const pfus = diag.pFus > 0.001 ? f(diag.pFus, diag.pFus < 10 ? 3 : 1) : '--'
  const q = diag.rate > 0 ? formatQ(diag.qPlasma) : '--'
  const [more, setMore] = useState(false)
  const s = snap
  const essential: [string, string, string][] = [
    ['Ip', f(s?.ip), 'MA'], ['n̄e', f(s?.ne_bar), 'e20/m3'],
    ['Wth', f(s?.w_th), 'MJ'], ['βN', f(rv(s?.beta_n)), ''],
    ['q95', f(rv(s?.q95)), ''], ['fGW', f(rv(s?.f_greenwald)), ''],
  ]
  const rest: [string, string, string][] = [
    ['Bt', f(s?.bt), 'T'], ['Te0', f(s?.te0), 'keV'],
    ['Pin', f(s?.p_input, 1), 'MW'], ['POH', f(s?.p_ohmic), 'MW'],
    ['Prad', f(s?.p_rad), 'MW'], ['Pα', f(s?.p_alpha, 3), 'MW'],
    ['τE', f(rv(s?.tau_e), 3), 's'], ['H98', f(rv(s?.h_factor)), ''],
    ['li', f(rv(s?.li)), ''], ['Zeff', f(s?.z_eff), ''],
    ['Vloop', f(s?.v_loop), 'V'], ['Te,ped', f(s?.te_ped), 'keV'],
    ['λq', diag.valid ? f(diag.lambdaQ, 1) : '--', 'mm'], ['fdet', diag.valid ? f(diag.fDet) : '--', ''],
  ]

  // ── traces ──
  const [listOpen, setListOpen] = useState(false)
  const shown = phoneTraces.filter((k) => phone[k])
  const toggle = (k: string) => setPhoneTraces(phoneTraces.includes(k) ? phoneTraces.filter((x) => x !== k) : [...phoneTraces, k])

  // ── pinned key row: the progress line, its playhead, and scrubbing by the handle only ──
  const trackRef = useRef<HTMLDivElement>(null)
  const at = ctx.scrubTime !== null ? ctx.scrubTime / T : ctx.progress / 100
  const pct = `${(Math.max(0, Math.min(1, at)) * 100).toFixed(2)}%`
  const scrubFrom = (e: React.PointerEvent) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    ctx.controls.setScrubTime(Math.max(0, Math.min(T, ((e.clientX - r.left) / r.width) * T)))
  }
  const ticks = win ? [win[0], win[1]].filter((t) => t > 0 && t < T) : []

  const pulse = ctx.pulseNumber === null ? '      ' : String(ctx.pulseNumber).padStart(6, ' ')
  const remaining = ctx.duration - ctx.time
  const lastEvents = ctx.events.slice(-3).reverse()

  return (
    <div data-layout="diiid" data-phone="" className="dc-root">
      <header className="dcp-head">
        <PickWord className="dcp-dev" value={ctx.activeDevice} label={dev?.name ?? ctx.activeDevice}
          options={ctx.devices.map((d) => ({ id: d.id, label: d.name }))} onChange={ctx.onDeviceChange} />
        <PickWord className="dcp-scn" value={ctx.activePreset} label={(preset?.label ?? ctx.activePreset).toUpperCase()}
          options={ctx.presets} onChange={(id) => ctx.onPresetChange(id as typeof ctx.activePreset)} />
        <span className="dcp-fill" />
        <div className="dcp-shot">
          <span className="dcp-k">SHOT</span>
          <SevenSeg text={pulse} color={CYAN} size={20} />
        </div>
        <div className="dcp-clocks">
          <div><span className="dcp-k">T+</span><SevenSeg text={clock(ctx.time)} color={GREEN} size={11} /></div>
          <div><span className="dcp-k">T−</span><SevenSeg text={clock(remaining)} color={ctx.finished ? RED : YELLOW} size={11} /></div>
        </div>
        <span className="dcp-settings">{ctx.settingsNode}</span>
      </header>

      <div className="dcp-state">
        {state.map((c) => (
          <div key={c.k} className="dc-cell" data-lamp={c.lamp}>
            <span className="dc-cell-k">{c.k}</span>
            <span className="dc-cell-v">{c.v}</span>
          </div>
        ))}
      </div>

      <div className="dcp-pair">
        <div className="dc-tile dc-eq" data-tutorial="equilibrium">
          <EquilibriumCanvas snapshot={snap} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
          <span className="dc-tile-title">EFIT01</span>
          {snap && by.CONFIGURATION.v !== '--' && (
            <span className="dcp-eq-cfg">{by.CONFIGURATION.v}<br />{snap.is_limited ? 'LIMITED' : 'DIVERTED'}</span>
          )}
        </div>
        <div className="dc-tile dc-cam" data-tutorial="portview">
          <PortView framing="wide" snapshot={ctx.plasmaSnapshot} limiterPoints={ctx.limiterPoints} deviceId={ctx.activeDevice}
            wallJson={ctx.wallJson} deviceR0={dev?.r0} deviceA={dev?.a} />
          <span className="dc-tile-title">TV TANGENTIAL</span>
        </div>
      </div>

      <section className="dcp-green" data-tutorial="status">
        <PhoneBars d={diag} pfus={pfus} q={q} />
        <div className="dcp-read-head">
          <span className="dcp-cap">SCALARS</span>
          <span className="dcp-fill" />
          {ctx.showsFuelToggle && (['DD', 'DT'] as const).map((fu) => (
            <button key={fu} className="dc-key dcp-key-s" data-on={ctx.fuelType === fu} onClick={() => ctx.onFuelChange(fu)}>{fu}</button>
          ))}
          <button className="dc-key dcp-key-s" data-on={more} aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'LESS' : 'MORE'}</button>
        </div>
        <div className="dcp-grid">
          {(more ? [...essential, ...rest] : essential).map(([k, v, u]) => (
            <div key={k} className="dc-text-row"><span>{k}</span><span>{v}</span><span>{u}</span></div>
          ))}
        </div>
      </section>

      <section className="dcp-traces" data-tutorial="traces">
        <div className="dcp-traces-head">
          <span className="dcp-cap">STRIP CHARTS {shown.length}/{PHONE_CHANNELS.length}</span>
          <span className="dcp-fill" />
          <button className="dc-key dcp-key-s" data-on={listOpen} aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
            {listOpen ? 'DONE' : '+ TRACES'}
          </button>
        </div>
        {listOpen && (
          <div className="dcp-chan">
            {PHONE_CHANNELS.map((c) => (
              <button key={c.key} className="dc-key" data-on={phoneTraces.includes(c.key)} aria-pressed={phoneTraces.includes(c.key)} onClick={() => toggle(c.key)}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        {shown.map((k) => {
          const c = phone[k]
          return (
            <StripChart key={k} title={c.title} unit={c.unit} series={c.series} tMax={T} yMin={c.yMin} yMax={c.yMax}
              scrubTime={ctx.scrubTime} liveTime={ctx.time} yTicks={2} />
          )
        })}
      </section>

      <div className="dcp-ticker">
        <span className="dc-ticker-k">{ctx.pulseNumber !== null ? `#${ctx.pulseNumber}` : '--'}</span>
        {ctx.finished && ctx.report
          ? ctx.report.slice(0, 6).map((r, i) => (
            <span key={i} className="dc-ev" style={{ color: r.status === 'major' ? RED : r.status === 'minor' ? YELLOW : '#bbbbbb' }}>
              {r.label} {r.achieved}{r.programmed ? ` / ${r.programmed}` : ''}
            </span>
          ))
          : lastEvents.map((e) => (
            <span key={e.id} className="dc-ev" style={{ color: SEV[e.severity] ?? '#bbbbbb' }}>
              {e.t.toFixed(3)} {e.text}
            </span>
          ))}
      </div>

      <div className="dcp-keys" data-tutorial="controls">
        <div className="dcp-line" ref={trackRef}>
          <span className="dcp-line-fill" style={{ width: pct }} />
          {ticks.map((t, i) => <span key={i} className="dcp-line-tick" style={{ left: `${(t / T) * 100}%` }} />)}
          <span
            className="dcp-handle"
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
        <div className="dcp-keyrow">
          <button className="dc-key dc-key-run dcp-key" data-on={ctx.running} onClick={() => (ctx.running ? ctx.controls.pause() : ctx.controls.start())}>
            {ctx.running ? 'PAUSE' : 'START'}
          </button>
          <button className="dc-key dcp-key" onClick={() => ctx.controls.reset()}>RESET</button>
          <PickWord className="dc-key dcp-key dcp-speed" value={String(ctx.activeSpeed)} label={`SPEED ${speedText(ctx.activeSpeed)}`}
            options={SPEEDS.map((v) => ({ id: String(v), label: speedText(v) }))} onChange={(v) => ctx.onSpeedChange(Number(v))} />
          <button className="dc-key dcp-key" data-on={ctx.showPlanner} onClick={ctx.togglePlanner}>EDIT{ctx.hasCustomProgram ? '*' : ''}</button>
        </div>
      </div>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
