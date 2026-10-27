import { useCallback, useEffect, useRef } from 'react'

/** One trace on a strip chart: a time series in a saturated primary. */
export interface Series {
  label: string
  color: string
  pts: [number, number][]
  /** Programmed reference, drawn dashed in the series colour at half strength. */
  ref?: [number, number][]
  /** Per-point ELM latch (D-alpha): spikes are drawn as vertical transients, not tent poles. */
  elm?: boolean[]
}

/** One spike flag per ELM: the tallest point of each run of latched points (the published panel's rule). */
function elmSpikes(pts: [number, number][], elm: boolean[]): boolean[] | null {
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

/** Baseline for a latched point: the last un-latched value, searched back up to five points. */
function elmBase(pts: [number, number][], elm: boolean[], i: number, fallback: number): number {
  for (let j = i - 1; j >= Math.max(0, i - 5); j--) if (!elm[j]) return pts[j][1]
  return fallback
}

/** Stroke a series; with an ELM latch the spike point goes up and straight back down at the same x,
 *  and the other latched points in the run sit on the baseline. */
function strokeSeries(g: CanvasRenderingContext2D, pts: [number, number][], elm: boolean[] | undefined,
  X: (t: number) => number, Y: (v: number) => number) {
  const isSpike = elm ? elmSpikes(pts, elm) : null
  g.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const x = X(pts[i][0]), y = Y(pts[i][1])
    if (i === 0) g.moveTo(x, y)
    else if (isSpike && elm && isSpike[i]) {
      const by = Y(elmBase(pts, elm, i, pts[i - 1][1]))
      g.lineTo(x, by); g.lineTo(x, y); g.lineTo(x, by)
    } else if (isSpike && elm && elm[i]) g.lineTo(x, Y(elmBase(pts, elm, i, pts[i][1])))
    else g.lineTo(x, y)
  }
  g.stroke()
}

interface Props {
  title: string
  unit?: string
  series: Series[]
  /** Time axis spans 0..tMax. */
  tMax: number
  yMin?: number
  yMax?: number
  scrubTime: number | null
  /** Vertical cursor at the live time while the pulse runs. */
  liveTime: number
  /** Drag to scrub; only wired once the pulse has ended. */
  onScrub?: (t: number | null) => void
}

export const FONT_PLOT = '11px Helvetica, Arial, sans-serif'

const AX = '#ffffff'
const GRID = 'rgba(255,255,255,0.18)'
const ML = 38, MR = 6, MT = 6, MB = 16

/** A "nice" tick step for a span, IDL style (1, 2, 5 × 10^n). */
function niceStep(span: number, target: number): number {
  const raw = span / target
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const r = raw / p
  const m = r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10
  return m * p
}

function fmt(v: number, step: number): string {
  if (step >= 1) return v.toFixed(0)
  if (step < 1e-3) return v === 0 ? '0' : v.toExponential(0).replace('e-', 'e-').replace('e+', 'e')
  return v.toFixed(Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)))
}

/**
 * A single IDL-style strip chart on a canvas: black field, white box axes
 * with inward ticks, a faint grid, the title inside the plot at top left and
 * the live value at top right in the trace colour.
 */
export default function StripChart({ title, unit, series, tMax, yMin, yMax, scrubTime, liveTime, onScrub }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    const g = canvas.getContext('2d')
    if (!g) return
    const rect = box.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(40, Math.floor(rect.width))
    const H = Math.max(30, Math.floor(rect.height))
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)

    const x0 = ML, x1 = W - MR, y0 = MT, y1 = H - MB
    const pw = x1 - x0, ph = y1 - y0
    const T = tMax > 0 ? tMax : 10

    // y range from data and references
    let lo = yMin ?? Infinity, hi = yMax ?? -Infinity
    if (yMin === undefined || yMax === undefined) {
      for (const s of series) {
        for (const [, v] of s.pts) { if (v < lo) lo = v; if (v > hi) hi = v }
        if (s.ref) for (const [, v] of s.ref) { if (v < lo) lo = v; if (v > hi) hi = v }
      }
      if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1 }
      if (yMin === undefined) lo = Math.min(0, lo)
      if (hi - lo < 1e-9) hi = lo + 1
      if (yMax === undefined) hi = lo + (hi - lo) * 1.12
    }
    const ys = niceStep(hi - lo, 4)
    if (yMax === undefined) hi = Math.ceil(hi / ys) * ys
    if (yMin === undefined) lo = Math.floor(lo / ys) * ys
    const ts = niceStep(T, 5)

    const X = (t: number) => x0 + (t / T) * pw
    const Y = (v: number) => y1 - ((v - lo) / (hi - lo)) * ph

    // grid, dotted, faint
    g.save()
    g.strokeStyle = GRID
    g.lineWidth = 1
    g.setLineDash([1, 3])
    g.beginPath()
    for (let t = ts; t < T - 1e-9; t += ts) { const x = Math.round(X(t)) + 0.5; g.moveTo(x, y0); g.lineTo(x, y1) }
    for (let v = lo + ys; v < hi - 1e-9; v += ys) { const y = Math.round(Y(v)) + 0.5; g.moveTo(x0, y); g.lineTo(x1, y) }
    g.stroke()
    g.restore()

    // traces
    g.save()
    g.beginPath(); g.rect(x0, y0, pw, ph); g.clip()
    for (const s of series) {
      if (s.ref && s.ref.length > 1) {
        g.strokeStyle = s.color
        g.globalAlpha = 0.55
        g.lineWidth = 1
        g.setLineDash([4, 3])
        g.beginPath()
        s.ref.forEach(([t, v], i) => { const x = X(t), y = Y(v); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y) })
        g.stroke()
        g.setLineDash([])
        g.globalAlpha = 1
      }
      if (s.pts.length > 1) {
        g.strokeStyle = s.color
        g.lineWidth = 1.25
        strokeSeries(g, s.pts, s.elm && s.elm.length === s.pts.length ? s.elm : undefined, X, Y)
      }
    }
    // cursor
    const cur = scrubTime ?? (liveTime > 0 && liveTime < T ? liveTime : null)
    if (cur !== null) {
      const x = Math.round(X(cur)) + 0.5
      g.strokeStyle = scrubTime !== null ? '#ffffff' : 'rgba(255,255,255,0.45)'
      g.lineWidth = 1
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
    }
    g.restore()

    // box axes with inward ticks on all four sides
    g.strokeStyle = AX
    g.lineWidth = 1
    g.strokeRect(x0 + 0.5, y0 + 0.5, pw - 1, ph - 1)
    g.beginPath()
    const tk = 4, tk2 = 2
    for (let t = 0; t <= T + 1e-9; t += ts) {
      const x = Math.round(X(t)) + 0.5
      g.moveTo(x, y1); g.lineTo(x, y1 - tk)
      g.moveTo(x, y0); g.lineTo(x, y0 + tk)
      const xm = Math.round(X(t + ts / 2)) + 0.5
      if (t + ts / 2 < T) { g.moveTo(xm, y1); g.lineTo(xm, y1 - tk2); g.moveTo(xm, y0); g.lineTo(xm, y0 + tk2) }
    }
    for (let v = lo; v <= hi + 1e-9; v += ys) {
      const y = Math.round(Y(v)) + 0.5
      g.moveTo(x0, y); g.lineTo(x0 + tk, y)
      g.moveTo(x1, y); g.lineTo(x1 - tk, y)
    }
    g.stroke()

    // tick labels
    g.fillStyle = AX
    g.font = FONT_PLOT
    g.textAlign = 'center'
    g.textBaseline = 'top'
    for (let t = 0; t <= T + 1e-9; t += ts) g.fillText(fmt(t, ts), X(t), y1 + 3)
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    for (let v = lo; v <= hi + 1e-9; v += ys) g.fillText(fmt(v, ys), x0 - 3, Y(v))

    // title inside the plot, top left; live values top right in series colour
    g.textBaseline = 'top'
    g.textAlign = 'left'
    g.fillStyle = AX
    g.font = 'bold 11px Helvetica, Arial, sans-serif'
    const titleText = unit ? `${title}  [${unit}]` : title
    g.fillText(titleText, x0 + 5, y0 + 4)
    const titleEnd = x0 + 5 + g.measureText(titleText).width + 12
    g.font = FONT_PLOT
    g.textAlign = 'right'
    // readouts right-aligned on the title line; on the next line when they would collide with the title
    let rw = 0
    const texts = series.map((s) => {
      let v: number | null = null
      if (s.pts.length) {
        if (scrubTime !== null) {
          let best = s.pts[0]
          for (const p of s.pts) { if (p[0] <= scrubTime) best = p; else break }
          v = best[1]
        } else v = s.pts[s.pts.length - 1][1]
      }
      const txt = v === null ? s.label : `${s.label} ${Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : v.toFixed(2)}`
      rw += g.measureText(txt).width + 10
      return txt
    })
    const ry = x1 - 5 - rw < titleEnd ? y0 + 17 : y0 + 4
    let rx = x1 - 5
    for (let i = series.length - 1; i >= 0; i--) {
      g.fillStyle = series[i].color
      g.fillText(texts[i], rx, ry)
      rx -= g.measureText(texts[i]).width + 10
    }
  }, [title, unit, series, tMax, yMin, yMax, scrubTime, liveTime])

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
    const T = tMax > 0 ? tMax : 10
    const t = ((e.clientX - r.left - ML) / (r.width - ML - MR)) * T
    onScrub(Math.max(0, Math.min(T, t)))
  }

  return (
    <div ref={boxRef} className="dc-strip">
      <canvas
        ref={canvasRef}
        style={{ cursor: onScrub ? 'crosshair' : 'default', display: 'block' }}
        onPointerDown={(e) => { if (!onScrub) return; e.currentTarget.setPointerCapture(e.pointerId); scrubAt(e) }}
        onPointerMove={(e) => { if (onScrub && e.buttons & 1) scrubAt(e) }}
        onDoubleClick={() => onScrub?.(null)}
      />
    </div>
  )
}
