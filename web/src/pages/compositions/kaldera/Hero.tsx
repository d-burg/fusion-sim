import { useCallback, useEffect, useRef } from 'react'
import type { Contour, Snapshot } from '../../../lib/types'
import { applyCaps } from './Strips'

interface Props {
  snapshot: Snapshot | null
  wallJson: string
  limiterPoints?: [number, number][]
}

/** A polyline with the engine's marching-squares jumps broken into sub-paths. */
function tracePath(g: CanvasRenderingContext2D, c: Contour, X: (r: number) => number, Y: (z: number) => number, jump: number) {
  const pts = c.points
  if (pts.length < 2) return
  g.beginPath()
  g.moveTo(X(pts[0][0]), Y(pts[0][1]))
  for (let i = 1; i < pts.length; i++) {
    const dr = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1]
    if (Math.hypot(dr, dz) > jump) { g.stroke(); g.beginPath(); g.moveTo(X(pts[i][0]), Y(pts[i][1])) }
    else g.lineTo(X(pts[i][0]), Y(pts[i][1]))
  }
  g.stroke()
}

/**
 * The hero: the equilibrium cross-section drawn large, line-only, white at
 * low opacity on the flat field. The separatrix is the one bright line and
 * carries a faint red warmth, like the render's glow on kaldera.desy.de.
 */
export default function Hero({ snapshot, wallJson, limiterPoints }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current, box = boxRef.current
    if (!canvas || !box) return
    const g = canvas.getContext('2d')
    if (!g) return
    const rect = box.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(40, Math.floor(rect.width)), H = Math.max(40, Math.floor(rect.height))
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)

    let wall: [number, number][] = []
    if (limiterPoints && limiterPoints.length > 0) wall = limiterPoints
    else { try { wall = JSON.parse(wallJson) } catch { wall = [] } }
    if (wall.length < 3) return

    const rs = wall.map((p) => p[0]), zs = wall.map((p) => p[1])
    const rMin = Math.min(...rs), rMax = Math.max(...rs), zMin = Math.min(...zs), zMax = Math.max(...zs)
    const dW = rMax - rMin, dH = zMax - zMin
    // margins: the caption above, the Z scale at the left, the R scale below
    const MT = 30, ML = 34, MB = 16
    const pad = 0.04
    const scale = Math.min((W - ML) / (dW * (1 + 2 * pad)), (H - MT - MB) / (dH * (1 + 2 * pad)))
    const ox = ML + (W - ML - dW * scale) / 2, oy = MT + (H - MT - MB - dH * scale) / 2
    const X = (r: number) => ox + (r - rMin) * scale
    const Y = (z: number) => oy + (zMax - z) * scale
    const jump = 3 * Math.hypot(dW / 47, dH / 71)

    // the scale: a few R and Z values in metres, faint, with 3 px ticks
    const step = (span: number) => { const raw = span / 3, p10 = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / p10; return (r < 1.5 ? 1 : r < 3.5 ? 2 : 5) * p10 }
    applyCaps(g, box, 8)
    ;(g as unknown as { letterSpacing: string }).letterSpacing = '0.1em'
    g.fillStyle = 'rgba(255,255,255,0.4)'
    g.strokeStyle = 'rgba(255,255,255,0.25)'
    g.lineWidth = 1
    const rStep = step(dW), zStep = step(dH)
    const yb = Math.round(Y(zMin)) + 0.5, xl = Math.round(X(rMin)) + 0.5
    g.textAlign = 'center'; g.textBaseline = 'top'
    for (let r = Math.ceil(rMin / rStep) * rStep; r <= rMax + 1e-9; r += rStep) {
      const x = Math.round(X(r)) + 0.5
      g.beginPath(); g.moveTo(x, yb); g.lineTo(x, yb + 3); g.stroke()
      g.fillText(r.toFixed(rStep < 1 ? 1 : 0), x, yb + 6)
    }
    g.textAlign = 'right'; g.textBaseline = 'middle'
    for (let z = Math.ceil(zMin / zStep) * zStep; z <= zMax + 1e-9; z += zStep) {
      const y = Math.round(Y(z)) + 0.5
      g.beginPath(); g.moveTo(xl, y); g.lineTo(xl - 3, y); g.stroke()
      g.fillText((Math.abs(z) < 1e-9 ? 0 : z).toFixed(zStep < 1 ? 1 : 0), xl - 6, y)
    }
    g.fillText('M', xl - 6, Y(zMax) - 10)

    const wallPath = () => {
      g.beginPath()
      wall.forEach(([r, z], i) => (i ? g.lineTo(X(r), Y(z)) : g.moveTo(X(r), Y(z))))
      g.closePath()
    }

    // a faint vertical through the geometric center: the one construction line
    g.strokeStyle = 'rgba(255,255,255,0.05)'
    g.lineWidth = 1
    const xc = Math.round(X((rMin + rMax) / 2)) + 0.5
    g.beginPath(); g.moveTo(xc, MT - 6); g.lineTo(xc, H - MB + 2); g.stroke()

    // flux surfaces, clipped to the wall
    if (snapshot && snapshot.flux_surfaces?.length) {
      g.save(); wallPath(); g.clip()
      const n = snapshot.flux_surfaces.length
      snapshot.flux_surfaces.forEach((c, i) => {
        if (c.points.length < 3) return
        const t = n > 1 ? i / (n - 1) : 0.5
        g.strokeStyle = `rgba(255,255,255,${(0.10 + 0.14 * (1 - t)).toFixed(3)})`
        g.lineWidth = 1
        tracePath(g, c, X, Y, jump)
      })
      g.restore()
    }

    // separatrix: red warmth underneath, then the one bright line
    if (snapshot && snapshot.separatrix?.points.length > 2) {
      g.save(); wallPath(); g.clip()
      g.lineCap = 'round'; g.lineJoin = 'round'
      g.strokeStyle = 'rgba(255,96,72,0.10)'; g.lineWidth = 9; tracePath(g, snapshot.separatrix, X, Y, jump)
      g.strokeStyle = 'rgba(255,130,110,0.22)'; g.lineWidth = 3.5; tracePath(g, snapshot.separatrix, X, Y, jump)
      g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 1.2; tracePath(g, snapshot.separatrix, X, Y, jump)
      g.restore()
    }

    // wall
    g.strokeStyle = 'rgba(255,255,255,0.30)'
    g.lineWidth = 1
    wallPath(); g.stroke()

    // axis and X-points as the site's tiny square markers
    const hasPlasma = !!snapshot && snapshot.ip > 0.05
    if (hasPlasma && snapshot) {
      g.save(); wallPath(); g.clip()
      if (snapshot.axis_r > 0) {
        const x = Math.round(X(snapshot.axis_r)), y = Math.round(Y(snapshot.axis_z))
        g.fillStyle = 'rgba(255,255,255,0.95)'
        g.fillRect(x - 2, y - 2, 4, 4)
      }
      const xp = (r: number, z: number) => {
        if (!(r > 0)) return
        const x = Math.round(X(r)), y = Math.round(Y(z))
        g.strokeStyle = 'rgba(255,255,255,0.8)'
        g.lineWidth = 1
        g.strokeRect(x - 3.5, y - 3.5, 7, 7)
      }
      xp(snapshot.xpoint_r, snapshot.xpoint_z)
      xp(snapshot.xpoint_upper_r ?? 0, snapshot.xpoint_upper_z ?? 0)
      g.restore()
    }
  }, [snapshot, wallJson, limiterPoints])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(box)
    return () => ro.disconnect()
  }, [draw])

  return (
    <div ref={boxRef} className="kd-hero">
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}
