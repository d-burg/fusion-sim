import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { WaveformPoint } from '../lib/wasm'

interface Props {
  waveform: WaveformPoint[]
  baseWaveform: WaveformPoint[]
  duration: number
  label: string
  unit: string
  color: string
  min: number
  max: number
  onSave: (waveform: WaveformPoint[]) => void
  onClose: () => void
}

// ── Smoothing & resampling ──────────────────────────────────────

function gaussianSmooth(points: WaveformPoint[], windowSize: number): WaveformPoint[] {
  const sigma = windowSize / 2
  const kernel: number[] = []
  for (let i = -windowSize; i <= windowSize; i++) {
    kernel.push(Math.exp(-0.5 * (i / sigma) ** 2))
  }
  return points.map(([t], idx) => {
    let sum = 0, wSum = 0
    for (let k = 0; k < kernel.length; k++) {
      const j = idx + k - windowSize
      if (j >= 0 && j < points.length) {
        sum += points[j][1] * kernel[k]
        wSum += kernel[k]
      }
    }
    return [t, sum / wSum] as WaveformPoint
  })
}

function interpolateAt(points: WaveformPoint[], t: number): number {
  if (points.length === 0) return 0
  if (t <= points[0][0]) return points[0][1]
  if (t >= points[points.length - 1][0]) return points[points.length - 1][1]
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] >= t) {
      const frac = (t - points[i - 1][0]) / (points[i][0] - points[i - 1][0])
      return points[i - 1][1] + frac * (points[i][1] - points[i - 1][1])
    }
  }
  return points[points.length - 1][1]
}

function resampleWaveform(points: WaveformPoint[], numPoints: number, duration: number): WaveformPoint[] {
  const result: WaveformPoint[] = []
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) * duration
    result.push([t, interpolateAt(points, t)])
  }
  return result
}

// ── Canvas layout ───────────────────────────────────────────────

const MARGIN = { left: 52, right: 16, top: 20, bottom: 28 }
const CANVAS_W = 500
const CANVAS_H = 280

export default function WaveformDrawer({
  waveform, baseWaveform, duration, label, unit, color, min, max, onSave, onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const rawPointsRef = useRef<[number, number][]>([])
  const [drawnWaveform, setDrawnWaveform] = useState<WaveformPoint[] | null>(null)
  const [drawTick, setDrawTick] = useState(0)

  const displayWf = drawnWaveform ?? waveform

  // Y-axis range
  const allVals = [...displayWf.map(p => p[1]), ...baseWaveform.map(p => p[1]), min, max]
  const yMin = Math.min(...allVals, 0)
  const yMax = Math.max(...allVals) * 1.15 || 1

  const plotW = CANVAS_W - MARGIN.left - MARGIN.right
  const plotH = CANVAS_H - MARGIN.top - MARGIN.bottom

  const dataToPixel = useCallback((t: number, v: number): [number, number] => [
    MARGIN.left + (t / duration) * plotW,
    MARGIN.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH,
  ], [duration, plotW, plotH, yMin, yMax])

  const pixelToData = useCallback((px: number, py: number): [number, number] => [
    Math.max(0, Math.min(duration, ((px - MARGIN.left) / plotW) * duration)),
    Math.max(min, Math.min(max * 1.5, yMin + ((plotH - (py - MARGIN.top)) / plotH) * (yMax - yMin))),
  ], [duration, plotW, plotH, yMin, yMax, min, max])

  // ── Mouse handlers ────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (px < MARGIN.left || px > CANVAS_W - MARGIN.right) return
    if (py < MARGIN.top || py > CANVAS_H - MARGIN.bottom) return
    setIsDrawing(true)
    rawPointsRef.current = [[px, py]]
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const pts = rawPointsRef.current
    if (pts.length > 0 && px <= pts[pts.length - 1][0]) return
    pts.push([px, py])
  }, [isDrawing])

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return
    setIsDrawing(false)
    const pts = rawPointsRef.current
    if (pts.length < 3) return

    let dataPoints: WaveformPoint[] = pts.map(([px, py]) => pixelToData(px, py))
    if (dataPoints[0][0] > 0.01) dataPoints.unshift([0, dataPoints[0][1]])
    if (dataPoints[dataPoints.length - 1][0] < duration - 0.01) dataPoints.push([duration, dataPoints[dataPoints.length - 1][1]])

    const smoothed = gaussianSmooth(dataPoints, 5)
    const resampled = resampleWaveform(smoothed, 25, duration)
    setDrawnWaveform(resampled.map(([t, v]) => [t, Math.max(0, v)] as WaveformPoint))
  }, [isDrawing, pixelToData, duration])

  // Live preview tick
  useEffect(() => {
    if (!isDrawing) return
    const id = setInterval(() => setDrawTick(n => n + 1), 33)
    return () => clearInterval(id)
  }, [isDrawing])

  // ── Canvas render ─────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#0a0c10'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const x = MARGIN.left + (i / 4) * plotW
      ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + plotH); ctx.stroke()
      const y = MARGIN.top + (i / 4) * plotH
      ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(MARGIN.left + plotW, y); ctx.stroke()
    }

    // Axis labels
    ctx.fillStyle = '#6b7280'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    for (let i = 0; i <= 4; i++) {
      ctx.fillText(`${((i / 4) * duration).toFixed(1)}`, MARGIN.left + (i / 4) * plotW, CANVAS_H - 6)
    }
    ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (1 - i / 4) * (yMax - yMin)
      ctx.fillText(v.toFixed(1), MARGIN.left - 4, MARGIN.top + (i / 4) * plotH + 3)
    }
    ctx.textAlign = 'center'
    ctx.fillText('t (s)', MARGIN.left + plotW / 2, CANVAS_H)
    ctx.save()
    ctx.translate(10, MARGIN.top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(unit, 0, 0)
    ctx.restore()

    // Draw waveform helper
    const drawWf = (wf: WaveformPoint[], col: string, lw: number, dash: number[] = []) => {
      if (wf.length < 2) return
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash)
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.beginPath()
      wf.forEach(([t, v], i) => { const [x, y] = dataToPixel(t, v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.stroke(); ctx.setLineDash([])
    }

    drawWf(baseWaveform, `${color}25`, 1.5, [4, 4])
    drawWf(displayWf, color, 2.5)

    // Live drawing preview
    if (isDrawing && rawPointsRef.current.length > 1) {
      ctx.strokeStyle = `${color}80`; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2])
      ctx.beginPath()
      rawPointsRef.current.forEach(([x, y], i) => { i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.stroke(); ctx.setLineDash([])
    }
  }, [displayWf, baseWaveform, duration, color, yMin, yMax, plotW, plotH, dataToPixel, isDrawing, drawTick, unit])

  // ── Render ────────────────────────────────────────────────────

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-sm font-medium text-gray-200">{label}</span>
            <span className="text-xs text-gray-500">({unit})</span>
          </div>
        </div>

        {/* Canvas — fixed size, no resize observer needed */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ width: CANVAS_W, height: CANVAS_H, cursor: 'crosshair', display: 'block' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-700">
          <button onClick={() => setDrawnWaveform(null)}
            className="px-3 py-1 rounded text-sm bg-gray-800 text-gray-400 hover:bg-gray-700 cursor-pointer">
            Reset
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1 rounded text-sm bg-gray-800 text-gray-400 hover:bg-gray-700 cursor-pointer">
              Cancel
            </button>
            <button
              onClick={() => { if (drawnWaveform) onSave(drawnWaveform); else onClose() }}
              disabled={!drawnWaveform}
              className={`px-4 py-1 rounded text-sm cursor-pointer ${
                drawnWaveform ? 'bg-cyan-700 text-white hover:bg-cyan-600' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
