import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { TracePoint } from '../../../lib/types'
import type { PulseProgram, WaveformPoint } from '../../../lib/wasm'

/* ─── jScope-style stacked strip chart on a white field ─────────────
   One canvas, N rows sharing the time axis; black measured traces, the
   programmed reference in blue, a second measured series in green. One-
   pixel black frames, inward ticks, Arial tick labels, the signal name
   on the top-left of each row like a jScope signal title. */

export const JS = {
  trace: '#000000',
  ref: '#0000ff',
  second: '#008000',
  third: '#c00000',
  frame: '#000000',
  grid: '#c8c8c8',
  tick: '#000000',
  cursor: '#0000ff',
  field: '#ffffff',
}

export interface SeriesDef {
  key: keyof TracePoint
  color?: string
  /** Legend text for the series (defaults to the row label). */
  name?: string
  scale?: number
  /** Dα: draw each ELM as a vertical spike (up and back down at one x). */
  spikes?: boolean
}

export interface RowDef {
  /** Signal title, e.g. "I_{p}" (subscripts as `_{...}`) */
  label: string
  unit: string
  series: SeriesDef[]
  /** Programmed reference from the pulse programme. */
  ref?: (p: PulseProgram) => WaveformPoint[]
  yMin?: number
  yMax?: number
  /** Fixed number of decimals for the cursor readout. */
  digits?: number
}

interface Props {
  rows: RowDef[]
  history: TracePoint[]
  programJson: string
  duration: number
  time: number
  scrubTime: number | null
  finished: boolean
  onScrub: (t: number | null) => void
}

/**
 * Stroke one series. With `isSpike`, each ELM is a vertical line from the
 * pre-ELM baseline up to the spike value and straight back down at the same
 * x; the other latched points of the run sit on the baseline (the last
 * value before the run, searched back up to five points). Same rule as the
 * published trace panel, so the spikes read as transients, not tent poles.
 */
function strokeSeries(
  g: CanvasRenderingContext2D,
  pts: TracePoint[],
  vals: number[],
  toX: (t: number) => number,
  toY: (v: number) => number,
  isSpike: boolean[] | null,
) {
  g.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const x = toX(pts[i].t)
    const y = toY(vals[i])
    if (i === 0) {
      g.moveTo(x, y)
    } else if (isSpike && isSpike[i]) {
      let baseVal = vals[i - 1]
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (!pts[j].elm_active) { baseVal = vals[j]; break }
      }
      const baseY = toY(baseVal)
      g.lineTo(x, baseY)
      g.lineTo(x, y)
      g.lineTo(x, baseY)
    } else if (isSpike && pts[i].elm_active) {
      let baseVal = vals[i]
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (!pts[j].elm_active) { baseVal = vals[j]; break }
      }
      g.lineTo(x, toY(baseVal))
    } else {
      g.lineTo(x, y)
    }
  }
  g.stroke()
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

/**
 * Signal names carry their subscripts as `P_{rad}`: the canvas has no <sub>,
 * so the subscript runs are drawn smaller and dropped by a third of the size.
 */
function richRuns(text: string): { t: string; sub: boolean }[] {
  const out: { t: string; sub: boolean }[] = []
  const re = /_\{([^}]*)\}|([^_]+|_)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1] !== undefined ? { t: m[1], sub: true } : { t: m[2], sub: false })
  return out
}

function richWidth(g: CanvasRenderingContext2D, text: string, font: string, subFont: string): number {
  let w = 0
  for (const r of richRuns(text)) { g.font = r.sub ? subFont : font; w += g.measureText(r.t).width }
  g.font = font
  return w
}

/** Draw `text` left-aligned at x (textBaseline top); returns the width drawn. */
function drawRich(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, subFont: string, drop: number): number {
  const align = g.textAlign
  g.textAlign = 'left'
  let cx = x
  for (const r of richRuns(text)) {
    g.font = r.sub ? subFont : font
    g.fillText(r.t, cx, y + (r.sub ? drop : 0))
    cx += g.measureText(r.t).width
  }
  g.font = font
  g.textAlign = align
  return cx - x
}

const LEFT = 44
const RIGHT = 30
const TOP = 3
const BOTTOM = 15

function niceStep(range: number, target: number): number {
  if (range <= 0 || !isFinite(range)) return 1
  const raw = range / target
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / pow
  const f = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10
  return f * pow
}

function fmtTick(v: number, step: number): string {
  const d = step >= 1 ? 0 : Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)))
  return v.toFixed(d)
}

function interp(w: WaveformPoint[], t: number): number {
  if (w.length === 0) return 0
  if (t <= w[0][0]) return w[0][1]
  const last = w[w.length - 1]
  if (t >= last[0]) return last[1]
  for (let i = 0; i < w.length - 1; i++) {
    const [t0, v0] = w[i]
    const [t1, v1] = w[i + 1]
    if (t >= t0 && t <= t1) return t1 > t0 ? v0 + ((t - t0) / (t1 - t0)) * (v1 - v0) : v0
  }
  return last[1]
}

/** Point-wise sum of several programmed waveforms on the union of their knots. */
export function sumWaveforms(ws: (WaveformPoint[] | undefined)[]): WaveformPoint[] {
  const defined = ws.filter((w): w is WaveformPoint[] => !!w && w.length > 0)
  if (defined.length === 0) return []
  const ts = Array.from(new Set(defined.flatMap((w) => w.map((p) => p[0])))).sort((a, b) => a - b)
  return ts.map((t) => [t, defined.reduce((s, w) => s + interp(w, t), 0)])
}

function valueAt(history: TracePoint[], key: keyof TracePoint, t: number, scale: number): number | null {
  if (history.length === 0) return null
  let lo = 0
  let hi = history.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (history[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const v = history[lo][key]
  return typeof v === 'number' ? v * scale : v ? 1 : 0
}

export default function JScope({ rows, history, programJson, duration, time, scrubTime, finished, onScrub }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef(false)

  const program = useMemo<PulseProgram | null>(() => {
    try { return JSON.parse(programJson) as PulseProgram } catch { return null }
  }, [programJson])

  const refs = useMemo(
    () => rows.map((r) => (r.ref && program ? r.ref(program) ?? [] : [])),
    [rows, program],
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    const g = canvas.getContext('2d')
    if (!g) return
    const rect = box.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(10, Math.floor(rect.width))
    const H = Math.max(10, Math.floor(rect.height))
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    g.setTransform(dpr, 0, 0, dpr, 0, 0)

    g.fillStyle = JS.field
    g.fillRect(0, 0, W, H)

    const tMax = Math.max(duration, 1e-3)
    const plotW = W - LEFT - RIGHT
    const n = rows.length
    const rowH = (H - TOP - BOTTOM) / n
    const toX = (t: number) => LEFT + (t / tMax) * plotW

    const tStep = niceStep(tMax, 8)
    const cursorT = scrubTime !== null ? scrubTime : (history.length > 0 ? history[history.length - 1].t : null)

    g.lineWidth = 1
    g.font = '10px Arial, Helvetica, sans-serif'

    rows.forEach((row, i) => {
      const y0 = Math.round(TOP + i * rowH) + 0.5
      const y1 = Math.round(TOP + (i + 1) * rowH) + 0.5
      const ph = y1 - y0

      // y range
      let lo = row.yMin ?? Infinity
      let hi = row.yMax ?? -Infinity
      const autoLo = row.yMin === undefined
      const autoHi = row.yMax === undefined
      if (autoLo || autoHi) {
        for (const s of row.series) {
          const sc = s.scale ?? 1
          for (const p of history) {
            const v = p[s.key]
            const x = (typeof v === 'number' ? v : v ? 1 : 0) * sc
            if (!isFinite(x)) continue
            if (autoLo && x < lo) lo = x
            if (autoHi && x > hi) hi = x
          }
        }
        for (const [, v] of refs[i]) {
          if (autoLo && v < lo) lo = v
          if (autoHi && v > hi) hi = v
        }
        if (!isFinite(lo)) lo = 0
        if (!isFinite(hi)) hi = 1
        if (autoLo && lo > 0) lo = 0
        if (hi <= lo) hi = lo + 1
        if (autoHi) hi = lo + (hi - lo) * 1.12
      }
      const yStep = niceStep(hi - lo, 3)
      if (autoHi) hi = Math.ceil(hi / yStep) * yStep
      if (autoLo) lo = Math.floor(lo / yStep) * yStep
      const toY = (v: number) => y1 - ((v - lo) / (hi - lo)) * ph

      // grid + ticks
      g.strokeStyle = JS.grid
      g.setLineDash([1, 2])
      for (let t = 0; t <= tMax + 1e-9; t += tStep) {
        const x = Math.round(toX(t)) + 0.5
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
      }
      for (let v = Math.ceil(lo / yStep) * yStep; v <= hi + 1e-9; v += yStep) {
        const y = Math.round(toY(v)) + 0.5
        g.beginPath(); g.moveTo(LEFT + 0.5, y); g.lineTo(LEFT + plotW + 0.5, y); g.stroke()
      }
      g.setLineDash([])

      // frame
      g.strokeStyle = JS.frame
      g.strokeRect(LEFT + 0.5, y0, plotW, ph)

      // inward ticks + y labels
      g.fillStyle = JS.tick
      g.textAlign = 'right'
      g.textBaseline = 'middle'
      for (let v = Math.ceil(lo / yStep) * yStep; v <= hi + 1e-9; v += yStep) {
        const y = Math.round(toY(v)) + 0.5
        g.beginPath(); g.moveTo(LEFT + 0.5, y); g.lineTo(LEFT + 4.5, y); g.stroke()
        if (y > y0 + 5 && y < y1 - 2) g.fillText(fmtTick(v, yStep), LEFT - 3, y)
      }
      for (let t = 0; t <= tMax + 1e-9; t += tStep) {
        const x = Math.round(toX(t)) + 0.5
        g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y1 - 4); g.stroke()
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + 4); g.stroke()
      }

      // traces (clipped to the frame)
      g.save()
      g.beginPath()
      g.rect(LEFT + 1, y0 + 0.5, plotW - 1, ph - 1)
      g.clip()

      const ref = refs[i]
      if (ref.length > 1) {
        g.strokeStyle = JS.ref
        g.beginPath()
        ref.forEach(([t, v], k) => {
          const x = toX(t); const y = toY(v)
          if (k === 0) g.moveTo(x, y); else g.lineTo(x, y)
        })
        g.stroke()
      }

      row.series.forEach((s, si) => {
        const sc = s.scale ?? 1
        g.strokeStyle = s.color ?? (si === 0 ? JS.trace : si === 1 ? JS.second : JS.third)
        const vals = history.map((p) => {
          const raw = p[s.key]
          return (typeof raw === 'number' ? raw : raw ? 1 : 0) * sc
        })
        strokeSeries(g, history, vals, toX, toY, s.spikes ? elmSpikes(history, vals) : null)
      })

      // cursor
      if (cursorT !== null && scrubTime !== null) {
        const x = Math.round(toX(cursorT)) + 0.5
        g.strokeStyle = JS.cursor
        g.setLineDash([3, 2])
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
        g.setLineDash([])
      }
      g.restore()

      // signal title top-left, readout top-right
      const TF = 'bold 11px Arial, Helvetica, sans-serif'
      g.font = TF
      g.textAlign = 'left'
      g.textBaseline = 'top'
      g.fillStyle = JS.trace
      const title = row.unit ? `${row.label} [${row.unit}]` : row.label
      drawRich(g, title, LEFT + 5, y0 + 3, TF, 'bold 8px Arial, Helvetica, sans-serif', 4)

      const RF = '10px Arial, Helvetica, sans-serif'
      const RSF = '7px Arial, Helvetica, sans-serif'
      g.font = RF
      g.textAlign = 'right'
      let rx = LEFT + plotW - 4
      const d = row.digits ?? 2
      const parts: { text: string; color: string }[] = []
      if (cursorT !== null) {
        row.series.forEach((s, si) => {
          const v = valueAt(history, s.key, cursorT, s.scale ?? 1)
          if (v === null) return
          const name = s.name ?? (si === 0 ? '' : s.key)
          parts.push({ text: `${name ? name + ' ' : ''}${v.toFixed(d)}`, color: s.color ?? (si === 0 ? JS.trace : si === 1 ? JS.second : JS.third) })
        })
        if (ref.length > 1) parts.push({ text: `program ${interp(ref, cursorT).toFixed(d)}`, color: JS.ref })
      } else if (ref.length > 1) {
        parts.push({ text: 'program', color: JS.ref })
      }
      for (let k = parts.length - 1; k >= 0; k--) {
        g.fillStyle = parts[k].color
        const w = richWidth(g, parts[k].text, RF, RSF)
        drawRich(g, parts[k].text, rx - w, y0 + 4, RF, RSF, 4)
        rx -= w + 10
      }
    })

    // time axis labels under the last row
    const yb = Math.round(TOP + n * rowH) + 0.5
    g.fillStyle = JS.tick
    g.font = '10px Arial, Helvetica, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'top'
    for (let t = 0; t <= tMax + 1e-9; t += tStep) {
      const x = Math.round(toX(t)) + 0.5
      g.fillText(fmtTick(t, tStep), x, yb + 2)
    }
    g.textAlign = 'left'
    g.fillText('t [s]', LEFT + plotW + 10, yb + 2)

    // a live time marker on the axis while the pulse runs
    if (scrubTime === null && time > 0 && !finished) {
      const x = Math.round(toX(Math.min(time, tMax))) + 0.5
      g.fillStyle = JS.ref
      g.beginPath(); g.moveTo(x, yb + 1); g.lineTo(x - 3, yb + 6); g.lineTo(x + 3, yb + 6); g.closePath(); g.fill()
    }
  }, [rows, refs, history, duration, time, scrubTime, finished])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(box)
    return () => ro.disconnect()
  }, [draw])

  const scrubAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const plotW = rect.width - LEFT - RIGHT
    const t = ((e.clientX - rect.left - LEFT) / plotW) * duration
    onScrub(Math.max(0, Math.min(duration, t)))
  }

  return (
    <div ref={boxRef} className="jet-jscope">
      <canvas
        ref={canvasRef}
        style={{ cursor: finished ? 'crosshair' : 'default' }}
        onPointerDown={(e) => { if (!finished) return; dragRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); scrubAt(e) }}
        onPointerMove={(e) => { if (dragRef.current) scrubAt(e) }}
        onPointerUp={(e) => { dragRef.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }}
        onDoubleClick={() => onScrub(null)}
      />
    </div>
  )
}
