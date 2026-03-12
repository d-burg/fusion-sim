import { useRef, useEffect, useCallback } from 'react'
import type { TracePoint } from '../lib/types'
import { useSettings } from '../lib/settingsContext'

interface TraceConfig {
  key: keyof TracePoint
  label: string
  unit: string
  color: string
  scale?: number // multiply value for display
}

const TRACES: TraceConfig[] = [
  { key: 'ip', label: 'Iₚ', unit: 'MA', color: '#22d3ee' },
  { key: 'te0', label: 'Tₑ₀', unit: 'keV', color: '#f97316' },
  { key: 'ne_bar', label: 'n̄ₑ', unit: '10²⁰m⁻³', color: '#a78bfa' },
  { key: 'w_th', label: 'Wₜₕ', unit: 'MJ', color: '#34d399' },
  { key: 'beta_n', label: 'βN', unit: '', color: '#fbbf24' },
  { key: 'd_alpha', label: 'Dα', unit: 'a.u.', color: '#fb7185' },
]

const ROW_H = 52 // px per trace row
const MARGIN_LEFT = 64
const MARGIN_RIGHT = 8
const MARGIN_TOP = 4
const MARGIN_BOTTOM = 2

interface Props {
  history: TracePoint[]
  duration: number // total discharge duration
}

export default function TimeTraces({ history, duration }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useSettings()
  const isModern = theme === 'modern'

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = rect.width
    const totalH = TRACES.length * ROW_H

    // Clear
    ctx.fillStyle = isModern ? '#08080a' : '#0a0e17'
    ctx.fillRect(0, 0, W, totalH)

    const plotW = W - MARGIN_LEFT - MARGIN_RIGHT
    const tMax = duration > 0 ? duration : 10
    const toX = (t: number) => MARGIN_LEFT + (t / tMax) * plotW

    for (let row = 0; row < TRACES.length; row++) {
      const cfg = TRACES[row]
      const y0 = row * ROW_H + MARGIN_TOP
      const h = ROW_H - MARGIN_TOP - MARGIN_BOTTOM

      // Row background
      ctx.fillStyle = isModern
        ? (row % 2 === 0 ? '#0a0a0d' : '#0e0e11')
        : (row % 2 === 0 ? '#0d1117' : '#111827')
      ctx.fillRect(0, y0 - MARGIN_TOP, W, ROW_H)

      // Row separator
      ctx.strokeStyle = isModern ? 'rgba(255,255,255,0.06)' : '#1f2937'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y0 + h + MARGIN_BOTTOM)
      ctx.lineTo(W, y0 + h + MARGIN_BOTTOM)
      ctx.stroke()

      // Label
      ctx.fillStyle = cfg.color
      ctx.font = '11px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(cfg.label, MARGIN_LEFT - 6, y0 + h / 2 + 4)

      // Get data and auto-scale
      if (history.length < 2) continue

      const vals = history.map((pt) => {
        const v = pt[cfg.key] as number
        return cfg.scale ? v * cfg.scale : v
      })

      let vMin = Math.min(...vals)
      let vMax = Math.max(...vals)
      if (vMax - vMin < 1e-10) {
        vMin -= 0.5
        vMax += 0.5
      }
      // Add 10% padding
      const range = vMax - vMin
      vMin -= range * 0.1
      vMax += range * 0.1

      const toY = (v: number) => y0 + h - ((v - vMin) / (vMax - vMin)) * h

      // Draw trace
      ctx.strokeStyle = cfg.color
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      for (let i = 0; i < history.length; i++) {
        const x = toX(history[i].t)
        const y = toY(vals[i])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1

      // Current value label
      const last = vals[vals.length - 1]
      ctx.fillStyle = cfg.color
      ctx.font = '10px monospace'
      ctx.textAlign = 'left'
      const unitStr = cfg.unit ? ` ${cfg.unit}` : ''
      ctx.fillText(`${last.toFixed(2)}${unitStr}`, MARGIN_LEFT + 2, y0 + 12)
    }

    // "Now" line
    if (history.length > 0) {
      const nowX = toX(history[history.length - 1].t)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.3
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(nowX, 0)
      ctx.lineTo(nowX, totalH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
  }, [history, duration, isModern])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  const totalH = TRACES.length * ROW_H

  return (
    <div ref={containerRef} className="w-full relative" style={{ height: totalH }}>
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
