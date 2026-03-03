import { useRef, useEffect, useCallback } from 'react'
import type { Snapshot } from '../lib/types'

interface Props {
  snapshot: Snapshot | null
  limiterPoints?: [number, number][]
}

// ── Camera & projection constants ──────────────────────────────────────────

const CAM_R = 3.8
const CAM_PHI = 0
const CAM_Z = 0.15
const LOOK_R = 1.2
const LOOK_PHI = 0.25
const LOOK_Z = -0.05
const FOV = 55

// Toroidal sweep range
const PHI_MIN = -0.65
const PHI_MAX = 0.75
const N_SLICES = 32

// Surface rendering tuning
const SURFACE_BASE_ALPHA = 0.18
const SURFACE_ELM_ALPHA = 0.35
const SURFACE_BLUR_PX = 2.5

// ── 3D math helpers ────────────────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number }

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (len < 1e-12) return { x: 0, y: 0, z: 1 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function buildCamera(W: number, H: number) {
  const camPos: Vec3 = {
    x: CAM_R * Math.cos(CAM_PHI),
    y: CAM_R * Math.sin(CAM_PHI),
    z: CAM_Z,
  }
  const lookAt: Vec3 = {
    x: LOOK_R * Math.cos(LOOK_PHI),
    y: LOOK_R * Math.sin(LOOK_PHI),
    z: LOOK_Z,
  }

  const forward = normalize(sub(lookAt, camPos))
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  const right = normalize(cross(forward, worldUp))
  const up = cross(right, forward)

  const focal = (Math.min(W, H) * 0.5) / Math.tan((FOV * Math.PI) / 360)
  const cx = W * 0.5
  const cy = H * 0.5

  return {
    pos: camPos,
    project(p: Vec3): { sx: number; sy: number; depth: number } | null {
      const d = sub(p, camPos)
      const cz = dot(forward, d)
      if (cz < 0.05) return null
      const px = dot(right, d)
      const py = dot(up, d)
      return {
        sx: cx + (focal * px) / cz,
        sy: cy - (focal * py) / cz,
        depth: cz,
      }
    },
  }
}

// ── Toroidal sweep ─────────────────────────────────────────────────────────

function toroidal(R: number, Z: number, phi: number): Vec3 {
  return { x: R * Math.cos(phi), y: R * Math.sin(phi), z: Z }
}

function subsample(pts: [number, number][], maxPts: number): [number, number][] {
  if (pts.length <= maxPts) return pts
  const step = pts.length / maxPts
  const out: [number, number][] = []
  for (let i = 0; i < maxPts; i++) {
    out.push(pts[Math.floor(i * step)])
  }
  return out
}

/**
 * Densify a closed (R,Z) contour by interpolating points where consecutive
 * points are more than maxGap apart. Treats the contour as a closed loop.
 */
function densifyContour(pts: [number, number][], maxGap: number): [number, number][] {
  const result: [number, number][] = []
  for (let i = 0; i < pts.length; i++) {
    result.push(pts[i])
    const ni = (i + 1) % pts.length
    const dR = pts[ni][0] - pts[i][0]
    const dZ = pts[ni][1] - pts[i][1]
    const dist = Math.sqrt(dR * dR + dZ * dZ)
    if (dist > maxGap) {
      const n = Math.ceil(dist / maxGap)
      for (let k = 1; k < n; k++) {
        const t = k / n
        result.push([pts[i][0] + t * dR, pts[i][1] + t * dZ])
      }
    }
  }
  return result
}

// ── Projected point type ───────────────────────────────────────────────────

interface ScreenPt { sx: number; sy: number; depth: number }

// ── Component ──────────────────────────────────────────────────────────────

export default function PortView({ snapshot, limiterPoints }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)

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

    // Ensure offscreen canvas
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas')
    }
    const offscreen = offscreenRef.current
    offscreen.width = canvas.width
    offscreen.height = canvas.height

    // Dark background
    ctx.fillStyle = '#06080d'
    ctx.fillRect(0, 0, W, H)

    const cam = buildCamera(W, H)

    // Draw limiter wall (always visible — inboard/top/bottom portions)
    if (limiterPoints && limiterPoints.length > 2) {
      drawLimiterWall(ctx, cam, limiterPoints, W, H)
    }

    if (!snapshot || snapshot.separatrix.points.length < 4) {
      ctx.fillStyle = '#4b556366'
      ctx.font = '11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('No plasma', W * 0.55, H * 0.52)
      return
    }

    const lcfs = subsample(snapshot.separatrix.points, 70)
    const elmActive = snapshot.elm_active
    const disrupted = snapshot.disrupted

    // ── Step 1: Build projection grid ──
    const phis: number[] = []
    for (let i = 0; i < N_SLICES; i++) {
      phis.push(PHI_MIN + (PHI_MAX - PHI_MIN) * (i / (N_SLICES - 1)))
    }

    const grid: (ScreenPt | null)[][] = []
    const sliceDepths: number[] = []

    for (let s = 0; s < N_SLICES; s++) {
      const phi = phis[s]
      const row: (ScreenPt | null)[] = []
      let depthSum = 0
      let depthCount = 0
      for (const [R, Z] of lcfs) {
        const p3d = toroidal(R, Z, phi)
        const p2d = cam.project(p3d)
        if (p2d) {
          row.push({ sx: p2d.sx, sy: p2d.sy, depth: p2d.depth })
          depthSum += p2d.depth
          depthCount++
        } else {
          row.push(null)
        }
      }
      grid.push(row)
      sliceDepths.push(depthCount > 0 ? depthSum / depthCount : 100)
    }

    // Depth range for normalization
    let minDepth = Infinity, maxDepth = -Infinity
    for (const d of sliceDepths) {
      if (d < minDepth) minDepth = d
      if (d > maxDepth) maxDepth = d
    }
    const depthRange = maxDepth - minDepth + 0.01

    // ── Step 2: Draw filled surface to offscreen canvas ──
    const oCtx = offscreen.getContext('2d')
    if (!oCtx) return
    oCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    oCtx.clearRect(0, 0, W, H)

    // Surface color — slightly brighter cyan-blue
    const sr = disrupted ? 200 : 100
    const sg = disrupted ? 90 : 175
    const sb = disrupted ? 50 : 230

    const stripAlpha = elmActive && !disrupted ? SURFACE_ELM_ALPHA : SURFACE_BASE_ALPHA

    // Build strip order: sort by average depth of the pair (back-to-front)
    const stripOrder: { idx: number; avgDepth: number }[] = []
    for (let i = 0; i < N_SLICES - 1; i++) {
      stripOrder.push({
        idx: i,
        avgDepth: (sliceDepths[i] + sliceDepths[i + 1]) / 2,
      })
    }
    stripOrder.sort((a, b) => b.avgDepth - a.avgDepth) // farthest first

    oCtx.globalCompositeOperation = 'source-over'

    for (const { idx, avgDepth } of stripOrder) {
      const depthFrac = 1 - (avgDepth - minDepth) / depthRange // 0=far, 1=near
      const alpha = stripAlpha * (0.5 + depthFrac * 0.5) // far=50% of base, near=100%

      const sliceA = grid[idx]
      const sliceB = grid[idx + 1]

      // Build closed polygon: forward along A, backward along B
      oCtx.beginPath()
      let started = false
      for (let j = 0; j < lcfs.length; j++) {
        const p = sliceA[j]
        if (!p) continue
        if (!started) { oCtx.moveTo(p.sx, p.sy); started = true }
        else oCtx.lineTo(p.sx, p.sy)
      }
      for (let j = lcfs.length - 1; j >= 0; j--) {
        const p = sliceB[j]
        if (!p) continue
        oCtx.lineTo(p.sx, p.sy)
      }
      oCtx.closePath()

      oCtx.fillStyle = `rgba(${sr},${sg},${sb},${alpha.toFixed(3)})`
      oCtx.fill()
    }

    // ── Step 3: Composite blurred surface onto main canvas ──
    ctx.save()
    ctx.filter = `blur(${SURFACE_BLUR_PX}px)`
    ctx.globalAlpha = 0.85
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
    ctx.restore()

    // Draw a second, sharper pass at moderate opacity for definition
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
    ctx.restore()

    // ── Step 4: X-point / divertor glow ──
    if (snapshot.xpoint_r > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      // Draw on a few slices near the front
      for (let s = 0; s < N_SLICES; s += 3) {
        const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange
        if (depthFrac < 0.3) continue // skip far slices
        const baseAlpha = 0.05 + depthFrac * 0.35
        drawXpointGlow(ctx, cam, snapshot, phis[s], baseAlpha * 0.7, elmActive)
      }
      ctx.restore()
    }

    // ── Step 6: ELM flash overlay ──
    if (elmActive && !disrupted) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const grad = ctx.createRadialGradient(W * 0.5, H * 0.48, 0, W * 0.5, H * 0.48, W * 0.45)
      grad.addColorStop(0, 'rgba(200, 240, 255, 0.10)')
      grad.addColorStop(0.5, 'rgba(150, 220, 255, 0.05)')
      grad.addColorStop(1, 'rgba(100, 180, 255, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }

    // ── Step 7: Disrupted flash ──
    if (disrupted) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = 'rgba(255, 60, 30, 0.08)'
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }
  }, [snapshot, limiterPoints])

  useEffect(() => { draw() }, [draw])

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
      <div className="absolute bottom-0.5 left-0 right-0 text-center text-[10px] text-gray-600 font-mono pointer-events-none">
        Port view
      </div>
    </div>
  )
}

// ── Drawing helpers ────────────────────────────────────────────────────────

function drawXpointGlow(
  ctx: CanvasRenderingContext2D,
  cam: ReturnType<typeof buildCamera>,
  snapshot: Snapshot,
  phi: number,
  baseAlpha: number,
  elmActive: boolean,
) {
  const xR = snapshot.xpoint_r
  const xZ = snapshot.xpoint_z
  const p3d = toroidal(xR, xZ, phi)
  const p2d = cam.project(p3d)
  if (!p2d) return

  const boost = elmActive ? 1.8 : 1.0
  const radius = 5 + baseAlpha * 8
  const alpha = Math.min(baseAlpha * 0.5 * boost, 1)

  const grad = ctx.createRadialGradient(p2d.sx, p2d.sy, 0, p2d.sx, p2d.sy, radius)
  grad.addColorStop(0, `rgba(180, 230, 255, ${alpha})`)
  grad.addColorStop(0.4, `rgba(140, 200, 255, ${alpha * 0.5})`)
  grad.addColorStop(1, 'rgba(100, 160, 255, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(p2d.sx - radius, p2d.sy - radius, radius * 2, radius * 2)

  // Divertor legs
  const legInR = xR - 0.15, legInZ = xZ - 0.25
  const pIn = cam.project(toroidal(legInR, legInZ, phi))
  if (pIn) {
    ctx.strokeStyle = `rgba(160, 220, 255, ${alpha * 0.4})`
    ctx.lineWidth = 1 + baseAlpha * 1.5
    ctx.beginPath()
    ctx.moveTo(p2d.sx, p2d.sy)
    ctx.lineTo(pIn.sx, pIn.sy)
    ctx.stroke()
  }

  const legOutR = xR + 0.15, legOutZ = xZ - 0.25
  const pOut = cam.project(toroidal(legOutR, legOutZ, phi))
  if (pOut) {
    ctx.strokeStyle = `rgba(160, 220, 255, ${alpha * 0.4})`
    ctx.lineWidth = 1 + baseAlpha * 1.5
    ctx.beginPath()
    ctx.moveTo(p2d.sx, p2d.sy)
    ctx.lineTo(pOut.sx, pOut.sy)
    ctx.stroke()
  }
}

/**
 * Draw the limiter wall as a smooth toroidally-swept surface.
 * Uses individual quad faces with backface culling and depth sorting
 * to create the appearance of a hollow torus interior.
 * The full closed contour is swept — backface culling naturally hides
 * the outboard-facing exterior, creating the "looking through the port" effect.
 */
function drawLimiterWall(
  ctx: CanvasRenderingContext2D,
  cam: ReturnType<typeof buildCamera>,
  limiter: [number, number][],
  _W: number,
  _H: number,
) {
  // Densify contour — interpolate large gaps (inboard wall segments)
  // and treat the contour as a closed loop
  const pts = densifyContour(limiter, 0.08)
  const nPts = pts.length
  if (nPts < 3) return

  const nSlices = N_SLICES // same as plasma (32)
  const phis: number[] = []
  for (let i = 0; i < nSlices; i++) {
    phis.push(PHI_MIN + (PHI_MAX - PHI_MIN) * (i / (nSlices - 1)))
  }

  // Approximate plasma axis R for backface culling
  const AXIS_R = 1.7

  // Build 3D grid: grid3D[slice][pointIdx] = Vec3
  const grid3D: Vec3[][] = []
  for (let s = 0; s < nSlices; s++) {
    const phi = phis[s]
    const row: Vec3[] = []
    for (const [R, Z] of pts) {
      row.push(toroidal(R, Z, phi))
    }
    grid3D.push(row)
  }

  // Build screen projection grid: gridScr[slice][pointIdx] = ScreenPt | null
  const gridScr: (ScreenPt | null)[][] = []
  for (let s = 0; s < nSlices; s++) {
    const row: (ScreenPt | null)[] = []
    for (const p3d of grid3D[s]) {
      const p2d = cam.project(p3d)
      row.push(p2d ? { sx: p2d.sx, sy: p2d.sy, depth: p2d.depth } : null)
    }
    gridScr.push(row)
  }

  // Build individual quad faces with backface culling
  const quadDepths: number[] = []
  const quadCorners: (ScreenPt | null)[][] = []

  for (let s = 0; s < nSlices - 1; s++) {
    const phiMid = (phis[s] + phis[s + 1]) * 0.5
    const axisPt = toroidal(AXIS_R, 0, phiMid)

    for (let j = 0; j < nPts; j++) {
      const jn = (j + 1) % nPts // closed contour

      // 3D corners: [s,j] [s,jn] [s+1,jn] [s+1,j]
      const a = grid3D[s][j]
      const b = grid3D[s][jn]
      const c = grid3D[s + 1][jn]
      const d = grid3D[s + 1][j]

      // Quad center in 3D
      const qcx = (a.x + b.x + c.x + d.x) * 0.25
      const qcy = (a.y + b.y + c.y + d.y) * 0.25
      const qcz = (a.z + b.z + c.z + d.z) * 0.25

      // Backface culling: only show interior-facing surface
      // "Inward" direction = from limiter surface toward plasma axis
      const inward: Vec3 = {
        x: axisPt.x - qcx,
        y: axisPt.y - qcy,
        z: -qcz, // axis is at Z=0
      }
      const viewDir: Vec3 = {
        x: cam.pos.x - qcx,
        y: cam.pos.y - qcy,
        z: cam.pos.z - qcz,
      }

      // If inward direction aligns with view direction, the interior face
      // is visible to the camera — draw it
      if (dot(inward, viewDir) <= 0) continue

      // Screen projections
      const sa = gridScr[s][j]
      const sb = gridScr[s][jn]
      const sc = gridScr[s + 1][jn]
      const sd = gridScr[s + 1][j]

      // Need at least 3 visible corners for a meaningful polygon
      let visCount = 0
      let depthSum = 0
      for (const p of [sa, sb, sc, sd]) {
        if (p) { visCount++; depthSum += p.depth }
      }
      if (visCount < 3) continue

      quadCorners.push([sa, sb, sc, sd])
      quadDepths.push(depthSum / visCount)
    }
  }

  if (quadCorners.length === 0) return

  // Build sort indices (back-to-front)
  const indices = Array.from({ length: quadCorners.length }, (_, i) => i)
  indices.sort((a, b) => quadDepths[b] - quadDepths[a])

  // Depth range for shading
  let minD = Infinity, maxD = -Infinity
  for (const d of quadDepths) {
    if (d < minD) minD = d
    if (d > maxD) maxD = d
  }
  const dRange = maxD - minD + 0.01

  // Draw all quads back-to-front
  ctx.save()
  for (const qi of indices) {
    const df = 1 - (quadDepths[qi] - minD) / dRange // 0=far, 1=near
    const brightness = Math.round(14 + df * 34)
    const alpha = 0.75 + df * 0.20

    const corners = quadCorners[qi]
    ctx.beginPath()
    let started = false
    for (const p of corners) {
      if (!p) continue
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true }
      else ctx.lineTo(p.sx, p.sy)
    }
    ctx.closePath()
    ctx.fillStyle = `rgba(${brightness},${brightness + 2},${brightness + 6},${alpha.toFixed(2)})`
    ctx.fill()
  }
  ctx.restore()
}
