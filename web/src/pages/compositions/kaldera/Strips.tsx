import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Station } from './Timeline'
import InfoHint from './InfoHint'
import type { DisplayClock } from './displayClock'

export type Pts = [number, number][]

export interface Strip {
  /** Link id shared with the scalar readouts (hover lights both). */
  id: string
  label: string
  /** Rendered form of the label when it needs markup (Greek glyphs). */
  node?: ReactNode
  /** Explanatory content for the label's hint popover. */
  hint?: ReactNode
  unit?: string
  pts: Pts
  /** Programmed reference, the dotted companion. */
  ref?: Pts
  /** A second series in dim white. `own` scales it to its own maximum instead of the strip's. */
  second?: { label: string; hint?: ReactNode; pts: Pts; own?: boolean }
  /** Per-point ELM latch, parallel to `pts`: ELMs are drawn as vertical spikes. */
  elm?: boolean[]
  /** Decimals for the live value. */
  digits?: number
  /** Blank the live value (reconstruction invalid). */
  blank?: boolean
}

interface Props {
  strips: Strip[]
  stations: Station[]
  duration: number
  /** The displayed time for the cursor: exact when paused, scrubbing or finished; extrapolated per frame while running. */
  clock: DisplayClock
  scrubTime: number | null
  onScrub?: (t: number | null) => void
  /** The strip under the pointer (or linked from a readout), by id. */
  hot: string | null
  onHot: (id: string | null) => void
}

/** A hue from the root's CSS variables, as "r,g,b" for rgba() use. */
export function hueRgb(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim() || fallback
  const m = v.match(/^#([0-9a-f]{6})$/i)
  if (!m) return '255,255,255'
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

/** Height of the shared time axis under the bottom strip. */
export const AXIS_H = 16

/** The caps face from the CSS variables, so the canvas follows the font switch. */
export function capsFont(el: Element, px: number): { font: string; tracking: string; stretch: string } {
  const cs = getComputedStyle(el)
  const fam = cs.getPropertyValue('--kd-caps').trim() || "'Mona Sans', sans-serif"
  const w = cs.getPropertyValue('--kd-caps-weight').trim() || '400'
  const tracking = cs.getPropertyValue('--kd-caps-track').trim() || '0.12em'
  const stretch = cs.getPropertyValue('--kd-caps-stretch').trim() || '125%'
  return { font: `${w} ${px}px ${fam}`, tracking, stretch }
}

export function applyCaps(g: CanvasRenderingContext2D, el: Element, px: number) {
  const f = capsFont(el, px)
  g.font = f.font
  const gx = g as unknown as { letterSpacing: string; fontStretch: string }
  gx.letterSpacing = f.tracking
  gx.fontStretch = parseFloat(f.stretch) >= 120 ? 'expanded' : parseFloat(f.stretch) >= 110 ? 'semi-expanded' : 'normal'
}

/** One spike flag per ELM: the tallest point of each run of latched points. */
function elmSpikes(pts: Pts, elm: boolean[]): boolean[] | null {
  if (pts.length <= 2) return null
  const isSpike: boolean[] = new Array(pts.length).fill(false)
  for (let i = 1; i < pts.length - 1; i++) if (elm[i]) isSpike[i] = true
  for (let i = 1; i < pts.length; i++) {
    if (isSpike[i] && isSpike[i - 1]) {
      if (pts[i][1] >= pts[i - 1][1]) isSpike[i - 1] = false
      else isSpike[i] = false
    }
  }
  return isSpike
}

/** Baseline for a latched point: the last value before the run, searched back up to five points. */
function baseline(pts: Pts, elm: boolean[], i: number, fallback: number): number {
  for (let j = i - 1; j >= Math.max(0, i - 5); j--) if (!elm[j]) return pts[j][1]
  return fallback
}

/**
 * Stroke one series. With an ELM latch the spike point is drawn as a vertical
 * line from the pre-ELM baseline up and straight back down at the same x,
 * and the other latched points of the run sit on the baseline.
 */
function strokeSeries(g: CanvasRenderingContext2D, pts: Pts, X: (t: number) => number, Y: (v: number) => number, elm?: boolean[]) {
  const spikes = elm ? elmSpikes(pts, elm) : null
  g.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const x = X(pts[i][0]), y = Y(pts[i][1])
    if (i === 0) g.moveTo(x, y)
    else if (spikes && elm && spikes[i]) {
      const by = Y(baseline(pts, elm, i, pts[i - 1][1]))
      g.lineTo(x, by); g.lineTo(x, y); g.lineTo(x, by)
    } else if (spikes && elm && elm[i]) g.lineTo(x, Y(baseline(pts, elm, i, pts[i][1])))
    else g.lineTo(x, y)
  }
  g.stroke()
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
export default function Strips({ strips, stations, duration, clock, scrubTime, onScrub, hot, onHot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [stripH, setStripH] = useState(0)

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
    setStripH((prev) => (Math.abs(prev - sh) > 0.01 ? sh : prev))
    const stationXs = stations.map((s) => Math.round(X(Math.min(s.t, T))) + 0.5)

    applyCaps(g, box, 8)
    g.lineWidth = 1
    const warm = hueRgb(box, '--kd-warm', '#f0a98a')

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
      const isHot = hot === s.id
      if (s.pts.length > 1) {
        g.strokeStyle = isHot ? `rgba(${warm},1)` : 'rgba(255,255,255,0.88)'
        g.lineJoin = 'round'
        strokeSeries(g, s.pts, X, Y, s.elm && s.elm.length === s.pts.length ? s.elm : undefined)
      }
      g.restore()

      // the label is a DOM element over the canvas (so it can carry a hint); the live value is drawn here
      g.textBaseline = 'top'
      const v = s.blank ? null : valueAt(s.pts, scrubTime)
      const v2 = s.second && !s.blank ? valueAt(s.second.pts, scrubTime) : null
      const d = s.digits ?? 2
      // main value first, then the second series, in the order of the label; the unit closes the line
      let txt = v === null ? '—' : v.toFixed(d)
      if (s.second && v2 !== null) txt += `   .   ${v2.toFixed(d)}`
      if (v !== null && s.unit) txt += ` ${s.unit}`
      g.textAlign = 'right'
      g.fillStyle = isHot ? `rgba(${warm},1)` : 'rgba(255,255,255,0.92)'
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

  }, [strips, stations, duration, scrubTime, hot])

  useEffect(() => { draw() }, [draw])

  // The hairline at the displayed time lives on its own canvas and follows the clock every frame.
  const drawCursor = useCallback((t: number) => {
    const canvas = cursorRef.current, box = boxRef.current
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
    const cur = scrubTime ?? (t > 0 ? t : null)
    if (cur === null) return
    const x = Math.round((Math.min(cur, T) / T) * W) + 0.5
    g.strokeStyle = 'rgba(255,255,255,0.55)'
    g.lineWidth = 1
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke()
  }, [duration, scrubTime])
  useEffect(() => { drawCursor(clock.get()); return clock.subscribe(drawCursor) }, [clock, drawCursor])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(() => { draw(); drawCursor(clock.get()) })
    ro.observe(box)
    return () => ro.disconnect()
  }, [draw, drawCursor, clock])

  const hotAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const sh = (r.height - AXIS_H) / Math.max(1, strips.length)
    const i = Math.floor((e.clientY - r.top) / sh)
    onHot(strips[i]?.id ?? null)
  }

  const scrubAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onScrub) return
    const r = e.currentTarget.getBoundingClientRect()
    const T = duration > 0 ? duration : 10
    onScrub(Math.max(0, Math.min(T, ((e.clientX - r.left) / r.width) * T)))
  }

  return (
    <div ref={boxRef} className="kd-strips" data-tutorial="traces">
      <div className="kd-strip-labels" aria-hidden={false}>
        {strips.map((s, i) => (
          <span
            key={s.label}
            className="kd-strip-label"
            data-hot={hot === s.id}
            style={{ top: Math.round(i * stripH) + 5 }}
            onMouseEnter={() => onHot(s.id)}
            onMouseLeave={() => onHot(null)}
          >
            {s.hint ? <InfoHint title={s.label} content={s.hint}>{s.node ?? s.label}</InfoHint> : (s.node ?? s.label)}
            {s.second && (
              <>
                <span className="kd-dot">   .   </span>
                {s.second.hint ? <InfoHint title={s.second.label} content={s.second.hint}>{s.second.label}</InfoHint> : s.second.label}
              </>
            )}
          </span>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: onScrub ? 'ew-resize' : 'default' }}
        onPointerDown={(e) => { if (!onScrub) return; e.currentTarget.setPointerCapture(e.pointerId); scrubAt(e) }}
        onPointerMove={(e) => { hotAt(e); if (onScrub && e.buttons & 1) scrubAt(e) }}
        onPointerLeave={() => onHot(null)}
        onDoubleClick={() => onScrub?.(null)}
      />
      <canvas ref={cursorRef} className="kd-strips-cursor" aria-hidden="true" />
    </div>
  )
}
