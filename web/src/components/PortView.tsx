import { useRef, useEffect, useCallback } from 'react'
import type { Snapshot } from '../lib/types'

interface Props {
  snapshot: Snapshot | null
  limiterPoints?: [number, number][]
  deviceId?: string
  wallJson?: string     // fallback wall outline for non-DIII-D devices
  deviceR0?: number     // major radius for default port config
  deviceA?: number      // minor radius for default port config
}

// ── Per-device diagnostic port configuration ─────────────────────────────
// Models the camera sitting inside a cylindrical diagnostic port on the
// outboard midplane, looking inward through a circular opening in the wall.

interface PortConfig {
  portR: number         // R where port meets vessel wall (outboard midplane)
  portZ: number         // Z of port center (0 = midplane)
  portRadius: number    // port cylinder radius (m)
  portLength: number    // length from vessel wall to camera (m)
  portPhi: number       // toroidal angle of port center
  camR: number          // camera R (= portR + portLength)
  camZ: number          // camera Z
  camPhi: number        // camera toroidal angle
  lookR: number         // look-at R (near magnetic axis)
  lookZ: number         // look-at Z
  lookPhi: number       // look-at toroidal angle
  fov: number           // field of view (degrees)
  tileColor: [number, number, number]  // base RGB for wall tiles
  tileGridSpacing: { poloidal: number; toroidal: number }
  tileGridDarken: number  // brightness reduction on grid lines (0–1)
  phiMin: number        // wall toroidal sweep range (full 360°)
  phiMax: number
  plasmaPhiMin: number  // plasma toroidal sweep (narrower — only visible range)
  plasmaPhiMax: number
  nWallSlices: number
  nPlasmaSlices: number
}

function defaultPortConfig(r0: number, a: number): PortConfig {
  const portR = r0 + a * 0.95     // just inside outermost wall
  const portLength = a * 0.25     // camera very close behind wall
  const fov = 80                   // wide-angle ~18mm equivalent — fits wall height
  // Port radius large enough that the rim is outside the camera FOV
  const portRadius = Math.tan((fov / 2) * Math.PI / 180) * portLength * 1.4
  return {
    portR,
    portZ: 0,
    portRadius,
    portLength,
    portPhi: 0,
    camR: portR + portLength,
    camZ: 0.04,
    camPhi: 0,
    lookR: r0 * 0.65,
    lookZ: -0.02,
    lookPhi: 0.25,
    fov,
    tileColor: [32, 32, 34],
    tileGridSpacing: { poloidal: 0.12, toroidal: 0.10 },
    tileGridDarken: 0.25,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 80,
  }
}

const PORT_CONFIGS: Record<string, PortConfig> = {
  diiid: {
    portR: 2.35,
    portZ: 0,
    portRadius: 0.42,     // tan(40°)*0.25*1.4 — rim outside 80° FOV
    portLength: 0.25,     // camera very close behind the wall
    portPhi: 0,
    camR: 2.60,           // portR + portLength
    camZ: 0.04,
    camPhi: 0,
    lookR: 1.10,
    lookZ: -0.02,
    lookPhi: 0.28,        // turned right — more toroidal angle
    fov: 80,              // wide-angle ~18mm — fits wall vertically
    tileColor: [28, 28, 30],       // dark matte carbon
    tileGridSpacing: { poloidal: 0.10, toroidal: 0.08 },
    tileGridDarken: 0.30,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 80,
  },
  iter: {
    portR: 8.30,
    portZ: 0,
    portRadius: 0.60,     // tan(40°)*0.35*1.4 — rim outside 80° FOV
    portLength: 0.35,     // camera close behind wall
    portPhi: 0,
    camR: 8.65,           // portR + portLength
    camZ: 0.06,
    camPhi: 0,
    lookR: 4.00,
    lookZ: -0.03,
    lookPhi: 0.22,        // turned right
    fov: 80,              // wide-angle ~18mm — fits wall vertically
    tileColor: [38, 36, 32],       // boronized tungsten
    tileGridSpacing: { poloidal: 0.15, toroidal: 0.12 },
    tileGridDarken: 0.25,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 80,
  },
  sparc: {
    portR: 2.10,
    portZ: 0,
    portRadius: 0.35,     // tan(40°)*0.20*1.4 — rim outside 80° FOV
    portLength: 0.20,     // camera close behind wall
    portPhi: 0,
    camR: 2.30,           // portR + portLength
    camZ: 0.04,
    camPhi: 0,
    lookR: 1.10,
    lookZ: -0.02,
    lookPhi: 0.28,        // turned right
    fov: 80,              // wide-angle ~18mm — fits wall vertically
    tileColor: [36, 34, 30],       // tungsten tiles
    tileGridSpacing: { poloidal: 0.08, toroidal: 0.07 },
    tileGridDarken: 0.28,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 80,
  },
  jet: {
    portR: 3.80,
    portZ: 0,
    portRadius: 0.50,     // tan(40°)*0.30*1.4 — rim outside 80° FOV
    portLength: 0.30,     // camera close behind wall
    portPhi: 0,
    camR: 4.10,           // portR + portLength
    camZ: 0.06,
    camPhi: 0,
    lookR: 2.00,
    lookZ: -0.03,
    lookPhi: 0.25,        // turned right
    fov: 80,              // wide-angle ~18mm — fits wall vertically
    tileColor: [32, 30, 28],       // carbon/Be wall
    tileGridSpacing: { poloidal: 0.12, toroidal: 0.10 },
    tileGridDarken: 0.26,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 80,
  },
}

function getPortConfig(deviceId?: string, r0?: number, a?: number): PortConfig {
  if (deviceId && PORT_CONFIGS[deviceId]) return PORT_CONFIGS[deviceId]
  return defaultPortConfig(r0 ?? 1.7, a ?? 0.6)
}

// ── Per-machine opacity tuning ───────────────────────────────────────────
// Hotter / larger machines get lower opacity so the plasma surface looks
// more tenuous and physically correct (optically thinner at higher Te).
const DEVICE_OPACITY_SCALE: Record<string, number> = {
  diiid:   0.45,   // medium-size — keep plasma subtle / tenuous
  iter:    0.55,   // very large, very hot → more transparent than DIII-D
  sparc:   0.55,   // compact but high-field / high-Te
  jet:     0.60,   // large conventional tokamak
}
const DEFAULT_OPACITY_SCALE = 0.65

// Per-machine power scaling for strike point glow intensity.
// Higher-power devices produce brighter divertor strike-point emission.
const DEVICE_POWER_SCALE: Record<string, number> = {
  diiid:   0.18,  // ~5–15 MW NBI — very subtle hint
  iter:    1.0,   // ~50 MW — very bright strike points
  sparc:   0.8,   // ~25 MW in compact device
  jet:     0.6,   // ~25 MW conventional
}
const DEFAULT_POWER_SCALE = 0.5

// Strike-point glow fade-in/out time constant (seconds).
// The glow ramps smoothly over this duration rather than snapping on/off.
const STRIKE_FADE_RATE = 0.5   // seconds to go 0→1 (or 1→0)
const LEG_FADE_RATE = 0.4      // seconds for divertor legs to fade in/out

// Camera & projection constants removed — now in PortConfig per device

// Surface rendering tuning — multi-shell radial emission profile
// Physically, visible-light emission peaks near the separatrix where
// partially-ionized impurities and neutrals radiate (cooler edge).
// The hot core is essentially transparent at visible wavelengths.
const SURFACE_BASE_ALPHA = 0.005
const SURFACE_ELM_ALPHA  = 0.010
const SURFACE_BLUR_PX = 2.5

// Radial emission shells: each shell is a thin ANNULAR RING between an
// inner and outer scale factor from the centroid.  Using rings (not filled
// discs) keeps the core visually empty — only the edge radiates.
//   - Deep pedestal (0.82–0.90): barely visible → transparent core preserved
//   - Pedestal shoulder (0.90–0.97): gentle ramp upward
//   - Separatrix peak (0.97–1.005): thin bright ring — the main emission
//   - Near SOL (1.005–1.02): still bright, but tight
//   - Far SOL (1.02–1.04): fast drop-off
const EMISSION_SHELLS: { innerScale: number; outerScale: number; weight: number }[] = [
  { innerScale: 0.82, outerScale: 0.90, weight: 0.03 },   // deep pedestal — faintest hint
  { innerScale: 0.90, outerScale: 0.97, weight: 0.20 },   // pedestal shoulder
  { innerScale: 0.97, outerScale: 1.005, weight: 1.00 },  // separatrix peak (thin!)
  { innerScale: 1.005, outerScale: 1.02, weight: 0.40 },  // near SOL
  { innerScale: 1.02, outerScale: 1.04, weight: 0.06 },   // far SOL
]

// ── Limb-brightened separatrix glow ─────────────────────────────────────
// In a real tokamak, sight lines tangent to the separatrix shell pass
// through a long column of emitting material.  Path length through a
// thin toroidal shell at major radius R goes roughly as ~1/R, so the
// inboard side (small R, tight curvature) accumulates ~2× more emission
// than the outboard side.  We model this as per-segment stroke alpha
// weighted by (R_geo / R_local)^LIMB_EXPONENT.
const LIMB_GLOW_PASSES: { lineWidth: number; alphaScale: number }[] = [
  { lineWidth: 6.0, alphaScale: 0.20 },  // outer halo — wider, slightly brighter
  { lineWidth: 2.5, alphaScale: 0.55 },  // bright core
]
const LIMB_EXPONENT = 1.4   // controls inboard/outboard contrast
const LIMB_BASE_ALPHA = 0.018  // overall brightness of the limb glow (up from 0.015)
const LIMB_N_SECTORS = 6     // split LCFS into N angular sectors for perf

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

function buildCamera(W: number, H: number, cfg: PortConfig) {
  const camPos: Vec3 = {
    x: cfg.camR * Math.cos(cfg.camPhi),
    y: cfg.camR * Math.sin(cfg.camPhi),
    z: cfg.camZ,
  }
  const lookAt: Vec3 = {
    x: cfg.lookR * Math.cos(cfg.lookPhi),
    y: cfg.lookR * Math.sin(cfg.lookPhi),
    z: cfg.lookZ,
  }

  const forward = normalize(sub(lookAt, camPos))
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  const right = normalize(cross(forward, worldUp))
  const up = cross(right, forward)

  const focal = (Math.min(W, H) * 0.5) / Math.tan((cfg.fov * Math.PI) / 360)
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

export default function PortView({ snapshot, limiterPoints, deviceId, wallJson, deviceR0, deviceA }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const wallCacheRef = useRef<{
    farCanvas: HTMLCanvasElement   // inboard wall — drawn BEHIND plasma
    nearCanvas: HTMLCanvasElement  // outboard wall + port — drawn IN FRONT of plasma
    w: number; h: number; key: string
  } | null>(null)
  const strikeGlowRef = useRef(0)       // current fade level 0–1
  const legFadeRef = useRef(0)          // divertor leg fade level 0–1
  const prevTimeRef = useRef<number>(0)  // previous snapshot time for dt calc
  const maxProgIpRef = useRef(0)        // peak |prog_ip| seen this discharge

  // Resolve wall points: prefer limiterPoints, fall back to parsed wallJson
  const resolvedWall = limiterPoints ?? (() => {
    if (!wallJson) return undefined
    try { return JSON.parse(wallJson) as [number, number][] } catch { return undefined }
  })()

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Size canvas to container — only resize when dimensions change
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(rect.width * dpr)
    const targetH = Math.round(rect.height * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = rect.width
    const H = rect.height

    // Ensure offscreen canvas — only resize when dimensions change
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas')
    }
    const offscreen = offscreenRef.current
    if (offscreen.width !== canvas.width || offscreen.height !== canvas.height) {
      offscreen.width = canvas.width
      offscreen.height = canvas.height
    }

    // Port config for this device
    const portCfg = getPortConfig(deviceId, deviceR0, deviceA)
    const [tr, tg, tb] = portCfg.tileColor

    // Background: dark version of tile color — uncovered pixels look like distant wall
    ctx.fillStyle = `rgb(${Math.round(tr * 0.4)},${Math.round(tg * 0.4)},${Math.round(tb * 0.4)})`
    ctx.fillRect(0, 0, W, H)

    const cam = buildCamera(W, H, portCfg)

    // Build/cache limiter wall — split into far (behind plasma) and near (in front).
    // Far wall is drawn BEFORE plasma, near wall AFTER (correct occlusion).
    if (resolvedWall && resolvedWall.length > 2) {
      const wallKey = `${canvas.width}x${canvas.height}x${resolvedWall.length}x${deviceId ?? 'default'}`
      const wc = wallCacheRef.current
      if (!wc || wc.key !== wallKey) {
        // Far canvas: inboard wall (behind plasma)
        const farCanvas = wc?.farCanvas ?? document.createElement('canvas')
        farCanvas.width = canvas.width
        farCanvas.height = canvas.height
        const farCtx = farCanvas.getContext('2d')
        if (farCtx) {
          farCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
          drawLimiterWall(farCtx, cam, resolvedWall, W, H, portCfg, 'far')
        }

        // Near canvas: outboard wall + port cylinder (in front of plasma)
        const nearCanvas = wc?.nearCanvas ?? document.createElement('canvas')
        nearCanvas.width = canvas.width
        nearCanvas.height = canvas.height
        const nearCtx = nearCanvas.getContext('2d')
        if (nearCtx) {
          nearCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
          drawLimiterWall(nearCtx, cam, resolvedWall, W, H, portCfg, 'near')
          drawPortCylinder(nearCtx, cam, portCfg)
        }

        wallCacheRef.current = { farCanvas, nearCanvas, w: canvas.width, h: canvas.height, key: wallKey }
      }

      // Draw far wall immediately (behind plasma)
      ctx.drawImage(wallCacheRef.current.farCanvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
    }

    if (!snapshot || snapshot.separatrix.points.length < 4) {
      // Draw both wall layers (no plasma to sandwich between them)
      if (wallCacheRef.current) {
        // Far wall already drawn above; draw near wall on top
        ctx.drawImage(wallCacheRef.current.nearCanvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
      }
      ctx.fillStyle = '#4b556366'
      ctx.font = '11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('No plasma', W * 0.55, H * 0.52)
      return
    }

    const elmActive = snapshot.elm_active
    const disrupted = snapshot.disrupted
    const xpZ = snapshot.xpoint_z
    const xpR = snapshot.xpoint_r
    const hasXpoint = xpR > 0 && xpZ < -0.01

    // ── Time delta for fade effects ──
    // Computed early so fades update even during early returns (betaN < 0.15).
    const dt = Math.abs(snapshot.time - prevTimeRef.current)
    // Detect new discharge (time jumped backward) — reset tracking state
    if (snapshot.time < prevTimeRef.current - 0.5) {
      maxProgIpRef.current = 0
      legFadeRef.current = 0
    }
    prevTimeRef.current = snapshot.time

    // ── Divertor leg fade ──
    // Legs appear when the programmed Ip has reached its flat-top value
    // (progIpFrac ≈ 1.0) and fade out as soon as ramp-down begins
    // (progIpFrac drops below threshold).  This uses peak-tracking: we
    // record the maximum |prog_ip| seen this discharge, then compare the
    // current value to that peak.  During ramp-down prog_ip drops while
    // both ip and prog_ip decrease together (so ip/prog_ip stays ~1.0),
    // but progIpFrac correctly detects the descent from flat-top.
    const progIpAbs = Math.abs(snapshot.prog_ip)
    if (progIpAbs > maxProgIpRef.current) maxProgIpRef.current = progIpAbs
    const progIpFrac = maxProgIpRef.current > 0.1
      ? progIpAbs / maxProgIpRef.current : 0
    const ipFrac = Math.abs(snapshot.prog_ip) > 0.1
      ? Math.abs(snapshot.ip) / Math.abs(snapshot.prog_ip) : 0
    const wantLegs = hasXpoint && progIpFrac > 0.98 && ipFrac > 0.5 && !disrupted
    const legFadeStep = LEG_FADE_RATE > 0 ? Math.min(dt / LEG_FADE_RATE, 1) : 1
    if (wantLegs) {
      legFadeRef.current = Math.min(legFadeRef.current + legFadeStep, 1)
    } else {
      legFadeRef.current = Math.max(legFadeRef.current - legFadeStep, 0)
    }
    const legFade = legFadeRef.current

    // ── Edge contour for emission shells and limb glow ──
    // The actual separatrix (ψ=0) has figure-eight topology at the X-point,
    // making it unsuitable for closed-loop emission shells.  Instead we use
    // the ψ_N≈0.995 flux surface (last entry in flux_surfaces) — visually
    // identical to the separatrix but guaranteed to be a simple closed curve.
    // During ramp-up/ramp-down the near-edge surface can be fragmentary, so
    // we walk inward through flux surfaces until we find one with enough
    // points to form a proper contour (≥20 points above the X-point).
    const nFlux = snapshot.flux_surfaces.length
    let edgeSurface: [number, number][] = []
    for (let fi = nFlux - 1; fi >= 0; fi--) {
      const pts = snapshot.flux_surfaces[fi].points
      const above = hasXpoint ? pts.filter(([, Z]) => Z > xpZ + 0.02) : pts
      if (above.length >= 20) {
        edgeSurface = above
        break
      }
    }
    // Fallback: use separatrix points if no flux surface had enough points
    if (edgeSurface.length < 20) {
      const pts = snapshot.separatrix.points
      edgeSurface = hasXpoint ? pts.filter(([, Z]) => Z > xpZ + 0.02) : pts
    }

    // Sort by poloidal angle from centroid → proper closed-loop ordering.
    // Works because any flux surface above the X-point is star-shaped.
    let crSum = 0, czSum = 0
    for (const [R, Z] of edgeSurface) { crSum += R; czSum += Z }
    const cR = crSum / edgeSurface.length
    const cZ = czSum / edgeSurface.length
    const lcfsSorted = [...edgeSurface].sort((a, b) => {
      return Math.atan2(a[1] - cZ, a[0] - cR) - Math.atan2(b[1] - cZ, b[0] - cR)
    })
    const lcfsRaw = subsample(lcfsSorted, 35)
    // Densify: the 35-point subsample leaves large gaps (up to 0.2 m) at the
    // inboard midplane where the contour curvature is tight.  This causes a
    // 30+ pixel screen gap between consecutive points — the limb glow stroke
    // and emission shells can't bridge it, creating the dark toroidal band.
    // Densifying to ≤0.10 m between points adds ~4 interpolated points at the
    // inboard midplane, closing the gap.
    const lcfs = densifyContour(lcfsRaw, 0.10)

    // Extract below-X-point separatrix points for divertor leg rendering.
    // Use the FULL (un-subsampled) actual separatrix for smooth legs.
    const divertorLegPts: [number, number][] = hasXpoint
      ? snapshot.separatrix.points.filter(([, Z]) => Z <= xpZ + 0.01)
      : []

    // ── Plasma intensity factor ──
    // During ramp-up/ramp-down the equilibrium evolves rapidly and the LCFS
    // contour is noisy, producing flickering artifacts if rendered at full
    // intensity.  We use βN as a proxy for plasma establishment: the glow
    // fades in smoothly as βN rises and fades out as it drops.
    // βN < 0.15 → skip rendering entirely (too noisy to be useful)
    // βN 0.15–0.5 → ramp from 0 to 1
    // βN > 0.5 → full intensity
    const betaN = snapshot.beta_n ?? 0
    if (betaN < 0.15 && !disrupted) {
      // Plasma too faint — just show wall and a dim label
      if (wallCacheRef.current) {
        ctx.drawImage(wallCacheRef.current.nearCanvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
      }
      return
    }
    const plasmaIntensity = disrupted ? 1.0 : Math.min((betaN - 0.15) / 0.35, 1.0)

    // ── Step 1: Build projection grid ──
    const nSlicesPlasma = portCfg.nPlasmaSlices
    const phis: number[] = []
    for (let i = 0; i < nSlicesPlasma; i++) {
      phis.push(portCfg.plasmaPhiMin + (portCfg.plasmaPhiMax - portCfg.plasmaPhiMin) * (i / (nSlicesPlasma - 1)))
    }

    const grid: (ScreenPt | null)[][] = []
    const sliceDepths: number[] = []

    for (let s = 0; s < nSlicesPlasma; s++) {
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

    // ── Toroidal path-length factor ──
    // For optically thin emission from a toroidal shell, the brightness at
    // each screen pixel depends on the accumulated path through the shell
    // along the sight line.  Face-on slices (nearest to camera) → short
    // path → dim.  Tangential slices (toroidal limbs) → long path → bright.
    //
    // path ∝ |d| / |R₀ - R_cam·cos(φ)|  where d = camera-to-point distance.
    let rLcfsMin = Infinity, rLcfsMax = -Infinity
    for (const [R] of lcfs) {
      if (R < rLcfsMin) rLcfsMin = R
      if (R > rLcfsMax) rLcfsMax = R
    }
    const rGeo = (rLcfsMin + rLcfsMax) / 2

    const pathFactor: number[] = []
    let pathMin = Infinity
    for (let s = 0; s < nSlicesPlasma; s++) {
      const phi = phis[s]
      const dx = rGeo * Math.cos(phi) - portCfg.camR
      const dy = rGeo * Math.sin(phi)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const faceOn = Math.abs(rGeo - portCfg.camR * Math.cos(phi))
      const pf = faceOn > 0.01 ? dist / faceOn : 10.0
      pathFactor.push(pf)
      if (pf < pathMin) pathMin = pf
    }
    // Normalize: face-on slice = 1.0, tangential slices > 1.0
    for (let s = 0; s < nSlicesPlasma; s++) {
      pathFactor[s] /= pathMin
    }

    // ── Step 2: Draw filled surface to offscreen canvas ──
    const oCtx = offscreen.getContext('2d')
    if (!oCtx) return
    oCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    oCtx.clearRect(0, 0, W, H)

    // Surface color — slightly brighter cyan-blue
    const sr = disrupted ? 200 : 100
    const sg = disrupted ? 90 : 175
    const sb = disrupted ? 50 : 230

    // Per-machine opacity: look up scale factor from device ID
    const opacityScale = (deviceId && DEVICE_OPACITY_SCALE[deviceId]) ?? DEFAULT_OPACITY_SCALE
    const baseAlpha = (elmActive && !disrupted ? SURFACE_ELM_ALPHA : SURFACE_BASE_ALPHA) * opacityScale * plasmaIntensity

    // Sort slices by depth: back-to-front (painter's algorithm)
    const sliceOrder = Array.from({ length: nSlicesPlasma }, (_, i) => i)
    sliceOrder.sort((a, b) => sliceDepths[b] - sliceDepths[a])

    oCtx.globalCompositeOperation = 'source-over'

    // For each toroidal slice, scale emission shell contours in physical (R,Z)
    // space and project to screen for uniform shell thickness.
    for (const s of sliceOrder) {
      const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange // 0=far, 1=near
      // Mild depth cue only — no pathFactor here.
      // The limb glow (Step 2a) handles limb-brightening.  Applying pathFactor
      // to the emission shells created a dark band at the inboard midplane
      // because face-on slices (low pathFactor) are ~6× dimmer than tangential
      // slices, and the inboard midplane is viewed nearly face-on.
      const sliceAlpha = baseAlpha * (0.7 + depthFrac * 0.3)

      const slicePts = grid[s]
      const phi = phis[s]

      // Visibility check — skip if fewer than 3 LCFS points project on-screen
      let visCount = 0
      for (let j = 0; j < lcfs.length; j++) {
        if (slicePts[j]) visCount++
      }
      if (visCount < 3) continue

      // Draw concentric emission RINGS (annuli) peaked at the separatrix.
      // Each ring is the area between innerScale and outerScale contours,
      // rendered with evenodd fill so the interior stays transparent.
      //
      // Shell offsets are computed in physical (R,Z) space from the LCFS
      // centroid, then projected to screen.  This ensures uniform shell
      // thickness on both inboard and outboard sides — the old screen-space
      // scaling produced thin shells on the inboard midplane due to
      // perspective compression, creating a dark toroidal band artifact.
      for (const shell of EMISSION_SHELLS) {
        const shellAlpha = sliceAlpha * shell.weight
        if (shellAlpha < 0.0003) continue

        oCtx.beginPath()

        // Outer contour (clockwise) — scaled in physical (R,Z) space
        let started = false
        for (let j = 0; j < lcfs.length; j++) {
          const [R, Z] = lcfs[j]
          const Ro = cR + (R - cR) * shell.outerScale
          const Zo = cZ + (Z - cZ) * shell.outerScale
          const p2d = cam.project(toroidal(Ro, Zo, phi))
          if (!p2d) continue
          if (!started) { oCtx.moveTo(p2d.sx, p2d.sy); started = true }
          else oCtx.lineTo(p2d.sx, p2d.sy)
        }
        oCtx.closePath()

        // Inner contour (counter-clockwise — traced in reverse)
        started = false
        for (let j = lcfs.length - 1; j >= 0; j--) {
          const [R, Z] = lcfs[j]
          const Ri = cR + (R - cR) * shell.innerScale
          const Zi = cZ + (Z - cZ) * shell.innerScale
          const p2d = cam.project(toroidal(Ri, Zi, phi))
          if (!p2d) continue
          if (!started) { oCtx.moveTo(p2d.sx, p2d.sy); started = true }
          else oCtx.lineTo(p2d.sx, p2d.sy)
        }
        oCtx.closePath()

        oCtx.fillStyle = `rgba(${sr},${sg},${sb},${shellAlpha.toFixed(4)})`
        oCtx.fill('evenodd')
      }
    }

    // ── Step 2a: Limb-brightened separatrix glow ──
    // Draw the LCFS outline as per-sector strokes whose brightness depends on:
    //  1. Toroidal path factor (dominant) — tangential sight lines through the
    //     toroidal shell accumulate more emission than face-on views.
    //  2. Poloidal R-weighting (secondary) — within each slice, inboard
    //     segments (small R, tighter curvature) have slightly longer paths.
    {
      const limbAlpha = LIMB_BASE_ALPHA * opacityScale * plasmaIntensity
        * (elmActive && !disrupted ? 1.8 : 1.0)

      // Pre-compute sector boundaries and mild R-based poloidal weighting
      const sectorSize = Math.ceil(lcfs.length / LIMB_N_SECTORS)
      const sectorLimb: number[] = []
      for (let sec = 0; sec < LIMB_N_SECTORS; sec++) {
        const j0 = sec * sectorSize
        const j1 = Math.min((sec + 1) * sectorSize, lcfs.length)
        let rSum = 0, cnt = 0
        for (let j = j0; j < j1; j++) {
          rSum += lcfs[j][0]
          cnt++
        }
        const rAvg = cnt > 0 ? rSum / cnt : rGeo
        // Mild poloidal factor — sqrt of the full exponent for subtlety
        sectorLimb.push(Math.pow(rGeo / rAvg, LIMB_EXPONENT * 0.5))
      }

      for (const s of sliceOrder) {
        const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange
        // Toroidal path factor is the primary driver; mild depth cue secondary
        const sliceLimbAlpha = limbAlpha * (0.7 + depthFrac * 0.3) * pathFactor[s]

        const slicePts = grid[s]

        // Draw glow passes per sector (arc segments, each with its own alpha).
        // The LCFS contour is sorted by poloidal angle; the wrap-around
        // segment (last point → first point) falls at the inboard midplane.
        // We draw LIMB_N_SECTORS+1 segments: the +1 connects the last point
        // back to the first, closing the contour and preventing a dark gap.
        for (const pass of LIMB_GLOW_PASSES) {
          oCtx.lineWidth = pass.lineWidth
          oCtx.lineCap = 'round'
          oCtx.lineJoin = 'round'

          for (let sec = 0; sec <= LIMB_N_SECTORS; sec++) {
            // The extra segment (sec == LIMB_N_SECTORS) closes the contour:
            // it strokes from the last sector's end back to the first point.
            const isWrap = sec === LIMB_N_SECTORS
            const secIdx = isWrap ? LIMB_N_SECTORS - 1 : sec  // use last sector's alpha
            const segAlpha = sliceLimbAlpha * pass.alphaScale * sectorLimb[secIdx]
            if (segAlpha < 0.0003) continue

            if (isWrap) {
              // Wrap-around: stroke from last point to first point
              const pLast = slicePts[lcfs.length - 1]
              const pFirst = slicePts[0]
              if (!pLast || !pFirst) continue
              oCtx.beginPath()
              oCtx.moveTo(pLast.sx, pLast.sy)
              oCtx.lineTo(pFirst.sx, pFirst.sy)
            } else {
              const j0 = sec * sectorSize
              const j1 = Math.min((sec + 1) * sectorSize + 1, lcfs.length)

              oCtx.beginPath()
              let started = false
              for (let j = j0; j < j1; j++) {
                const p = slicePts[j]
                if (!p) continue
                if (!started) { oCtx.moveTo(p.sx, p.sy); started = true }
                else oCtx.lineTo(p.sx, p.sy)
              }
              if (!started) continue
            }
            oCtx.strokeStyle = `rgba(${sr},${sg},${sb},${segAlpha.toFixed(4)})`
            oCtx.stroke()
          }
        }
      }
    }

    // ── Step 2b: Draw divertor legs from actual separatrix geometry ──
    // Use the real separatrix points below the X-point (extracted above),
    // split into inner leg (R < x-point R) and outer leg (R > x-point R).
    // Rendered as diffuse stroked centerlines (multiple glow passes) rather
    // than flat-filled ribbons, so they blend smoothly across toroidal slices.
    let strikePointRZ: [number, number][] = []
    const showLegs = legFade > 0.01 && divertorLegPts.length >= 3
    if (showLegs) {
      // Split below-X-point points into inner and outer legs
      const innerLeg: [number, number][] = []
      const outerLeg: [number, number][] = []
      for (const pt of divertorLegPts) {
        if (pt[0] < xpR - 0.01) innerLeg.push(pt)
        else if (pt[0] > xpR + 0.01) outerLeg.push(pt)
        // Points very near xpR are near the x-point itself — skip
      }
      // Sort each leg by Z descending (x-point at top, strike point at bottom)
      innerLeg.sort((a, b) => b[1] - a[1])
      outerLeg.sort((a, b) => b[1] - a[1])

      // Prepend the x-point itself so legs connect smoothly to the main LCFS
      const xPt: [number, number] = [xpR, xpZ]
      if (innerLeg.length > 0) innerLeg.unshift(xPt)
      if (outerLeg.length > 0) outerLeg.unshift(xPt)

      // Leg color: slightly brighter/whiter than bulk plasma
      const lr = disrupted ? 220 : 140
      const lg = disrupted ? 110 : 210
      const lb = disrupted ? 70 : 255
      const legAlphaBase = baseAlpha * 4.0 * legFade

      // Diffuse glow passes — wide soft outer + narrow bright core
      const legPasses = [
        { lineWidth: 8.0, alphaScale: 0.15 },  // soft outer halo
        { lineWidth: 4.0, alphaScale: 0.30 },  // mid glow
        { lineWidth: 1.5, alphaScale: 0.55 },  // bright core
      ]

      for (const s of sliceOrder) {
        const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange
        const legAlpha = legAlphaBase * (0.5 + depthFrac * 0.5) * pathFactor[s]
        if (legAlpha < 0.0002) continue
        const phi = phis[s]

        for (const leg of [innerLeg, outerLeg]) {
          if (leg.length < 2) continue

          for (const pass of legPasses) {
            const passAlpha = legAlpha * pass.alphaScale
            if (passAlpha < 0.0002) continue

            oCtx.beginPath()
            oCtx.lineWidth = pass.lineWidth
            oCtx.lineCap = 'round'
            oCtx.lineJoin = 'round'
            let started = false
            for (const [R, Z] of leg) {
              const p3d = toroidal(R, Z, phi)
              const p2d = cam.project(p3d)
              if (!p2d) continue
              if (!started) { oCtx.moveTo(p2d.sx, p2d.sy); started = true }
              else oCtx.lineTo(p2d.sx, p2d.sy)
            }
            if (!started) continue
            oCtx.strokeStyle = `rgba(${lr},${lg},${lb},${passAlpha.toFixed(4)})`
            oCtx.stroke()
          }
        }
      }

      // Save strike point positions for main-canvas glow rendering
      // Strike points are the lowest Z in each leg
      if (innerLeg.length > 0) strikePointRZ.push(innerLeg[innerLeg.length - 1])
      if (outerLeg.length > 0) strikePointRZ.push(outerLeg[outerLeg.length - 1])
    }

    // ── Step 3: Composite blurred surface onto main canvas ──
    // With many overlapping polygons, the surface is already quite smooth.
    // A moderate blur gives a soft glow; the sharp pass adds plasma definition.
    ctx.save()
    ctx.filter = `blur(${SURFACE_BLUR_PX}px)`
    ctx.globalAlpha = 0.7
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
    ctx.restore()

    // Second, sharper pass for plasma edge definition
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
    ctx.restore()

    // ── Step 3a: Draw NEAR wall on top of plasma ──
    // Only the outboard wall (between camera and plasma) occludes.
    // The far/inboard wall was already drawn before the plasma.
    if (wallCacheRef.current) {
      ctx.drawImage(wallCacheRef.current.nearCanvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
    }

    // ── Step 3b: Wall illumination from strike points ──
    // When strike points are active, nearby wall tiles glow with warm orange
    // light — visible mostly on the divertor region.
    const wantStrikeGlow = snapshot.in_hmode && !disrupted
    // dt and prevTimeRef already updated above (before early returns)
    const fadeStep = STRIKE_FADE_RATE > 0 ? Math.min(dt / STRIKE_FADE_RATE, 1) : 1
    if (wantStrikeGlow) {
      strikeGlowRef.current = Math.min(strikeGlowRef.current + fadeStep, 1)
    } else {
      strikeGlowRef.current = Math.max(strikeGlowRef.current - fadeStep, 0)
    }
    const strikeFade = strikeGlowRef.current

    // Wall illumination: localized warm glow on divertor tiles near strike points.
    // Small radius — should not extend much beyond the divertor leg width.
    // Brighter than before, but tightly confined to the plate region.
    if (strikePointRZ.length > 0 && strikeFade > 0.001) {
      const powerScale = (deviceId && DEVICE_POWER_SCALE[deviceId]) ?? DEFAULT_POWER_SCALE
      const illumAlpha = 0.10 * powerScale * strikeFade  // brighter than before (was 0.06)

      if (illumAlpha > 0.001) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const [spR, spZ] of strikePointRZ) {
          for (const s of sliceOrder) {
            const phi = phis[s]
            const p3d = toroidal(spR, spZ, phi)
            const p2d = cam.project(p3d)
            if (!p2d) continue

            const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange
            const gAlpha = illumAlpha * (0.4 + depthFrac * 0.6)
            if (gAlpha < 0.001) continue

            // Tight glow radius — comparable to divertor leg width on screen
            const glowR = 5 + depthFrac * 7  // was 10+14 — now half the size
            const grad = ctx.createRadialGradient(p2d.sx, p2d.sy, 0, p2d.sx, p2d.sy, glowR)
            grad.addColorStop(0, `rgba(255,190,120,${(gAlpha * 1.0).toFixed(4)})`)
            grad.addColorStop(0.4, `rgba(220,120,50,${(gAlpha * 0.4).toFixed(4)})`)
            grad.addColorStop(1, 'rgba(140,60,20,0)')
            ctx.fillStyle = grad
            ctx.fillRect(p2d.sx - glowR, p2d.sy - glowR, glowR * 2, glowR * 2)
          }
        }
        ctx.restore()
      }
    }

    // ── Step 4: Strike point glow on divertor plates ──
    // Localized, bright glow at the strike-point locations.  Should be
    // comparable in width to the divertor legs — no wider.
    if (strikePointRZ.length > 0 && strikeFade > 0.001) {
      const powerScale = (deviceId && DEVICE_POWER_SCALE[deviceId]) ?? DEFAULT_POWER_SCALE
      const strikeAlpha = 0.20 * powerScale * opacityScale * strikeFade  // brighter (was 0.12)

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const [spR, spZ] of strikePointRZ) {
        for (const s of sliceOrder) {
          const phi = phis[s]
          const p3d = toroidal(spR, spZ, phi)
          const p2d = cam.project(p3d)
          if (!p2d) continue

          const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange
          const gAlpha = strikeAlpha * (0.5 + depthFrac * 0.5)
          if (gAlpha < 0.001) continue

          // Tight glow — matches divertor leg width on screen
          const glowR = 6 + depthFrac * 8  // was 12+18 — now half the size
          const grad = ctx.createRadialGradient(
            p2d.sx, p2d.sy, 0,
            p2d.sx, p2d.sy, glowR,
          )
          grad.addColorStop(0, `rgba(255,220,170,${(gAlpha * 2.0).toFixed(4)})`)
          grad.addColorStop(0.3, `rgba(255,160,90,${(gAlpha * 1.2).toFixed(4)})`)
          grad.addColorStop(0.6, `rgba(230,100,40,${(gAlpha * 0.4).toFixed(4)})`)
          grad.addColorStop(1, 'rgba(160,50,15,0)')
          ctx.fillStyle = grad
          ctx.fillRect(p2d.sx - glowR, p2d.sy - glowR, glowR * 2, glowR * 2)
        }
      }
      ctx.restore()
    }

    // ── Step 5: ELM flash overlay ──
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
  }, [snapshot, limiterPoints, deviceId, resolvedWall, wallJson, deviceR0, deviceA])

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

// drawXpointGlow removed — divertor legs now use smooth toroidal ribbon rendering

/**
 * Draw the limiter wall as a smooth toroidally-swept surface viewed from
 * inside a diagnostic port.  Uses tile colors from PortConfig with a visible
 * tile grid pattern.  Backface culling hides exterior-facing quads.
 *
 * depthFilter controls which quads are drawn:
 *   'all'  — draw everything (used when no plasma)
 *   'far'  — only quads farther than the magnetic axis (behind plasma)
 *   'near' — only quads closer than the magnetic axis (in front of plasma)
 */
function drawLimiterWall(
  ctx: CanvasRenderingContext2D,
  cam: ReturnType<typeof buildCamera>,
  limiter: [number, number][],
  _W: number,
  _H: number,
  cfg: PortConfig,
  depthFilter: 'all' | 'near' | 'far' = 'all',
) {
  // Densify contour — interpolate large gaps (inboard wall segments)
  const pts = densifyContour(limiter, 0.08)
  const nPts = pts.length
  if (nPts < 3) return

  const nSlices = cfg.nWallSlices
  const phis: number[] = []
  for (let i = 0; i < nSlices; i++) {
    phis.push(cfg.phiMin + (cfg.phiMax - cfg.phiMin) * (i / (nSlices - 1)))
  }

  // Compute approximate axis R from limiter geometry for backface culling
  let rMin = Infinity, rMax = -Infinity
  for (const [R] of pts) {
    if (R < rMin) rMin = R
    if (R > rMax) rMax = R
  }
  const axisR = (rMin + rMax) * 0.5

  // Compute depth threshold at magnetic axis for near/far splitting.
  // Quads closer than this are "near" (outboard wall, between camera and plasma).
  // Quads farther than this are "far" (inboard wall, behind plasma).
  let axisDepth = Infinity
  if (depthFilter !== 'all') {
    const axisPt3d = toroidal(axisR, 0, cfg.portPhi)
    const axisProj = cam.project(axisPt3d)
    axisDepth = axisProj ? axisProj.depth : Infinity
  }

  // Tile grid: compute cumulative poloidal arc length for grid pattern
  const poloidalArc: number[] = [0]
  for (let j = 1; j < nPts; j++) {
    const dR = pts[j][0] - pts[j - 1][0]
    const dZ = pts[j][1] - pts[j - 1][1]
    poloidalArc.push(poloidalArc[j - 1] + Math.sqrt(dR * dR + dZ * dZ))
  }

  const [tr, tg, tb] = cfg.tileColor

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

  // Build screen projection grid
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
  interface WallQuad {
    corners: (ScreenPt | null)[]
    depth: number
    isGridEdge: boolean  // tile boundary
  }
  const quads: WallQuad[] = []

  for (let s = 0; s < nSlices - 1; s++) {
    const phiMid = (phis[s] + phis[s + 1]) * 0.5
    const axisPt = toroidal(axisR, 0, phiMid)

    // Toroidal grid: check if this phi boundary crosses a tile edge
    const toroidalArc0 = phis[s] * axisR  // approximate arc length
    const toroidalArc1 = phis[s + 1] * axisR
    const tGrid = cfg.tileGridSpacing.toroidal
    const crossesToroidalGrid = tGrid > 0 &&
      Math.floor(toroidalArc0 / tGrid) !== Math.floor(toroidalArc1 / tGrid)

    for (let j = 0; j < nPts; j++) {
      const jn = (j + 1) % nPts

      const a = grid3D[s][j]
      const b = grid3D[s][jn]
      const c = grid3D[s + 1][jn]
      const d = grid3D[s + 1][j]

      const qcx = (a.x + b.x + c.x + d.x) * 0.25
      const qcy = (a.y + b.y + c.y + d.y) * 0.25
      const qcz = (a.z + b.z + c.z + d.z) * 0.25

      // Backface culling
      const inward: Vec3 = {
        x: axisPt.x - qcx,
        y: axisPt.y - qcy,
        z: -qcz,
      }
      const viewDir: Vec3 = {
        x: cam.pos.x - qcx,
        y: cam.pos.y - qcy,
        z: cam.pos.z - qcz,
      }
      if (dot(inward, viewDir) <= 0) continue

      // Port hole punching — skip quads inside port opening
      // Compute quad center in cylindrical coords
      const qR = Math.sqrt(qcx * qcx + qcy * qcy)
      const qPhi = Math.atan2(qcy, qcx)
      const dPhi = Math.abs(qPhi - cfg.portPhi)
      const angularRadius = cfg.portRadius / cfg.portR
      if (dPhi < angularRadius * 1.2) {
        const dr = qR - cfg.portR
        const dz = qcz - cfg.portZ
        if (dr * dr + dz * dz < cfg.portRadius * cfg.portRadius * 1.1) continue
      }

      const sa = gridScr[s][j]
      const sb = gridScr[s][jn]
      const sc = gridScr[s + 1][jn]
      const sd = gridScr[s + 1][j]

      let visCount = 0
      let depthSum = 0
      for (const p of [sa, sb, sc, sd]) {
        if (p) { visCount++; depthSum += p.depth }
      }
      if (visCount < 3) continue

      const avgDepth = depthSum / visCount

      // Depth filter: skip quads on the wrong side of the magnetic axis
      if (depthFilter === 'near' && avgDepth > axisDepth) continue
      if (depthFilter === 'far'  && avgDepth <= axisDepth) continue

      // Poloidal grid: check if this segment crosses a tile boundary
      const pGrid = cfg.tileGridSpacing.poloidal
      const crossesPoloidalGrid = pGrid > 0 &&
        Math.floor(poloidalArc[j] / pGrid) !== Math.floor(poloidalArc[jn < nPts ? jn : 0] / pGrid)

      quads.push({
        corners: [sa, sb, sc, sd],
        depth: avgDepth,
        isGridEdge: crossesToroidalGrid || crossesPoloidalGrid,
      })
    }
  }

  if (quads.length === 0) return

  // Sort back-to-front
  quads.sort((a, b) => b.depth - a.depth)

  // Depth range for shading
  let minD = Infinity, maxD = -Infinity
  for (const q of quads) {
    if (q.depth < minD) minD = q.depth
    if (q.depth > maxD) maxD = q.depth
  }
  const dRange = maxD - minD + 0.01

  // Draw all quads
  ctx.save()
  for (const q of quads) {
    const df = 1 - (q.depth - minD) / dRange // 0=far, 1=near
    // Tile color: device-specific base modulated by depth and grid pattern
    const depthMod = 0.45 + df * 0.55
    const gridDim = q.isGridEdge ? (1 - cfg.tileGridDarken) : 1.0
    const r = Math.round(tr * depthMod * gridDim)
    const g = Math.round(tg * depthMod * gridDim)
    const b = Math.round(tb * depthMod * gridDim)
    const alpha = 0.80 + df * 0.18

    ctx.beginPath()
    let started = false
    for (const p of q.corners) {
      if (!p) continue
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true }
      else ctx.lineTo(p.sx, p.sy)
    }
    ctx.closePath()
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Draw the cylindrical diagnostic port tube from the vessel wall to the camera.
 * Camera sits inside the tube — only inward-facing quads are visible.
 */
function drawPortCylinder(
  ctx: CanvasRenderingContext2D,
  cam: ReturnType<typeof buildCamera>,
  cfg: PortConfig,
) {
  const nRings = 8
  const nSegs = 24
  const [tr, tg, tb] = cfg.tileColor

  for (let ri = 0; ri < nRings - 1; ri++) {
    const t0 = ri / (nRings - 1)
    const t1 = (ri + 1) / (nRings - 1)
    const r0 = cfg.portR + t0 * cfg.portLength
    const r1 = cfg.portR + t1 * cfg.portLength

    for (let si = 0; si < nSegs; si++) {
      const a0 = (si / nSegs) * Math.PI * 2
      const a1 = ((si + 1) / nSegs) * Math.PI * 2

      // Port cylinder coords: local (y,z) circle at each R, centred at (portPhi, portZ)
      const dy0 = cfg.portRadius * Math.cos(a0)
      const dz0 = cfg.portRadius * Math.sin(a0)
      const dy1 = cfg.portRadius * Math.cos(a1)
      const dz1 = cfg.portRadius * Math.sin(a1)

      // Convert to tokamak coords: phi offset = dy/R, Z offset = dz
      const corners3D: Vec3[] = [
        toroidal(r0, cfg.portZ + dz0, cfg.portPhi + dy0 / r0),
        toroidal(r0, cfg.portZ + dz1, cfg.portPhi + dy1 / r0),
        toroidal(r1, cfg.portZ + dz1, cfg.portPhi + dy1 / r1),
        toroidal(r1, cfg.portZ + dz0, cfg.portPhi + dy0 / r1),
      ]

      // Backface cull: only draw interior-facing quads
      const qcx = (corners3D[0].x + corners3D[2].x) * 0.5
      const qcy = (corners3D[0].y + corners3D[2].y) * 0.5
      const qcz = (corners3D[0].z + corners3D[2].z) * 0.5

      // Inward normal for cylinder: toward the axis of the cylinder
      const cylAxisX = cfg.portR * Math.cos(cfg.portPhi) + cfg.portLength * 0.5 * Math.cos(cfg.portPhi)
      const cylAxisY = cfg.portR * Math.sin(cfg.portPhi) + cfg.portLength * 0.5 * Math.sin(cfg.portPhi)
      const inward: Vec3 = {
        x: cylAxisX - qcx,
        y: cylAxisY - qcy,
        z: cfg.portZ - qcz,
      }
      const viewDir: Vec3 = {
        x: cam.pos.x - qcx,
        y: cam.pos.y - qcy,
        z: cam.pos.z - qcz,
      }
      if (dot(inward, viewDir) <= 0) continue

      // Project corners
      const scrPts: (ScreenPt | null)[] = corners3D.map(p => {
        const p2d = cam.project(p)
        return p2d ? { sx: p2d.sx, sy: p2d.sy, depth: p2d.depth } : null
      })

      let vis = 0
      for (const p of scrPts) if (p) vis++
      if (vis < 3) continue

      // Port cylinder: slightly darker than wall tiles (shadow zone)
      const depthFrac = t0  // 0 at vessel wall, 1 at camera
      const shade = 0.35 + depthFrac * 0.45
      const r = Math.round(tr * shade)
      const g = Math.round(tg * shade)
      const b = Math.round(tb * shade)

      ctx.beginPath()
      let started = false
      for (const p of scrPts) {
        if (!p) continue
        if (!started) { ctx.moveTo(p.sx, p.sy); started = true }
        else ctx.lineTo(p.sx, p.sy)
      }
      ctx.closePath()
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fill()
    }
  }
}
