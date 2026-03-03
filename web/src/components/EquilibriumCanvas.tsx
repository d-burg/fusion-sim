import { useRef, useEffect, useCallback } from 'react'
import type { Snapshot, Contour } from '../lib/types'

interface Props {
  snapshot: Snapshot | null
  wallJson: string // JSON array of [r, z] pairs
  limiterPoints?: [number, number][] // optional CAD limiter — replaces wall when provided
}

/** Colour palette for flux surfaces — core (warm) → edge (cool). */
function fluxColor(normalizedLevel: number): string {
  // level 0 = core (hot orange/white), level 1 = edge (cool blue)
  const r = Math.round(255 - normalizedLevel * 180)
  const g = Math.round(140 - normalizedLevel * 100)
  const b = Math.round(60 + normalizedLevel * 195)
  return `rgb(${r},${g},${b})`
}

export default function EquilibriumCanvas({ snapshot, wallJson, limiterPoints }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Size canvas to container
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = rect.width
    const H = rect.height

    // Clear
    ctx.fillStyle = '#0a0e17'
    ctx.fillRect(0, 0, W, H)

    // Use limiter as wall boundary when provided, otherwise parse wallJson
    let wall: [number, number][] = []
    if (limiterPoints && limiterPoints.length > 0) {
      wall = limiterPoints
    } else {
      try {
        wall = JSON.parse(wallJson)
      } catch {
        // empty
      }
    }

    if (wall.length === 0) {
      ctx.fillStyle = '#4b5563'
      ctx.font = '14px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('No equilibrium data', W / 2, H / 2)
      return
    }

    // Compute bounds from wall
    const rs = wall.map((p) => p[0])
    const zs = wall.map((p) => p[1])
    const rMin = Math.min(...rs)
    const rMax = Math.max(...rs)
    const zMin = Math.min(...zs)
    const zMax = Math.max(...zs)

    const padFrac = 0.08
    const dataW = rMax - rMin
    const dataH = zMax - zMin
    const rLo = rMin - dataW * padFrac
    const rHi = rMax + dataW * padFrac
    const zLo = zMin - dataH * padFrac
    const zHi = zMax + dataH * padFrac

    const scaleR = W / (rHi - rLo)
    const scaleZ = H / (zHi - zLo)
    const scale = Math.min(scaleR, scaleZ)

    const offsetX = (W - (rHi - rLo) * scale) / 2
    const offsetY = (H - (zHi - zLo) * scale) / 2

    const toX = (r: number) => (r - rLo) * scale + offsetX
    const toY = (z: number) => (zHi - z) * scale + offsetY // flip Y

    // --- Build wall clip path (used to mask flux surfaces & separatrix) ---
    const buildWallPath = () => {
      ctx.beginPath()
      for (let i = 0; i < wall.length; i++) {
        const x = toX(wall[i][0])
        const y = toY(wall[i][1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }

    // --- Draw flux surfaces (clipped to wall) ---
    if (snapshot && snapshot.flux_surfaces && snapshot.flux_surfaces.length > 0) {
      ctx.save()
      buildWallPath()
      ctx.clip()

      const surfaces = snapshot.flux_surfaces
      const nSurf = surfaces.length

      for (let i = 0; i < nSurf; i++) {
        const contour = surfaces[i]
        if (contour.points.length < 3) continue
        const t = nSurf > 1 ? i / (nSurf - 1) : 0.5
        ctx.strokeStyle = fluxColor(t)
        ctx.lineWidth = 1.2
        ctx.globalAlpha = 0.7
        drawContour(ctx, contour, toX, toY)
      }
      ctx.globalAlpha = 1.0
      ctx.restore()
    }

    // --- Draw separatrix (clipped to wall) ---
    if (snapshot && snapshot.separatrix && snapshot.separatrix.points.length > 2) {
      ctx.save()
      buildWallPath()
      ctx.clip()

      ctx.strokeStyle = '#facc15' // bright yellow
      ctx.lineWidth = 2
      ctx.shadowColor = '#facc15'
      ctx.shadowBlur = 6
      drawContour(ctx, snapshot.separatrix, toX, toY)
      ctx.shadowBlur = 0
      ctx.restore()
    }

    // --- Draw wall outline ---
    ctx.strokeStyle = '#6b7280'
    ctx.lineWidth = 2
    buildWallPath()
    ctx.stroke()

    // --- Draw magnetic axis ---
    if (snapshot && snapshot.axis_r > 0) {
      const ax = toX(snapshot.axis_r)
      const ay = toY(snapshot.axis_z)
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.arc(ax, ay, 4, 0, Math.PI * 2)
      ctx.fill()

      // Crosshair
      ctx.strokeStyle = '#f97316'
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(ax - 8, ay)
      ctx.lineTo(ax + 8, ay)
      ctx.moveTo(ax, ay - 8)
      ctx.lineTo(ax, ay + 8)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // --- Draw X-point ---
    if (snapshot && snapshot.xpoint_r > 0) {
      const xp = toX(snapshot.xpoint_r)
      const yp = toY(snapshot.xpoint_z)
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      const s = 5
      ctx.beginPath()
      ctx.moveTo(xp - s, yp - s)
      ctx.lineTo(xp + s, yp + s)
      ctx.moveTo(xp + s, yp - s)
      ctx.lineTo(xp - s, yp + s)
      ctx.stroke()
    }

    // --- Labels ---
    ctx.fillStyle = '#9ca3af'
    ctx.font = '11px monospace'
    ctx.textAlign = 'left'
    if (snapshot) {
      const labelX = 8
      let labelY = H - 8
      ctx.fillText(`q₉₅ = ${snapshot.q95.toFixed(2)}`, labelX, labelY)
      labelY -= 16
      ctx.fillText(`βN = ${snapshot.beta_n.toFixed(2)}`, labelX, labelY)
      labelY -= 16
      if (snapshot.in_hmode) {
        ctx.fillStyle = '#22d3ee'
        ctx.fillText('H-mode', labelX, labelY)
      } else {
        ctx.fillStyle = '#9ca3af'
        ctx.fillText('L-mode', labelX, labelY)
      }
    }
  }, [snapshot, wallJson, limiterPoints])

  // Redraw on data change
  useEffect(() => {
    draw()
  }, [draw])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0" />
      {/* Title overlay */}
      <div className="absolute top-2 left-3 text-xs text-gray-500 font-mono pointer-events-none">
        Equilibrium
      </div>
    </div>
  )
}

/**
 * Draw a contour path that may contain multiple disconnected loops.
 * Detects jumps larger than `jumpThreshold` (in data-space units)
 * and starts a new sub-path at each discontinuity.
 */
function drawContour(
  ctx: CanvasRenderingContext2D,
  contour: Contour,
  toX: (r: number) => number,
  toY: (z: number) => number,
  jumpThreshold = 0.15,
) {
  const pts = contour.points
  if (pts.length < 2) return

  ctx.beginPath()
  ctx.moveTo(toX(pts[0][0]), toY(pts[0][1]))

  for (let i = 1; i < pts.length; i++) {
    const dr = pts[i][0] - pts[i - 1][0]
    const dz = pts[i][1] - pts[i - 1][1]
    const dist = Math.sqrt(dr * dr + dz * dz)

    if (dist > jumpThreshold) {
      // Large jump → close the current sub-path and start a new one
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(toX(pts[i][0]), toY(pts[i][1]))
    } else {
      ctx.lineTo(toX(pts[i][0]), toY(pts[i][1]))
    }
  }
  ctx.stroke()
}
