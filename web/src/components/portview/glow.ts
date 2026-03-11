import * as THREE from 'three'
import type { PortConfig } from './types'
import { toroidal } from './types'
import { STRIKE_FADE_RATE } from './config'

const GLOW_SLICES = 200
const POINTS_PER_STRIKE = GLOW_SLICES

// Glow color — warm orange
const GLOW_COLOR = { r: 1.0, g: 0.45, b: 0.15 }

// Base glow intensity multiplier
const GLOW_INTENSITY = 2.0

// Point size for glow sprites (world units, attenuated by distance)
const BASE_POINT_SIZE = 0.4

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
 */
export function createGlowGroup(cfg: PortConfig): GlowGroup {
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
    size: BASE_POINT_SIZE,
  })

  let storedPixelRatio = 1

  const result: GlowGroup = {
    group,
    get pixelRatio() { return storedPixelRatio },
    set pixelRatio(v: number) { storedPixelRatio = v },
    update: () => {},
  }

  const update = (params: GlowUpdateParams) => {
    // Clear old points
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      if (child instanceof THREE.Points) {
        child.geometry.dispose()
      }
    }

    if (params.strikePoints.length === 0 || params.intensity <= 0) return

    // Flicker based on time (matches original shader)
    const time = params.time

    // Build point cloud for all strike points across full toroidal range
    const totalPts = params.strikePoints.length * POINTS_PER_STRIKE
    const positions = new Float32Array(totalPts * 3)
    const colors = new Float32Array(totalPts * 3)

    let vi = 0
    for (const sp of params.strikePoints) {
      for (let si = 0; si < POINTS_PER_STRIKE; si++) {
        const phi = cfg.phiMin + (si / (POINTS_PER_STRIKE - 1)) * (cfg.phiMax - cfg.phiMin)

        // SOL turbulence: position jitter
        const jitterR = (Math.random() - 0.5) * 0.02
        const jitterZ = (Math.random() - 0.5) * 0.02
        const v = toroidal(sp.r + jitterR, sp.z + jitterZ, phi)

        positions[vi * 3] = v.x
        positions[vi * 3 + 1] = v.y
        positions[vi * 3 + 2] = v.z

        // Per-point brightness: intensity * fadeFactor * powerScale * GLOW_INTENSITY
        const phiDist = Math.abs(phi)
        const fadeFactor = Math.exp(-phiDist * STRIKE_FADE_RATE)

        // Flicker per point (random phase baked into position index)
        const phase = (vi * 0.618033988) % 1.0  // golden ratio hash for phase
        const flicker = 0.85 + 0.15 * Math.sin(time * 12.0 + phase * 6.283)

        const brightness = params.intensity * fadeFactor * params.powerScale * GLOW_INTENSITY * flicker

        // Vertex color = glowColor * brightness
        colors[vi * 3] = GLOW_COLOR.r * brightness
        colors[vi * 3 + 1] = GLOW_COLOR.g * brightness
        colors[vi * 3 + 2] = GLOW_COLOR.b * brightness

        vi++
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const points = new THREE.Points(geometry, material)
    points.renderOrder = 3
    points.frustumCulled = false
    group.add(points)
  }

  result.update = update
  return result
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
