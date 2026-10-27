import { useCallback, useEffect, useRef } from 'react'
import type { TracePoint } from '../../../lib/types'
import type { Waveform } from './phase'

interface Props {
  history: TracePoint[]
  /** Programmed Ip, drawn dotted with a dot at each knot. */
  ipProgram?: Waveform
  /** Peak programmed Ip, the scale for the Ip curve. */
  ipPeak: number
  duration: number
  time: number
  scrubTime: number | null
  onScrub?: (t: number | null) => void
}

export const KD_FONT = "9px 'Michroma', sans-serif"

/**
 * Three thin white curves along the lower third with no axes: Ip, W_th and
 * the D_alpha envelope, each on its own vertical scale so they read as three
 * lines of different height, as the site's electric-field curves do. The
 * programme is a dotted companion with dot markers at its breakpoints.
 */
export default function Traces({ history, ipProgram, ipPeak, duration, time, scrubTime, onScrub }: Props) {
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
    const base = H - 1

    let wMax = 0, dMax = 0, iMax = ipPeak
    for (const p of history) { if (p.w_th > wMax) wMax = p.w_th; if (p.d_alpha > dMax) dMax = p.d_alpha; if (p.ip > iMax) iMax = p.ip }
    wMax = Math.max(wMax, 0.05); dMax = Math.max(dMax, 0.05); iMax = Math.max(iMax, 0.05)

    const series: { key: keyof TracePoint; scale: number; span: number; alpha: number; label: string }[] = [
      { key: 'ip', scale: iMax, span: 0.92, alpha: 0.9, label: 'IP' },
      { key: 'w_th', scale: wMax, span: 0.62, alpha: 0.55, label: 'W TH' },
      { key: 'd_alpha', scale: dMax, span: 0.34, alpha: 0.38, label: 'D α' },
    ]

    // the programme: dotted, dots at the knots
    if (ipProgram && ipProgram.length > 1) {
      const Yp = (v: number) => base - (v / iMax) * 0.92 * (H - 14)
      g.save()
      g.strokeStyle = 'rgba(255,255,255,0.45)'
      g.lineWidth = 1
      g.setLineDash([1, 4])
      g.beginPath()
      ipProgram.forEach(([t, v], i) => (i ? g.lineTo(X(t), Yp(v)) : g.moveTo(X(t), Yp(v))))
      g.stroke()
      g.setLineDash([])
      g.fillStyle = 'rgba(255,255,255,0.85)'
      for (const [t, v] of ipProgram) { g.beginPath(); g.arc(X(t), Yp(v), 1.6, 0, Math.PI * 2); g.fill() }
      g.restore()
    }

    // curves, then their labels pushed apart so they never overlap at the curves' ends
    const labels: { text: string; y: number; alpha: number }[] = []
    let endX = 0
    for (const s of series) {
      if (history.length < 2) continue
      const Y = (v: number) => base - (Math.max(0, v) / s.scale) * s.span * (H - 14)
      g.strokeStyle = `rgba(255,255,255,${s.alpha})`
      g.lineWidth = 1
      g.lineJoin = 'round'
      g.beginPath()
      history.forEach((p, i) => { const x = X(p.t), y = Y(Number(p[s.key])); if (i) g.lineTo(x, y); else g.moveTo(x, y) })
      g.stroke()
      const last = history[history.length - 1]
      endX = X(last.t)
      labels.push({ text: s.label, y: Y(Number(last[s.key])), alpha: Math.min(1, s.alpha + 0.25) })
    }
    labels.sort((a, b) => a.y - b.y)
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12
    for (let i = labels.length - 1; i >= 0; i--) labels[i].y = Math.min(labels[i].y, H - 6 - 12 * (labels.length - 1 - i))
    g.font = KD_FONT
    g.textBaseline = 'middle'
    // the labels ride the curves' ends; once the ends reach the right edge they step
    // up into the top-right corner, clear of the playhead and the END station
    const right = endX + 48 > W
    g.textAlign = right ? 'right' : 'left'
    labels.forEach((l, i) => {
      g.fillStyle = `rgba(255,255,255,${l.alpha})`
      g.fillText(l.text, right ? W : endX + 8, right ? 8 + 12 * i : Math.max(6, l.y))
    })

    // the hairline at the playhead time, continued below by the timeline
    const cur = scrubTime ?? (time > 0 ? time : null)
    if (cur !== null) {
      const x = Math.round(X(Math.min(cur, T))) + 0.5
      g.strokeStyle = 'rgba(255,255,255,0.55)'
      g.lineWidth = 1
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke()
    }
  // history is mutated in place by the simulation hook; key on its length and last time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, history.length, history.length ? history[history.length - 1].t : 0, ipProgram, ipPeak, duration, time, scrubTime])

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
    <div ref={boxRef} className="kd-traces">
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
