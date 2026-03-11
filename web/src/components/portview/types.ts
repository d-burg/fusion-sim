/** Shared types for the WebGL port view renderer. */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface PortConfig {
  portR: number
  portZ: number
  portRadius: number
  portLength: number
  portPhi: number
  camR: number
  camZ: number
  camPhi: number
  lookR: number
  lookZ: number
  lookPhi: number
  fov: number
  tileColor: [number, number, number]
  tileGridSpacing: { poloidal: number; toroidal: number }
  tileGridDarken: number
  phiMin: number
  phiMax: number
  plasmaPhiMin: number
  plasmaPhiMax: number
  nWallSlices: number
  nPlasmaSlices: number
  tileRegions?: {
    inboardGridSpacing: { poloidal: number; toroidal: number }
    limiterGridSpacing: { poloidal: number; toroidal: number }
    limiterZThreshold: number
  }
  extraPorts?: { r: number; z: number; phi: number; radius: number }[]
  antennae?: { r: number; zMin: number; zMax: number; phiMin: number; phiMax: number }[]
  fresnelStrength?: number
  inboardStyle?: 'tiles' | 'bands'
  bandWidth?: number
  divertorRegion?: {
    zThreshold: number
    tileColor: [number, number, number]
    gridSpacing: { poloidal: number; toroidal: number }
  }
}

/** Wall region classification for per-region rendering. */
export const enum WallRegion {
  Outboard = 0,
  Inboard = 1,
  Limiter = 2,
  ExtraPort = 3,
  Antenna = 4,
  Divertor = 5,
}

/** Toroidal coordinate conversion: (R, Z, phi) → cartesian (x, y, z). */
export function toroidal(R: number, Z: number, phi: number): Vec3 {
  return { x: R * Math.cos(phi), y: R * Math.sin(phi), z: Z }
}

/**
 * Densify a closed (R,Z) contour by interpolating points where consecutive
 * points are more than maxGap apart.
 */
export function densifyContour(pts: [number, number][], maxGap: number): [number, number][] {
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

export function subsample(pts: [number, number][], maxPts: number): [number, number][] {
  if (pts.length <= maxPts) return pts
  const step = pts.length / maxPts
  const out: [number, number][] = []
  for (let i = 0; i < maxPts; i++) {
    out.push(pts[Math.floor(i * step)])
  }
  return out
}

/**
 * Split a concatenated point array into separate chains by detecting
 * large jumps between consecutive points.
 *
 * The Rust contour extractor concatenates multiple chains (main LCFS loop
 * + divertor legs) into a single flat array with no markers. This function
 * detects the discontinuities and returns individual chains.
 *
 * Uses an adaptive threshold based on the median consecutive-point spacing.
 * This automatically scales with device size (DIII-D grid ~0.02m vs
 * ITER grid ~0.08m) so the same function works for all tokamaks.
 *
 * @param jumpMultiplier - multiplier on median spacing to determine the
 *   chain break threshold. Default 5.0 cleanly separates real chain
 *   boundaries (which are 10-50× the typical spacing) from normal
 *   contour curvature variations.
 */
export function splitChains(
  pts: [number, number][],
  jumpMultiplier = 5.0,
): [number, number][][] {
  if (pts.length < 2) return pts.length > 0 ? [pts] : []

  // Compute all consecutive distances
  const dists: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const dR = pts[i][0] - pts[i - 1][0]
    const dZ = pts[i][1] - pts[i - 1][1]
    dists.push(Math.sqrt(dR * dR + dZ * dZ))
  }

  // Adaptive threshold: jumpMultiplier × median spacing
  // Median is robust to outliers (the actual chain breaks)
  const sorted = [...dists].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const jumpThreshold = Math.max(median * jumpMultiplier, 0.05)

  const chains: [number, number][][] = []
  let current: [number, number][] = [pts[0]]

  for (let i = 0; i < dists.length; i++) {
    if (dists[i] > jumpThreshold) {
      // Large jump → start a new chain
      if (current.length >= 3) chains.push(current)
      current = [pts[i + 1]]
    } else {
      current.push(pts[i + 1])
    }
  }
  if (current.length >= 3) chains.push(current)

  // Sort by length descending — longest chain (main LCFS) first
  chains.sort((a, b) => b.length - a.length)
  return chains
}

/**
 * Truncate a polyline at its first intersection with a closed wall polygon.
 */
export function truncateAtWall(
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
      const truncated = path.slice(0, i + 1)
      truncated.push(bestPt)
      return truncated
    }
  }
  return path
}
