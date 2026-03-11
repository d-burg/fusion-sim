import * as THREE from 'three'
import type { PortConfig } from './types'
import { WallRegion, toroidal, densifyContour } from './types'

export interface WallMeshData {
  geometry: THREE.BufferGeometry
  /** Per-quad region classification for shader use. */
  regions: Float32Array
}

/**
 * Build wall mesh from limiter contour × toroidal slices.
 * Produces an indexed BufferGeometry with custom attributes for
 * the tile shader (UVs, normals, region, tileHash).
 */
export function buildWallGeometry(
  limiterPts: [number, number][],
  cfg: PortConfig,
  axisR: number,
): WallMeshData {
  // Densify contour for smooth quads
  const pts = densifyContour(limiterPts, 0.08)
  const nPts = pts.length
  const nSlices = cfg.nWallSlices

  const phiMin = cfg.phiMin
  const phiMax = cfg.phiMax
  const phiRange = phiMax - phiMin

  // Compute poloidal arc lengths for UV mapping
  const arcLengths = new Float64Array(nPts + 1)
  arcLengths[0] = 0
  for (let i = 1; i <= nPts; i++) {
    const prev = pts[(i - 1) % nPts]
    const curr = pts[i % nPts]
    const dR = curr[0] - prev[0]
    const dZ = curr[1] - prev[1]
    arcLengths[i] = arcLengths[i - 1] + Math.sqrt(dR * dR + dZ * dZ)
  }
  const totalArc = arcLengths[nPts]

  // Port hole test helper — only removes tiles near the correct R.
  // Uses a small margin (1.15×) beyond the port radius to remove quads
  // whose centers are just outside the port boundary but whose extent
  // partially overlaps the viewport (prevents tile occlusion at edges).
  const portMargin = 1.15
  const portTest = (R: number, Z: number, phi: number): boolean => {
    // Main port — must be near the outboard wall (portR)
    if (Math.abs(R - cfg.portR) < cfg.portRadius * 1.5) {
      const dz = Z - cfg.portZ
      const dp = phi - cfg.portPhi
      if (Math.sqrt(dz * dz + dp * dp * R * R) < cfg.portRadius * portMargin) return true
    }
    // Extra ports
    if (cfg.extraPorts) {
      for (const ep of cfg.extraPorts) {
        if (Math.abs(R - ep.r) < ep.radius * 1.5) {
          const edz = Z - ep.z
          const edp = phi - ep.phi
          if (Math.sqrt(edz * edz + edp * edp * ep.r * ep.r) < ep.radius) return true
        }
      }
    }
    return false
  }

  // Region classification
  const classifyRegion = (R: number, Z: number, phi: number): WallRegion => {
    // Antenna regions — must also check R to avoid classifying center stack
    // quads in the same Z/phi range as outboard antennae
    if (cfg.antennae) {
      for (const ant of cfg.antennae) {
        if (Math.abs(R - ant.r) < ant.r * 0.15 &&
            Z >= ant.zMin && Z <= ant.zMax &&
            phi >= ant.phiMin && phi <= ant.phiMax) {
          return WallRegion.Antenna
        }
      }
    }
    // Divertor region
    if (cfg.divertorRegion && Z < cfg.divertorRegion.zThreshold) {
      return WallRegion.Divertor
    }
    // Limiter (top/bottom)
    if (cfg.tileRegions && Math.abs(Z) > cfg.tileRegions.limiterZThreshold) {
      return WallRegion.Limiter
    }
    // Inboard
    if (R < axisR * 0.85) {
      return WallRegion.Inboard
    }
    return WallRegion.Outboard
  }

  // Count valid quads (non-port-hole)
  const quads: {
    pi: number; si: number
    r00: number; z00: number; phi0: number
    r10: number; z10: number; phi1: number
    r01: number; z01: number
    r11: number; z11: number
    region: WallRegion
    arcU: number; arcV: number
  }[] = []

  for (let si = 0; si < nSlices; si++) {
    const phi0 = phiMin + (si / nSlices) * phiRange
    const phi1 = phiMin + ((si + 1) / nSlices) * phiRange
    const phiMid = (phi0 + phi1) * 0.5

    for (let pi = 0; pi < nPts; pi++) {
      const ni = (pi + 1) % nPts
      const [r0, z0] = pts[pi]
      const [r1, z1] = pts[ni]
      const rMid = (r0 + r1) * 0.5
      const zMid = (z0 + z1) * 0.5

      // Skip port holes
      if (portTest(rMid, zMid, phiMid)) continue

      const region = classifyRegion(rMid, zMid, phiMid)
      const arcU = (arcLengths[pi] + arcLengths[pi + 1]) * 0.5 / totalArc
      const arcV = (si + 0.5) / nSlices

      quads.push({
        pi, si,
        r00: r0, z00: z0, phi0,
        r10: r1, z10: z1, phi1,
        r01: r0, z01: z0,
        r11: r1, z11: z1,
        region,
        arcU, arcV,
      })
    }
  }

  const nQuads = quads.length
  const nVerts = nQuads * 4
  const nIndices = nQuads * 6

  const positions = new Float32Array(nVerts * 3)
  const normals = new Float32Array(nVerts * 3)
  const uvs = new Float32Array(nVerts * 2)
  const regions = new Float32Array(nVerts)
  const tileHashes = new Float32Array(nVerts)
  const indices = new Uint32Array(nIndices)

  for (let q = 0; q < nQuads; q++) {
    const quad = quads[q]
    const base = q * 4

    // Four corners: (r0,z0,phi0), (r1,z1,phi0), (r1,z1,phi1), (r0,z0,phi1)
    const v0 = toroidal(quad.r00, quad.z00, quad.phi0)
    const v1 = toroidal(quad.r10, quad.z10, quad.phi0)
    const v2 = toroidal(quad.r11, quad.z11, quad.phi1)
    const v3 = toroidal(quad.r01, quad.z01, quad.phi1)

    // Positions
    positions[base * 3 + 0] = v0.x; positions[base * 3 + 1] = v0.y; positions[base * 3 + 2] = v0.z
    positions[base * 3 + 3] = v1.x; positions[base * 3 + 4] = v1.y; positions[base * 3 + 5] = v1.z
    positions[base * 3 + 6] = v2.x; positions[base * 3 + 7] = v2.y; positions[base * 3 + 8] = v2.z
    positions[base * 3 + 9] = v3.x; positions[base * 3 + 10] = v3.y; positions[base * 3 + 11] = v3.z

    // Normal from cross product of quad diagonals
    const d1x = v2.x - v0.x, d1y = v2.y - v0.y, d1z = v2.z - v0.z
    const d2x = v3.x - v1.x, d2y = v3.y - v1.y, d2z = v3.z - v1.z
    let nx = d1y * d2z - d1z * d2y
    let ny = d1z * d2x - d1x * d2z
    let nz = d1x * d2y - d1y * d2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= len; ny /= len; nz /= len

    // Ensure normal points inward (toward the magnetic axis)
    const cx = (v0.x + v1.x + v2.x + v3.x) * 0.25
    const cy = (v0.y + v1.y + v2.y + v3.y) * 0.25
    const rMid = Math.sqrt(cx * cx + cy * cy)
    const inwardX = cx * (axisR / rMid - 1)
    const inwardY = cy * (axisR / rMid - 1)
    if (nx * inwardX + ny * inwardY < 0) {
      nx = -nx; ny = -ny; nz = -nz
    }

    for (let i = 0; i < 4; i++) {
      normals[(base + i) * 3 + 0] = nx
      normals[(base + i) * 3 + 1] = ny
      normals[(base + i) * 3 + 2] = nz
    }

    // UVs: poloidal arc (u) × toroidal position (v)
    const polU0 = arcLengths[quad.pi] / totalArc
    const polU1 = arcLengths[quad.pi + 1] / totalArc
    const torV0 = (quad.phi0 - phiMin) / phiRange
    const torV1 = (quad.phi1 - phiMin) / phiRange

    uvs[base * 2 + 0] = polU0; uvs[base * 2 + 1] = torV0
    uvs[base * 2 + 2] = polU1; uvs[base * 2 + 3] = torV0
    uvs[base * 2 + 4] = polU1; uvs[base * 2 + 5] = torV1
    uvs[base * 2 + 6] = polU0; uvs[base * 2 + 7] = torV1

    // Per-tile hash for brightness variation
    const cellP = Math.floor(polU0 * totalArc / getGridSpacing(quad.region, cfg).poloidal)
    const cellT = Math.floor(torV0 * nSlices)
    const hash = ((cellP * 7919 + cellT * 104729) & 0xFFFF) / 65536

    for (let i = 0; i < 4; i++) {
      regions[base + i] = quad.region
      tileHashes[base + i] = hash
    }

    // Indices: two triangles per quad
    const idx = q * 6
    indices[idx + 0] = base + 0
    indices[idx + 1] = base + 1
    indices[idx + 2] = base + 2
    indices[idx + 3] = base + 0
    indices[idx + 4] = base + 2
    indices[idx + 5] = base + 3
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('a_region', new THREE.BufferAttribute(regions, 1))
  geometry.setAttribute('a_tileHash', new THREE.BufferAttribute(tileHashes, 1))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))

  return { geometry, regions }
}

function getGridSpacing(region: WallRegion, cfg: PortConfig): { poloidal: number; toroidal: number } {
  if (region === WallRegion.Inboard && cfg.tileRegions) return cfg.tileRegions.inboardGridSpacing
  if (region === WallRegion.Limiter && cfg.tileRegions) return cfg.tileRegions.limiterGridSpacing
  if (region === WallRegion.Divertor && cfg.divertorRegion) return cfg.divertorRegion.gridSpacing
  return cfg.tileGridSpacing
}

/**
 * Build the port cylinder geometry (the tube the camera looks through).
 */
export function buildPortGeometry(cfg: PortConfig): THREE.BufferGeometry {
  const nRings = 8
  const nSegments = 24
  const nVerts = nRings * nSegments
  const nQuads = (nRings - 1) * nSegments

  const positions = new Float32Array(nVerts * 3)
  const normals = new Float32Array(nVerts * 3)
  const uvs = new Float32Array(nVerts * 2)
  const indices = new Uint32Array(nQuads * 6)

  for (let ri = 0; ri < nRings; ri++) {
    const t = ri / (nRings - 1)
    const ringR = cfg.portR + t * cfg.portLength
    for (let si = 0; si < nSegments; si++) {
      const angle = (si / nSegments) * Math.PI * 2
      const localZ = Math.cos(angle) * cfg.portRadius
      const localPhi = Math.sin(angle) * cfg.portRadius / ringR

      const v = toroidal(ringR, cfg.portZ + localZ, cfg.portPhi + localPhi)
      const idx = ri * nSegments + si
      positions[idx * 3] = v.x
      positions[idx * 3 + 1] = v.y
      positions[idx * 3 + 2] = v.z

      // Normal points inward (toward cylinder axis)
      normals[idx * 3] = -Math.cos(cfg.portPhi + localPhi) * Math.cos(angle)
      normals[idx * 3 + 1] = -Math.sin(cfg.portPhi + localPhi) * Math.cos(angle)
      normals[idx * 3 + 2] = -Math.sin(angle)

      uvs[idx * 2] = si / nSegments
      uvs[idx * 2 + 1] = t
    }
  }

  let triIdx = 0
  for (let ri = 0; ri < nRings - 1; ri++) {
    for (let si = 0; si < nSegments; si++) {
      const ns = (si + 1) % nSegments
      const a = ri * nSegments + si
      const b = ri * nSegments + ns
      const c = (ri + 1) * nSegments + ns
      const d = (ri + 1) * nSegments + si
      indices[triIdx++] = a; indices[triIdx++] = b; indices[triIdx++] = c
      indices[triIdx++] = a; indices[triIdx++] = c; indices[triIdx++] = d
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))

  return geometry
}
