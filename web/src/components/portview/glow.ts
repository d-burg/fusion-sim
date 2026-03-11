import * as THREE from 'three'
import type { PortConfig } from './types'
import { toroidal } from './types'
import { STRIKE_FADE_RATE, DEFAULT_GLOW_TUNING } from './config'
import type { GlowTuning } from './config'

const GLOW_SLICES = 600
const POINTS_PER_STRIKE = GLOW_SLICES

// Base glow intensity multiplier
const GLOW_INTENSITY = 2.0

// Max strike points we'll ever render (generous upper bound)
const MAX_STRIKE_POINTS = 8
const MAX_GLOW_POINTS = MAX_STRIKE_POINTS * POINTS_PER_STRIKE

// ═══ STOCHASTIC JITTER PARAMETERS ═══
// Subtle R/Z position jitter amplitude (meters) — keeps the band alive
const JITTER_RATE = 18.0          // fast jitter time rate
// Brightness flicker time rate — how fast brightness changes (Hz-like seed rate)
const FLICKER_RATE = 25.0
// Slow brightness modulation rate — broad undulations along the ring
const MODULATION_RATE = 3.0

/** Deterministic pseudo-random in [0,1) for cacheable jitter. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453
  return x - Math.floor(x)
}

export interface GlowGroup {
  group: THREE.Group
  pixelRatio: number  // stored externally, used for size scaling
  update: (params: GlowUpdateParams) => void
}

export interface StrikePoint {
  r: number
  z: number
}

export interface GlowUpdateParams {
  strikePoints: StrikePoint[]
  intensity: number  // overall glow brightness
  powerScale: number
  axisR: number
  time: number
}

/**
 * Create a canvas-based Gaussian glow texture for point sprites.
 * Radial falloff matches the original shader: exp(-r * 3.0)
 */
function createGlowTexture(size = 64): THREE.CanvasTexture {
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

      // Gaussian falloff matching original shader: exp(-r * 3.0)
      // r is 0 at center, 1 at edge
      const falloff = r <= 1.0 ? Math.exp(-r * 3.0) : 0

      const idx = (y * size + x) * 4
      imageData.data[idx] = 255      // R — actual color comes from vertex colors
      imageData.data[idx + 1] = 255  // G
      imageData.data[idx + 2] = 255  // B
      imageData.data[idx + 3] = Math.round(falloff * 255) // A — radial falloff
    }
  }

  ctx.putImageData(imageData, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/**
 * Create the glow rendering group for strike point sprites.
 * Uses PointsMaterial with canvas texture and vertex colors.
 *
 * Renders the SOL (scrape-off layer) as a uniform continuous glowing band:
 * - 600 overlapping point sprites per strike → seamless band, not discrete orbs
 * - Fast stochastic brightness jitter → simulates turbulent opacity/width variation
 * - Subtle R/Z position jitter → heat-shimmer alive-ness
 * - Positions rebuild only when strike points change; colors + jitter update every frame
 *
 * Performance: pre-allocates a single Points object and buffers (4800 points max).
 * Position jitter + color update every frame (~0.1ms CPU cost).
 */
export function createGlowGroup(cfg: PortConfig, tuning?: GlowTuning): GlowGroup {
  const t = tuning ?? DEFAULT_GLOW_TUNING
  const group = new THREE.Group()
  group.renderOrder = 3

  const glowTexture = createGlowTexture(64)

  // PointsMaterial with vertex colors for per-point brightness
  const material = new THREE.PointsMaterial({
    map: glowTexture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    size: t.pointSize,
  })

  let storedPixelRatio = 1

  // ═══ PRE-ALLOCATED BUFFERS ═══
  const posBuffer = new Float32Array(MAX_GLOW_POINTS * 3)
  const colBuffer = new Float32Array(MAX_GLOW_POINTS * 3)

  // Base positions (without jitter) — rebuilt only when strike points change
  const basePosR = new Float32Array(MAX_GLOW_POINTS)
  const basePosZ = new Float32Array(MAX_GLOW_POINTS)
  const basePhi = new Float32Array(MAX_GLOW_POINTS)
  // Cached phi fade factor — only changes when strike points change
  const cachedFade = new Float32Array(MAX_GLOW_POINTS)

  // Single persistent geometry + Points (never disposed/recreated)
  const geometry = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(posBuffer, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  const colAttr = new THREE.BufferAttribute(colBuffer, 3)
  colAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('color', colAttr)

  const points = new THREE.Points(geometry, material)
  points.renderOrder = 3
  points.frustumCulled = false
  points.visible = false
  group.add(points)

  let activeCount = 0
  let lastStrikeFP = ''

  // Phi range constants
  const phiSpan = cfg.phiMax - cfg.phiMin

  const update = (params: GlowUpdateParams) => {
    if (params.strikePoints.length === 0 || params.intensity <= 0) {
      points.visible = false
      activeCount = 0
      lastStrikeFP = ''
      return
    }

    const time = params.time
    const intensityBase = params.intensity * params.powerScale * GLOW_INTENSITY

    // Strike point fingerprint — detect when strikes appear/disappear
    const fp = params.strikePoints
      .map(sp => `${sp.r.toFixed(4)},${sp.z.toFixed(4)}`)
      .join(':')

    if (fp !== lastStrikeFP) {
      // ═══ BASE POSITION REBUILD (strike points changed) ═══
      let vi = 0
      for (const sp of params.strikePoints) {
        for (let si = 0; si < POINTS_PER_STRIKE && vi < MAX_GLOW_POINTS; si++) {
          const phi = cfg.phiMin + (si / (POINTS_PER_STRIKE - 1)) * phiSpan
          basePosR[vi] = sp.r
          basePosZ[vi] = sp.z
          basePhi[vi] = phi
          cachedFade[vi] = Math.exp(-Math.abs(phi) * STRIKE_FADE_RATE)
          vi++
        }
      }
      activeCount = vi
      lastStrikeFP = fp
    }

    // ═══ PER-FRAME UPDATE: position jitter + stochastic brightness ═══
    const jitAmp = t.jitterAmplitude
    const glowR = t.color.r, glowG = t.color.g, glowB = t.color.b

    for (let vi = 0; vi < activeCount; vi++) {
      // Subtle R/Z position jitter — fast-evolving for heat-shimmer effect
      const jitR = jitAmp * (pseudoRandom(vi * 127.1 + time * JITTER_RATE) - 0.5)
      const jitZ = jitAmp * (pseudoRandom(vi * 269.5 + time * JITTER_RATE) - 0.5)

      const v = toroidal(basePosR[vi] + jitR, basePosZ[vi] + jitZ, basePhi[vi])
      posBuffer[vi * 3] = v.x
      posBuffer[vi * 3 + 1] = v.y
      posBuffer[vi * 3 + 2] = v.z

      // Stochastic brightness — fast random flicker simulates turbulent opacity/width
      // Multiple overlapping noise frequencies for natural turbulent appearance
      const fastNoise = pseudoRandom(vi * 43.7 + Math.floor(time * FLICKER_RATE))
      const slowWave = 0.5 + 0.5 * Math.sin(basePhi[vi] * 3.0 + time * MODULATION_RATE)
      const flicker = 1.0 - t.flickerDepth * fastNoise * (0.6 + 0.4 * slowWave)

      const brightness = intensityBase * cachedFade[vi] * flicker

      colBuffer[vi * 3] = glowR * brightness
      colBuffer[vi * 3 + 1] = glowG * brightness
      colBuffer[vi * 3 + 2] = glowB * brightness
    }

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    geometry.setDrawRange(0, activeCount)
    points.visible = true
  }

  return {
    group,
    get pixelRatio() { return storedPixelRatio },
    set pixelRatio(v: number) { storedPixelRatio = v },
    update,
  }
}

/**
 * Extract strike points from separatrix + wall intersection.
 * Finds where divertor legs actually intersect the wall using proper
 * line-segment intersection (matching buildDivertorLegLines' truncateAtWall).
 *
 * Previous approach of "closest wall point to leg tip" gave incorrect positions
 * because the tip isn't necessarily where the leg crosses the wall, and the
 * closest wall vertex can be far from the true intersection.
 */
export function findStrikePoints(
  sepPts: [number, number][],
  limiterPts: [number, number][],
  xpointR: number,
  xpointZ: number,
  axisR: number,
): StrikePoint[] {
  if (sepPts.length < 4 || xpointR <= 0) return []

  const results: StrikePoint[] = []

  // Find separatrix points below the X-point (divertor legs)
  const belowXp = sepPts.filter(p => p[1] < xpointZ - 0.05)
  if (belowXp.length < 2) return []

  // Split into inner and outer legs using X-point R as dividing line
  const innerLeg = belowXp.filter(p => p[0] < xpointR).sort((a, b) => b[1] - a[1])
  const outerLeg = belowXp.filter(p => p[0] >= xpointR).sort((a, b) => b[1] - a[1])

  // Find actual wall intersection for each leg
  for (const leg of [innerLeg, outerLeg]) {
    if (leg.length < 2) continue

    // Prepend X-point to form full leg path (same as buildDivertorLegLines)
    const fullLeg: [number, number][] = [[xpointR, xpointZ], ...leg]

    // Walk along the leg and find the first intersection with the wall polygon
    let hitPt: [number, number] | null = null
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
        hitPt = bestIntersection
        break  // First intersection along the leg path
      }
    }

    if (hitPt) {
      results.push({ r: hitPt[0], z: hitPt[1] })
    }
  }

  return results
}
