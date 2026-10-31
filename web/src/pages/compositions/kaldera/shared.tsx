/* eslint-disable react-refresh/only-export-components -- helpers shared by the desktop and phone compositions */
import { useEffect, useRef, type ReactNode } from 'react'
import type { Snapshot } from '../../../lib/types'
import type { ReportRow } from '../../../lib/pulseLog'
import { powerBalanceInfo, stabilityInfo } from '../../../components/infoContent'
import InfoHint from './InfoHint'
import type { Tone } from './Diagnostics'
import type { Waveform } from './phase'
import { createDisplayClock, type DisplayClock } from './displayClock'
import { Fx } from '../Fixed'
import { reportLabel } from '../reportLabel'

export const f2 = (v: number | undefined) => (v !== undefined && isFinite(v) ? v.toFixed(2) : '—')
export const f1 = (v: number | undefined) => (v !== undefined && isFinite(v) ? v.toFixed(1) : '—')

/** Scenario names as abbreviations, never phrases. */
export const PRESET_WORD: Record<string, string> = { hmode: 'H-MODE', lmode: 'L-MODE', density_limit: 'DENSITY LIMIT' }

/** Sum of several programmed waveforms, sampled on the union of their knots. */
export function sumWaveforms(ws: (Waveform | undefined)[]): Waveform | undefined {
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
  /** Widest text the value can show (e.g. '88.88'): the value sits in a slot that wide, so the unit never moves. */
  fit?: string
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
export function Readout({ value, fit, unit, caption, hint, tone, link, hot, onHot }: ReadoutProps) {
  return (
    <div
      className="kd-ro"
      data-hot={!!link && !!hot}
      onMouseEnter={link && onHot ? () => onHot(link) : undefined}
      onMouseLeave={link && onHot ? () => onHot(null) : undefined}
    >
      <div className="kd-ro-v" data-tone={tone}>{fit ? <Fx fit={fit} align="start">{value}</Fx> : value}{unit && value !== '—' ? <span className="kd-ro-u kd-g"> {unit}</span> : null}</div>
      <div className="kd-ro-c">{hint ? <InfoHint title={hint.title} content={hint.content}>{caption}</InfoHint> : caption}</div>
    </div>
  )
}

/** EMA with a ~300 ms time constant at 60 fps, so a band tint does not flicker on ELMs.
 *  The ref is a per-frame accumulator read and written in render on purpose: the
 *  smoothed value is presentation state that must track every render without
 *  scheduling another one. */
/* eslint-disable react-hooks/refs */
export function useEma(raw: number | undefined, alpha = 0.05): number | undefined {
  const ref = useRef<number | null>(null)
  if (raw === undefined || !isFinite(raw)) { ref.current = null; return undefined }
  ref.current = ref.current === null ? raw : ref.current + alpha * (raw - ref.current)
  return ref.current
}
/* eslint-enable react-hooks/refs */

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
export function useDisplayClock(time: number, exact: number, live: boolean, speed: number): DisplayClock {
  const clock = useRef<DisplayClock | null>(null)
  if (!clock.current) clock.current = createDisplayClock(exact)
  const last = useRef({ wall: 0, sim: time, step: 0.03 })
  if (time !== last.current.sim) {
    const d = time - last.current.sim
    if (d > 0 && d < 0.5) last.current.step = Math.min(0.1, Math.max(0.015, d))
    // Records the wall-clock instant this simulation time arrived; the display
    // clock extrapolates from it. Intentionally impure.
    // eslint-disable-next-line react-hooks/purity
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
export function band(v: number | undefined, warn: number, bad: number, below = false): Tone {
  if (v === undefined) return undefined
  if (below) return v < bad ? 'bad' : v < warn ? 'warn' : undefined
  return v > bad ? 'bad' : v > warn ? 'warn' : undefined
}

/** Greek glyphs escape the page-wide uppercase transform (β would become B). */
export const G = ({ children }: { children: ReactNode }) => <span className="kd-g">{children}</span>

/** Hazard rate (probability per second) as percent per second, two significant figures. */
export function hazardPct(p: number | undefined): string {
  if (p === undefined || !isFinite(p)) return '—'
  const v = p * 100
  if (v <= 0) return '0'
  if (v < 0.0001) return '< 0.0001'
  return v.toFixed(Math.min(5, Math.max(0, 1 - Math.floor(Math.log10(v)))))
}

/** Units and Greek inside a report value keep their case; the words around them take the caps. */
const KEEP = /^(s|V|V·s|MA|MJ|MW|kW|Hz)$|[α-ω]/
function keepUnits(text: string): ReactNode {
  return text.split(/(\s+)/).map((tok, i) => {
    const [, pre, core, post] = /^([(<]*)(.*?)([),]*)$/.exec(tok) ?? ['', '', tok, '']
    return KEEP.test(core) ? <span key={i}>{pre}<G>{core}</G>{post}</span> : tok
  })
}

/** End-of-pulse report: achieved against programmed, one hairline-framed panel over the strips. */
export function ReportPanel({ rows, pulseNo, onClose }: { rows: ReportRow[]; pulseNo: string; onClose: () => void }) {
  return (
    <div className="kd-report" role="dialog" aria-label="Pulse report">
      <div className="kd-report-head">
        <span>PULSE {pulseNo} <span className="kd-dot">.</span> REPORT</span>
        <button className="kd-report-x" onClick={onClose}>CLOSE</button>
      </div>
      <div className="kd-report-cols" aria-hidden="true"><span /><span>PROGRAMMED</span><span>ACHIEVED</span></div>
      {rows.map((r, i) => (
        <div key={i} className="kd-report-row">
          <span className="kd-report-l">{reportLabel(r.label, G)}</span>
          <span className="kd-report-p">{r.programmed ? keepUnits(r.programmed) : '—'}</span>
          <span className="kd-report-a" data-tone={r.status === 'major' ? 'bad' : r.status === 'minor' ? 'warn' : undefined}>{keepUnits(r.achieved)}</span>
        </div>
      ))}
    </div>
  )
}


export const STAB = { title: 'Stability', content: stabilityInfo }
export const POWER = { title: 'Power balance', content: powerBalanceInfo }

/** Configuration word from the engine's enum name. */
export function configWord(s: Snapshot | null): string {
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
export function Link({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return <button className="kd-link" data-on={on} onClick={onClick}>{children}</button>
}



