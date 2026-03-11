import * as THREE from 'three'
import type { Contour } from '../../lib/types'
import type { PortConfig } from './types'
import { toroidal, truncateAtWall, subsample, splitChains, densifyContour } from './types'

// ── Separatrix: mesh-based volumetric rendering ──
// The separatrix is rendered as multiple thin toroidal mesh shells with
// per-vertex Fresnel brightness. Face-on views are nearly transparent;
// edge-on (tangential) sight lines accumulate brightness through additive
// blending, creating a misty, limb-brightened boundary layer.
// Bloom post-processing then creates the soft glow halo.
//
// PERFORMANCE: Geometry is pre-allocated once and reused across frames.
// A contour fingerprint detects when the equilibrium changes; if unchanged,
// only the color buffer is updated (cheap per-vertex multiply).  This
// eliminates ~700 MB/sec of transient Float32Array allocation and all
// per-frame geometry.dispose() / new Mesh() overhead.

// Toroidal mesh resolution — enough slices so individual quads aren't visible.
// Must cover the full torus (±π), so we need more slices than the old ±1.4 range.
const SEP_MESH_SLICES = 240

// Poloidal resolution (max contour points per shell) — high enough that
// polygon edges are invisible even on the limb.
const SEP_CONTOUR_PTS = 200

// Shell offsets (meters along contour normal).
// 6 shells with wider spacing gives a broader misty boundary.
// Fewer shells reduces face-on accumulation artifacts.
const SHELL_OFFSETS = [
  -0.025, -0.012, -0.003,
   0.003,  0.012,  0.025,
]

// Fresnel exponent: controls edge-on brightening shape.
// Lower values give a wider, mistier limb. Higher values make it thinner.
// 2.0 creates a broad misty glow that fades gradually from limb to face.
const FRESNEL_EXPONENT = 2.0

// Base intensity per shell fragment.
// With 6 shells × additive blending, tangential views accumulate
// ~30-60 overlapping fragments → bright misty limb + bloom.
const SEP_BASE_INTENSITY = 0.10

// ELM flash parameters
const ELM_FLASH_MULT = 5.0
const ELM_WHITE_SHIFT = 0.3

/** GLSL-style smoothstep: Hermite interpolation clamped to [0,1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// ── Divertor legs: mesh-based volumetric rendering (same approach as separatrix) ──
// Fewer toroidal slices than the separatrix since legs are small features.
const LEG_MESH_SLICES = 120
// Max poloidal points per leg after densify + subsample
const LEG_CONTOUR_MAX = 25
// Narrower shell offsets than separatrix — legs are thinner ribbon-like features
const LEG_SHELL_OFFSETS = [-0.015, -0.006, 0.006, 0.015]
const N_LEG_SHELLS = LEG_SHELL_OFFSETS.length
const LEG_FRESNEL_EXPONENT = 2.0
const LEG_BASE_INTENSITY = 0.12

export interface PlasmaGroup {
  group: THREE.Group
  sepMaterial: THREE.MeshBasicMaterial
  legMaterial: THREE.MeshBasicMaterial
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

// ═══════════════════════════════════════════════════════════════════
// Pre-allocated buffer sizes
// ═══════════════════════════════════════════════════════════════════

const N_SHELLS = SHELL_OFFSETS.length
const SEP_MAX_VERTS = N_SHELLS * SEP_MESH_SLICES * SEP_CONTOUR_PTS
// Each shell: (nSlices-1) × nQuadsPol × 6 indices (2 triangles × 3 verts)
// nQuadsPol can be up to nPts (closed contour)
const SEP_MAX_INDICES = N_SHELLS * (SEP_MESH_SLICES - 1) * SEP_CONTOUR_PTS * 6

// Divertor legs: generous upper bound (4 legs × 25 pts × 4 shells × 120 slices)
const LEG_MAX_VERTS = 200_000
const LEG_MAX_INDICES = 400_000

// ═══════════════════════════════════════════════════════════════════
// Contour fingerprint for change detection
// ═══════════════════════════════════════════════════════════════════

/**
 * Lightweight fingerprint of the separatrix contour.
 * Samples 5 sentinel points + count + mode + X-point coordinates.
 * If this string matches, the contour hasn't changed meaningfully.
 */
function contourFingerprint(
  sepPts: [number, number][],
  inHmode: boolean,
  xpR: number,
  xpZ: number,
  xpUR: number,
  xpUZ: number,
): string {
  const n = sepPts.length
  if (n === 0) return ''
  const s = [0, n >> 2, n >> 1, (3 * n) >> 2, n - 1]
  let fp = `${n}:${inHmode ? 1 : 0}:${xpR.toFixed(4)}:${xpZ.toFixed(4)}:${xpUR.toFixed(4)}:${xpUZ.toFixed(4)}`
  for (const i of s) {
    fp += `:${sepPts[i][0].toFixed(4)},${sepPts[i][1].toFixed(4)}`
  }
  return fp
}

// ═══════════════════════════════════════════════════════════════════
// Helper functions (unchanged from original)
// ═══════════════════════════════════════════════════════════════════

/**
 * Laplacian smooth a contour to eliminate jagged polygon edges.
 * Each point is averaged with its neighbours, preserving overall shape
 * but removing high-frequency kinks.  Handles both open and closed contours.
 */
function smoothContour(pts: [number, number][], iterations: number): [number, number][] {
  if (pts.length < 3) return pts

  // Detect closed contour
  const d = Math.sqrt(
    (pts[0][0] - pts[pts.length - 1][0]) ** 2 +
    (pts[0][1] - pts[pts.length - 1][1]) ** 2,
  )
  let avgSpacing = 0
  for (let i = 1; i < pts.length; i++) {
    avgSpacing += Math.sqrt(
      (pts[i][0] - pts[i - 1][0]) ** 2 +
      (pts[i][1] - pts[i - 1][1]) ** 2,
    )
  }
  avgSpacing /= pts.length - 1
  const closed = d < avgSpacing * 3

  let current = pts
  for (let iter = 0; iter < iterations; iter++) {
    const n = current.length
    const next: [number, number][] = new Array(n)
    for (let i = 0; i < n; i++) {
      const prev = closed ? (i - 1 + n) % n : Math.max(0, i - 1)
      const nxt = closed ? (i + 1) % n : Math.min(n - 1, i + 1)
      // Weighted: 50% self + 25% each neighbour
      next[i] = [
        0.5 * current[i][0] + 0.25 * current[prev][0] + 0.25 * current[nxt][0],
        0.5 * current[i][1] + 0.25 * current[prev][1] + 0.25 * current[nxt][1],
      ]
    }
    current = next
  }
  return current
}

/**
 * Compute toroidal path-length factor for each slice.
 * Face-on slices (nearest camera) → short path → dim.
 * Tangential slices (toroidal limbs) → long path → bright.
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

    const dx = rGeo * cosPhi - cfg.camR
    const dy = rGeo * sinPhi
    const dist = Math.sqrt(dx * dx + dy * dy)

    const faceOn = Math.abs(rGeo - cfg.camR * cosPhi)
    const pf = faceOn > 0.01 ? dist / faceOn : 10.0
    factors[s] = pf
    if (pf < minFactor) minFactor = pf
  }

  for (let s = 0; s < nSlices; s++) {
    factors[s] = Math.min(factors[s] / minFactor, 4.0)
  }

  return factors
}

/**
 * Compute depth fade per slice — nearer slices brighter.
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
    const depthFrac = 1 - (depths[s] - minDepth) / range
    fades[s] = 0.85 + depthFrac * 0.15
  }

  return fades
}

// ═══════════════════════════════════════════════════════════════════
// Separatrix geometry rebuild (called only when contour changes)
// ═══════════════════════════════════════════════════════════════════

/**
 * Rebuild separatrix positions and per-vertex baseBrightness into
 * pre-allocated buffers.  Returns the active vertex/index counts.
 */
function rebuildSepGeometry(
  cfg: PortConfig,
  sepPts: [number, number][],
  camPos: THREE.Vector3,
  positions: Float32Array,
  baseBright: Float32Array,
  indices: Uint32Array,
): { vertCount: number; idxCount: number } {
  const chains = splitChains(sepPts)
  if (chains.length === 0) return { vertCount: 0, idxCount: 0 }

  // Densify, subsample, smooth — the expensive contour pipeline
  const densified = densifyContour(chains[0], 0.02)
  const sampled = subsample(densified, SEP_CONTOUR_PTS)
  const mainLoop = smoothContour(sampled, 3)
  const nPts = mainLoop.length
  if (nPts < 4) return { vertCount: 0, idxCount: 0 }

  // Check if the main loop is closed (first ≈ last point)
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

  // Compute contour normals (perpendicular to tangent in R-Z plane)
  const cNormals: [number, number][] = []
  for (let i = 0; i < nPts; i++) {
    const prev = isClosed ? (i - 1 + nPts) % nPts : Math.max(0, i - 1)
    const next = isClosed ? (i + 1) % nPts : Math.min(nPts - 1, i + 1)
    const dR = mainLoop[next][0] - mainLoop[prev][0]
    const dZ = mainLoop[next][1] - mainLoop[prev][1]
    const len = Math.sqrt(dR * dR + dZ * dZ) || 1
    cNormals.push([-dZ / len, dR / len])
  }

  const nSlices = SEP_MESH_SLICES
  const phiMin = cfg.phiMin
  const phiMax = cfg.phiMax

  // Per-slice depth fades
  let rMin = Infinity, rMax = -Infinity
  for (const [R] of mainLoop) {
    if (R < rMin) rMin = R
    if (R > rMax) rMax = R
  }
  const rGeo = (rMin + rMax) / 2
  const depthFades = computeDepthFades(cfg, rGeo, nSlices, phiMin, phiMax)

  const nQuadsPol = isClosed ? nPts : nPts - 1
  const phiStep = (phiMax - phiMin) / (nSlices - 1)

  let vi = 0
  let ii = 0

  for (let sh = 0; sh < N_SHELLS; sh++) {
    const shellBase = sh * nSlices * nPts
    const offset = SHELL_OFFSETS[sh]
    // Golden-ratio-based stagger so no two shells align
    const phiStagger = phiStep * ((sh * 0.618) % 1.0)

    // Offset contour along normals to create shell
    const shellPts: [number, number][] = mainLoop.map((pt, i) => [
      pt[0] + offset * cNormals[i][0],
      pt[1] + offset * cNormals[i][1],
    ])

    for (let si = 0; si < nSlices; si++) {
      const phi = phiMin + (si / (nSlices - 1)) * (phiMax - phiMin) + phiStagger
      const cosPhi = Math.cos(phi)
      const sinPhi = Math.sin(phi)
      const dFade = depthFades[si]

      for (let pi = 0; pi < nPts; pi++) {
        const R = shellPts[pi][0]
        const Z = shellPts[pi][1]

        // 3D position (toroidal coordinates)
        const px = R * cosPhi
        const py = R * sinPhi
        const pz = Z
        positions[vi * 3] = px
        positions[vi * 3 + 1] = py
        positions[vi * 3 + 2] = pz

        // Surface normal = cross(poloidalTangent, toroidalTangent)
        const prev = isClosed ? (pi - 1 + nPts) % nPts : Math.max(0, pi - 1)
        const next = isClosed ? (pi + 1) % nPts : Math.min(nPts - 1, pi + 1)
        const dR = shellPts[next][0] - shellPts[prev][0]
        const dZ = shellPts[next][1] - shellPts[prev][1]

        let nx = -dZ * cosPhi
        let ny = -dZ * sinPhi
        let nz = dR
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
        if (nLen > 1e-10) { nx /= nLen; ny /= nLen; nz /= nLen }

        // View direction (camera → vertex)
        const vx = camPos.x - px
        const vy = camPos.y - py
        const vz = camPos.z - pz
        const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz)
        const NdotV = Math.abs((nx * vx + ny * vy + nz * vz) / vLen)

        // Fresnel: transparent face-on (NdotV≈1), bright edge-on (NdotV≈0)
        let fresnel = Math.pow(Math.max(0, 1.0 - NdotV), FRESNEL_EXPONENT)
        fresnel *= smoothstep(0.08, 0.35, fresnel)

        // Cache geometry-dependent brightness (without opacity/ELM which change per-frame)
        baseBright[vi] = SEP_BASE_INTENSITY * fresnel * dFade

        vi++
      }
    }

    // Triangle indices for this shell's quad grid
    for (let si = 0; si < nSlices - 1; si++) {
      for (let pi = 0; pi < nQuadsPol; pi++) {
        const nextPi = (pi + 1) % nPts
        const a = shellBase + si * nPts + pi
        const b = shellBase + (si + 1) * nPts + pi
        const c = shellBase + (si + 1) * nPts + nextPi
        const d = shellBase + si * nPts + nextPi
        indices[ii++] = a
        indices[ii++] = b
        indices[ii++] = c
        indices[ii++] = a
        indices[ii++] = c
        indices[ii++] = d
      }
    }
  }

  return { vertCount: vi, idxCount: ii }
}

// ═══════════════════════════════════════════════════════════════════
// Divertor leg geometry rebuild
// ═══════════════════════════════════════════════════════════════════

/**
 * Densify an open contour (no wraparound from last→first).
 * Inserts intermediate points wherever adjacent spacing exceeds maxGap.
 */
function densifyOpen(pts: [number, number][], maxGap: number): [number, number][] {
  if (pts.length < 2) return pts
  const result: [number, number][] = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0]
    const dy = pts[i + 1][1] - pts[i][1]
    const d = Math.sqrt(dx * dx + dy * dy)
    const n = Math.ceil(d / maxGap)
    for (let j = 1; j < n; j++) {
      const t = j / n
      result.push([pts[i][0] + dx * t, pts[i][1] + dy * t])
    }
    result.push(pts[i + 1])
  }
  return result
}

/**
 * Rebuild divertor leg mesh positions and per-vertex baseBrightness into
 * pre-allocated buffers.  Uses the same volumetric shell + Fresnel approach
 * as the separatrix for a smooth, misty appearance instead of discrete lines.
 * Returns the active vertex/index counts.
 */
function rebuildLegGeometry(
  cfg: PortConfig,
  params: PlasmaUpdateParams,
  camPos: THREE.Vector3,
  positions: Float32Array,
  baseBright: Float32Array,
  indices: Uint32Array,
): { vertCount: number; idxCount: number } {
  const { separatrix, xpointR, xpointZ, xpointUpperR, xpointUpperZ, limiterPts } = params
  const sepPts = separatrix.points
  if (sepPts.length < 4) return { vertCount: 0, idxCount: 0 }

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

  if (allLegs.length === 0) return { vertCount: 0, idxCount: 0 }

  const nSlices = LEG_MESH_SLICES
  const phiMin = cfg.phiMin
  const phiMax = cfg.phiMax

  // Average R for depth fade computation
  let rSum = 0, rCount = 0
  for (const leg of allLegs) {
    for (const [R] of leg) { rSum += R; rCount++ }
  }
  const rGeo = rCount > 0 ? rSum / rCount : params.axisR
  const depthFades = computeDepthFades(cfg, rGeo, nSlices, phiMin, phiMax)

  const phiStep = (phiMax - phiMin) / (nSlices - 1)

  let vi = 0
  let ii = 0

  for (const rawLeg of allLegs) {
    if (rawLeg.length < 2) continue

    // Densify for smooth quads (open contour — no wraparound)
    const densified = densifyOpen(rawLeg, 0.02)
    // Subsample to reasonable count
    const sampled = subsample(densified, LEG_CONTOUR_MAX)
    // Smooth to eliminate jagged polygon edges
    const smoothed = smoothContour(sampled, 2)
    const nPts = smoothed.length
    if (nPts < 2) continue

    // Compute contour normals (perpendicular to tangent in R-Z plane)
    const cNormals: [number, number][] = []
    for (let i = 0; i < nPts; i++) {
      const prev = Math.max(0, i - 1)
      const next = Math.min(nPts - 1, i + 1)
      const dR = smoothed[next][0] - smoothed[prev][0]
      const dZ = smoothed[next][1] - smoothed[prev][1]
      const len = Math.sqrt(dR * dR + dZ * dZ) || 1
      cNormals.push([-dZ / len, dR / len])
    }

    const nQuadsPol = nPts - 1  // open contour

    for (let sh = 0; sh < N_LEG_SHELLS; sh++) {
      const shellBase = vi
      const offset = LEG_SHELL_OFFSETS[sh]
      // Golden-ratio-based stagger so no two shells align
      const phiStagger = phiStep * ((sh * 0.618) % 1.0)

      // Offset contour along normals to create shell
      const shellPts: [number, number][] = smoothed.map((pt, i) => [
        pt[0] + offset * cNormals[i][0],
        pt[1] + offset * cNormals[i][1],
      ])

      // Safety: don't exceed pre-allocated buffer
      if (vi + nSlices * nPts > LEG_MAX_VERTS) break

      for (let si = 0; si < nSlices; si++) {
        const phi = phiMin + (si / (nSlices - 1)) * (phiMax - phiMin) + phiStagger
        const cosPhi = Math.cos(phi)
        const sinPhi = Math.sin(phi)
        const dFade = depthFades[si]

        for (let pi = 0; pi < nPts; pi++) {
          const R = shellPts[pi][0]
          const Z = shellPts[pi][1]

          // 3D position (toroidal coordinates)
          const px = R * cosPhi
          const py = R * sinPhi
          const pz = Z
          positions[vi * 3] = px
          positions[vi * 3 + 1] = py
          positions[vi * 3 + 2] = pz

          // Surface normal = cross(poloidalTangent, toroidalTangent)
          const prev = Math.max(0, pi - 1)
          const next = Math.min(nPts - 1, pi + 1)
          const dR = shellPts[next][0] - shellPts[prev][0]
          const dZ = shellPts[next][1] - shellPts[prev][1]

          let nx = -dZ * cosPhi
          let ny = -dZ * sinPhi
          let nz = dR
          const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
          if (nLen > 1e-10) { nx /= nLen; ny /= nLen; nz /= nLen }

          // View direction (camera → vertex)
          const vx = camPos.x - px
          const vy = camPos.y - py
          const vz = camPos.z - pz
          const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz)
          const NdotV = Math.abs((nx * vx + ny * vy + nz * vz) / vLen)

          // Fresnel: transparent face-on (NdotV≈1), bright edge-on (NdotV≈0)
          let fresnel = Math.pow(Math.max(0, 1.0 - NdotV), LEG_FRESNEL_EXPONENT)
          fresnel *= smoothstep(0.08, 0.35, fresnel)

          // Cache geometry-dependent brightness (without opacity/ELM which change per-frame)
          baseBright[vi] = LEG_BASE_INTENSITY * fresnel * dFade

          vi++
        }
      }

      // Triangle indices for this shell's quad grid (open contour)
      for (let si = 0; si < nSlices - 1; si++) {
        for (let pi = 0; pi < nQuadsPol; pi++) {
          if (ii + 6 > LEG_MAX_INDICES) break
          const a = shellBase + si * nPts + pi
          const b = shellBase + (si + 1) * nPts + pi
          const c = shellBase + (si + 1) * nPts + pi + 1
          const d = shellBase + si * nPts + pi + 1
          indices[ii++] = a
          indices[ii++] = b
          indices[ii++] = c
          indices[ii++] = a
          indices[ii++] = c
          indices[ii++] = d
        }
      }
    }
  }

  return { vertCount: vi, idxCount: ii }
}

// ═══════════════════════════════════════════════════════════════════
// Main factory — pre-allocates all buffers and creates persistent
// Three.js objects.  The update() function is the hot path.
// ═══════════════════════════════════════════════════════════════════

/**
 * Create the plasma rendering group.
 * Separatrix: mesh-based volumetric shells with Fresnel limb brightening.
 * Divertor legs: mesh-based volumetric shells (same technique as separatrix).
 *
 * PERFORMANCE: All geometry is pre-allocated once.  The update() function
 * detects contour changes via fingerprinting and uses two code paths:
 * - Full rebuild (contour changed): recompute positions + baseBrightness
 * - Color-only (contour static): cheap per-vertex multiply
 */
export function createPlasmaGroup(cfg: PortConfig): PlasmaGroup {
  const group = new THREE.Group()
  group.renderOrder = 1

  // Separatrix material: mesh with additive blending for accumulation
  const sepMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

  // Divertor leg material: mesh with additive blending (same as separatrix)
  const legMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

  const baseColor = { r: 0.85, g: 0.20, b: 0.55 }   // fuchsia — ionized deuterium
  const legColor = { r: 0.90, g: 0.30, b: 0.60 }

  // Camera position (constant for a given device config)
  const camPos = new THREE.Vector3(
    cfg.camR * Math.cos(cfg.camPhi),
    cfg.camR * Math.sin(cfg.camPhi),
    cfg.camZ,
  )

  // ═══ PRE-ALLOCATED SEPARATRIX CACHE ═══
  const sepPositions = new Float32Array(SEP_MAX_VERTS * 3)
  const sepColors = new Float32Array(SEP_MAX_VERTS * 3)
  const sepBaseBright = new Float32Array(SEP_MAX_VERTS)
  const sepIdxBuf = new Uint32Array(SEP_MAX_INDICES)

  const sepGeom = new THREE.BufferGeometry()
  const sepPosAttr = new THREE.BufferAttribute(sepPositions, 3)
  sepPosAttr.setUsage(THREE.DynamicDrawUsage)
  const sepColAttr = new THREE.BufferAttribute(sepColors, 3)
  sepColAttr.setUsage(THREE.DynamicDrawUsage)
  const sepIdxAttr = new THREE.BufferAttribute(sepIdxBuf, 1)
  sepIdxAttr.setUsage(THREE.DynamicDrawUsage)
  sepGeom.setAttribute('position', sepPosAttr)
  sepGeom.setAttribute('color', sepColAttr)
  sepGeom.setIndex(sepIdxAttr)

  const sepMesh = new THREE.Mesh(sepGeom, sepMaterial)
  sepMesh.renderOrder = 1
  sepMesh.frustumCulled = false
  sepMesh.visible = false
  group.add(sepMesh)

  let sepVertCount = 0
  let sepIdxCount = 0
  let sepFP = ''

  // ═══ PRE-ALLOCATED DIVERTOR LEG CACHE ═══
  const legPositions = new Float32Array(LEG_MAX_VERTS * 3)
  const legColors = new Float32Array(LEG_MAX_VERTS * 3)
  const legBaseBright = new Float32Array(LEG_MAX_VERTS)
  const legIdxBuf = new Uint32Array(LEG_MAX_INDICES)

  const legGeom = new THREE.BufferGeometry()
  const legPosAttr = new THREE.BufferAttribute(legPositions, 3)
  legPosAttr.setUsage(THREE.DynamicDrawUsage)
  const legColAttr = new THREE.BufferAttribute(legColors, 3)
  legColAttr.setUsage(THREE.DynamicDrawUsage)
  const legIdxAttr = new THREE.BufferAttribute(legIdxBuf, 1)
  legIdxAttr.setUsage(THREE.DynamicDrawUsage)
  legGeom.setAttribute('position', legPosAttr)
  legGeom.setAttribute('color', legColAttr)
  legGeom.setIndex(legIdxAttr)

  const legMesh = new THREE.Mesh(legGeom, legMaterial)
  legMesh.renderOrder = 1
  legMesh.frustumCulled = false
  legMesh.visible = false
  group.add(legMesh)

  let legVertCount = 0
  let legIdxCount = 0
  let legFP = ''

  // ═══ UPDATE (hot path — called every frame) ═══
  const update = (params: PlasmaUpdateParams) => {
    const sepPts = params.separatrix.points
    if (sepPts.length < 4) {
      sepMesh.visible = false
      legMesh.visible = false
      return
    }

    // Plasma color from temperature — fuchsia (ionized deuterium) base
    const tempFrac = Math.min(params.te0 / 12, 1)
    baseColor.r = 0.75 + tempFrac * 0.15   // 0.75 → 0.90
    baseColor.g = 0.15 + tempFrac * 0.10   // 0.15 → 0.25
    baseColor.b = 0.45 + tempFrac * 0.15   // 0.45 → 0.60

    const elmMult = params.elmActive ? ELM_FLASH_MULT : 1.0
    const elmW = params.elmActive ? ELM_WHITE_SHIFT : 0.0
    const opacity = params.opacity

    // ── Separatrix ──
    const newFP = contourFingerprint(
      sepPts, params.inHmode,
      params.xpointR, params.xpointZ,
      params.xpointUpperR, params.xpointUpperZ,
    )

    if (newFP !== sepFP) {
      // FULL REBUILD: contour geometry changed
      const result = rebuildSepGeometry(
        cfg, sepPts, camPos,
        sepPositions, sepBaseBright, sepIdxBuf,
      )
      sepVertCount = result.vertCount
      sepIdxCount = result.idxCount
      sepFP = newFP
      sepPosAttr.needsUpdate = true
      sepIdxAttr.needsUpdate = true
    }

    // COLOR UPDATE (every frame — cheap per-vertex multiply)
    if (sepVertCount > 0) {
      const cr = (baseColor.r + elmW)
      const cg = (baseColor.g + elmW)
      const cb = (baseColor.b + elmW)
      const scale = opacity * elmMult

      for (let i = 0; i < sepVertCount; i++) {
        const b = sepBaseBright[i] * scale
        sepColors[i * 3] = cr * b
        sepColors[i * 3 + 1] = cg * b
        sepColors[i * 3 + 2] = cb * b
      }
      sepColAttr.needsUpdate = true
      sepGeom.setDrawRange(0, sepIdxCount)
      sepMesh.visible = true
    } else {
      sepMesh.visible = false
    }

    // ── Divertor legs ──
    if (params.inHmode) {
      // Legs share the same fingerprint (if contour changed, legs change too)
      if (newFP !== legFP) {
        const result = rebuildLegGeometry(
          cfg, params, camPos,
          legPositions, legBaseBright, legIdxBuf,
        )
        legVertCount = result.vertCount
        legIdxCount = result.idxCount
        legFP = newFP
        legPosAttr.needsUpdate = true
        legIdxAttr.needsUpdate = true
      }

      if (legVertCount > 0) {
        // Apply ELM flash to leg colors (same as separatrix)
        const lr = (legColor.r + elmW)
        const lg = (legColor.g + elmW)
        const lb = (legColor.b + elmW)
        const lScale = opacity * elmMult
        for (let i = 0; i < legVertCount; i++) {
          const b = legBaseBright[i] * lScale
          legColors[i * 3] = lr * b
          legColors[i * 3 + 1] = lg * b
          legColors[i * 3 + 2] = lb * b
        }
        legColAttr.needsUpdate = true
        legGeom.setDrawRange(0, legIdxCount)
        legMesh.visible = true
      } else {
        legMesh.visible = false
      }
    } else {
      legMesh.visible = false
    }
  }

  return { group, sepMaterial, legMaterial, update }
}
