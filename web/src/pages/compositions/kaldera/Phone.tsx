import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ControlRoomContext } from '../types'
import type { TracePoint } from '../../../lib/types'
import PortView from '../../../components/portview'
import { useSettings, DEFAULT_PHONE_TRACES } from '../../../lib/settingsContext'
import { equilibriumInfo, plasmaParamsInfo, traceDescriptions } from '../../../components/infoContent'
import Hero from './Hero'
import Strips, { type Pts, type Strip } from './Strips'
import Timeline, { type Station } from './Timeline'
import Diagnostics, { type Tone } from './Diagnostics'
import InfoHint from './InfoHint'
import type { DisplayClock } from './displayClock'
import type { Phase, Waveform } from './phase'
import { f1, f2, G, PRESET_WORD, Readout, ReportPanel, STAB, POWER, configWord, hazardPct } from './shared'

/** What the desktop composition has already derived, handed over so both layouts agree. */
export interface PhoneView {
  valid: boolean
  clock: DisplayClock
  phase: Phase
  pulseNo: string
  stateWord: string
  stations: Station[]
  T: number
  program: Record<string, Waveform>
  pinRef: Waveform | undefined
  speeds: number[]
  tones: { beta: Tone; q95: Tone; fgw: Tone; haz: Tone }
  showReport: boolean
  onCloseReport: () => void
  onToggleReport: () => void
}

const fmtT = (t: number) => `${Math.max(0, t).toFixed(3)} S`
const speedWord = (sp: number) => (sp === 1 ? '1' : sp === 2 ? '2' : sp.toFixed(2).replace(/0$/, ''))

/** The phone trace channels, keyed as the shared `phoneTraces` setting keys them (TracePoint names). */
const CHANNELS: { key: string; word: ReactNode }[] = [
  { key: 'ip', word: <>I<sub>P</sub></> },
  { key: 'w_th', word: <>W<sub>TH</sub></> },
  { key: 'd_alpha', word: <>D <G>α</G></> },
  { key: 'ne_bar', word: <>N̄<sub>E</sub> . F<sub>GW</sub></> },
  { key: 'p_input', word: <>P<sub>IN</sub> . P<sub>RAD</sub></> },
  { key: 'beta_n', word: <><G>β</G><sub>N</sub></> },
  { key: 'q95', word: <>Q<sub>95</sub></> },
  { key: 'v_loop', word: <>V<sub>LOOP</sub></> },
  { key: 'te0', word: <>T<sub>E0</sub></> },
  { key: 'tau_e', word: <><G>τ</G><sub>E</sub></> },
  { key: 'h_factor', word: <>H<sub>98</sub></> },
  { key: 'psi_oh', word: <><G>Ψ</G><sub>OH</sub></> },
  { key: 'disruption_risk', word: <>HAZARD</> },
]

/**
 * τ_E is not in the trace history, so the phone records it from the live
 * snapshot as the pulse runs (cleared when the history resets). The ref is a
 * per-render accumulator, like useEma: read and written in render on purpose.
 */
/* eslint-disable react-hooks/refs */
function useRecorded(t: number, v: number | undefined, live: boolean, historyLen: number): Pts {
  const ref = useRef<Pts>([])
  if (historyLen === 0) ref.current = []
  else if (live && v !== undefined && isFinite(v)) {
    const a = ref.current
    if (a.length && t < a[a.length - 1][0] - 1e-6) ref.current = []
    if (!ref.current.length || t > ref.current[ref.current.length - 1][0]) ref.current = [...ref.current, [t, v]]
  }
  return ref.current
}
/* eslint-enable react-hooks/refs */

/** Device, scenario and fuel: one tap target in the header that opens the choices under it. */
function Choices({ ctx, onClose }: { ctx: ControlRoomContext; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || t.closest?.('.kd-ph-pick')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [onClose])
  const row = (cap: string, items: { id: string; word: string; on: boolean; go: () => void }[]) => (
    <div className="kd-ph-choice-row">
      <span className="kd-ph-cap">{cap}</span>
      <span className="kd-ph-choice-items">
        {items.map((it) => (
          <button key={it.id} className="kd-ph-word" data-on={it.on} onClick={() => { it.go(); onClose() }}>{it.word}</button>
        ))}
      </span>
    </div>
  )
  return (
    <div ref={ref} className="kd-ph-choices" role="dialog" aria-label="Device and scenario">
      {row('DEVICE', ctx.devices.map((d) => ({ id: d.id, word: d.name.toUpperCase(), on: d.id === ctx.activeDevice, go: () => ctx.onDeviceChange(d.id) })))}
      {row('SCENARIO', ctx.presets.map((p) => ({ id: p.id, word: PRESET_WORD[p.id] ?? p.label.toUpperCase(), on: p.id === ctx.activePreset, go: () => ctx.onPresetChange(p.id) })))}
      {ctx.showsFuelToggle && row('FUEL', (['DD', 'DT'] as const).map((f) => ({ id: f, word: f, on: ctx.fuelType === f, go: () => ctx.onFuelChange(f) })))}
    </div>
  )
}

/**
 * The Modern room on a phone: the shared skeleton (header, state line, the
 * pair, bars, readouts, traces, pinned controls) in the same grammar as the
 * desktop: tracked caps on the flat field, hairlines, the warm hue for
 * interaction and the state hues on bars, words and threshold readouts.
 */
export default function Phone({ ctx, view }: { ctx: ControlRoomContext; view: PhoneView }) {
  const { displaySnapshot: s, history, running, finished, scrubTime, time } = ctx
  const { valid, clock, phase, pulseNo, stateWord, stations, T, program, pinRef, speeds, tones } = view
  const { phoneTraces, setPhoneTraces } = useSettings()
  const [picking, setPicking] = useState(false)
  const [more, setMore] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const rv = (v: number | undefined) => (valid ? v : undefined)

  // The time in the header follows the display clock every painted frame.
  const timeRef = useRef<HTMLSpanElement>(null)
  useEffect(() => clock.subscribe((t) => {
    if (timeRef.current) timeRef.current.textContent = fmtT(scrubTime ?? Math.min(t, T))
  }), [clock, scrubTime, T])

  const tauPts = useRecorded(time, s?.tau_e, running && scrubTime === null && valid, history.length)

  const lastT = history.length ? history[history.length - 1].t : 0
  const all: Record<string, Strip> = useMemo(() => {
    const pick = (k: keyof TracePoint): Pts => history.map((p) => [p.t, Number(p[k])] as [number, number])
    return {
      ip: { id: 'ip', label: 'IP', node: <>I<sub>P</sub></>, hint: traceDescriptions.ip, unit: 'MA', pts: pick('ip'), ref: program.ip },
      w_th: { id: 'w_th', label: 'W TH', node: <>W<sub>TH</sub></>, hint: traceDescriptions.w_th, unit: 'MJ', pts: pick('w_th') },
      d_alpha: { id: 'd_alpha', label: 'D α', node: <>D <G>α</G></>, hint: traceDescriptions.d_alpha, pts: pick('d_alpha'), elm: history.map((p) => !!p.elm_active) },
      ne_bar: { id: 'ne_bar', label: 'N̄E', node: <>N̄<sub>E</sub></>, hint: traceDescriptions.ne_bar, pts: pick('ne_bar'), ref: program.ne_target, second: { label: 'F GW', node: <>F<sub>GW</sub></>, hint: traceDescriptions.f_greenwald, pts: pick('f_greenwald'), own: true }, blank: !valid },
      p_input: { id: 'p_input', label: 'P IN', node: <>P<sub>IN</sub></>, hint: traceDescriptions.p_input, unit: 'MW', pts: pick('p_input'), ref: pinRef, second: { label: 'P RAD', node: <>P<sub>RAD</sub></>, hint: traceDescriptions.p_rad, pts: pick('p_rad') }, digits: 1 },
      beta_n: { id: 'beta_n', label: 'BETA N', node: <><G>β</G><sub>N</sub></>, hint: traceDescriptions.beta_n, pts: pick('beta_n'), blank: !valid },
      q95: { id: 'q95', label: 'Q95', node: <>Q<sub>95</sub></>, hint: traceDescriptions.q95, pts: pick('q95'), blank: !valid },
      v_loop: { id: 'v_loop', label: 'V LOOP', node: <>V<sub>LOOP</sub></>, hint: traceDescriptions.v_loop, unit: 'V', pts: pick('v_loop') },
      te0: { id: 'te0', label: 'TE0', node: <>T<sub>E0</sub></>, hint: traceDescriptions.te0, unit: 'KEV', pts: pick('te0'), blank: !valid },
      tau_e: { id: 'tau_e', label: 'TAU E', node: <><G>τ</G><sub>E</sub></>, unit: 'S', pts: tauPts, digits: 3, blank: !valid },
      h_factor: { id: 'h_factor', label: 'H98', node: <>H<sub>98</sub></>, hint: traceDescriptions.h_factor, pts: pick('h_factor'), blank: !valid },
      psi_oh: { id: 'psi_oh', label: 'PSI OH', node: <><G>Ψ</G><sub>OH</sub></>, hint: traceDescriptions.psi_oh, unit: 'V·S', pts: pick('psi_oh') },
      disruption_risk: { id: 'disruption_risk', label: 'HAZARD', hint: traceDescriptions.disruption_risk, unit: '%/S', pts: history.map((p) => [p.t, p.disruption_risk * 100] as [number, number]), blank: !valid },
    }
  // history is mutated in place by the simulation hook; key on its length and last time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, history.length, lastT, program, pinRef, valid, tauPts])

  const keys = phoneTraces.filter((k) => k in all)
  const shown = (keys.length ? keys : DEFAULT_PHONE_TRACES).map((k) => all[k])
  const toggle = (k: string) => {
    if (keys.includes(k)) { if (keys.length > 1) setPhoneTraces(keys.filter((x) => x !== k)) }
    else setPhoneTraces([...keys, k])
  }

  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const scenario = PRESET_WORD[ctx.activePreset] ?? ctx.presets.find((p) => p.id === ctx.activePreset)?.label.toUpperCase() ?? ''
  const hasReport = finished && !!ctx.report && ctx.report.length > 0
  const STRIP_H = 70, AXIS = 16

  return (
    <div data-layout="kaldera" data-phone="" className="kd-root">
      <header className="kd-ph-head">
        <button className="kd-ph-pick" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
          <span className="kd-ph-cap">CONTROL ROOM</span>
          <span className="kd-ph-val">
            {dev?.name.toUpperCase() ?? ctx.activeDevice.toUpperCase()} <span className="kd-dot">.</span> {scenario}
            {ctx.showsFuelToggle && <> <span className="kd-dot">.</span> {ctx.fuelType}</>}
            <span className="kd-ph-caret" aria-hidden="true" />
          </span>
        </button>
        <div className="kd-ph-pulse">
          <span className="kd-ph-cap">PULSE {pulseNo}</span>
          <span ref={timeRef} className="kd-ph-time">{fmtT(scrubTime ?? Math.min(clock.get(), T))}</span>
        </div>
        <span className="kd-settings kd-ph-settings">{ctx.settingsNode}</span>
        {picking && <Choices ctx={ctx} onClose={() => setPicking(false)} />}
      </header>

      <div className="kd-ph-state" data-state={stateWord}>
        <span className="kd-phase" data-tone={phase === 'DISRUPT' ? 'bad' : undefined}>{phase}</span>
        {stateWord !== phase && <><span className="kd-dot">.</span><span className="kd-ph-mode">{stateWord}</span></>}
        {s?.oh_saturated && <span className="kd-flag">OH SATURATED</span>}
        {s?.flux_exhausted && <span className="kd-flag">FLUX</span>}
        <span className="kd-haz">HAZARD <span className="kd-haz-v" data-tone={tones.haz}>{valid ? hazardPct(s?.disruption_risk) : '—'}</span>{valid ? ' %/S' : ''}</span>
        {hasReport && (
          <button className="kd-ph-report-open" data-on={view.showReport} onClick={view.onToggleReport}>REPORT</button>
        )}
      </div>

      <section className="kd-ph-pair">
        <div className="kd-ph-eq" data-tutorial="equilibrium">
          <div className="kd-ph-paircap">
            <InfoHint title="Equilibrium" content={equilibriumInfo}>EQUILIBRIUM</InfoHint>
            <span className="kd-dot">.</span><span className="kd-ph-config">{configWord(s)}</span>
          </div>
          <div className="kd-ph-eqbox">
            <Hero snapshot={s} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} bare />
            <span className="kd-ph-bt"><span className="kd-ph-cap">B<sub>T</sub></span>{f2(s?.bt)} T</span>
          </div>
        </div>
        <div className="kd-ph-portcol">
          <div className="kd-ph-paircap">PORT VIEW</div>
          <div className="kd-port kd-ph-port" data-tutorial="portview">
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
      </section>

      <section className="kd-ph-status" data-tutorial="status">
        <Diagnostics snapshot={s} valid={valid} compact />
        <div className="kd-ph-sechead">
          <InfoHint title="Plasma parameters" content={plasmaParamsInfo}>PLASMA</InfoHint>
          <button className="kd-ph-word kd-ph-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? 'LESS' : 'MORE'}</button>
        </div>
        <div className="kd-scalars kd-ph-scalars">
          <Readout value={f2(s?.ip)} unit="MA" caption={<>I<sub>P</sub></>} />
          <Readout value={f2(s?.ne_bar)} unit="10²⁰ M⁻³" caption={<>N̄<sub>E</sub></>} />
          <Readout value={f2(s?.w_th)} unit="MJ" caption={<>W<sub>TH</sub></>} />
          <Readout value={f2(rv(s?.beta_n))} caption={<><G>β</G><sub>N</sub></>} hint={STAB} tone={tones.beta} />
          <Readout value={f2(rv(s?.q95))} caption={<>Q<sub>95</sub></>} hint={STAB} tone={tones.q95} />
          <Readout value={f2(rv(s?.f_greenwald))} caption={<>F<sub>GW</sub></>} hint={STAB} tone={tones.fgw} />
          {more && (
            <>
              <Readout value={f1(s?.p_input)} unit="MW" caption={<>P<sub>IN</sub></>} hint={POWER} />
              <Readout value={f1(s?.p_rad)} unit="MW" caption={<>P<sub>RAD</sub></>} hint={POWER} />
              <Readout value={f2(rv(s?.te0))} unit="KEV" caption={<>T<sub>E0</sub></>} />
              <Readout value={f2(rv(s?.tau_e))} unit="S" caption={<><G>τ</G><sub>E</sub></>} />
              <Readout value={f2(rv(s?.h_factor))} caption={<>H<sub>98</sub></>} />
              <Readout value={f2(s?.v_loop)} unit="V" caption={<>V<sub>LOOP</sub></>} />
            </>
          )}
        </div>
      </section>

      <section className="kd-ph-traces">
        <div className="kd-ph-sechead">
          <span>TRACES</span>
          <button className="kd-ph-word kd-ph-more" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)}>{listOpen ? 'DONE' : '+ TRACES'}</button>
        </div>
        {listOpen && (
          <div className="kd-ph-list">
            {CHANNELS.map((c) => (
              <button key={c.key} className="kd-ph-word" data-on={keys.includes(c.key)} aria-pressed={keys.includes(c.key)} onClick={() => toggle(c.key)}><span>{c.word}</span></button>
            ))}
          </div>
        )}
        <div className="kd-ph-strips" style={{ height: shown.length * STRIP_H + AXIS }}>
          <Strips
            strips={shown}
            stations={stations}
            duration={T}
            clock={clock}
            scrubTime={scrubTime}
            hot={null}
            onHot={() => {}}
            fontPx={11}
          />
        </div>
      </section>

      {view.showReport && ctx.report && (
        <div className="kd-ph-sheet">
          <ReportPanel rows={ctx.report} pulseNo={pulseNo} onClose={view.onCloseReport} />
        </div>
      )}

      <div className="kd-ph-ctl" data-tutorial="controls">
        <div className="kd-ph-tl">
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
            headOnly
          />
        </div>
        <div className="kd-ph-row">
          <button className="kd-ph-btn" onClick={ctx.controls.reset}>RESET</button>
          <span className="kd-ph-speeds">
            <span className="kd-ph-cap">SPEED</span>
            {speeds.map((sp) => (
              <button key={sp} className="kd-ph-btn kd-ph-speed" data-on={ctx.activeSpeed === sp} aria-pressed={ctx.activeSpeed === sp} onClick={() => ctx.onSpeedChange(sp)}>{speedWord(sp)}</button>
            ))}
          </span>
          <button className="kd-ph-btn" data-on={ctx.showPlanner} onClick={ctx.togglePlanner}>EDIT{ctx.hasCustomProgram ? ' *' : ''}</button>
        </div>
      </div>

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
