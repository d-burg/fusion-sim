import { useRef, useEffect, useCallback } from 'react'
import type { Snapshot, Contour } from '../lib/types'
import InfoPopup from './InfoPopup'
import { equilibriumInfo } from './infoContent'
import { useSettings } from '../lib/settingsContext'

interface Props {
  snapshot: Snapshot | null
  wallJson: string // JSON array of [r, z] pairs
  limiterPoints?: [number, number][] // optional CAD limiter — replaces wall when provided
}

/** Inferno colormap — perceptually uniform, colourblind-robust (vs the old
 *  ad-hoc orange→blue ramp). 10 anchor stops, linearly interpolated. */
const INFERNO: [number, number, number][] = [
  [0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96],
  [207, 68, 70], [237, 105, 37], [251, 154, 6], [247, 208, 60], [252, 255, 164],
]
function inferno(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (INFERNO.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = INFERNO[i]
  const b = INFERNO[Math.min(i + 1, INFERNO.length - 1)]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/** Flux-surface colour — core (level 0) is hottest/brightest, edge (level 1)
 *  fades to dark, following the inferno luminance ramp. */
function fluxColor(normalizedLevel: number): string {
  const [r, g, b] = inferno(1 - normalizedLevel)
  return `rgb(${r},${g},${b})`
}

export default function EquilibriumCanvas({ snapshot, wallJson, limiterPoints }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useSettings()
  const isRetro = theme === 'retro'

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
    ctx.fillStyle = isRetro ? '#000000' : '#0e0f11'
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

    const dataW = rMax - rMin
    const dataH = zMax - zMin
    // Asymmetric padding: extra room on left & bottom for axis labels
    const rLo = rMin - dataW * 0.14
    const rHi = rMax + dataW * 0.06
    const zLo = zMin - dataH * 0.14
    const zHi = zMax + dataH * 0.06

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

    // Compute jump threshold for contour rendering.  The Rust contour
    // extraction uses a 48×72 marching-squares grid whose cell size scales
    // with the device.  Adjacent contour points are at most one cell
    // diagonal apart, so the threshold must exceed √(dr²+dz²).  We use
    // 3× the estimated diagonal to be safe.
    const estDr = dataW / 47
    const estDz = dataH / 71
    const jumpThresh = 3.0 * Math.sqrt(estDr * estDr + estDz * estDz)

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
        if (isRetro) {
          // Green contours, brighter toward the core
          const g = Math.round(100 + (1 - t) * 155)
          ctx.strokeStyle = `rgb(0,${g},0)`
        } else {
          ctx.strokeStyle = fluxColor(t)
        }
        ctx.lineWidth = isRetro ? 1.0 : 1.2
        ctx.globalAlpha = isRetro ? 0.8 : 0.7
        drawContour(ctx, contour, toX, toY, jumpThresh)
      }
      ctx.globalAlpha = 1.0
      ctx.restore()
    }

    // --- Draw separatrix ---
    if (snapshot && snapshot.separatrix && snapshot.separatrix.points.length > 2) {
      const applySepStyle = () => {
        if (isRetro) {
          ctx.strokeStyle = '#33ff33'
          ctx.lineWidth = 2
          ctx.shadowColor = '#33ff33'
          ctx.shadowBlur = 4
        } else {
          ctx.strokeStyle = '#facc15' // bright yellow
          ctx.lineWidth = 2
          ctx.shadowColor = '#facc15'
          ctx.shadowBlur = 6
        }
      }

      // Main separatrix body, clipped to the wall.
      ctx.save()
      buildWallPath()
      ctx.clip()
      applySepStyle()
      drawContour(ctx, snapshot.separatrix, toX, toY, jumpThresh)
      ctx.shadowBlur = 0
      ctx.restore()

      // Divertor-leg extensions to the limiter strike points, drawn UNCLIPPED so
      // they reach into the divertor (e.g. the DIII-D upper baffle slot) instead
      // of being cut off at the main wall boundary.
      ctx.save()
      applySepStyle()
      extendLegsToWall(ctx, snapshot.separatrix.points, wall, toX, toY, jumpThresh)
      ctx.shadowBlur = 0
      ctx.restore()
    }

    // --- Draw wall outline ---
    ctx.strokeStyle = isRetro ? '#555555' : '#6b7280'
    ctx.lineWidth = 2
    buildWallPath()
    ctx.stroke()

    // --- Draw magnetic axis + X-points (clipped to wall interior) ---
    // Clip to the wall polygon so markers don't appear outside the limiter
    // during ramp-up when equilibrium geometry is still evolving.
    const hasPlasma = snapshot && snapshot.ip > 0.05
    ctx.save()
    buildWallPath()
    ctx.clip()

    if (hasPlasma && snapshot.axis_r > 0) {
      // Compute axis from centroid of the innermost flux surface so it
      // tracks the actual rendered contours during dynamic shape changes.
      let axisR = snapshot.axis_r
      let axisZ = snapshot.axis_z
      const innermost = snapshot.flux_surfaces?.[0]
      if (innermost && innermost.points.length > 3) {
        let sumR = 0, sumZ = 0
        for (const pt of innermost.points) {
          sumR += pt[0]
          sumZ += pt[1]
        }
        axisR = sumR / innermost.points.length
        axisZ = sumZ / innermost.points.length
      }
      const ax = toX(axisR)
      const ay = toY(axisZ)
      ctx.fillStyle = isRetro ? '#33ff33' : '#f97316'
      ctx.beginPath()
      ctx.arc(ax, ay, 4, 0, Math.PI * 2)
      ctx.fill()

      // Crosshair
      ctx.strokeStyle = isRetro ? '#33ff33' : '#f97316'
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

    // --- X-point(s) ---
    const drawXMark = (r: number, z: number) => {
      const xp = toX(r)
      const yp = toY(z)
      ctx.strokeStyle = isRetro ? '#ffff33' : '#ef4444'
      ctx.lineWidth = 2
      const s = 5
      ctx.beginPath()
      ctx.moveTo(xp - s, yp - s)
      ctx.lineTo(xp + s, yp + s)
      ctx.moveTo(xp + s, yp - s)
      ctx.lineTo(xp - s, yp + s)
      ctx.stroke()
    }
    if (hasPlasma && snapshot.xpoint_r > 0) {
      drawXMark(snapshot.xpoint_r, snapshot.xpoint_z)
    }
    if (hasPlasma && (snapshot.xpoint_upper_r ?? 0) > 0) {
      drawXMark(snapshot.xpoint_upper_r, snapshot.xpoint_upper_z)
    }

    ctx.restore() // remove wall clip

    // --- R / Z Axes ---
    // Pick a "nice" tick step that avoids overcrowding at small panel sizes.
    // pixelsPerUnit lets us adapt to actual rendered size.
    const niceStep = (_range: number, pixelsPerUnit: number) => {
      // Target ~40-60 px between ticks
      const candidates = [0.1, 0.2, 0.5, 1.0, 2.0]
      for (const c of candidates) {
        if (c * pixelsPerUnit >= 40) return c
      }
      return 2.0
    }

    ctx.lineWidth = 0.5

    // R axis ticks (bottom)
    const rStep = niceStep(rMax - rMin, scale)
    let rTick = Math.ceil(rMin / rStep) * rStep
    rTick = Math.round(rTick * 1000) / 1000
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const bottomEdge = toY(zMin)
    while (rTick <= rMax + rStep * 0.01) {
      const x = toX(rTick)
      // Faint vertical grid line
      ctx.strokeStyle = isRetro ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'
      ctx.beginPath()
      ctx.moveTo(x, toY(zMax))
      ctx.lineTo(x, bottomEdge)
      ctx.stroke()
      // Tick mark
      ctx.strokeStyle = 'rgba(107,114,128,0.5)'
      ctx.beginPath()
      ctx.moveTo(x, bottomEdge)
      ctx.lineTo(x, bottomEdge + 4)
      ctx.stroke()
      // Label
      ctx.fillStyle = '#6b7280'
      ctx.font = '9px monospace'
      ctx.fillText(rTick.toFixed(1), x, bottomEdge + 5)
      rTick = Math.round((rTick + rStep) * 1000) / 1000
    }

    // Z axis ticks (left)
    const zStep = niceStep(zMax - zMin, scale)
    let zTick = Math.ceil(zMin / zStep) * zStep
    zTick = Math.round(zTick * 1000) / 1000
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const leftEdge = toX(rMin)
    while (zTick <= zMax + zStep * 0.01) {
      const y = toY(zTick)
      // Faint horizontal grid line
      ctx.strokeStyle = isRetro ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'
      ctx.beginPath()
      ctx.moveTo(leftEdge, y)
      ctx.lineTo(toX(rMax), y)
      ctx.stroke()
      // Tick mark
      ctx.strokeStyle = 'rgba(107,114,128,0.5)'
      ctx.beginPath()
      ctx.moveTo(leftEdge, y)
      ctx.lineTo(leftEdge - 4, y)
      ctx.stroke()
      // Label
      ctx.fillStyle = '#6b7280'
      ctx.font = '9px monospace'
      ctx.fillText(zTick.toFixed(1), leftEdge - 6, y)
      zTick = Math.round((zTick + zStep) * 1000) / 1000
    }

    // Axis unit labels
    ctx.fillStyle = '#4b5563'
    ctx.font = '9px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('R (m)', (toX(rMin) + toX(rMax)) / 2, bottomEdge + 16)
    ctx.save()
    ctx.translate(leftEdge - 34, (toY(zMax) + toY(zMin)) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textBaseline = 'middle'
    ctx.fillText('Z (m)', 0, 0)
    ctx.restore()

    // --- Labels ---
    const labelColor = isRetro ? '#1a801a' : '#9ca3af'
    const labelHighlight = isRetro ? '#ffb000' : '#e0a23a'
    ctx.fillStyle = labelColor
    ctx.font = isRetro ? '11px "VCR OSD Mono", "Courier New", monospace' : '11px monospace'
    ctx.textAlign = 'left'
    if (snapshot) {
      const labelX = 8
      let labelY = H - 22
      // q95: render "q" then subscript "95" at smaller font to avoid
      // awkward spacing from Unicode subscript digits in monospace fonts.
      const q95Val = ` = ${snapshot.q95.toFixed(2)}`
      ctx.fillText('q', labelX, labelY)
      const qW = ctx.measureText('q').width
      ctx.save()
      ctx.font = isRetro ? '8px "VCR OSD Mono", "Courier New", monospace' : '8px monospace'
      ctx.fillText('95', labelX + qW, labelY + 3)
      const subW = ctx.measureText('95').width
      ctx.restore()
      ctx.font = isRetro ? '11px "VCR OSD Mono", "Courier New", monospace' : '11px monospace'
      ctx.fillText(q95Val, labelX + qW + subW, labelY)
      labelY -= 16
      // βN: render "β" then subscript "N"
      const bnVal = ` = ${snapshot.beta_n.toFixed(2)}`
      ctx.fillText('\u03B2', labelX, labelY)
      const betaW = ctx.measureText('\u03B2').width
      ctx.save()
      ctx.font = isRetro ? '8px "VCR OSD Mono", "Courier New", monospace' : '8px monospace'
      ctx.fillText('N', labelX + betaW, labelY + 3)
      const nW = ctx.measureText('N').width
      ctx.restore()
      ctx.font = isRetro ? '11px "VCR OSD Mono", "Courier New", monospace' : '11px monospace'
      ctx.fillText(bnVal, labelX + betaW + nW, labelY)
      labelY -= 16
      if (snapshot.in_hmode) {
        ctx.fillStyle = labelHighlight
        ctx.fillText('H-mode', labelX, labelY)
      } else {
        ctx.fillStyle = labelColor
        ctx.fillText('L-mode', labelX, labelY)
      }
      labelY -= 16
      ctx.fillStyle = labelColor
      ctx.fillText(`Bₜ = ${snapshot.bt.toFixed(2)} T`, labelX, labelY)
      labelY -= 16
      if (snapshot.is_limited) {
        ctx.fillStyle = isRetro ? '#ccaa00' : '#f59e0b'
        ctx.fillText('Limited', labelX, labelY)
      } else {
        ctx.fillStyle = '#6b7280'
        ctx.fillText('Diverted', labelX, labelY)
      }
    }
  }, [snapshot, wallJson, limiterPoints, isRetro])

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
      <div className="absolute top-2 left-3 panel-title flex items-center gap-1.5">
        <span className="pointer-events-none"><span className="panel-num">01 · </span>Equilibrium</span>
        <InfoPopup title="Magnetic Equilibrium" position="right">
          {equilibriumInfo}
        </InfoPopup>
      </div>
    </div>
  )
}

/**
 * Extend open separatrix divertor legs to the limiter wall.
 *
 * The analytic flux legs thin out and the contour terminates short of the
 * strike points. For each OPEN chain (the closed LCFS is skipped), extend each
 * free endpoint along its outgoing tangent until it hits the wall (forward
 * ray-cast, within `maxExtend`). Tangent extension continues the leg's natural
 * direction, so it doesn't curl back like a nearest-point connector would.
 */
function extendLegsToWall(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  wall: [number, number][],
  toX: (r: number) => number,
  toY: (z: number) => number,
  jumpThresh: number,
  // The Rust side now clips the separatrix at its first wall impact, so leg
  // ends normally sit ON the wall and need no extension at all. This pass
  // survives only as a short gap-bridger for walls whose display polygon
  // differs slightly from the physics wall — hence the tight cap. The old
  // 0.5 m reach let the tangent ray fly from an already-landed strike point
  // clear across the divertor throat to the far baffle, drawing the "leg
  // through the limiter" glitch.
  maxExtend = 0.08,
) {
  if (points.length < 4 || wall.length < 3) return

  const distToWall = (px: number, py: number): number => {
    let best = Infinity
    for (let i = 0; i < wall.length; i++) {
      const a = wall[i]
      const b = wall[(i + 1) % wall.length]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0
      best = Math.min(best, Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy))
    }
    return best
  }

  // Forward ray (unit dir d from p) vs wall polygon → nearest hit point or null.
  const rayHit = (px: number, py: number, dx: number, dy: number): [number, number] | null => {
    let bestT = Infinity
    let hit: [number, number] | null = null
    for (let i = 0; i < wall.length; i++) {
      const a = wall[i]
      const b = wall[(i + 1) % wall.length]
      const v1x = px - a[0], v1y = py - a[1]
      const v2x = b[0] - a[0], v2y = b[1] - a[1]
      const v3x = -dy, v3y = dx
      const denom = v2x * v3x + v2y * v3y
      if (Math.abs(denom) < 1e-9) continue
      const t = (v2x * v1y - v2y * v1x) / denom // distance along ray (d is unit)
      const s = (v1x * v3x + v1y * v3y) / denom // position on segment
      if (t > 1e-4 && t < bestT && s >= 0 && s <= 1) {
        bestT = t
        hit = [px + t * dx, py + t * dy]
      }
    }
    return hit && bestT <= maxExtend ? hit : null
  }

  // Split into chains at jumps.
  const chains: [number, number][][] = []
  let cur: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
      if (d > jumpThresh) { chains.push(cur); cur = [] }
    }
    cur.push(points[i])
  }
  if (cur.length) chains.push(cur)

  const extend = (end: [number, number], back: [number, number]) => {
    // Already terminated on the wall (the normal case with Rust-side leg
    // clipping, which lands ends within ~3 mm of the boundary) — nothing to
    // extend, and extending would draw across in-vessel space.
    if (distToWall(end[0], end[1]) < 0.012) return
    let dx = end[0] - back[0]
    let dy = end[1] - back[1]
    const n = Math.hypot(dx, dy)
    if (n < 1e-9) return
    dx /= n; dy /= n
    const h = rayHit(end[0], end[1], dx, dy)
    if (!h) return
    ctx.beginPath()
    ctx.moveTo(toX(end[0]), toY(end[1]))
    ctx.lineTo(toX(h[0]), toY(h[1]))
    ctx.stroke()
  }

  for (const ch of chains) {
    if (ch.length < 4) continue
    const f = ch[0]
    const l = ch[ch.length - 1]
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < jumpThresh) continue // closed loop
    extend(l, ch[ch.length - 4]) // outgoing tangent at the last point
    extend(f, ch[3]) // outgoing tangent at the first point
  }
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
