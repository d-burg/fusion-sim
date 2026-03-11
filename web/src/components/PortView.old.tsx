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
  tileGridSpacing: { poloidal: number; toroidal: number }  // default/outboard spacing
  tileGridDarken: number  // brightness reduction on grid lines (0–1)
  phiMin: number        // wall toroidal sweep range (full 360°)
  phiMax: number
  plasmaPhiMin: number  // plasma toroidal sweep (narrower — only visible range)
  plasmaPhiMax: number
  nWallSlices: number
  nPlasmaSlices: number
  // Per-region tile sizing
  tileRegions?: {
    inboardGridSpacing: { poloidal: number; toroidal: number }   // center stack — small square tiles
    limiterGridSpacing: { poloidal: number; toroidal: number }   // top/bottom — wider rectangular tiles
    limiterZThreshold: number                                     // |Z| above this = limiter region
  }
  // Extra diagnostic ports on outboard wall (dark circular openings)
  extraPorts?: { r: number; z: number; phi: number; radius: number }[]
  // Antenna structures on outboard wall (louvered Faraday screens)
  antennae?: { r: number; zMin: number; zMax: number; phiMin: number; phiMax: number }[]
  // Fresnel edge brightening strength (0.25 = default subtle, 0.65 = strong metallic sheen)
  fresnelStrength?: number
  // JET-style alternating vertical bands on inboard wall
  inboardStyle?: 'tiles' | 'bands'
  bandWidth?: number  // toroidal width of each band (m) — default 0.08
  // Divertor region: darker tiles in lower vessel
  divertorRegion?: {
    zThreshold: number                    // Z below this (negative) = divertor
    tileColor: [number, number, number]   // darker tile color
    gridSpacing: { poloidal: number; toroidal: number }
  }
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
    nPlasmaSlices: 140,
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
    tileColor: [58, 58, 62],       // metallic silver-gray (shiny graphite tiles)
    tileGridSpacing: { poloidal: 0.10, toroidal: 0.10 },    // square tiles
    tileGridDarken: 0.30,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 140,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.10, toroidal: 0.10 },  // ~4"×4" center stack tiles
      limiterGridSpacing: { poloidal: 0.10, toroidal: 0.20 },  // ~4"×8" wider limiter tiles
      limiterZThreshold: 0.80,
    },
    extraPorts: [
      { r: 2.35, z: 0.42, phi: 0.18, radius: 0.09 },    // upper diagnostic port
      { r: 2.35, z: -0.48, phi: -0.12, radius: 0.08 },   // lower diagnostic port
      { r: 2.35, z: 0.12, phi: -0.32, radius: 0.07 },    // near-midplane port
      { r: 2.35, z: -0.15, phi: 0.42, radius: 0.06 },    // small port
    ],
    antennae: [
      { r: 2.35, zMin: -0.28, zMax: 0.28, phiMin: 0.55, phiMax: 0.72 },   // ICRH antenna
      { r: 2.35, zMin: -0.12, zMax: 0.12, phiMin: -0.60, phiMax: -0.48 },  // ECH launcher
    ],
    fresnelStrength: 0.55,
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
    tileGridDarken: 0.15,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 140,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.18, toroidal: 0.18 },  // larger tiles for bigger machine
      limiterGridSpacing: { poloidal: 0.15, toroidal: 0.30 },
      limiterZThreshold: 2.5,
    },
    extraPorts: [
      { r: 8.30, z: 1.2, phi: 0.12, radius: 0.22 },
      { r: 8.30, z: -1.4, phi: -0.08, radius: 0.20 },
      { r: 8.30, z: 0.3, phi: -0.25, radius: 0.18 },
    ],
    antennae: [
      { r: 8.30, zMin: -0.8, zMax: 0.8, phiMin: 0.35, phiMax: 0.55 },
    ],
    fresnelStrength: 0.20,
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
    tileGridDarken: 0.16,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 140,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.08, toroidal: 0.08 },
      limiterGridSpacing: { poloidal: 0.08, toroidal: 0.14 },
      limiterZThreshold: 0.55,
    },
    extraPorts: [
      { r: 2.10, z: 0.30, phi: 0.15, radius: 0.06 },
      { r: 2.10, z: -0.25, phi: -0.20, radius: 0.05 },
    ],
    fresnelStrength: 0.18,
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
    tileGridDarken: 0.15,
    phiMin: -Math.PI,
    phiMax: Math.PI,
    plasmaPhiMin: -1.40,
    plasmaPhiMax: 1.40,
    nWallSlices: 100,
    nPlasmaSlices: 140,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.12, toroidal: 0.12 },
      limiterGridSpacing: { poloidal: 0.12, toroidal: 0.22 },
      limiterZThreshold: 1.2,
    },
    extraPorts: [
      { r: 3.80, z: 0.55, phi: 0.14, radius: 0.12 },
      { r: 3.80, z: -0.60, phi: -0.10, radius: 0.11 },
      { r: 3.80, z: 0.15, phi: -0.28, radius: 0.09 },
    ],
    antennae: [
      { r: 3.80, zMin: -0.40, zMax: 0.40, phiMin: 0.40, phiMax: 0.58 },
    ],
    fresnelStrength: 0.25,
    inboardStyle: 'bands',
    bandWidth: 0.06,
    divertorRegion: {
      zThreshold: -1.0,
      tileColor: [18, 16, 14],
      gridSpacing: { poloidal: 0.08, toroidal: 0.08 },
    },
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
  iter:    0.04,   // basically invisible bulk — strike points dominate
  sparc:   0.55,   // compact but high-field / high-Te
  jet:     0.06,   // basically invisible bulk — strike points dominate
}
const DEFAULT_OPACITY_SCALE = 0.65

// Per-machine power scaling for strike point glow intensity.
// Higher-power devices produce brighter divertor strike-point emission.
const DEVICE_POWER_SCALE: Record<string, number> = {
  diiid:   0.18,  // ~5–15 MW NBI — very subtle hint
  iter:    1.8,   // ~50 MW — very bright deep red strike rings
  sparc:   0.8,   // ~25 MW in compact device
  jet:     1.3,   // ~25 MW — bright red, slightly less than ITER
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
const SURFACE_BASE_ALPHA = 0.003  // reduced from 0.005 to compensate for 140 slices (was 80)
const SURFACE_ELM_ALPHA  = 0.006  // reduced from 0.010, same ratio
const SURFACE_BLUR_PX = 3.5       // increased from 2.5 to soften shell edges

// Radial emission shells: each shell is a thin ANNULAR RING between an
// inner and outer scale factor from the centroid.  Using rings (not filled
// discs) keeps the core visually empty — only the edge radiates.
// Shells overlap slightly at boundaries for smooth blending.
const EMISSION_SHELLS: { innerScale: number; outerScale: number; weight: number }[] = [
  { innerScale: 0.82, outerScale: 0.90, weight: 0.03 },   // deep pedestal — faintest hint
  { innerScale: 0.90, outerScale: 0.96, weight: 0.20 },   // pedestal shoulder (overlaps peak)
  { innerScale: 0.95, outerScale: 1.01, weight: 1.00 },   // separatrix peak (widened for diffuse look)
  { innerScale: 1.005, outerScale: 1.025, weight: 0.35 },  // near SOL (widened)
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
  { lineWidth: 9.0, alphaScale: 0.08 },  // widest, faintest halo
  { lineWidth: 6.0, alphaScale: 0.15 },  // mid-outer
  { lineWidth: 3.5, alphaScale: 0.30 },  // mid-inner
  { lineWidth: 1.5, alphaScale: 0.55 },  // bright core
]
const LIMB_EXPONENT = 1.4   // controls inboard/outboard contrast
const LIMB_BASE_ALPHA = 0.012  // reduced from 0.018 to compensate for 140 slices

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

/**
 * Truncate a polyline at its first intersection with a closed wall polygon.
 * Returns a new array containing points up to (and including) the intersection.
 * If no intersection is found, returns the original path.
 */
function truncateAtWall(
  path: [number, number][],
  wall: [number, number][],
): [number, number][] {
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i]
    const [bx, by] = path[i + 1]
    const dx = bx - ax, dy = by - ay

    let bestT = Infinity
    let bestPt: [number, number] | null = null
    for (let j = 0; j < wall.length; j++) {
      const nj = (j + 1) % wall.length
      const [cx, cy] = wall[j]
      const [ex, ey] = wall[nj]
      const fx = ex - cx, fy = ey - cy
      const denom = dx * fy - dy * fx
      if (Math.abs(denom) < 1e-12) continue
      const t = ((cx - ax) * fy - (cy - ay) * fx) / denom
      const u = ((cx - ax) * dy - (cy - ay) * dx) / denom
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) {
        bestT = t
        bestPt = [ax + t * dx, ay + t * dy]
      }
    }

    if (bestPt) {
      // Return path up to this segment, plus the intersection point
      const truncated = path.slice(0, i + 1)
      truncated.push(bestPt)
      return truncated
    }
  }
  return path
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
    csClipPath: Path2D | null      // center stack silhouette clip (evenodd: renders OUTSIDE silhouette)
    csTangentPhi: number           // toroidal angle where glow transitions from in-front to behind CS
    w: number; h: number; key: string
  } | null>(null)
  const strikeGlowRef = useRef(0)       // current fade level 0–1
  const legFadeRef = useRef(0)          // divertor leg fade level 0–1
  const prevTimeRef = useRef<number>(0)  // previous snapshot time for dt calc
  const maxProgIpRef = useRef(0)        // peak |prog_ip| seen this discharge
  const lastDrawTimeRef = useRef(0)     // throttle port view to ~20fps

  // Resolve wall points: prefer limiterPoints, fall back to parsed wallJson
  const resolvedWall = limiterPoints ?? (() => {
    if (!wallJson) return undefined
    try { return JSON.parse(wallJson) as [number, number][] } catch { return undefined }
  })()

  const draw = useCallback(() => {
    // Throttle port view to ~20fps — plasma changes slowly, no need for 60fps
    const now = performance.now()
    if (now - lastDrawTimeRef.current < 50) return
    lastDrawTimeRef.current = now

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

        // ── Center stack silhouette for glow occlusion ──────────────────
        // Compute the tangent-based silhouette of the inboard wall.
        // For each inboard wall point at (R_w, Z_w), the tangent angle from the
        // camera at camR is φ_t = arccos(R_w / camR). Projecting the tangent
        // points to screen space gives left/right silhouette edges. This polygon,
        // used with evenodd fill rule (outer rect + inner silhouette), clips glow
        // to ONLY the region outside the center stack — robust to any limiter
        // geometry including complex divertor channels, because it uses the actual
        // contour R at each Z height.
        let csClipPath: Path2D | null = null
        const camR_cs = portCfg.camR

        // Find the center stack column: the narrow vertical section at the
        // minimum R of the limiter contour.  Use a tight threshold so we only
        // capture the actual center stack, NOT the upper/lower shelves or
        // divertor region (which have larger R and would produce overly wide
        // tangent angles, creating geometric clip artifacts).
        const nWallPts = resolvedWall.length
        let minR = Infinity
        for (let i = 0; i < nWallPts; i++) {
          if (resolvedWall[i][0] < minR) minR = resolvedWall[i][0]
        }
        // Tight threshold: center stack R + 15% of the gap to the axis center.
        // For DIII-D (minR≈1.017): threshold ≈ 1.017 * 1.15 ≈ 1.17
        // This captures only the narrow CS column, not shelves at R≈1.3-1.7.
        const ibThreshold = minR * 1.15

        // Extract the contiguous center stack section of the limiter contour.
        let ibStartIdx = -1
        for (let i = 0; i < nWallPts; i++) {
          const iPrev = (i - 1 + nWallPts) % nWallPts
          if (resolvedWall[iPrev][0] >= ibThreshold && resolvedWall[i][0] < ibThreshold) {
            ibStartIdx = i
            break
          }
        }

        const csProfile: [number, number][] = []
        if (ibStartIdx >= 0) {
          for (let i = 0; i < nWallPts; i++) {
            const idx = (ibStartIdx + i) % nWallPts
            if (resolvedWall[idx][0] < ibThreshold) {
              csProfile.push(resolvedWall[idx])
            } else {
              break
            }
          }
        }

        if (csProfile.length >= 2) {
          // Ensure top-to-bottom order (descending Z)
          if (csProfile[0][1] < csProfile[csProfile.length - 1][1]) {
            csProfile.reverse()
          }

          const leftEdge: { sx: number; sy: number }[] = []
          const rightEdge: { sx: number; sy: number }[] = []

          for (const [Rw, Zw] of csProfile) {
            const ratio = Math.min(Rw / camR_cs, 0.9999)
            const cosPhiT = ratio
            const sinPhiT = Math.sqrt(1 - ratio * ratio)

            // Left tangent point (positive toroidal angle)
            const lp = cam.project({ x: Rw * cosPhiT, y: Rw * sinPhiT, z: Zw })
            if (lp) leftEdge.push({ sx: lp.sx, sy: lp.sy })

            // Right tangent point (negative toroidal angle)
            const rp = cam.project({ x: Rw * cosPhiT, y: -Rw * sinPhiT, z: Zw })
            if (rp) rightEdge.push({ sx: rp.sx, sy: rp.sy })
          }

          if (leftEdge.length >= 2 && rightEdge.length >= 2) {
            csClipPath = new Path2D()
            // Outer boundary: full canvas (all pixels initially included)
            csClipPath.rect(0, 0, W, H)
            // Inner boundary: center stack silhouette (excluded by evenodd rule).
            // Extend top and bottom beyond canvas edges so the cap connections
            // never clip visible glow — only the curved left/right silhouette
            // edges are within the viewport.
            const topExtY = -200   // well above canvas
            const botExtY = H + 200  // well below canvas
            csClipPath.moveTo(leftEdge[0].sx, topExtY)
            csClipPath.lineTo(leftEdge[0].sx, leftEdge[0].sy)
            for (let i = 1; i < leftEdge.length; i++) {
              csClipPath.lineTo(leftEdge[i].sx, leftEdge[i].sy)
            }
            // Extend left bottom beyond canvas, connect to right bottom extension
            csClipPath.lineTo(leftEdge[leftEdge.length - 1].sx, botExtY)
            csClipPath.lineTo(rightEdge[rightEdge.length - 1].sx, botExtY)
            csClipPath.lineTo(rightEdge[rightEdge.length - 1].sx, rightEdge[rightEdge.length - 1].sy)
            // Right edge bottom-to-top
            for (let i = rightEdge.length - 2; i >= 0; i--) {
              csClipPath.lineTo(rightEdge[i].sx, rightEdge[i].sy)
            }
            // Extend right top beyond canvas, connect back to left top extension
            csClipPath.lineTo(rightEdge[0].sx, topExtY)
            csClipPath.closePath()
          }
        }

        // Compute the tangent angle where glow transitions from in-front to behind
        // the center stack.  φ_t = arccos(minR / camR).  Slices with |φ| < φ_t
        // pass in front of the CS (visible); |φ| >= φ_t pass behind (occluded).
        const csTangentPhi = csClipPath
          ? Math.acos(Math.min(minR / camR_cs, 0.9999))
          : Math.PI  // no clip → everything is "in front" (never clipped)

        wallCacheRef.current = { farCanvas, nearCanvas, csClipPath, csTangentPhi, w: canvas.width, h: canvas.height, key: wallKey }
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
    const hasLowerXpoint = xpR > 0 && xpZ < -0.01
    const hasUpperXpoint = (snapshot.xpoint_upper_r ?? 0) > 0 && (snapshot.xpoint_upper_z ?? 0) > 0.01
    const hasXpoint = hasLowerXpoint || hasUpperXpoint
    const xpUpperR = snapshot.xpoint_upper_r ?? 0
    const xpUpperZ = snapshot.xpoint_upper_z ?? 0

    // ── Time delta for fade effects ──
    // Computed early so fades update even during early returns (betaN < 0.15).
    const dt = Math.abs(snapshot.time - prevTimeRef.current)
    // Detect new discharge (time jumped backward) — reset tracking state
    if (snapshot.time < prevTimeRef.current - 0.5) {
      maxProgIpRef.current = 0
      legFadeRef.current = 0
      lastDrawTimeRef.current = 0  // force first frame of new discharge to draw
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
    // Filter out divertor regions — bulk plasma only
    const inBulkPlasma = ([, Z]: [number, number]): boolean => {
      if (hasLowerXpoint && Z < xpZ + 0.02) return false
      if (hasUpperXpoint && Z > xpUpperZ - 0.02) return false
      return true
    }

    const nFlux = snapshot.flux_surfaces.length
    let edgeSurface: [number, number][] = []
    for (let fi = nFlux - 1; fi >= 0; fi--) {
      const pts = snapshot.flux_surfaces[fi].points
      const above = hasXpoint ? pts.filter(inBulkPlasma) : pts
      if (above.length >= 20) {
        edgeSurface = above
        break
      }
    }
    // Fallback: use separatrix points if no flux surface had enough points
    if (edgeSurface.length < 20) {
      const pts = snapshot.separatrix.points
      edgeSurface = hasXpoint ? pts.filter(inBulkPlasma) : pts
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

    // Extract divertor separatrix points for leg rendering.
    // Use the FULL (un-subsampled) actual separatrix for smooth legs.
    const lowerDivPts: [number, number][] = hasLowerXpoint
      ? snapshot.separatrix.points.filter(([, Z]) => Z <= xpZ + 0.01)
      : []
    const upperDivPts: [number, number][] = hasUpperXpoint
      ? snapshot.separatrix.points.filter(([, Z]) => Z >= xpUpperZ - 0.01)
      : []
    const divertorLegPts: [number, number][] = [...lowerDivPts, ...upperDivPts]

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

    // Pre-compute trig per slice — eliminates ~190k redundant Math.cos/sin
    // calls that were previously computed inside toroidal() for every point.
    const cosPhis = new Float64Array(nSlicesPlasma)
    const sinPhis = new Float64Array(nSlicesPlasma)
    for (let s = 0; s < nSlicesPlasma; s++) {
      cosPhis[s] = Math.cos(phis[s])
      sinPhis[s] = Math.sin(phis[s])
    }

    // Glow phi: full ±π range so strike glow wraps all the way around the vessel.
    // 200 slices across full ±π keeps ~90 slices in the visible front region,
    // restoring additive brightness comparable to the original 140-in-±80° setup.
    const nGlowSlices = 200
    const glowPhis: number[] = []
    for (let i = 0; i < nGlowSlices; i++) {
      glowPhis.push(portCfg.phiMin + (portCfg.phiMax - portCfg.phiMin) * (i / (nGlowSlices - 1)))
    }
    const cosGlowPhis = new Float64Array(nGlowSlices)
    const sinGlowPhis = new Float64Array(nGlowSlices)
    for (let s = 0; s < nGlowSlices; s++) {
      cosGlowPhis[s] = Math.cos(glowPhis[s])
      sinGlowPhis[s] = Math.sin(glowPhis[s])
    }

    // Reusable Vec3 for projections — avoids allocating ~70k temporary
    // objects per frame that toroidal() would otherwise create.
    const tmpV: Vec3 = { x: 0, y: 0, z: 0 }

    const grid: (ScreenPt | null)[][] = []
    const sliceDepths: number[] = []

    for (let s = 0; s < nSlicesPlasma; s++) {
      const cp = cosPhis[s], sp = sinPhis[s]
      const row: (ScreenPt | null)[] = []
      let depthSum = 0
      let depthCount = 0
      for (const [R, Z] of lcfs) {
        tmpV.x = R * cp; tmpV.y = R * sp; tmpV.z = Z
        const p2d = cam.project(tmpV)
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
      const dx = rGeo * cosPhis[s] - portCfg.camR
      const dy = rGeo * sinPhis[s]
      const dist = Math.sqrt(dx * dx + dy * dy)
      const faceOn = Math.abs(rGeo - portCfg.camR * cosPhis[s])
      const pf = faceOn > 0.01 ? dist / faceOn : 10.0
      pathFactor.push(pf)
      if (pf < pathMin) pathMin = pf
    }
    // Normalize: face-on slice = 1.0, tangential slices > 1.0
    // Cap at 4.0 to prevent extreme inter-slice contrast at tangential views
    for (let s = 0; s < nSlicesPlasma; s++) {
      pathFactor[s] = Math.min(pathFactor[s] / pathMin, 4.0)
    }

    // ── Pre-project emission shell contours ──
    // Moves ~49k projection calls out of the draw loop so shell rendering
    // becomes pure canvas operations (flat-array reads → lineTo).  Each
    // shell contour (inner + outer) is stored as a flat Float64Array with
    // interleaved [sx, sy] pairs; NaN marks off-screen points.
    const nPts = lcfs.length
    const lcfsDR = new Float64Array(nPts)
    const lcfsDZ = new Float64Array(nPts)
    for (let j = 0; j < nPts; j++) {
      lcfsDR[j] = lcfs[j][0] - cR
      lcfsDZ[j] = lcfs[j][1] - cZ
    }
    const nShells = EMISSION_SHELLS.length
    const shellOuterXY: Float64Array[] = new Array(nShells)
    const shellInnerXY: Float64Array[] = new Array(nShells)
    const stride = nPts * 2  // elements per slice in the flat array

    for (let si = 0; si < nShells; si++) {
      const shell = EMISSION_SHELLS[si]
      const outerXY = new Float64Array(nSlicesPlasma * stride)
      const innerXY = new Float64Array(nSlicesPlasma * stride)

      for (let s = 0; s < nSlicesPlasma; s++) {
        const cp = cosPhis[s], sp = sinPhis[s]
        const base = s * stride

        for (let j = 0; j < nPts; j++) {
          const off = base + j * 2
          const Ro = cR + lcfsDR[j] * shell.outerScale
          const Zo = cZ + lcfsDZ[j] * shell.outerScale
          tmpV.x = Ro * cp; tmpV.y = Ro * sp; tmpV.z = Zo
          const p2d = cam.project(tmpV)
          if (p2d) { outerXY[off] = p2d.sx; outerXY[off + 1] = p2d.sy }
          else { outerXY[off] = NaN; outerXY[off + 1] = NaN }
        }

        for (let j = 0; j < nPts; j++) {
          const off = base + j * 2
          const Ri = cR + lcfsDR[j] * shell.innerScale
          const Zi = cZ + lcfsDZ[j] * shell.innerScale
          tmpV.x = Ri * cp; tmpV.y = Ri * sp; tmpV.z = Zi
          const p2d = cam.project(tmpV)
          if (p2d) { innerXY[off] = p2d.sx; innerXY[off + 1] = p2d.sy }
          else { innerXY[off] = NaN; innerXY[off + 1] = NaN }
        }
      }

      shellOuterXY[si] = outerXY
      shellInnerXY[si] = innerXY
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

    // Draw emission shells from pre-projected contours (pure canvas ops).
    // Shell contours were projected during grid build — the draw loop here
    // just reads flat arrays and issues lineTo/fill calls with no math.
    for (const s of sliceOrder) {
      const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange // 0=far, 1=near
      const sliceAlpha = baseAlpha * (0.85 + depthFrac * 0.15)

      // Visibility check — skip if fewer than 3 LCFS points project on-screen
      const slicePts = grid[s]
      let visCount = 0
      for (let j = 0; j < nPts; j++) { if (slicePts[j]) visCount++ }
      if (visCount < 3) continue

      const base = s * stride

      for (let si = 0; si < nShells; si++) {
        const shellAlpha = sliceAlpha * EMISSION_SHELLS[si].weight
        if (shellAlpha < 0.0003) continue

        const outerXY = shellOuterXY[si]
        const innerXY = shellInnerXY[si]

        oCtx.beginPath()

        // Outer contour (clockwise)
        let started = false
        for (let j = 0; j < nPts; j++) {
          const off = base + j * 2
          const sx = outerXY[off]
          if (sx !== sx) continue  // NaN = off-screen
          if (!started) { oCtx.moveTo(sx, outerXY[off + 1]); started = true }
          else oCtx.lineTo(sx, outerXY[off + 1])
        }
        oCtx.closePath()

        // Inner contour (counter-clockwise — reversed)
        started = false
        for (let j = nPts - 1; j >= 0; j--) {
          const off = base + j * 2
          const sx = innerXY[off]
          if (sx !== sx) continue
          if (!started) { oCtx.moveTo(sx, innerXY[off + 1]); started = true }
          else oCtx.lineTo(sx, innerXY[off + 1])
        }
        oCtx.closePath()

        oCtx.fillStyle = `rgba(${sr},${sg},${sb},${shellAlpha.toFixed(4)})`
        oCtx.fill('evenodd')
      }
    }

    // ── Step 2a: Limb-brightened separatrix glow ──
    // Draw the LCFS outline as a single closed stroke per pass per slice.
    // Brightness depends on toroidal path factor (tangential views brighter)
    // and a mild contour-averaged R-weighting (inboard slightly brighter).
    // Previous sector-based approach (LIMB_N_SECTORS=6) created visible bright
    // bands at sector boundaries from overlapping strokes with mismatched alpha.
    // Drawing the entire contour as one path eliminates all boundary artifacts.
    {
      const limbAlpha = LIMB_BASE_ALPHA * opacityScale * plasmaIntensity
        * (elmActive && !disrupted ? 1.8 : 1.0)

      // Single contour-averaged R-weight (replaces per-sector sectorLimb[])
      let rContourSum = 0
      for (const [R] of lcfs) rContourSum += R
      const contourLimb = Math.pow(rGeo / (rContourSum / lcfs.length), LIMB_EXPONENT * 0.5)

      // Set stroke style constants once (saves ~1120 redundant state changes)
      oCtx.lineCap = 'round'
      oCtx.lineJoin = 'round'

      for (const s of sliceOrder) {
        const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange
        const sliceLimbAlpha = limbAlpha * (0.85 + depthFrac * 0.15) * pathFactor[s] * contourLimb

        const slicePts = grid[s]

        for (const pass of LIMB_GLOW_PASSES) {
          const passAlpha = sliceLimbAlpha * pass.alphaScale
          if (passAlpha < 0.0003) continue

          oCtx.beginPath()
          oCtx.lineWidth = pass.lineWidth

          let started = false
          for (let j = 0; j < nPts; j++) {
            const p = slicePts[j]
            if (!p) continue
            if (!started) { oCtx.moveTo(p.sx, p.sy); started = true }
            else oCtx.lineTo(p.sx, p.sy)
          }
          if (!started) continue
          oCtx.closePath()

          oCtx.strokeStyle = `rgba(${sr},${sg},${sb},${passAlpha.toFixed(4)})`
          oCtx.stroke()
        }
      }
    }

    // ── Step 2b: Draw divertor legs from actual separatrix geometry ──
    // Split divertor points into individual legs (inner/outer for each X-point),
    // then render as diffuse stroked centerlines across toroidal slices.
    let strikePointRZ: [number, number][] = []
    const showLegs = legFade > 0.01 && divertorLegPts.length >= 3
    if (showLegs) {
      // Build all legs: split each divertor region into inner/outer by X-point R
      const allLegPts: [number, number][][] = []

      // Lower divertor legs
      if (hasLowerXpoint && lowerDivPts.length >= 2) {
        const lowerInner: [number, number][] = []
        const lowerOuter: [number, number][] = []
        for (const pt of lowerDivPts) {
          if (pt[0] < xpR - 0.01) lowerInner.push(pt)
          else if (pt[0] > xpR + 0.01) lowerOuter.push(pt)
        }
        // Sort Z descending (x-point at top → strike at bottom)
        lowerInner.sort((a, b) => b[1] - a[1])
        lowerOuter.sort((a, b) => b[1] - a[1])
        const xPtLower: [number, number] = [xpR, xpZ]
        if (lowerInner.length >= 2) {
          lowerInner.unshift(xPtLower)
          const clipped = resolvedWall ? truncateAtWall(lowerInner, resolvedWall) : lowerInner
          allLegPts.push(clipped)
          // Strike point = wall intersection (last point of clipped path)
          strikePointRZ.push(clipped[clipped.length - 1])
        }
        if (lowerOuter.length >= 2) {
          lowerOuter.unshift(xPtLower)
          const clipped = resolvedWall ? truncateAtWall(lowerOuter, resolvedWall) : lowerOuter
          allLegPts.push(clipped)
          strikePointRZ.push(clipped[clipped.length - 1])
        }
      }

      // Upper divertor legs
      if (hasUpperXpoint && upperDivPts.length >= 2) {
        const upperInner: [number, number][] = []
        const upperOuter: [number, number][] = []
        for (const pt of upperDivPts) {
          if (pt[0] < xpUpperR - 0.01) upperInner.push(pt)
          else if (pt[0] > xpUpperR + 0.01) upperOuter.push(pt)
        }
        // Sort Z ascending (x-point at bottom → strike at top)
        upperInner.sort((a, b) => a[1] - b[1])
        upperOuter.sort((a, b) => a[1] - b[1])
        const xPtUpper: [number, number] = [xpUpperR, xpUpperZ]
        if (upperInner.length >= 2) {
          upperInner.unshift(xPtUpper)
          const clipped = resolvedWall ? truncateAtWall(upperInner, resolvedWall) : upperInner
          allLegPts.push(clipped)
          strikePointRZ.push(clipped[clipped.length - 1])
        }
        if (upperOuter.length >= 2) {
          upperOuter.unshift(xPtUpper)
          const clipped = resolvedWall ? truncateAtWall(upperOuter, resolvedWall) : upperOuter
          allLegPts.push(clipped)
          strikePointRZ.push(clipped[clipped.length - 1])
        }
      }

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

      // Pre-project all leg points for all slices
      const legs: { xy: Float64Array; len: number }[] = []
      for (const legPts of allLegPts) {
        const legLen = legPts.length
        const legXY = new Float64Array(nSlicesPlasma * legLen * 2)
        for (let s = 0; s < nSlicesPlasma; s++) {
          const cp = cosPhis[s], sp = sinPhis[s]
          const sBase = s * legLen * 2
          for (let j = 0; j < legLen; j++) {
            const off = sBase + j * 2
            const R = legPts[j][0], Z = legPts[j][1]
            tmpV.x = R * cp; tmpV.y = R * sp; tmpV.z = Z
            const p2d = cam.project(tmpV)
            if (p2d) { legXY[off] = p2d.sx; legXY[off + 1] = p2d.sy }
            else { legXY[off] = NaN; legXY[off + 1] = NaN }
          }
        }
        if (legLen >= 2) legs.push({ xy: legXY, len: legLen })
      }

      oCtx.lineCap = 'round'
      oCtx.lineJoin = 'round'

      for (const s of sliceOrder) {
        const depthFrac = 1 - (sliceDepths[s] - minDepth) / depthRange
        const legAlpha = legAlphaBase * (0.85 + depthFrac * 0.15) * pathFactor[s]
        if (legAlpha < 0.0002) continue

        for (const { xy, len } of legs) {
          const base = s * len * 2

          for (const pass of legPasses) {
            const passAlpha = legAlpha * pass.alphaScale
            if (passAlpha < 0.0002) continue

            oCtx.beginPath()
            oCtx.lineWidth = pass.lineWidth
            let started = false
            for (let j = 0; j < len; j++) {
              const off = base + j * 2
              const sx = xy[off]
              if (sx !== sx) continue  // NaN = off-screen
              if (!started) { oCtx.moveTo(sx, xy[off + 1]); started = true }
              else oCtx.lineTo(sx, xy[off + 1])
            }
            if (!started) continue
            oCtx.strokeStyle = `rgba(${lr},${lg},${lb},${passAlpha.toFixed(4)})`
            oCtx.stroke()
          }
        }
      }
    }

    // ── Pre-project strike point positions for glow rendering ──
    // Both wall illumination and strike glow use the same screen positions.
    // Pre-projecting once eliminates 560 redundant toroidal()+project() calls.
    const nStrike = strikePointRZ.length
    const strikeXY = new Float64Array(nStrike * nSlicesPlasma * 2)
    for (let sp = 0; sp < nStrike; sp++) {
      const spR = strikePointRZ[sp][0], spZ = strikePointRZ[sp][1]
      for (let s = 0; s < nSlicesPlasma; s++) {
        const off = (sp * nSlicesPlasma + s) * 2
        tmpV.x = spR * cosPhis[s]; tmpV.y = spR * sinPhis[s]; tmpV.z = spZ
        const p2d = cam.project(tmpV)
        if (p2d) { strikeXY[off] = p2d.sx; strikeXY[off + 1] = p2d.sy }
        else { strikeXY[off] = NaN; strikeXY[off + 1] = NaN }
      }
    }

    // Pre-project strike points at glow phi range (full ±π) for glow that
    // wraps all the way around the vessel, not just the plasma phi range.
    const strikeGlowXY = new Float64Array(nStrike * nGlowSlices * 2)
    for (let sp = 0; sp < nStrike; sp++) {
      const spR = strikePointRZ[sp][0], spZ = strikePointRZ[sp][1]
      for (let s = 0; s < nGlowSlices; s++) {
        const off = (sp * nGlowSlices + s) * 2
        tmpV.x = spR * cosGlowPhis[s]; tmpV.y = spR * sinGlowPhis[s]; tmpV.z = spZ
        const p2d = cam.project(tmpV)
        if (p2d) { strikeGlowXY[off] = p2d.sx; strikeGlowXY[off + 1] = p2d.sy }
        else { strikeGlowXY[off] = NaN; strikeGlowXY[off + 1] = NaN }
      }
    }

    // Glow slice depths for depthFrac (controls glow size/brightness per slice)
    const glowSliceDepths: number[] = []
    const glowAxisR = portCfg.lookR
    for (let s = 0; s < nGlowSlices; s++) {
      tmpV.x = glowAxisR * cosGlowPhis[s]
      tmpV.y = glowAxisR * sinGlowPhis[s]
      tmpV.z = 0
      const p2d = cam.project(tmpV)
      glowSliceDepths.push(p2d ? p2d.depth : 1e6)
    }
    let glowMinDepth = Infinity, glowMaxDepth = -Infinity
    for (const d of glowSliceDepths) {
      if (d < 1e5) {
        if (d < glowMinDepth) glowMinDepth = d
        if (d > glowMaxDepth) glowMaxDepth = d
      }
    }
    const glowDepthRange = glowMaxDepth - glowMinDepth + 0.01

    // ── Pre-render glow sprites for strike point rendering ──
    // A single 32×32 radial gradient canvas stamped with drawImage()+globalAlpha
    // replaces 560 createRadialGradient()+addColorStop() calls per frame.
    const wallGlowSprite = document.createElement('canvas')
    wallGlowSprite.width = 32; wallGlowSprite.height = 32
    const wgCtx = wallGlowSprite.getContext('2d')!
    const wgGrad = wgCtx.createRadialGradient(16, 16, 0, 16, 16, 16)
    wgGrad.addColorStop(0, 'rgba(255,40,20,1.0)')
    wgGrad.addColorStop(0.4, 'rgba(200,20,10,0.5)')
    wgGrad.addColorStop(1, 'rgba(140,10,5,0)')
    wgCtx.fillStyle = wgGrad
    wgCtx.fillRect(0, 0, 32, 32)

    const strikeGlowSprite = document.createElement('canvas')
    strikeGlowSprite.width = 32; strikeGlowSprite.height = 32
    const sgCtx = strikeGlowSprite.getContext('2d')!
    const sgGrad = sgCtx.createRadialGradient(16, 16, 0, 16, 16, 16)
    sgGrad.addColorStop(0, 'rgba(255,60,30,1.0)')         // bright red-hot core
    sgGrad.addColorStop(0.3, 'rgba(255,30,15,0.7)')      // intense red
    sgGrad.addColorStop(0.6, 'rgba(200,15,5,0.25)')      // deep red
    sgGrad.addColorStop(1, 'rgba(140,5,0,0)')
    sgCtx.fillStyle = sgGrad
    sgCtx.fillRect(0, 0, 32, 32)

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

    // ── Step 3a: Volumetric divertor glow ──
    // Diffuse Dα/Hα light scattering fills the vacuum vessel volume when
    // strike points are active.  Large radial gradient centered at the
    // screen-space centroid of the strike points — simulates scattered
    // light washing across the far wall and vacuum region.
    const wantStrikeGlow = snapshot.in_hmode && !disrupted
    // dt and prevTimeRef already updated above (before early returns)
    const fadeStep = STRIKE_FADE_RATE > 0 ? Math.min(dt / STRIKE_FADE_RATE, 1) : 1
    if (wantStrikeGlow) {
      strikeGlowRef.current = Math.min(strikeGlowRef.current + fadeStep, 1)
    } else {
      strikeGlowRef.current = Math.max(strikeGlowRef.current - fadeStep, 0)
    }
    const strikeFade = strikeGlowRef.current

    if (strikePointRZ.length > 0 && strikeFade > 0.01) {
      const powerScale = (deviceId && DEVICE_POWER_SCALE[deviceId]) ?? DEFAULT_POWER_SCALE

      // Compute screen-space centroid of all strike points
      let strikeCx = 0, strikeCy = 0, strikeCount = 0
      for (let sp = 0; sp < nStrike; sp++) {
        for (let s = 0; s < nSlicesPlasma; s++) {
          const off = (sp * nSlicesPlasma + s) * 2
          const sx = strikeXY[off]
          if (sx !== sx) continue  // NaN
          strikeCx += sx
          strikeCy += strikeXY[off + 1]
          strikeCount++
        }
      }
      if (strikeCount > 0) {
        strikeCx /= strikeCount
        strikeCy /= strikeCount

        const volumeAlpha = 0.10 * powerScale * strikeFade
        if (volumeAlpha > 0.005) {
          const glowRadius = W * 0.38
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          const volGrad = ctx.createRadialGradient(
            strikeCx, strikeCy, 0,
            strikeCx, strikeCy, glowRadius
          )
          volGrad.addColorStop(0, `rgba(180, 30, 10, ${(volumeAlpha * 1.0).toFixed(3)})`)
          volGrad.addColorStop(0.25, `rgba(140, 20, 5, ${(volumeAlpha * 0.7).toFixed(3)})`)
          volGrad.addColorStop(0.55, `rgba(100, 12, 3, ${(volumeAlpha * 0.35).toFixed(3)})`)
          volGrad.addColorStop(1, 'rgba(60, 5, 0, 0)')
          ctx.fillStyle = volGrad
          ctx.fillRect(0, 0, W, H)
          ctx.restore()
        }
      }
    }

    // Center stack silhouette clip: prevents glow from shining through the
    // center stack.  Computed once in the wall cache from tangent-based
    // projection of the inboard wall profile.  The evenodd Path2D clips
    // rendering to OUTSIDE the center stack silhouette.
    const csClip = wallCacheRef.current?.csClipPath ?? null
    const csTanPhi = wallCacheRef.current?.csTangentPhi ?? Math.PI

    // ── Step 4: Strike point glow on divertor plates ──
    // Localized, bright glow at the strike-point locations.  Should be
    // comparable in width to the divertor legs — no wider.
    // SOL-like turbulent fluctuations: fast position jitter + brightness flicker
    // simulates the filamentary, turbulent scrape-off layer seen in real tokamak cameras.
    if (strikePointRZ.length > 0 && strikeFade > 0.001) {
      const powerScale = (deviceId && DEVICE_POWER_SCALE[deviceId]) ?? DEFAULT_POWER_SCALE
      const strikeAlpha = 0.35 * powerScale * strikeFade  // decoupled from opacityScale for bright strikes

      // SOL turbulence: fast pseudo-random jitter seeded by time
      const tNow = performance.now()
      // Quick hash function for turbulent variation per slice/strike
      const solHash = (seed: number) => {
        let h = (seed * 2654435761) >>> 0
        h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0
        return (h & 0xFFFF) / 65536  // 0..1
      }

      // Helper to draw strike glow for a given slice range predicate
      const drawStrikeSlices = (slicePred: (s: number) => boolean) => {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let sp = 0; sp < nStrike; sp++) {
          for (let s = 0; s < nGlowSlices; s++) {
            if (!slicePred(s)) continue
            const off = (sp * nGlowSlices + s) * 2
            const sx = strikeGlowXY[off]
            if (sx !== sx) continue  // NaN = off-screen
            const sy = strikeGlowXY[off + 1]

            const depthFrac = 1 - (glowSliceDepths[s] - glowMinDepth) / glowDepthRange

            // SOL fluctuations: per-slice position jitter + brightness flicker
            // Changes rapidly (~60-120 Hz) to simulate turbulent filaments
            const tSeed = Math.floor(tNow * 0.12) // ~120 Hz update rate
            const posJitter = (solHash(tSeed + s * 137 + sp * 9371) - 0.5) * 3.5  // ±1.75px lateral wobble
            const brightFlicker = 0.75 + solHash(tSeed * 3 + s * 241 + sp * 6173) * 0.50  // 75–125% brightness

            const gAlpha = strikeAlpha * (0.85 + depthFrac * 0.15) * brightFlicker
            if (gAlpha < 0.001) continue

            // Broad deep red strike glow
            const glowR = 10 + depthFrac * 14
            // Sprite was rendered with alphas normalized by /2.0, so multiply back
            ctx.globalAlpha = gAlpha * 2.0
            ctx.drawImage(strikeGlowSprite, 0, 0, 32, 32,
              sx - glowR + posJitter, sy - glowR, glowR * 2, glowR * 2)
          }
        }
        ctx.restore()
      }

      // Two-pass rendering: front slices (in front of center stack) are drawn
      // without the clip mask so they remain visible.  Behind slices are drawn
      // with the csClip evenodd mask to occlude glow behind the center stack.
      // csTanPhi = arccos(minR / camR): the toroidal angle where the line of
      // sight is tangent to the center stack cylinder.

      // Pass 1: behind-CS slices — draw WITH clip mask
      if (csClip) { ctx.save(); ctx.clip(csClip, 'evenodd') }
      drawStrikeSlices(s => Math.abs(glowPhis[s]) >= csTanPhi)
      if (csClip) ctx.restore()

      // Pass 2: front-of-CS slices — draw WITHOUT clip mask (visible in front)
      drawStrikeSlices(s => Math.abs(glowPhis[s]) < csTanPhi)
    }

    // ── Step 4a: Draw NEAR wall on top of plasma + glow ──
    // Only the outboard wall (between camera and plasma) occludes.
    // Drawn AFTER glow effects so the near wall properly occludes glow
    // at the port plug edges (prevents glow arc on widescreen monitors).
    if (wallCacheRef.current) {
      ctx.drawImage(wallCacheRef.current.nearCanvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H)
    }

    // ── Step 4b: Wall illumination from strike points ──
    // Drawn AFTER the near wall so the additive glow is visible on ALL wall
    // tiles (both far and near), producing the red reflected glow from
    // divertor emission onto nearby wall surfaces.
    if (strikePointRZ.length > 0 && strikeFade > 0.001) {
      const powerScale4b = (deviceId && DEVICE_POWER_SCALE[deviceId]) ?? DEFAULT_POWER_SCALE
      const illumAlpha = 0.18 * powerScale4b * strikeFade

      // SOL turbulence for wall illumination (matches Step 4 fluctuations)
      const tNow4b = performance.now()
      const solHash4b = (seed: number) => {
        let h = (seed * 2654435761) >>> 0
        h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0
        return (h & 0xFFFF) / 65536
      }
      const tSeed4b = Math.floor(tNow4b * 0.12)  // ~120 Hz

      // Helper to draw wall illumination slices for a given predicate
      const drawWallIllumSlices = (slicePred: (s: number) => boolean) => {
        if (illumAlpha > 0.001) {
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          for (let sp = 0; sp < nStrike; sp++) {
            for (let s = 0; s < nGlowSlices; s++) {
              if (!slicePred(s)) continue
              const off = (sp * nGlowSlices + s) * 2
              const sx = strikeGlowXY[off]
              if (sx !== sx) continue  // NaN = off-screen
              const sy = strikeGlowXY[off + 1]

              const depthFrac = 1 - (glowSliceDepths[s] - glowMinDepth) / glowDepthRange

              // Correlated SOL fluctuations: position + brightness jitter
              const posJitter = (solHash4b(tSeed4b + s * 137 + sp * 9371) - 0.5) * 3.5
              const brightFlicker = 0.80 + solHash4b(tSeed4b * 3 + s * 241 + sp * 6173) * 0.40

              const gAlpha = illumAlpha * (0.4 + depthFrac * 0.6) * brightFlicker
              if (gAlpha < 0.001) continue

              const glowR = 14 + depthFrac * 18
              ctx.globalAlpha = gAlpha
              ctx.drawImage(wallGlowSprite, 0, 0, 32, 32,
                sx - glowR + posJitter, sy - glowR, glowR * 2, glowR * 2)
            }
          }
          ctx.restore()
        }

        // Extended divertor floor glow: interpolated sources between strike pairs
        if (nStrike >= 2 && strikeFade > 0.01 && illumAlpha > 0.001) {
          const FLOOR_INTERP = 4
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          for (let pair = 0; pair < nStrike - 1; pair += 2) {
            const r0 = strikePointRZ[pair][0], z0 = strikePointRZ[pair][1]
            const r1 = strikePointRZ[pair + 1][0], z1 = strikePointRZ[pair + 1][1]
            for (let fi = 1; fi <= FLOOR_INTERP; fi++) {
              const t = fi / (FLOOR_INTERP + 1)
              const iR = r0 + (r1 - r0) * t
              const iZ = z0 + (z1 - z0) * t
              for (let s = 0; s < nGlowSlices; s++) {
                if (!slicePred(s)) continue
                tmpV.x = iR * cosGlowPhis[s]; tmpV.y = iR * sinGlowPhis[s]; tmpV.z = iZ
                const p2d = cam.project(tmpV)
                if (!p2d) continue
                const depthFrac = 1 - (glowSliceDepths[s] - glowMinDepth) / glowDepthRange
                const gAlpha = illumAlpha * 0.6 * (0.3 + depthFrac * 0.7)
                if (gAlpha < 0.001) continue
                const glowR = 10 + depthFrac * 14
                ctx.globalAlpha = gAlpha
                ctx.drawImage(wallGlowSprite, 0, 0, 32, 32,
                  p2d.sx - glowR, p2d.sy - glowR, glowR * 2, glowR * 2)
              }
            }
          }
          ctx.restore()
        }
      }

      // Two-pass wall illumination: same front/behind split as Step 4.
      // Pass 1: behind-CS slices — draw WITH clip mask
      if (csClip) { ctx.save(); ctx.clip(csClip, 'evenodd') }
      drawWallIllumSlices(s => Math.abs(glowPhis[s]) >= csTanPhi)
      if (csClip) ctx.restore()

      // Pass 2: front-of-CS slices — draw WITHOUT clip mask
      drawWallIllumSlices(s => Math.abs(glowPhis[s]) < csTanPhi)
    }

    // Step 4c removed — center stack occlusion now handled by silhouette clip
    // mask (csClipPath) applied during Steps 4 and 4b.  This is more robust
    // than re-drawing the far wall canvas because it handles complex divertor
    // channel geometry and doesn't sacrifice wall illumination on visible tiles.

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
  const regions = cfg.tileRegions
  const extraPorts = cfg.extraPorts
  const antennae = cfg.antennae

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
  // Extended quad type: includes region classification for per-region rendering
  const enum WallRegion { Outboard, Inboard, Limiter, ExtraPort, Antenna, Divertor }
  interface WallQuad {
    corners: (ScreenPt | null)[]
    depth: number
    gridProximity: number  // 0 = on grid line (darkest), 1 = center of tile (brightest)
    region: WallRegion
    qZ: number           // Z position for antenna louver pattern
    viewDot: number       // view angle for Fresnel-like specular
    tileHash: number      // per-tile brightness variation (0–1)
    toroidalArc: number   // toroidal arc position for band rendering
    phi: number           // raw toroidal angle (for R-independent band alignment)
  }
  const quads: WallQuad[] = []

  for (let s = 0; s < nSlices - 1; s++) {
    const phiMid = (phis[s] + phis[s + 1]) * 0.5
    const axisPt = toroidal(axisR, 0, phiMid)

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

      // Port hole punching — skip quads inside main port opening
      const qR = Math.sqrt(qcx * qcx + qcy * qcy)
      const qPhi = Math.atan2(qcy, qcx)
      const dPhi = Math.abs(qPhi - cfg.portPhi)
      const angularRadius = cfg.portRadius / cfg.portR
      if (dPhi < angularRadius * 1.2) {
        const dr = qR - cfg.portR
        const dz = qcz - cfg.portZ
        if (dr * dr + dz * dz < cfg.portRadius * cfg.portRadius * 1.1) continue
      }

      // Toroidal arc lengths for grid spacing — use local qR so tiles
      // at the inboard wall (small R) are properly proportioned (square).
      const toroidalArc0 = phis[s] * qR
      const toroidalArc1 = phis[s + 1] * qR

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

      // ── Region classification ──
      let region = WallRegion.Outboard

      // Check extra ports first (dark openings on outboard wall)
      let inExtraPort = false
      if (extraPorts) {
        for (const ep of extraPorts) {
          const epDPhi = Math.abs(qPhi - ep.phi)
          const epAngR = ep.radius / ep.r
          if (epDPhi < epAngR * 1.3) {
            const dr = qR - ep.r
            const dz = qcz - ep.z
            if (dr * dr + dz * dz < ep.radius * ep.radius * 1.2) {
              inExtraPort = true
              break
            }
          }
        }
      }

      // Check antennae (louvered structures on outboard wall)
      let inAntenna = false
      if (!inExtraPort && antennae) {
        for (const ant of antennae) {
          if (qcz >= ant.zMin && qcz <= ant.zMax &&
              qPhi >= ant.phiMin && qPhi <= ant.phiMax &&
              qR > axisR) {
            inAntenna = true
            break
          }
        }
      }

      if (inExtraPort) {
        region = WallRegion.ExtraPort
      } else if (inAntenna) {
        region = WallRegion.Antenna
      } else if (qR < axisR * 0.85) {
        region = WallRegion.Inboard
      } else if (regions && Math.abs(qcz) > regions.limiterZThreshold) {
        region = WallRegion.Limiter
      } else if (cfg.divertorRegion && qcz < cfg.divertorRegion.zThreshold) {
        region = WallRegion.Divertor
      }

      // ── Per-region tile grid spacing ──
      let pGrid: number, tGrid: number
      if (region === WallRegion.Divertor && cfg.divertorRegion) {
        pGrid = cfg.divertorRegion.gridSpacing.poloidal
        tGrid = cfg.divertorRegion.gridSpacing.toroidal
      } else if (region === WallRegion.Inboard && regions) {
        pGrid = regions.inboardGridSpacing.poloidal
        tGrid = regions.inboardGridSpacing.toroidal
      } else if (region === WallRegion.Limiter && regions) {
        pGrid = regions.limiterGridSpacing.poloidal
        tGrid = regions.limiterGridSpacing.toroidal
      } else {
        pGrid = cfg.tileGridSpacing.poloidal
        tGrid = cfg.tileGridSpacing.toroidal
      }

      // Distance-based grid proximity: prevents moiré when quad size > tile size.
      // Computes how close the quad CENTER is to the nearest grid line.
      const tCenter = (toroidalArc0 + toroidalArc1) * 0.5
      const pCenter = (poloidalArc[j] + poloidalArc[jn < nPts ? jn : 0]) * 0.5

      // Fractional position within tile cell (0..1), handling negative toroidal arcs
      const tCellPos = tGrid > 0 ? (((tCenter % tGrid) + tGrid) % tGrid) / tGrid : 0.5
      const pCellPos = pGrid > 0 ? (((pCenter % pGrid) + pGrid) % pGrid) / pGrid : 0.5

      // Distance from nearest grid line: 0 = on line, 0.5 = center of tile
      const tDist = Math.min(tCellPos, 1 - tCellPos)
      const pDist = Math.min(pCellPos, 1 - pCellPos)

      // Smooth border: ramp from 0 (on grid) to 1 (inside tile) over borderWidth fraction
      const borderWidth = 0.05  // 5% of tile width → narrow gap between tiles
      const tBorder = tGrid > 0 ? Math.min(tDist / borderWidth, 1.0) : 1.0
      const pBorder = pGrid > 0 ? Math.min(pDist / borderWidth, 1.0) : 1.0
      const gridProximity = tBorder * pBorder

      // ── View angle for Fresnel-like specular ──
      const inLen = Math.sqrt(inward.x * inward.x + inward.y * inward.y + inward.z * inward.z)
      const vLen = Math.sqrt(viewDir.x * viewDir.x + viewDir.y * viewDir.y + viewDir.z * viewDir.z)
      const viewDot = (inLen > 0.01 && vLen > 0.01)
        ? dot(inward, viewDir) / (inLen * vLen) : 0.5

      // ── Per-tile deterministic hash for brightness variation ──
      // Use quad center for consistent hashing even when quad spans multiple tiles
      const cellP = pGrid > 0 ? Math.floor(pCenter / pGrid) : j
      const cellT = tGrid > 0 ? Math.floor(tCenter / tGrid) : s
      const tileHash = (((cellP * 7919 + cellT * 104729) & 0xFFFF) / 65536)

      quads.push({
        corners: [sa, sb, sc, sd],
        depth: avgDepth,
        gridProximity,
        region,
        qZ: qcz,
        viewDot,
        tileHash,
        toroidalArc: toroidalArc0,
        phi: phis[s],
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

  // Draw all quads with per-region appearance
  ctx.save()
  for (const q of quads) {
    const df = 1 - (q.depth - minD) / dRange // 0=far, 1=near

    let r: number, g: number, b: number, alpha: number

    if (q.region === WallRegion.ExtraPort) {
      // Extra diagnostic ports: very dark (deep opening into vessel wall)
      r = 6; g = 6; b = 8
      alpha = 0.92 + df * 0.08
    } else if (q.region === WallRegion.Antenna) {
      // Antenna Faraday screen: brighter metallic with horizontal louver pattern
      const louverSpacing = 0.028  // ~1.1" louver pitch
      const louverPhase = q.qZ / louverSpacing
      const isLouverGap = (louverPhase - Math.floor(louverPhase)) < 0.35
      const depthMod = 0.50 + df * 0.50
      if (isLouverGap) {
        // Dark gap between louver slats
        r = Math.round(12 * depthMod)
        g = Math.round(12 * depthMod)
        b = Math.round(14 * depthMod)
      } else {
        // Bright metallic louver slat
        const fresnel = 1.0 + (1.0 - q.viewDot) * 0.4
        r = Math.round(62 * depthMod * fresnel)
        g = Math.round(58 * depthMod * fresnel)
        b = Math.round(52 * depthMod * fresnel)
      }
      alpha = 0.85 + df * 0.14
    } else {
      // Normal tile regions (inboard, outboard, limiter, divertor)
      const depthMod = 0.45 + df * 0.55

      // Per-tile brightness variation: very subtle for uniform tile appearance
      const tileVariation = 0.97 + q.tileHash * 0.06  // ±3% — nearly uniform tiles
      const fresnelStr = cfg.fresnelStrength ?? 0.25
      const fresnel = 1.0 + (1.0 - q.viewDot) * fresnelStr

      // Divertor region: use darker tile color
      let qtr = tr, qtg = tg, qtb = tb
      if (q.region === WallRegion.Divertor && cfg.divertorRegion) {
        ;[qtr, qtg, qtb] = cfg.divertorRegion.tileColor
      }

      // JET-style alternating vertical bands on inboard wall
      // Uses phi (toroidal angle) instead of toroidal arc so that bands
      // align as pure vertical stripes regardless of local R variation.
      let bandMod = 1.0
      let gridDim: number
      if (q.region === WallRegion.Inboard && cfg.inboardStyle === 'bands') {
        const bw = cfg.bandWidth ?? 0.08
        // Convert metric band width to angular width at typical inboard wall R
        const inboardR = axisR * 0.6
        const angularBw = bw / inboardR
        const bandIdx = Math.floor(q.phi / angularBw)
        bandMod = (bandIdx & 1) === 0 ? 1.12 : 0.88  // subtle alternating bright/dark columns
        gridDim = 1.0  // band alternation IS the visual pattern — no additional grid lines
      } else {
        gridDim = 1.0 - cfg.tileGridDarken * (1.0 - q.gridProximity)
      }

      const mod = depthMod * gridDim * tileVariation * fresnel * bandMod
      r = Math.round(qtr * mod)
      g = Math.round(qtg * mod)
      b = Math.round(qtb * mod)
      alpha = 0.80 + df * 0.18
    }

    // Clamp color values
    r = Math.min(r, 255)
    g = Math.min(g, 255)
    b = Math.min(b, 255)

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
