import { useRef } from 'react'

export interface Station { label: string; t: number }

interface Props {
  stations: Station[]
  duration: number
  time: number
  scrubTime: number | null
  running: boolean
  finished: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onScrub: (t: number | null) => void
}

const fmtT = (t: number) => `${Math.max(0, t).toFixed(3)} S`

/**
 * The timeline along the bottom: one 1 px line, labelled stations, and a
 * circular playhead that is the Start/Pause control. After the pulse the
 * playhead can be dragged (or the line clicked) to scrub.
 */
export default function Timeline({ stations, duration, time, scrubTime, running, finished, onStart, onPause, onReset, onScrub }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const T = duration > 0 ? duration : 10
  const cur = scrubTime ?? Math.min(time, T)
  const pct = (cur / T) * 100
  const dragged = useRef(false)

  const scrubAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    onScrub(Math.max(0, Math.min(T, ((clientX - r.left) / r.width) * T)))
  }

  const trackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!finished) return
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

  const glyph = finished ? 'reset' : running ? 'pause' : 'start'
  const word = finished ? 'RESET' : running ? 'PAUSE' : 'START'

  return (
    <div
      ref={trackRef}
      className="kd-timeline"
      data-scrub={finished}
      onPointerDown={trackDown}
      onPointerMove={(e) => { if (finished && e.buttons & 1 && !(e.target as HTMLElement).closest('.kd-playhead')) scrubAt(e.clientX) }}
      onDoubleClick={() => { if (finished) onScrub(null) }}
    >
      <div className="kd-line" />
      {stations.map((s, i) => (
        <div
          key={s.label}
          className="kd-station"
          style={{ left: `${(Math.min(s.t, T) / T) * 100}%` }}
          data-passed={cur >= s.t}
          data-anchor={i === 0 ? 'start' : i === stations.length - 1 ? 'end' : 'mid'}
        >
          <span className="kd-station-tick" />
          <span className="kd-station-label">{s.label}</span>
        </div>
      ))}
      <div className="kd-cursor" style={{ left: `${pct}%` }} />
      <button
        className="kd-playhead"
        style={{ left: `${pct}%` }}
        data-glyph={glyph}
        onPointerDown={headDown}
        onPointerMove={headMove}
        onClick={headClick}
        title={word}
      >
        <span className="kd-glyph" aria-hidden="true" />
        <span className="kd-sr">{word}</span>
      </button>
      <div className="kd-playhead-time" style={{ left: `${pct}%` }}>{fmtT(cur)}{scrubTime !== null ? ' . SCRUB' : ''}</div>
    </div>
  )
}
