import * as THREE from 'three'
import type { Contour } from '../../lib/types'
import type { PortConfig } from './types'
import { toroidal, truncateAtWall, subsample, splitChains } from './types'

// ── Line-based plasma rendering ──
// Replicates the Canvas 2D approach: stroked line paths at many toroidal
// slices, with brightness modulated by the toroidal path-length factor.
// Uses LineBasicMaterial with vertex colors for per-vertex brightness.
// Bloom post-processing creates the soft glow halo (replacing Canvas 2D's
// multi-pass strokes at different line widths).

// Number of toroidal slices for separatrix line rendering.
// Higher = smoother coverage. Canvas 2D used 140.
const SEP_LINE_SLICES = 120

// Base intensity for separatrix lines.
// With additive blending across ~120 slices, tangential views accumulate
// 20-40 overlapping lines. pathFactor ranges 1.0 (face-on) to 4.0 (tangential).
// Per-fragment color = baseColor * intensity * pathFactor * depthFade * opacity
// At tangential limbs: ~30 overlaps × color(~0.08) → accumulated ~2.4 → bright + bloom
const SEP_INTENSITY = 1.5

// Divertor leg intensity — brighter than separatrix for visual punch
const LEG_INTENSITY = 2.0

// Max contour points for line rendering (performance bound)
const MAX_CONTOUR_PTS = 100

export interface PlasmaGroup {
  group: THREE.Group
  sepMaterial: THREE.LineBasicMaterial
  legMaterial: THREE.LineBasicMaterial
  update: (params: PlasmaUpdateParams) => void
}

export interface PlasmaUpdateParams {
  separatrix: Contour
  fluxSurfaces: Contour[]
  axisR: number
  axisZ: number
  xpointR: number
  xpointZ: number
  xpointUpperR: number
  xpointUpperZ: number
  inHmode: boolean
  elmActive: boolean
  te0: number
  betaN: number
  opacity: number
  limiterPts: [number, number][]
}

/**
 * Create the plasma rendering group with line-based separatrix and divertor legs.
 * Uses LineBasicMaterial with vertex colors for per-vertex brightness modulation.
 */
export function createPlasmaGroup(cfg: PortConfig): PlasmaGroup {
  const group = new THREE.Group()
  group.renderOrder = 1

  // Separatrix line material — vertex colors provide per-vertex brightness
  const sepMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  })

  // Divertor leg material — same approach
  const legMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  })

  // Current base color (updated each frame from temperature)
  const baseColor = { r: 0.4, g: 0.7, b: 1.0 }
  const legColor = { r: 0.55, g: 0.82, b: 1.0 }

  const update = (params: PlasmaUpdateParams) => {
    // Clear old children
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose()
      }
    }

    // Plasma color from temperature — cyan-blue base
    const tempFrac = Math.min(params.te0 / 12, 1)
    baseColor.r = 0.30 + tempFrac * 0.15
    baseColor.g = 0.60 + tempFrac * 0.15
    baseColor.b = 0.90 + tempFrac * 0.10

    const sepPts = params.separatrix.points
    if (sepPts.length < 4) return

    // Build separatrix lines
    buildSeparatrixLines(group, sepMaterial, cfg, sepPts, params, baseColor)

    // Build divertor leg lines in H-mode
    if (params.inHmode) {
      buildDivertorLegLines(group, legMaterial, cfg, params, legColor)
    }

  }

  return { group, sepMaterial, legMaterial, update }
}

/**
 * Compute toroidal path-length factor for each slice.
 * Face-on slices (nearest camera) → short path → dim.
 * Tangential slices (toroidal limbs) → long path → bright.
 * Matches the Canvas 2D formula: path ∝ |d| / |R₀ - R_cam·cos(φ)|
 */
function computePathFactors(
  cfg: PortConfig,
  rGeo: number,
  nSlices: number,
  phiMin: number,
  phiMax: number,
): Float32Array {
  const factors = new Float32Array(nSlices)
  let minFactor = Infinity

  for (let s = 0; s < nSlices; s++) {
    const phi = phiMin + (s / (nSlices - 1)) * (phiMax - phiMin)
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    // Distance from camera to geometric center of this slice
    const dx = rGeo * cosPhi - cfg.camR
    const dy = rGeo * sinPhi
    const dist = Math.sqrt(dx * dx + dy * dy)

    // "Face-on" factor: how parallel the line of sight is to the toroidal direction
    const faceOn = Math.abs(rGeo - cfg.camR * cosPhi)
    const pf = faceOn > 0.01 ? dist / faceOn : 10.0
    factors[s] = pf
    if (pf < minFactor) minFactor = pf
  }

  // Normalize: face-on = 1.0, tangential > 1.0. Cap at 4.0.
  for (let s = 0; s < nSlices; s++) {
    factors[s] = Math.min(factors[s] / minFactor, 4.0)
  }

  return factors
}

/**
 * Compute depth fade per slice — nearer slices brighter.
 * Uses a gentle linear fade (0.85 + 0.15 * depthFrac) matching Canvas 2D.
 */
function computeDepthFades(
  cfg: PortConfig,
  rGeo: number,
  nSlices: number,
  phiMin: number,
  phiMax: number,
): Float32Array {
  const fades = new Float32Array(nSlices)
  const depths = new Float32Array(nSlices)
  let minDepth = Infinity, maxDepth = -Infinity

  for (let s = 0; s < nSlices; s++) {
    const phi = phiMin + (s / (nSlices - 1)) * (phiMax - phiMin)
    const dx = rGeo * Math.cos(phi) - cfg.camR
    const dy = rGeo * Math.sin(phi)
    const d = Math.sqrt(dx * dx + dy * dy)
    depths[s] = d
    if (d < minDepth) minDepth = d
    if (d > maxDepth) maxDepth = d
  }

  const range = maxDepth - minDepth + 0.01
  for (let s = 0; s < nSlices; s++) {
    const depthFrac = 1 - (depths[s] - minDepth) / range // 0=far, 1=near
    fades[s] = 0.85 + depthFrac * 0.15
  }

  return fades
}

/**
 * Build separatrix lines as THREE.LineSegments across toroidal slices.
 *
 * The separatrix point array from the Rust contour extractor may contain
 * multiple concatenated chains (main LCFS loop + divertor leg fragments).
 * We split them apart using jump-threshold detection, then render:
 *   - The main LCFS loop as a closed contour (wrap-around)
 *   - Any smaller chains as open polylines (no wrap — divertor legs are
 *     handled separately by buildDivertorLegLines)
 *
 * Per-vertex color encodes: baseColor * intensity * pathFactor * depthFade * opacity
 */
function buildSeparatrixLines(
  group: THREE.Group,
  material: THREE.LineBasicMaterial,
  cfg: PortConfig,
  sepPts: [number, number][],
  params: PlasmaUpdateParams,
  color: { r: number; g: number; b: number },
): void {
  // Split concatenated chains apart at discontinuities
  const chains = splitChains(sepPts)
  if (chains.length === 0) return

  // Only render the main LCFS loop (longest chain).
  // Divertor leg fragments are handled by buildDivertorLegLines which
  // uses proper topology-aware splitting (inner/outer by X-point R).
  const mainLoop = subsample(chains[0], MAX_CONTOUR_PTS)
  const nPts = mainLoop.length
  if (nPts < 4) return

  // Check if the main loop is closed (first ≈ last point)
  // Use adaptive closure threshold based on contour spacing.
  // Compute typical spacing from the chain itself.
  let avgSpacing = 0
  for (let i = 1; i < nPts; i++) {
    const dr = mainLoop[i][0] - mainLoop[i - 1][0]
    const dz = mainLoop[i][1] - mainLoop[i - 1][1]
    avgSpacing += Math.sqrt(dr * dr + dz * dz)
  }
  avgSpacing /= Math.max(nPts - 1, 1)
  const closureThreshold = Math.max(avgSpacing * 5, 0.05)

  const dClose = Math.sqrt(
    (mainLoop[0][0] - mainLoop[nPts - 1][0]) ** 2 +
    (mainLoop[0][1] - mainLoop[nPts - 1][1]) ** 2,
  )
  const isClosed = dClose < closureThreshold

  const nSlices = SEP_LINE_SLICES
  const phiMin = cfg.plasmaPhiMin
  const phiMax = cfg.plasmaPhiMax

  // Geometric center radius for path-length calculation
  let rMin = Infinity, rMax = -Infinity
  for (const [R] of mainLoop) {
    if (R < rMin) rMin = R
    if (R > rMax) rMax = R
  }
  const rGeo = (rMin + rMax) / 2

  // Compute per-slice factors
  const pathFactors = computePathFactors(cfg, rGeo, nSlices, phiMin, phiMax)
  const depthFades = computeDepthFades(cfg, rGeo, nSlices, phiMin, phiMax)

  // Build geometry with vertex colors
  const totalVerts = nSlices * nPts
  const positions = new Float32Array(totalVerts * 3)
  const colors = new Float32Array(totalVerts * 3)
  const indices: number[] = []

  const opacity = params.opacity

  let vi = 0
  for (let si = 0; si < nSlices; si++) {
    const phi = phiMin + (si / (nSlices - 1)) * (phiMax - phiMin)
    const sliceBase = si * nPts

    // Per-vertex brightness: intensity * pathFactor * depthFade * opacity
    const brightness = SEP_INTENSITY * pathFactors[si] * depthFades[si] * opacity

    for (let pi = 0; pi < nPts; pi++) {
      const v = toroidal(mainLoop[pi][0], mainLoop[pi][1], phi)
      positions[vi * 3] = v.x
      positions[vi * 3 + 1] = v.y
      positions[vi * 3 + 2] = v.z

      // Vertex color = baseColor * brightness
      colors[vi * 3] = color.r * brightness
      colors[vi * 3 + 1] = color.g * brightness
      colors[vi * 3 + 2] = color.b * brightness
      vi++
    }

    // Line segments: closed loop if LCFS, open path otherwise
    if (isClosed) {
      // Closed: (0,1), (1,2), ..., (N-2,N-1), (N-1,0)
      for (let pi = 0; pi < nPts; pi++) {
        const nextPi = (pi + 1) % nPts
        indices.push(sliceBase + pi, sliceBase + nextPi)
      }
    } else {
      // Open: (0,1), (1,2), ..., (N-2,N-1) — no wrap-around
      for (let pi = 0; pi < nPts - 1; pi++) {
        indices.push(sliceBase + pi, sliceBase + pi + 1)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)

  const lines = new THREE.LineSegments(geometry, material)
  lines.renderOrder = 1
  lines.frustumCulled = false
  group.add(lines)
}

/**
 * Build divertor leg lines using full separatrix geometry.
 * Matches the Canvas 2D approach: split divertor points into inner/outer legs
 * by X-point R, sort by Z, prepend X-point, truncate at wall.
 */
function buildDivertorLegLines(
  group: THREE.Group,
  material: THREE.LineBasicMaterial,
  cfg: PortConfig,
  params: PlasmaUpdateParams,
  color: { r: number; g: number; b: number },
): void {
  const { separatrix, xpointR, xpointZ, xpointUpperR, xpointUpperZ, limiterPts } = params
  const sepPts = separatrix.points
  if (sepPts.length < 4) return

  const allLegs: [number, number][][] = []

  // Lower divertor legs
  if (xpointR > 0) {
    const lowerDivPts = sepPts.filter(p => p[1] < xpointZ - 0.05)
    if (lowerDivPts.length >= 2) {
      const inner: [number, number][] = []
      const outer: [number, number][] = []
      for (const pt of lowerDivPts) {
        if (pt[0] < xpointR - 0.01) inner.push(pt)
        else if (pt[0] > xpointR + 0.01) outer.push(pt)
      }
      // Sort Z descending (X-point at top → strike at bottom)
      inner.sort((a, b) => b[1] - a[1])
      outer.sort((a, b) => b[1] - a[1])

      const xPt: [number, number] = [xpointR, xpointZ]
      if (inner.length >= 2) {
        inner.unshift(xPt)
        allLegs.push(truncateAtWall(inner, limiterPts))
      }
      if (outer.length >= 2) {
        outer.unshift(xPt)
        allLegs.push(truncateAtWall(outer, limiterPts))
      }
    }
  }

  // Upper divertor legs
  if (xpointUpperR > 0) {
    const upperDivPts = sepPts.filter(p => p[1] > xpointUpperZ + 0.05)
    if (upperDivPts.length >= 2) {
      const inner: [number, number][] = []
      const outer: [number, number][] = []
      for (const pt of upperDivPts) {
        if (pt[0] < xpointUpperR - 0.01) inner.push(pt)
        else if (pt[0] > xpointUpperR + 0.01) outer.push(pt)
      }
      // Sort Z ascending (X-point at bottom → strike at top)
      inner.sort((a, b) => a[1] - b[1])
      outer.sort((a, b) => a[1] - b[1])

      const xPt: [number, number] = [xpointUpperR, xpointUpperZ]
      if (inner.length >= 2) {
        inner.unshift(xPt)
        allLegs.push(truncateAtWall(inner, limiterPts))
      }
      if (outer.length >= 2) {
        outer.unshift(xPt)
        allLegs.push(truncateAtWall(outer, limiterPts))
      }
    }
  }

  if (allLegs.length === 0) return

  // Render all legs as line segments
  const nSlices = SEP_LINE_SLICES
  const phiMin = cfg.plasmaPhiMin
  const phiMax = cfg.plasmaPhiMax

  // Use average R of all leg points for path-length calculation
  let rSum = 0, rCount = 0
  for (const leg of allLegs) {
    for (const [R] of leg) { rSum += R; rCount++ }
  }
  const rGeo = rCount > 0 ? rSum / rCount : params.axisR

  const pathFactors = computePathFactors(cfg, rGeo, nSlices, phiMin, phiMax)
  const depthFades = computeDepthFades(cfg, rGeo, nSlices, phiMin, phiMax)

  const opacity = params.opacity

  // Count total vertices and indices across all legs
  let totalPts = 0
  for (const leg of allLegs) totalPts += leg.length

  const totalVerts = nSlices * totalPts
  const positions = new Float32Array(totalVerts * 3)
  const vertColors = new Float32Array(totalVerts * 3)
  const indices: number[] = []

  let vi = 0
  for (let si = 0; si < nSlices; si++) {
    const phi = phiMin + (si / (nSlices - 1)) * (phiMax - phiMin)
    const brightness = LEG_INTENSITY * pathFactors[si] * depthFades[si] * opacity

    for (const leg of allLegs) {
      const legBase = vi
      for (let pi = 0; pi < leg.length; pi++) {
        const v = toroidal(leg[pi][0], leg[pi][1], phi)
        positions[vi * 3] = v.x
        positions[vi * 3 + 1] = v.y
        positions[vi * 3 + 2] = v.z
        vertColors[vi * 3] = color.r * brightness
        vertColors[vi * 3 + 1] = color.g * brightness
        vertColors[vi * 3 + 2] = color.b * brightness
        vi++
      }

      // Line segments for open path: (0,1), (1,2), ..., (N-2,N-1)
      for (let pi = 0; pi < leg.length - 1; pi++) {
        indices.push(legBase + pi, legBase + pi + 1)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, vi * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(vertColors.slice(0, vi * 3), 3))
  geometry.setIndex(indices)

  const lines = new THREE.LineSegments(geometry, material)
  lines.renderOrder = 1
  lines.frustumCulled = false
  group.add(lines)
}
