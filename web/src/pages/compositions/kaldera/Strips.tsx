import { useCallback, useEffect, useRef } from 'react'
import type { Station } from './Timeline'

export type Pts = [number, number][]

export interface Strip {
  label: string
  unit?: string
  pts: Pts
  /** Programmed reference, the dotted companion. */
  ref?: Pts
  /** A second series in dim white. `own` scales it to its own maximum instead of the strip's. */
  second?: { label: string; pts: Pts; own?: boolean }
  /** Decimals for the live value. */
  digits?: number
  /** Blank the live value (reconstruction invalid). */
  blank?: boolean
}

interface Props {
  strips: Strip[]
  stations: Station[]
  duration: number
  time: number
  scrubTime: number | null
  onScrub?: (t: number | null) => void
}

const FONT = "8px 'Michroma', sans-serif"
/** Height of the shared time axis under the bottom strip. */
export const AXIS_H = 16

function setTracking(g: CanvasRenderingContext2D, em: string) {
  (g as unknown as { letterSpacing: string }).letterSpacing = em
}

function valueAt(pts: Pts, t: number | null): number | null {
  if (!pts.length) return null
  if (t === null) return pts[pts.length - 1][1]
  let best = pts[0]
  for (const p of pts) { if (p[0] <= t) best = p; else break }
  return best[1]
}

/**
 * Four or five stacked strips in one canvas, between the MOCR big board and
 * the site's bare curves: a hairline frame, a faint grid at the stations, the
 * label top-left and the live value top-right in tracked caps, the measured
 * trace as a thin white line and the programme as its dotted companion. One
 * shared time axis under the bottom strip carries the only numerals.
 */
export default function Strips({ strips, stations, duration, time, scrubTime, onScrub }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current, box = boxRef.current
    if (!canvas || !box) return
    const g = canvas.getContext('2d')
    if (!g) return
    const rect = box.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(40, Math.floor(rect.width)), H = Math.max(30, Math.floor(rect.height))
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)

    const T = duration > 0 ? duration : 10
    const X = (t: number) => (t / T) * W
    const n = Math.max(1, strips.length)
    const sh = (H - AXIS_H) / n
    const stationXs = stations.map((s) => Math.round(X(Math.min(s.t, T))) + 0.5)

    g.font = FONT
    setTracking(g, '0.2em')
    g.lineWidth = 1

    // one hairline frame around the stack and one separator between strips
    const stackH = Math.round(n * sh)
    g.strokeStyle = 'rgba(255,255,255,0.15)'
    g.strokeRect(0.5, 0.5, W - 1, stackH - 1)
    g.beginPath()
    for (let i = 1; i < n; i++) { const y = Math.round(i * sh) + 0.5; g.moveTo(0, y); g.lineTo(W, y) }
    g.stroke()

    strips.forEach((s, i) => {
      const y0 = Math.round(i * sh) + 0.5, y1 = Math.round((i + 1) * sh) + 0.5
      const h = y1 - y0
      const top = y0 + 14, bot = y1 - 3

      // the faint grid: verticals at the stations, two horizontals
      g.strokeStyle = 'rgba(255,255,255,0.05)'
      g.beginPath()
      for (const x of stationXs) { if (x > 1 && x < W - 1) { g.moveTo(x, y0); g.lineTo(x, y1) } }
      for (const f of [1 / 3, 2 / 3]) { const y = Math.round(y0 + h * f) + 0.5; g.moveTo(0, y); g.lineTo(W, y) }
      g.stroke()

      // scale from data and reference
      let hi = 0
      for (const [, v] of s.pts) if (v > hi) hi = v
      if (s.ref) for (const [, v] of s.ref) if (v > hi) hi = v
      let hi2 = 0
      if (s.second) { for (const [, v] of s.second.pts) if (v > hi2) hi2 = v; if (!s.second.own && hi2 > hi) hi = hi2 }
      hi = Math.max(hi, 1e-6) * 1.08
      hi2 = Math.max(hi2, 1e-6) * 1.08
      const Y = (v: number) => bot - (Math.max(0, v) / hi) * (bot - top)
      const Y2 = (v: number) => bot - (Math.max(0, v) / (s.second?.own ? hi2 : hi)) * (bot - top)

      g.save()
      g.beginPath(); g.rect(0, y0, W, h); g.clip()
      if (s.ref && s.ref.length > 1) {
        g.strokeStyle = 'rgba(255,255,255,0.45)'
        g.setLineDash([1, 4])
        g.beginPath()
        s.ref.forEach(([t, v], k) => (k ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v))))
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(255,255,255,0.8)'
        for (const [t, v] of s.ref) { g.beginPath(); g.arc(X(t), Y(v), 1.5, 0, Math.PI * 2); g.fill() }
      }
      if (s.second && s.second.pts.length > 1) {
        g.strokeStyle = 'rgba(255,255,255,0.32)'
        g.beginPath()
        s.second.pts.forEach(([t, v], k) => (k ? g.lineTo(X(t), Y2(v)) : g.moveTo(X(t), Y2(v))))
        g.stroke()
      }
      if (s.pts.length > 1) {
        g.strokeStyle = 'rgba(255,255,255,0.88)'
        g.lineJoin = 'round'
        g.beginPath()
        s.pts.forEach(([t, v], k) => (k ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v))))
        g.stroke()
      }
      g.restore()

      // label top-left, live value top-right, in the same face
      g.textBaseline = 'top'
      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.7)'
      g.fillText(s.label + (s.second ? `   .   ${s.second.label}` : ''), 8, y0 + 5)
      const v = s.blank ? null : valueAt(s.pts, scrubTime)
      const v2 = s.second && !s.blank ? valueAt(s.second.pts, scrubTime) : null
      const d = s.digits ?? 2
      // main value first, then the second series, in the order of the label; the unit closes the line
      let txt = v === null ? '—' : v.toFixed(d)
      if (s.second && v2 !== null) txt += `   .   ${v2.toFixed(d)}`
      if (v !== null && s.unit) txt += ` ${s.unit}`
      g.textAlign = 'right'
      g.fillStyle = 'rgba(255,255,255,0.92)'
      g.fillText(txt, W - 8, y0 + 5)
    })

    // the shared time axis: numerals only at the stations
    const ay = H - AXIS_H
    g.textBaseline = 'top'
    g.fillStyle = 'rgba(255,255,255,0.5)'
    stations.forEach((s, i) => {
      const x = X(Math.min(s.t, T))
      const last = i === stations.length - 1
      g.textAlign = i === 0 ? 'left' : last ? 'right' : 'center'
      g.fillText(`${s.t.toFixed(2)}${last ? ' S' : ''}`, i === 0 ? 0 : last ? W : x, ay + 5)
    })

    // the hairline at the playhead time, continued below by the timeline
    const cur = scrubTime ?? (time > 0 ? time : null)
    if (cur !== null) {
      const x = Math.round(X(Math.min(cur, T))) + 0.5
      g.strokeStyle = 'rgba(255,255,255,0.55)'
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke()
    }
  }, [strips, stations, duration, time, scrubTime])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(box)
    return () => ro.disconnect()
  }, [draw])

  const scrubAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onScrub) return
    const r = e.currentTarget.getBoundingClientRect()
    const T = duration > 0 ? duration : 10
    onScrub(Math.max(0, Math.min(T, ((e.clientX - r.left) / r.width) * T)))
  }

  return (
    <div ref={boxRef} className="kd-strips">
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: onScrub ? 'ew-resize' : 'default' }}
        onPointerDown={(e) => { if (!onScrub) return; e.currentTarget.setPointerCapture(e.pointerId); scrubAt(e) }}
        onPointerMove={(e) => { if (onScrub && e.buttons & 1) scrubAt(e) }}
        onDoubleClick={() => onScrub?.(null)}
      />
    </div>
  )
}
