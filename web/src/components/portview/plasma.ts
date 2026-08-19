import * as THREE from 'three'
import type { Contour } from '../../lib/types'
import type { PortConfig } from './types'
import { truncateAtWall, subsample, splitChains, densifyContour } from './types'

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

// ── ELM event parameters ──
// An ELM is an *event*, not a state: the elm_active rising edge triggers an
// envelope (fast attack, exponential decay) localized to the outboard
// midplane where ballooning modes erupt. The envelope drives two things on
// the existing translucent separatrix shells: a broad pedestal-emission
// brightening (the "thicker glowing edge") and a *continuous* helical stripe
// pattern painted per-vertex (field-aligned "barbershop-pole" filaments,
// pitch set by q95). No discrete sprites — continuous by construction.
// Timescales are stretched ~100× from the real sub-millisecond crash.
const ELM_PED_GAIN = 2.2       // broad pedestal-shell brightening at weight 1
const ELM_FIL_GAIN = 6.0       // extra brightness inside the helical filaments
const ELM_WHITE_SHIFT = 0.35   // color shift toward white (strongest in filaments)
// The envelope tracks the sim's elm_active flag directly so the visual stays
// in sync with the Dα trace: it rises fast while the ELM is on and collapses
// promptly when it ends, leaving nothing visible between ELMs.
const ELM_ATTACK = 0.02        // seconds to full brightness while active
const ELM_DECAY_TAU = 0.04     // brightness e-folding once elm_active clears
const ELM_TAIL = 0.15          // envelope forced to zero this long after turn-off
const ELM_STRIPE_COUNT = 11    // filaments around the poloidal cross-section
                               // (integer → continuous across the inboard seam)
// Edge toroidal rotation is tens of km/s — the filament pattern completes many
// turns per frame, so at display rate it reads as rapid flashes at different
// swirl phases rather than a smoothly rotating pattern. That temporal aliasing
// is the intended look (it is what a limited-frame-rate camera actually sees).
const ELM_STRIPE_SPEED = 2200.0  // rad/s
const ELM_FIL_WHITE = 0.65     // filament share of the white shift

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
  /** Animate time-based effects (ELM filaments) at display rate. */
  tick: (time: number) => void
}

export interface PlasmaUpdateParams {
  separatrix: Contour
  axisR: number
  axisZ: number
  xpointR: number
  xpointZ: number
  xpointUpperR: number
  xpointUpperZ: number
  inHmode: boolean
  elmActive: boolean
  te0: number
  /** Edge safety factor — sets the ELM filament field-line pitch */
  q95: number
  /** Energy lost by the last ELM crash (MJ) — scales the eruption */
  elmEnergyLoss?: number
  /** Greenwald density fraction — denser edge recycles/glows brighter */
  fGreenwald: number
  /** Core impurity fraction (carbon) — subtle blue-green tinge */
  impurityFraction: number
  /** Neon seeding rate (10²⁰/s) — shifts the edge glow orange-red */
  neonPuff: number
  /** Radiated power fraction p_rad/p_loss — a radiative edge emits more */
  pRadFrac: number
  opacity: number
  limiterPts: [number, number][]
  /** Scene clock (seconds) for event envelopes */
  time: number
}

// ═══════════════════════════════════════════════════════════════════
// Pre-allocated buffer sizes
// ═══════════════════════════════════════════════════════════════════

const N_SHELLS = SHELL_OFFSETS.length
// +32 headroom: the multi-chain budget split rounds each chain up to a
// 24-point minimum, so the summed point count can slightly exceed
// SEP_CONTOUR_PTS when the boundary arrives as several chains.
const SEP_MAX_VERTS = N_SHELLS * SEP_MESH_SLICES * (SEP_CONTOUR_PTS + 32)
// Each shell: (nSlices-1) × nQuadsPol × 6 indices (2 triangles × 3 verts)
// nQuadsPol can be up to nPts (closed contour)
const SEP_MAX_INDICES = N_SHELLS * (SEP_MESH_SLICES - 1) * (SEP_CONTOUR_PTS + 32) * 6

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
export function computePathFactors(
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
 * For negative triangularity (outboard X-points), the ψ=0 separatrix has
 * figure-eight topology with a bridge segment connecting the upper and lower
 * X-points on the outboard side.  This bridge is invisible for positive-δ
 * (hidden behind the center stack) but is glaringly visible for negative-δ.
 *
 * This function clips the bridge by finding the two contour points closest
 * to each X-point, breaking the loop, and keeping the longer arc (the actual
 * plasma-enclosing boundary) while discarding the shorter arc (the bridge).
 */
function clipOutboardBridge(
  pts: [number, number][],
  xpR: number, xpZ: number,
  xpUR: number, xpUZ: number,
  axisR: number,
): [number, number][] {
  // Only needed when both X-points are outboard of the magnetic axis
  if (xpR <= axisR || xpUR <= axisR) return pts
  if (xpR <= 0 || xpUR <= 0) return pts
  if (pts.length < 10) return pts

  // Find the contour points closest to each X-point
  let iLo = 0, iUp = 0
  let dLo = Infinity, dUp = Infinity
  for (let i = 0; i < pts.length; i++) {
    const [r, z] = pts[i]
    const dl = (r - xpR) ** 2 + (z - xpZ) ** 2
    const du = (r - xpUR) ** 2 + (z - xpUZ) ** 2
    if (dl < dLo) { dLo = dl; iLo = i }
    if (du < dUp) { dUp = du; iUp = i }
  }

  // Need two distinct break points
  if (Math.abs(iLo - iUp) < 3) return pts

  // Two arcs between the X-points
  const i1 = Math.min(iLo, iUp)
  const i2 = Math.max(iLo, iUp)
  const arc1 = pts.slice(i1, i2 + 1)
  const arc2 = [...pts.slice(i2), ...pts.slice(0, i1 + 1)]

  // The plasma-enclosing arc passes through the inboard side (R < axisR);
  // the bridge arc stays on the outboard side.  Pick the arc whose minimum
  // R is smaller — that's the one going around the plasma through the
  // high-field side.
  const minR1 = Math.min(...arc1.map(p => p[0]))
  const minR2 = Math.min(...arc2.map(p => p[0]))
  return minR1 < minR2 ? arc1 : arc2
}

/**
 * Rebuild separatrix positions, per-vertex baseBrightness, and per-vertex
 * ELM weight (outboard-midplane localization) into pre-allocated buffers.
 * Returns the active vertex/index counts plus the processed boundary contour
 * and its normals (consumed by the ELM filament system).
 */
function rebuildSepGeometry(
  cfg: PortConfig,
  sepPts: [number, number][],
  camPos: THREE.Vector3,
  positions: Float32Array,
  baseBright: Float32Array,
  elmWeight: Float32Array,
  vertPhi: Float32Array,
  vertPolAngle: Float32Array,
  indices: Uint32Array,
  xpR = 0, xpZ = 0, xpUR = 0, xpUZ = 0, axisR = 0, axisZ = 0,
  inHmode = false,
): { vertCount: number; idxCount: number; contour: [number, number][]; normals: [number, number][] } {
  const empty = { vertCount: 0, idxCount: 0, contour: [] as [number, number][], normals: [] as [number, number][] }
  // H-mode pedestal: the edge steepens into a transport barrier — tighten
  // the shell stack and sharpen the limb so the boundary reads as a crisp
  // skin; L-mode keeps the broad fuzzy profile. (inHmode is part of the
  // contour fingerprint, so the L-H transition triggers this rebuild.)
  const shellScale = inHmode ? 0.65 : 1.0
  const fresnelExp = inHmode ? 2.6 : FRESNEL_EXPONENT
  const allChains = splitChains(sepPts)
  if (allChains.length === 0) return empty

  // The double-null ψ_N=1 topology is sweep-phase dependent: at most phases
  // the boundary arrives as one closed loop (plus short leg chains), but at
  // the outboard sweep extreme marching squares emits it as TWO long open
  // arcs — the outboard arc (running strike point to strike point through
  // both outer legs) and the inboard arc (through both inner legs). Treating
  // chains[0] as closed then draws a phantom vertical chord bridging its two
  // strike-point ends across the whole vessel, and the inboard limb (all of
  // chains[1]) simply vanishes. So: render every long chain, each with its
  // own closure decided from its RAW endpoints — never assume closure.
  // Short chains (< 60 pts — bare divertor legs) are left to the dedicated
  // leg mesh, as before.
  const chains = allChains.filter((c, i) => i === 0 || c.length >= 60).slice(0, 3)
  const totalRawPts = chains.reduce((s, c) => s + c.length, 0)

  const nSlices = SEP_MESH_SLICES
  const phiMin = cfg.phiMin
  const phiMax = cfg.phiMax
  const phiStep = (phiMax - phiMin) / (nSlices - 1)

  let vi = 0
  let ii = 0
  let mainContour: [number, number][] = []
  let mainNormals: [number, number][] = []

  for (let ci = 0; ci < chains.length; ci++) {
    const rawChain = chains[ci]
    // For negative triangularity: clip the outboard bridge from the main chain
    const clipped = ci === 0
      ? clipOutboardBridge(rawChain, xpR, xpZ, xpUR, xpUZ, axisR)
      : rawChain
    if (clipped.length < 4) continue

    // Closure from the RAW endpoints: a genuinely closed loop ends within a
    // grid cell of its start; open arcs end at wall strike points, 0.5–3 m
    // apart. This must be decided before densification — densifying an open
    // arc as closed is what painted the bridge.
    const endGap = Math.sqrt(
      (clipped[0][0] - clipped[clipped.length - 1][0]) ** 2 +
      (clipped[0][1] - clipped[clipped.length - 1][1]) ** 2,
    )
    const isClosed = endGap < 0.12

    // Densify, subsample (proportional share of the point budget), smooth
    const densified = isClosed ? densifyContour(clipped, 0.02) : densifyOpen(clipped, 0.02)
    const budget = Math.max(24, Math.round(SEP_CONTOUR_PTS * rawChain.length / totalRawPts))
    const sampled = subsample(densified, budget)
    const loop = smoothContour(sampled, 3)
    const nPts = loop.length
    if (nPts < 4) continue

    // Compute contour normals (perpendicular to tangent in R-Z plane)
    const cNormals: [number, number][] = []
    for (let i = 0; i < nPts; i++) {
      const prev = isClosed ? (i - 1 + nPts) % nPts : Math.max(0, i - 1)
      const next = isClosed ? (i + 1) % nPts : Math.min(nPts - 1, i + 1)
      const dR = loop[next][0] - loop[prev][0]
      const dZ = loop[next][1] - loop[prev][1]
      const len = Math.sqrt(dR * dR + dZ * dZ) || 1
      cNormals.push([-dZ / len, dR / len])
    }
    if (ci === 0) {
      mainContour = loop
      mainNormals = cNormals
    }

    // Per-slice depth fades from this chain's radial extent
    let rMin = Infinity, rMax = -Infinity
    for (const [R] of loop) {
      if (R < rMin) rMin = R
      if (R > rMax) rMax = R
    }
    const rGeo = (rMin + rMax) / 2
    const depthFades = computeDepthFades(cfg, rGeo, nSlices, phiMin, phiMax)

    const nQuadsPol = isClosed ? nPts : nPts - 1

    for (let sh = 0; sh < N_SHELLS; sh++) {
      const shellBase = vi
      const offset = SHELL_OFFSETS[sh] * shellScale
      // Golden-ratio-based stagger so no two shells align
      const phiStagger = phiStep * ((sh * 0.618) % 1.0)

      // Offset contour along normals to create shell
      const shellPts: [number, number][] = loop.map((pt, i) => [
        pt[0] + offset * cNormals[i][0],
        pt[1] + offset * cNormals[i][1],
      ])

      // Safety: don't exceed the pre-allocated buffers
      if (vi + nSlices * nPts > SEP_MAX_VERTS) break

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
          let fresnel = Math.pow(Math.max(0, 1.0 - NdotV), fresnelExp)
          fresnel *= smoothstep(0.08, 0.35, fresnel)

          // Cache geometry-dependent brightness (without opacity/ELM which change per-frame)
          baseBright[vi] = SEP_BASE_INTENSITY * fresnel * dFade

          // ELM localization weight: strongest at the outboard midplane
          // (ballooning-unstable side), fading toward the inboard/top/bottom.
          const outb = Math.max(0, Math.min(1, (R - axisR) / Math.max(rMax - axisR, 0.2)))
          const zg = Math.exp(-((Z - axisZ) * (Z - axisZ)) / 0.72)  // σ ≈ 0.6 m
          elmWeight[vi] = 0.25 + 0.75 * outb * zg

          // Toroidal + poloidal parametrization for the ELM helical stripes.
          // Poloidal angle is measured around the magnetic axis; with an integer
          // stripe count it stays continuous across the inboard branch cut.
          vertPhi[vi] = phi
          vertPolAngle[vi] = Math.atan2(Z - axisZ, R - axisR)

          vi++
        }
      }

      // Triangle indices for this shell's quad grid
      for (let si = 0; si < nSlices - 1; si++) {
        for (let pi = 0; pi < nQuadsPol; pi++) {
          if (ii + 6 > SEP_MAX_INDICES) break
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
  }

  if (vi === 0) return empty
  return { vertCount: vi, idxCount: ii, contour: mainContour, normals: mainNormals }
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
  const sepElmWeight = new Float32Array(SEP_MAX_VERTS)
  const sepVertPhi = new Float32Array(SEP_MAX_VERTS)
  const sepVertPolAngle = new Float32Array(SEP_MAX_VERTS)
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

  // ═══ ELM EVENT ENVELOPE ═══
  // Driven directly by the sim's elm_active flag so the visual is in sync
  // with the Dα trace rather than free-running on its own timer.
  let elmActiveNow = false
  let elmOnT0 = -Infinity   // animation-clock time elm_active went true
  let elmOffT0 = -Infinity  // ... and when it went false
  let elmOffLevel = 0       // envelope value captured at turn-off
  let elmAmp = 0            // per-event amplitude from elm_energy_loss
  let lastParams: PlasmaUpdateParams | null = null

  /** Fast rise while the ELM is on, prompt collapse once it clears. */
  const elmEnvelope = (time: number): number => {
    if (elmActiveNow) {
      return Math.min(Math.max(time - elmOnT0, 0) / ELM_ATTACK, 1)
    }
    const dt = time - elmOffT0
    if (dt < 0 || dt > ELM_TAIL) return 0
    return elmOffLevel * Math.exp(-dt / ELM_DECAY_TAU)
  }

  // ═══ COLOR APPLICATION ═══
  // Per-vertex color write for the separatrix shells and divertor legs.
  // Split out from update() so it can also run every frame from tick()
  // while an ELM envelope is alive, animating the barbershop stripes at
  // display rate.  Cheap (a multiply, plus one cos during ELMs) per vertex.
  const applyColors = (time: number) => {
    const p = lastParams
    if (!p || sepVertCount === 0) { sepMesh.visible = false; legMesh.visible = false; return }

    // Plasma color from temperature — fuchsia (ionized deuterium) base
    const tempFrac = Math.min(p.te0 / 12, 1)
    let cr = 0.75 + tempFrac * 0.15
    let cg = 0.15 + tempFrac * 0.10
    let cb = 0.45 + tempFrac * 0.15
    // Impurity tints: carbon pulls faintly blue-green; neon seeding pulls
    // the edge glow orange-red (its strongest visible lines are red).
    const imp = Math.min(Math.max(p.impurityFraction, 0) * 20, 1)
    const neon = Math.min(Math.max(p.neonPuff, 0) / 2, 1)
    cr += neon * 0.08 - imp * 0.04
    cg += imp * 0.06
    cb -= neon * 0.12 - imp * 0.02
    // Edge emission scales with density (recycling light) and radiated
    // power fraction (a radiative edge is a brighter edge).
    const fGW = Math.min(Math.max(p.fGreenwald, 0), 1.2)
    const emission = (0.6 + 0.55 * fGW) * (1 + Math.min(Math.max(p.pRadFrac, 0), 1) * 0.4)
    const scale = p.opacity * emission
    const elmEnv = elmEnvelope(time) * elmAmp

    // ── Separatrix shells ──
    if (elmEnv > 0.001) {
      // Field-aligned helical stripes: bright filaments at constant
      // (N·θ − N/q·φ), winding tighter at low q95, slowly rotating. The
      // broad pedestal term brightens the whole edge; the stripe term adds
      // the barbershop filaments on top, localized to the outboard midplane.
      const pitch = Math.min(Math.max(Math.abs(p.q95), 2), 8)
      const kPhi = ELM_STRIPE_COUNT / pitch
      const drift = time * ELM_STRIPE_SPEED
      for (let i = 0; i < sepVertCount; i++) {
        const w = sepElmWeight[i] * elmEnv
        const phase = ELM_STRIPE_COUNT * sepVertPolAngle[i] - kPhi * sepVertPhi[i] - drift
        let s = Math.cos(phase)
        s = s > 0 ? s * s * s : 0   // sharpen to narrow bright filaments
        const b = sepBaseBright[i] * scale * (1 + ELM_PED_GAIN * w + ELM_FIL_GAIN * s * w)
        const shift = ELM_WHITE_SHIFT * w * ((1 - ELM_FIL_WHITE) + ELM_FIL_WHITE * s)
        sepColors[i * 3] = (cr + shift) * b
        sepColors[i * 3 + 1] = (cg + shift) * b
        sepColors[i * 3 + 2] = (cb + shift) * b
      }
    } else {
      for (let i = 0; i < sepVertCount; i++) {
        const b = sepBaseBright[i] * scale
        sepColors[i * 3] = cr * b
        sepColors[i * 3 + 1] = cg * b
        sepColors[i * 3 + 2] = cb * b
      }
    }
    sepColAttr.needsUpdate = true
    sepGeom.setDrawRange(0, sepIdxCount)
    sepMesh.visible = true

    // ── Divertor legs ──
    // The particle burst arrives at the divertor: uniform brightening along
    // the legs (no stripes), slightly weaker than the midplane flash.
    if (legVertCount > 0) {
      const legEnv = elmEnv * 0.7
      const lr = legColor.r + ELM_WHITE_SHIFT * legEnv
      const lg = legColor.g + ELM_WHITE_SHIFT * legEnv
      const lb = legColor.b + ELM_WHITE_SHIFT * legEnv
      const lScale = scale * (1 + ELM_PED_GAIN * legEnv)
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
  }

  // ═══ UPDATE (called on each sim snapshot) ═══
  const update = (params: PlasmaUpdateParams) => {
    const sepPts = params.separatrix.points
    if (sepPts.length < 4) {
      sepMesh.visible = false
      legMesh.visible = false
      lastParams = null
      return
    }

    // ── ELM event: follow the elm_active flag's edges ──
    if (params.elmActive && !elmActiveNow) {
      elmOnT0 = params.time
      // Scale the eruption with the crash energy (MJ): DIII-D-size ELMs
      // (~30 kJ) ≈ 1.0, JET/ITER-size crashes saturate at 1.6.
      const loss = Math.max(params.elmEnergyLoss ?? 0, 0)
      elmAmp = Math.min(0.6 + Math.sqrt(loss) * 2.5, 1.6)
    } else if (!params.elmActive && elmActiveNow) {
      // Capture where the envelope had got to, and decay from there
      elmOffLevel = Math.min(Math.max(params.time - elmOnT0, 0) / ELM_ATTACK, 1)
      elmOffT0 = params.time
    }
    elmActiveNow = params.elmActive
    lastParams = params

    // ── Separatrix geometry (rebuilt only when the contour changes) ──
    const newFP = contourFingerprint(
      sepPts, params.inHmode,
      params.xpointR, params.xpointZ,
      params.xpointUpperR, params.xpointUpperZ,
    )

    if (newFP !== sepFP) {
      const result = rebuildSepGeometry(
        cfg, sepPts, camPos,
        sepPositions, sepBaseBright, sepElmWeight, sepVertPhi, sepVertPolAngle, sepIdxBuf,
        params.xpointR, params.xpointZ, params.xpointUpperR, params.xpointUpperZ,
        params.axisR, params.axisZ, params.inHmode,
      )
      sepVertCount = result.vertCount
      sepIdxCount = result.idxCount
      sepFP = newFP
      sepPosAttr.needsUpdate = true
      sepIdxAttr.needsUpdate = true

      // Legs share the same fingerprint (if contour changed, legs change too)
      const legResult = rebuildLegGeometry(
        cfg, params, camPos,
        legPositions, legBaseBright, legIdxBuf,
      )
      legVertCount = legResult.vertCount
      legIdxCount = legResult.idxCount
      legPosAttr.needsUpdate = true
      legIdxAttr.needsUpdate = true
    }

    applyColors(params.time)
  }

  // ═══ TICK (display-rate animation between sim snapshots) ═══
  const tick = (time: number) => {
    // Re-run the per-vertex color write only while an ELM envelope is alive,
    // so the swirling filaments animate; the plasma is otherwise static
    // between sim ticks and needs no per-frame work.
    if (!lastParams) return
    if (elmActiveNow || time - elmOffT0 <= ELM_TAIL) applyColors(time)
  }

  return { group, sepMaterial, legMaterial, update, tick }
}
