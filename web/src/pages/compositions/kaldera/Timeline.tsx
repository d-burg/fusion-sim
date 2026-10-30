import { useEffect, useRef } from 'react'
import type { DisplayClock } from './displayClock'

export interface Station { label: string; t: number }

interface Props {
  stations: Station[]
  duration: number
  /** The displayed time: exact when paused, scrubbing or finished; extrapolated per frame while running. */
  clock: DisplayClock
  scrubTime: number | null
  running: boolean
  finished: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onScrub: (t: number | null) => void
  /** Phone: only the playhead scrubs (no taps or drags on the line). */
  headOnly?: boolean
}

const fmtT = (t: number) => `${Math.max(0, t).toFixed(3)} S`

/**
 * The timeline along the bottom: one 1 px line, labelled stations, and a
 * circular playhead that is the Start/Pause control. After the pulse the
 * playhead can be dragged (or the line clicked) to scrub.
 */
export default function Timeline({ stations, duration, clock, scrubTime, running, finished, onStart, onPause, onReset, onScrub, headOnly }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const T = duration > 0 ? duration : 10
  const cur = scrubTime ?? Math.min(clock.get(), T)
  const pct = (cur / T) * 100
  const dragged = useRef(false)
  const cursorRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLButtonElement>(null)
  const timeRef = useRef<HTMLDivElement>(null)

  // Between React renders the clock moves the cursor, the circle and the time text directly.
  useEffect(() => clock.subscribe((t) => {
    const c = scrubTime ?? Math.min(t, T)
    const left = `${(c / T) * 100}%`
    if (cursorRef.current) cursorRef.current.style.left = left
    if (headRef.current) headRef.current.style.left = left
    if (timeRef.current) { timeRef.current.style.left = left; timeRef.current.textContent = `${fmtT(c)}${scrubTime !== null ? ' . SCRUB' : ''}` }
  }), [clock, scrubTime, T])

  const scrubAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    onScrub(Math.max(0, Math.min(T, ((clientX - r.left) / r.width) * T)))
  }

  const trackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!finished || headOnly) return
    if ((e.target as HTMLElement).closest('.kd-playhead')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubAt(e.clientX)
  }

  const headDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!finished) return
    dragged.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const headMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!finished || !(e.buttons & 1)) return
    dragged.current = true
    scrubAt(e.clientX)
  }
  const headClick = () => {
    if (dragged.current) { dragged.current = false; return }
    if (finished) onReset()
    else if (running) onPause()
    else onStart()
  }

  const glyph = finished ? 'replay' : running ? 'pause' : 'start'
  const word = finished ? 'REPLAY' : running ? 'PAUSE' : 'START'

  return (
    <div
      ref={trackRef}
      className="kd-timeline"
      data-tutorial="controls"
      data-scrub={finished}
      onPointerDown={trackDown}
      onPointerMove={(e) => { if (finished && !headOnly && e.buttons & 1 && !(e.target as HTMLElement).closest('.kd-playhead')) scrubAt(e.clientX) }}
      onDoubleClick={() => { if (finished && !headOnly) onScrub(null) }}
    >
      <div className="kd-line" />
      {stations.map((s, i) => (
        <div
          key={s.label}
          className="kd-station"
          style={{ left: `${(Math.min(s.t, T) / T) * 100}%` }}
          data-passed={cur >= s.t}
          data-anchor={i === 0 ? 'start' : i === stations.length - 1 ? 'end' : 'mid'}
          data-half={s.t < T / 2 ? 'first' : 'second'}
        >
          <span className="kd-station-tick" />
          <span className="kd-station-label">{s.label}</span>
        </div>
      ))}
      <div ref={cursorRef} className="kd-cursor" style={{ left: `${pct}%` }} />
      <button
        ref={headRef}
        className="kd-playhead"
        style={{ left: `${pct}%` }}
        data-glyph={glyph}
        onPointerDown={headDown}
        onPointerMove={headMove}
        onClick={headClick}
        title={word}
      >
        {glyph === 'replay' ? (
          // a circular arrow: a 270° arc with a small chevron at its end, 1.5 px strokes in the page's white
          <svg className="kd-glyph kd-glyph-replay" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M10.25 4.10 A4.5 4.5 0 1 1 4.10 5.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M1.56 6.93 L4.10 5.75 L4.34 8.54" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="kd-glyph" aria-hidden="true" />
        )}
        <span className="kd-sr">{word}</span>
      </button>
      <div ref={timeRef} className="kd-playhead-time" style={{ left: `${pct}%` }}>{fmtT(cur)}{scrubTime !== null ? ' . SCRUB' : ''}</div>
    </div>
  )
}
