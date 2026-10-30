import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import type { TracePoint } from '../../../lib/types'
import { interpWaveform, type Waveform } from './phase'

export interface Series {
  key: keyof TracePoint
  color: string
  /** Programmed reference, drawn dashed in the series colour. */
  ref?: Waveform
  fmt: (v: number) => string
  unit: string
  /** Rendered label for the readout (JSX so subscripts work). */
  label: ReactNode
  /** Lower bound of the axis; data minimum when omitted. */
  floor?: number
  /** Draw ELMs as vertical spikes (the published Dα rule) instead of joined points. */
  spikes?: boolean
  /** Derived channel: read the value from the whole sample instead of `key`. */
  get?: (h: TracePoint) => number
}

const valueOf = (s: Series, h: TracePoint): number => {
  const v = s.get ? s.get(h) : (h[s.key] as number)
  return typeof v === 'number' && isFinite(v) ? v : NaN
}

/**
 * Stroke one series. With `isSpike`, each ELM is drawn as a vertical line
 * from the pre-ELM baseline up to the spike value and straight back down at
 * the same x, and the other latched points of the run sit at the baseline
 * (the last value before the run, searched back up to five points), so the
 * ELMs read as transient events rather than triangular "tent poles".
 */
function strokeSeries(
  ctx: CanvasRenderingContext2D,
  pts: TracePoint[],
  vals: number[],
  toX: (t: number) => number,
  toY: (v: number) => number,
  isSpike: boolean[] | null,
) {
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const x = toX(pts[i].t)
    const y = toY(vals[i])
    if (i === 0) {
      ctx.moveTo(x, y)
    } else if (isSpike && isSpike[i]) {
      let baseVal = vals[i - 1]
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (!pts[j].elm_active) { baseVal = vals[j]; break }
      }
      const baseY = toY(baseVal)
      ctx.lineTo(x, baseY)
      ctx.lineTo(x, y)
      ctx.lineTo(x, baseY)
    } else if (isSpike && pts[i].elm_active) {
      let baseVal = vals[i]
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (!pts[j].elm_active) { baseVal = vals[j]; break }
      }
      ctx.lineTo(x, toY(baseVal))
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

/** One spike flag per ELM: the tallest point of each run of latched points. */
function elmSpikes(pts: TracePoint[], vals: number[]): boolean[] | null {
  if (pts.length <= 2) return null
  const isSpike: boolean[] = new Array(pts.length).fill(false)
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i].elm_active) isSpike[i] = true
  }
  for (let i = 1; i < pts.length; i++) {
    if (isSpike[i] && isSpike[i - 1]) {
      if (vals[i] >= vals[i - 1]) isSpike[i - 1] = false
      else isSpike[i] = false
    }
  }
  return isSpike
}

interface Props {
  number: string
  title: ReactNode
  unit: string
  series: Series[]
  history: TracePoint[]
  duration: number
  time: number
  running: boolean
  finished: boolean
  scrubTime: number | null
  onScrub: (t: number | null) => void
  xAxis?: boolean
  /** Phone strip: no pointer scrubbing (vertical drags scroll the page), larger axis figures. */
  phone?: boolean
}

const WHITE = '#f2f2ee'
const CYAN = '#5fd7ff'
const GRID = 'rgba(95,215,255,0.22)'
const GRID_MAJOR = 'rgba(95,215,255,0.42)'
const FONT = '9px Helvetica, Arial, sans-serif'
const FONT_PHONE = '10px Helvetica, Arial, sans-serif'

const PAD_L = 36
const PAD_R = 8
const PAD_T = 5

function niceMax(v: number): number {
  if (!(v > 0)) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / e
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10
  return n * e
}

/**
 * One projection-slide plot of the big board: white and cyan lines on
 * black, a fine cyan grid, white Helvetica axis figures, inward ticks.
 * The first series owns the y axis; the others are scaled to their own
 * maximum and read through their coloured value at the right.
 */
export default function BoardPlot(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { series, history, duration, time, running, finished, scrubTime, xAxis, phone } = p

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(10, Math.floor(rect.width))
    const H = Math.max(10, Math.floor(rect.height))
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    const padB = xAxis ? 15 : 4
    const x0 = PAD_L
    const x1 = W - PAD_R
    const y0 = PAD_T
    const y1 = H - padB
    const pw = x1 - x0
    const ph = y1 - y0
    const T = duration > 0 ? duration : 1
    const tx = (t: number) => x0 + (t / T) * pw

    // ── grid ──
    const step = T > 20 ? 5 : T > 10 ? 1 : 0.5
    ctx.lineWidth = 1
    for (let t = 0; t <= T + 1e-9; t += step) {
      const major = Math.abs(t / (step * 2) - Math.round(t / (step * 2))) < 1e-6
      ctx.strokeStyle = major ? GRID_MAJOR : GRID
      const x = Math.round(tx(t)) + 0.5
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke()
    }
    const ny = 4
    for (let i = 0; i <= ny; i++) {
      const y = Math.round(y0 + (i / ny) * ph) + 0.5
      ctx.strokeStyle = i === 0 || i === ny ? GRID_MAJOR : GRID
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke()
    }

    // ── scales ──
    const scales = series.map((s) => {
      let max = 0
      let min = s.floor ?? Infinity
      for (const h of history) {
        const v = valueOf(s, h)
        if (isFinite(v)) { if (v > max) max = v; if (v < min) min = v }
      }
      if (s.ref) for (const [, v] of s.ref) { if (v > max) max = v; if (v < min) min = v }
      if (!isFinite(min)) min = 0
      if (min > 0) min = 0
      const top = niceMax(max * 1.08)
      return { min, max: top }
    })
    const ty = (v: number, i: number) => {
      const sc = scales[i]
      const span = sc.max - sc.min || 1
      return y1 - ((v - sc.min) / span) * ph
    }

    // ── y figures on the primary series, inward ticks ──
    ctx.fillStyle = WHITE
    ctx.font = phone ? FONT_PHONE : FONT
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const s0 = scales[0]
    for (let i = 0; i <= ny; i += 2) {
      const v = s0.min + (i / ny) * (s0.max - s0.min)
      const y = y0 + ((ny - i) / ny) * ph
      ctx.fillText(series[0].fmt(v), x0 - 4, Math.min(y1 - 4, Math.max(y0 + 4, y)))
      ctx.strokeStyle = WHITE
      ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x0 + 4, Math.round(y) + 0.5); ctx.stroke()
    }
    if (xAxis) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let t = 0; t <= T + 1e-9; t += step * 2) {
        const x = tx(t)
        if (x < x1 - 28) ctx.fillText(t.toFixed(T > 10 ? 0 : 1), x, y1 + 3)
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y1); ctx.lineTo(Math.round(x) + 0.5, y1 - 4); ctx.stroke()
      }
      ctx.textAlign = 'right'
      ctx.fillText('SEC', x1, y1 + 3)
    }

    // ── programmed references, dashed ──
    series.forEach((s, i) => {
      if (!s.ref || s.ref.length === 0) return
      ctx.strokeStyle = s.color
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      const n = 160
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * T
        const v = interpWaveform(s.ref, t)
        if (v === null) continue
        const x = tx(t)
        const y = ty(v, i)
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    })

    // ── traces ──
    series.forEach((s, i) => {
      if (history.length < 2) return
      ctx.strokeStyle = s.color
      ctx.lineWidth = 1.3
      ctx.lineJoin = 'round'
      const vals = history.map((h) => { const v = valueOf(s, h); return isFinite(v) ? v : 0 })
      strokeSeries(ctx, history, vals, tx, (v) => ty(v, i), s.spikes ? elmSpikes(history, vals) : null)
    })

    // ── cursor ──
    const cursor = scrubTime !== null ? scrubTime : (running || finished) ? time : null
    if (cursor !== null && cursor > 0) {
      const x = Math.round(tx(Math.min(cursor, T))) + 0.5
      ctx.strokeStyle = scrubTime !== null ? WHITE : CYAN
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke()
    }

    // ── frame ──
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, pw - 1, ph - 1)
  }, [series, history, duration, time, running, finished, scrubTime, xAxis, phone])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const scrubAt = (e: PointerEvent<HTMLDivElement>) => {
    if (!finished || phone) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const pw = rect.width - PAD_L - PAD_R
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left - PAD_L) / pw))
    p.onScrub(f * duration)
  }

  // Readout: the sample at the cursor, or the latest.
  const at = scrubTime !== null ? scrubTime : time
  let sample: TracePoint | null = null
  if (history.length) {
    sample = history[history.length - 1]
    if (scrubTime !== null) {
      let lo = 0, hi = history.length - 1
      while (lo < hi) { const mid = (lo + hi) >> 1; if (history[mid].t < at) lo = mid + 1; else hi = mid }
      sample = history[lo]
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`ap-plot${finished && !phone ? ' ap-plot-scrub' : ''}`}
      onPointerDown={scrubAt}
      onPointerMove={(e) => { if (e.buttons & 1) scrubAt(e) }}
    >
      <canvas ref={canvasRef} />
      <div className="ap-plot-title">{p.title} <span className="ap-unit">{p.unit}</span></div>
      <div className="ap-plot-num">{p.number}</div>
      <div className="ap-plot-vals">
        {series.map((s) => (
          <span key={String(s.key)} style={{ color: s.color }}>
            {s.label} {sample ? s.fmt(valueOf(s, sample)) : '—'}{s.unit ? ` ${s.unit}` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
