import * as THREE from 'three'
import type { PortConfig } from './types'
import { toroidal } from './types'
import { STRIKE_FADE_RATE, DEFAULT_GLOW_TUNING } from './config'
import type { GlowTuning } from './config'

// ═══ STRIKE BAND GEOMETRY ═══
// The strike glow is a ribbon lying on the target surface: it follows the
// wall polygon poloidally through the strike point and sweeps the visible
// toroidal sector. Earlier versions drew it as a ring of billboard sprites
// offset a few centimetres in front of the wall; the wall's depth test
// clipped the half of every sprite that sat inside the target, which gave
// the band a hard lower edge whenever it was too dim for bloom to hide it,
// and the offset read as a hoop floating in front of the tiles.
const BAND_SLICES = 96          // toroidal resolution of each ribbon
const BAND_POL = 21             // poloidal samples across each ribbon
const MAX_STRIKE_POINTS = 8
const MAX_BAND_VERTS = MAX_STRIKE_POINTS * BAND_SLICES * BAND_POL
const MAX_BAND_INDICES = MAX_STRIKE_POINTS * (BAND_SLICES - 1) * (BAND_POL - 1) * 6
// Lift off the tile surface along the inward normal so the ribbon is not
// swallowed by the wall's depth test; a polygon offset does the rest.
const BAND_LIFT = 0.004
// Width of the ribbon in Gaussian sigmas, and the faint recycling skirt
// drawn around the bright core so the band has no hard edge at any brightness.
const BAND_HALF_SIGMAS = 3.2
const SKIRT_SIGMA_RATIO = 2.4
const SKIRT_WEIGHT = 0.22
// Base brightness multiplier (a single ribbon layer replaces ~600 stacked sprites)
const BAND_GAIN = 2.4

// ═══ STOCHASTIC SHIMMER PARAMETERS ═══
const FLICKER_RATE = 25.0       // brightness flicker time rate
const MODULATION_RATE = 3.0     // slow undulation along the ring

/** Deterministic pseudo-random in [0,1) for cacheable jitter. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453
  return x - Math.floor(x)
}

export interface GlowGroup {
  group: THREE.Group
  pixelRatio: number  // stored externally, used for size scaling
  update: (params: GlowUpdateParams) => void
  /** Re-run the shimmer/flicker animation at display rate between sim ticks. */
  tick: (time: number) => void
}

export interface StrikePoint {
  r: number
  z: number
}

export interface GlowUpdateParams {
  strikePoints: StrikePoint[]
  /** Overall glow brightness — physics-driven (see divertorVisuals.ts) */
  intensity: number
  /** Strike band half-width on the target (metres), from λ_q × flux expansion */
  bandWidth?: number
  /** Glow tint override — recycling light blended toward blackbody incandescence */
  color?: { r: number; g: number; b: number }
  /** The wall polygon the band lies on (R, Z); required when strikePoints is non-empty */
  wallPts?: [number, number][]
  axisR: number
  /** Z of the magnetic axis, used to orient the wall normal toward the plasma */
  axisZ?: number
  time: number
}

/**
 * Create a canvas-based Gaussian glow texture for point sprites.
 * Radial falloff: exp(-r * 3.0). Used by the ELM filament system.
 */
export function createGlowTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const center = size / 2
  const imageData = ctx.createImageData(size, size)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / center  // -1 to 1
      const dy = (y - center) / center
      const r = Math.sqrt(dx * dx + dy * dy)
      const falloff = r <= 1.0 ? Math.exp(-r * 3.0) : 0
      const idx = (y * size + x) * 4
      imageData.data[idx] = 255
      imageData.data[idx + 1] = 255
      imageData.data[idx + 2] = 255
      imageData.data[idx + 3] = Math.round(falloff * 255)
    }
  }

  ctx.putImageData(imageData, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/** A sample along the wall polyline: position, inward normal, signed arclength from the strike. */
interface WallSample {
  r: number
  z: number
  nr: number
  nz: number
  s: number
}

/**
 * Walk the wall polygon through the strike point and return samples at
 * equal arclength steps from -halfLen to +halfLen, each with the unit
 * normal pointing into the vessel (toward the axis).
 */
function sampleWallThroughStrike(
  wall: [number, number][],
  sp: StrikePoint,
  halfLen: number,
  nSamples: number,
  axisR: number,
  axisZ: number,
): WallSample[] | null {
  const n = wall.length
  if (n < 3) return null

  // Closest segment and the projection parameter on it
  let bestD = Infinity, bestJ = 0, bestT = 0
  for (let j = 0; j < n; j++) {
    const [ax, az] = wall[j]
    const [bx, bz] = wall[(j + 1) % n]
    const dx = bx - ax, dz = bz - az
    const L2 = dx * dx + dz * dz
    let t = L2 > 0 ? ((sp.r - ax) * dx + (sp.z - az) * dz) / L2 : 0
    t = Math.max(0, Math.min(1, t))
    const px = ax + t * dx, pz = az + t * dz
    const d = (sp.r - px) ** 2 + (sp.z - pz) ** 2
    if (d < bestD) { bestD = d; bestJ = j; bestT = t }
  }

  const segLen = (j: number) => {
    const [ax, az] = wall[((j % n) + n) % n]
    const [bx, bz] = wall[(((j + 1) % n) + n) % n]
    return Math.hypot(bx - ax, bz - az)
  }
  // Point at signed arclength `s` from the foot of the strike along the polyline.
  const pointAt = (s: number): { r: number; z: number; j: number } => {
    let j = bestJ
    let along = bestT * segLen(bestJ) + s   // arclength from the start of segment j
    // Walk forward or backward across segment boundaries
    let guard = 0
    while (along > segLen(j) && guard++ < n) { along -= segLen(j); j = (j + 1) % n }
    while (along < 0 && guard++ < 2 * n) { j = (j - 1 + n) % n; along += segLen(j) }
    const [ax, az] = wall[j]
    const [bx, bz] = wall[(j + 1) % n]
    const L = segLen(j) || 1
    const t = Math.max(0, Math.min(1, along / L))
    return { r: ax + t * (bx - ax), z: az + t * (bz - az), j }
  }

  const out: WallSample[] = []
  for (let i = 0; i < nSamples; i++) {
    const s = -halfLen + (2 * halfLen * i) / (nSamples - 1)
    const p = pointAt(s)
    const [ax, az] = wall[p.j]
    const [bx, bz] = wall[(p.j + 1) % n]
    const dx = bx - ax, dz = bz - az
    const L = Math.hypot(dx, dz) || 1
    // Normal to the segment; pick the sign that points toward the axis
    let nr = -dz / L, nz = dx / L
    if ((axisR - p.r) * nr + (axisZ - p.z) * nz < 0) { nr = -nr; nz = -nz }
    out.push({ r: p.r, z: p.z, nr, nz, s })
  }
  return out
}

/**
 * Create the strike-band renderer: one additive ribbon per strike point,
 * lying on the wall and shimmering at display rate.
 */
export function createGlowGroup(cfg: PortConfig, tuning?: GlowTuning): GlowGroup {
  const t = tuning ?? DEFAULT_GLOW_TUNING
  const group = new THREE.Group()
  group.renderOrder = 3

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    // Pull the ribbon a hair toward the camera in depth so it wins against
    // the tiles it lies on without having to float in front of them.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })

  let storedPixelRatio = 1

  const posBuffer = new Float32Array(MAX_BAND_VERTS * 3)
  const colBuffer = new Float32Array(MAX_BAND_VERTS * 3)
  const idxBuffer = new Uint32Array(MAX_BAND_INDICES)
  // Per-vertex cached factors: poloidal profile × toroidal fade, and phi
  const cachedProfile = new Float32Array(MAX_BAND_VERTS)
  const cachedPhi = new Float32Array(MAX_BAND_VERTS)

  const geometry = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(posBuffer, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  const colAttr = new THREE.BufferAttribute(colBuffer, 3)
  colAttr.setUsage(THREE.DynamicDrawUsage)
  const idxAttr = new THREE.BufferAttribute(idxBuffer, 1)
  idxAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('color', colAttr)
  geometry.setIndex(idxAttr)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 3
  mesh.frustumCulled = false
  mesh.visible = false
  group.add(mesh)

  let activeVerts = 0
  let activeIndices = 0
  let lastFP = ''
  let lastParams: GlowUpdateParams | null = null

  const phiSpan = cfg.phiMax - cfg.phiMin

  const rebuild = (params: GlowUpdateParams, sigma: number) => {
    const wall = params.wallPts!
    const axisZ = params.axisZ ?? 0
    const halfLen = BAND_HALF_SIGMAS * sigma * SKIRT_SIGMA_RATIO
    let vi = 0
    let ii = 0
    for (const sp of params.strikePoints) {
      if (vi + BAND_SLICES * BAND_POL > MAX_BAND_VERTS) break
      const samples = sampleWallThroughStrike(wall, sp, halfLen, BAND_POL, params.axisR, axisZ)
      if (!samples) continue
      const base = vi
      for (let si = 0; si < BAND_SLICES; si++) {
        const phi = cfg.phiMin + (si / (BAND_SLICES - 1)) * phiSpan
        const fade = Math.exp(-Math.abs(phi) * STRIKE_FADE_RATE)
        for (let pi = 0; pi < BAND_POL; pi++) {
          const w = samples[pi]
          const v = toroidal(w.r + w.nr * BAND_LIFT, w.z + w.nz * BAND_LIFT, phi)
          posBuffer[vi * 3] = v.x
          posBuffer[vi * 3 + 1] = v.y
          posBuffer[vi * 3 + 2] = v.z
          // Bright core plus a faint wide skirt: no edge at any brightness
          const u = w.s / sigma
          const core = Math.exp(-0.5 * u * u)
          const us = w.s / (sigma * SKIRT_SIGMA_RATIO)
          const skirt = Math.exp(-0.5 * us * us) * SKIRT_WEIGHT
          cachedProfile[vi] = (core + skirt) * fade
          cachedPhi[vi] = phi
          vi++
        }
      }
      for (let si = 0; si < BAND_SLICES - 1; si++) {
        for (let pi = 0; pi < BAND_POL - 1; pi++) {
          if (ii + 6 > MAX_BAND_INDICES) break
          const a = base + si * BAND_POL + pi
          const b = base + (si + 1) * BAND_POL + pi
          const c = base + (si + 1) * BAND_POL + pi + 1
          const d = base + si * BAND_POL + pi + 1
          idxBuffer[ii++] = a; idxBuffer[ii++] = b; idxBuffer[ii++] = c
          idxBuffer[ii++] = a; idxBuffer[ii++] = c; idxBuffer[ii++] = d
        }
      }
    }
    activeVerts = vi
    activeIndices = ii
    posAttr.needsUpdate = true
    idxAttr.needsUpdate = true
  }

  const update = (params: GlowUpdateParams) => {
    lastParams = params
    if (params.strikePoints.length === 0 || params.intensity <= 0 || !params.wallPts || params.wallPts.length < 3) {
      mesh.visible = false
      activeVerts = 0
      lastFP = ''
      return
    }

    // Visual band sigma: the physics half-width (λ_q × flux expansion) or
    // the device's tuned minimum, whichever is wider.
    const sigma = Math.max(params.bandWidth ?? 0.03, t.pointSize * 0.3, 0.012)

    const fp = params.strikePoints
      .map(sp => `${sp.r.toFixed(4)},${sp.z.toFixed(4)}`)
      .join(':') + `|${sigma.toFixed(3)}|${params.wallPts.length}`
    if (fp !== lastFP) {
      rebuild(params, sigma)
      lastFP = fp
    }

    // ═══ PER-FRAME COLOUR: shimmer and slow undulation ═══
    const time = params.time
    const intensityBase = params.intensity * BAND_GAIN
    const col = params.color ?? t.color
    for (let vi = 0; vi < activeVerts; vi++) {
      const fastNoise = pseudoRandom(vi * 43.7 + Math.floor(time * FLICKER_RATE))
      const slowWave = 0.5 + 0.5 * Math.sin(cachedPhi[vi] * 3.0 + time * MODULATION_RATE)
      const flicker = 1.0 - t.flickerDepth * fastNoise * (0.6 + 0.4 * slowWave)
      const b = intensityBase * cachedProfile[vi] * flicker
      colBuffer[vi * 3] = col.r * b
      colBuffer[vi * 3 + 1] = col.g * b
      colBuffer[vi * 3 + 2] = col.b * b
    }
    colAttr.needsUpdate = true
    geometry.setDrawRange(0, activeIndices)
    mesh.visible = true
  }

  const tick = (time: number) => {
    if (!lastParams || activeVerts === 0) return
    update({ ...lastParams, time })
  }

  return {
    group,
    get pixelRatio() { return storedPixelRatio },
    set pixelRatio(v: number) { storedPixelRatio = v },
    update,
    tick,
  }
}

/**
 * Walk a divertor leg path and find the first intersection with the wall.
 */
function findLegWallIntersection(
  leg: [number, number][],
  xpR: number, xpZ: number,
  limiterPts: [number, number][],
): StrikePoint | null {
  if (leg.length < 2) return null

  const fullLeg: [number, number][] = [[xpR, xpZ], ...leg]

  for (let i = 0; i < fullLeg.length - 1; i++) {
    const [ax, ay] = fullLeg[i]
    const [bx, by] = fullLeg[i + 1]
    const dx = bx - ax, dy = by - ay

    let bestT = Infinity
    let bestIntersection: [number, number] | null = null

    for (let j = 0; j < limiterPts.length; j++) {
      const nj = (j + 1) % limiterPts.length
      const [cx, cy] = limiterPts[j]
      const [ex, ey] = limiterPts[nj]
      const fx = ex - cx, fy = ey - cy
      const denom = dx * fy - dy * fx
      if (Math.abs(denom) < 1e-12) continue
      const t = ((cx - ax) * fy - (cy - ay) * fx) / denom
      const u = ((cx - ax) * dy - (cy - ay) * dx) / denom
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) {
        bestT = t
        bestIntersection = [ax + t * dx, ay + t * dy]
      }
    }

    if (bestIntersection) {
      return { r: bestIntersection[0], z: bestIntersection[1] }
    }
  }
  return null
}

/**
 * Extract strike points from separatrix + wall intersection: where the
 * divertor legs cross the wall polygon, by proper segment intersection.
 */
export function findStrikePoints(
  sepPts: [number, number][],
  limiterPts: [number, number][],
  xpointR: number,
  xpointZ: number,
  _axisR: number,
  xpointUpperR = 0,
  xpointUpperZ = 0,
): StrikePoint[] {
  if (sepPts.length < 4 || xpointR <= 0) return []

  const results: StrikePoint[] = []

  // ── Lower divertor legs ──
  const belowXp = sepPts.filter(p => p[1] < xpointZ - 0.05)
  if (belowXp.length >= 2) {
    const innerLeg = belowXp.filter(p => p[0] < xpointR).sort((a, b) => b[1] - a[1])
    const outerLeg = belowXp.filter(p => p[0] >= xpointR).sort((a, b) => b[1] - a[1])
    for (const leg of [innerLeg, outerLeg]) {
      const hit = findLegWallIntersection(leg, xpointR, xpointZ, limiterPts)
      if (hit) results.push(hit)
    }
  }

  // ── Upper divertor legs (double-null) ──
  if (xpointUpperR > 0) {
    const aboveXp = sepPts.filter(p => p[1] > xpointUpperZ + 0.05)
    if (aboveXp.length >= 2) {
      const innerLeg = aboveXp.filter(p => p[0] < xpointUpperR).sort((a, b) => a[1] - b[1])
      const outerLeg = aboveXp.filter(p => p[0] >= xpointUpperR).sort((a, b) => a[1] - b[1])
      for (const leg of [innerLeg, outerLeg]) {
        const hit = findLegWallIntersection(leg, xpointUpperR, xpointUpperZ, limiterPts)
        if (hit) results.push(hit)
      }
    }
  }

  return results
}
