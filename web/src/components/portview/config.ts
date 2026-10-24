import type { PortConfig } from './types'

function defaultPortConfig(r0: number, a: number): PortConfig {
  const portR = r0 + a * 0.95
  const portLength = a * 0.25
  const fov = 80
  const portRadius = Math.tan((fov / 2) * Math.PI / 180) * portLength * 1.4
  return {
    portR, portZ: 0, portRadius, portLength, portPhi: 0,
    camR: portR + portLength, camZ: 0.04, camPhi: 0,
    lookR: r0 * 0.65, lookZ: -0.02, lookPhi: 0.25, fov,
    tileColor: [32, 32, 34],
    tileGridSpacing: { poloidal: 0.12, toroidal: 0.10 },
    tileGridDarken: 0.25,
    phiMin: -Math.PI, phiMax: Math.PI,
    plasmaPhiMin: -1.40, plasmaPhiMax: 1.40,
    nWallSlices: 100, nPlasmaSlices: 40,
  }
}

const PORT_CONFIGS: Record<string, PortConfig> = {
  diiid: {
    portR: 2.35, portZ: 0, portRadius: 0.42, portLength: 0.25, portPhi: 0,
    camR: 2.60, camZ: 0.04, camPhi: 0,
    lookR: 1.10, lookZ: -0.02, lookPhi: 0.28, fov: 80,
    tileColor: [26, 26, 30],
    tileGridSpacing: { poloidal: 0.10, toroidal: 0.10 },
    tileGridDarken: 0.30,
    phiMin: -Math.PI, phiMax: Math.PI,
    plasmaPhiMin: -1.40, plasmaPhiMax: 1.40,
    nWallSlices: 100, nPlasmaSlices: 40,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.10, toroidal: 0.10 },
      limiterGridSpacing: { poloidal: 0.10, toroidal: 0.20 },
      limiterZThreshold: 0.80,
    },
    extraPorts: (() => {
      // DIII-D realistic port arrangement: 3 densely cluttered toroidal bands.
      // DIII-D has ~24 toroidal sectors — one of the most heavily diagnosed tokamaks.
      // Midplane: wide rectangular ports + RF antenna housings, densely packed
      // Upper/lower (±55°): vertically-oriented racetracks + circles, 20 each
      type Port = { theta: number; phi: number; radius: number; zRadius?: number;
        shape?: 'circle' | 'square' | 'stadium'; toroidalExtent?: number; texture?: 'dark' | 'rf' }
      const ports: Port[] = []

      // ── Midplane band (theta ≈ -5°, shifted down slightly): dense tall rectangles ──
      // All ports have similar large heights; some are very long toroidally.
      const nMid = 16
      const dphiMid = (2 * Math.PI) / nMid
      for (let k = 0; k < nMid; k++) {
        const phi = k * dphiMid
        // Alternate RF emitters and dark NBI/diagnostic ports
        const tex = (k % 3 === 0) ? 'rf' as const : 'dark' as const
        if (k % 4 === 0) {
          // Very long toroidal RF antenna housing
          ports.push({ theta: -5, phi, radius: 0.28, zRadius: 0.24, shape: 'square', texture: 'rf' })
        } else if (k % 4 === 2) {
          // Long toroidal diagnostic port
          ports.push({ theta: -5, phi, radius: 0.22, zRadius: 0.22, shape: 'square', texture: tex })
        } else {
          // Standard tall rectangle — alternate
          ports.push({ theta: -5, phi, radius: 0.16, zRadius: 0.22, shape: 'square', texture: tex })
        }
      }

      // ── Upper band (theta ≈ 45°, shifted down from 55°) ──
      const nUL = 20
      const dphiUL = (2 * Math.PI) / nUL
      for (let k = 0; k < nUL; k++) {
        const phi = k * dphiUL
        if (k % 3 === 0) {
          ports.push({ theta: 45, phi, radius: 0.11, zRadius: 0.11, shape: 'stadium', toroidalExtent: 0.06 })
        } else if (k % 3 === 1) {
          ports.push({ theta: 45, phi, radius: 0.14, shape: 'circle' })
        } else {
          ports.push({ theta: 45, phi, radius: 0.09, zRadius: 0.09, shape: 'stadium', toroidalExtent: 0.05 })
        }
      }

      // ── Lower band (theta ≈ -45°, shifted up from -55°) ──
      for (let k = 0; k < nUL; k++) {
        const phi = (k + 0.5) * dphiUL
        if (k % 3 === 0) {
          ports.push({ theta: -50, phi, radius: 0.11, zRadius: 0.11, shape: 'stadium', toroidalExtent: 0.06 })
        } else if (k % 3 === 1) {
          ports.push({ theta: -50, phi, radius: 0.14, shape: 'circle' })
        } else {
          ports.push({ theta: -50, phi, radius: 0.09, zRadius: 0.09, shape: 'stadium', toroidalExtent: 0.05 })
        }
      }

      return ports
    })(),
    antennae: [
      { r: 2.35, zMin: -0.28, zMax: 0.28, phiMin: 0.55, phiMax: 0.72 },   // ICRH
      { r: 2.35, zMin: -0.12, zMax: 0.12, phiMin: -0.60, phiMax: -0.48 },  // LHRF
      { r: 2.35, zMin: -0.18, zMax: 0.18, phiMin: -0.92, phiMax: -0.80 },  // ECH launcher
    ],
    fresnelStrength: 0.30,
    boltHoleScale: 0.55,
    boltHoleScaleInboard: 0,   // smooth centre column
  },
  centaur: {
    portR: 2.73, portZ: 0, portRadius: 0.42, portLength: 0.22, portPhi: 0,
    camR: 2.95, camZ: 0.04, camPhi: 0,
    lookR: 1.30, lookZ: -0.02, lookPhi: 0.26, fov: 80,
    tileColor: [22, 22, 26],
    tileGridSpacing: { poloidal: 0.10, toroidal: 0.10 },
    tileGridDarken: 0.28,
    phiMin: -Math.PI, phiMax: Math.PI,
    plasmaPhiMin: -1.40, plasmaPhiMax: 1.40,
    nWallSlices: 100, nPlasmaSlices: 40,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.10, toroidal: 0.10 },
      limiterGridSpacing: { poloidal: 0.10, toroidal: 0.18 },
      limiterZThreshold: 1.0,
    },
    extraPorts: (() => {
      // CENTAUR: compact HTS tokamak — densely packed rounded-rectangle ports.
      // Many diagnostic ports above/below midplane, big rounded rectangles at midplane.
      type Port = { theta: number; phi: number; radius: number; zRadius?: number;
        shape?: 'circle' | 'square' | 'stadium'; toroidalExtent?: number; texture?: 'dark' | 'rf' }
      const ports: Port[] = []

      // ── Midplane: wide rectangular ports, alternating RF and dark ──
      // Shifted 15° toroidally to offset from upper/lower bands
      const nMid = 12
      const dphiMid = (2 * Math.PI) / nMid
      const phiOffset = Math.PI / 12  // 15° toroidal shift
      for (let k = 0; k < nMid; k++) {
        const phi = k * dphiMid + phiOffset
        const tex = (k % 2 === 0) ? 'rf' as const : 'dark' as const
        ports.push({ theta: 0, phi, radius: 0.30, zRadius: 0.28, shape: 'square', texture: tex })
      }

      // ── Upper band (theta ≈ 50°): dense rounded rectangles ──
      const nUL = 24
      const dphiUL = (2 * Math.PI) / nUL
      for (let k = 0; k < nUL; k++) {
        const phi = k * dphiUL
        ports.push({ theta: 50, phi, radius: 0.10, zRadius: 0.10, shape: 'stadium', toroidalExtent: 0.06 })
      }

      // ── Lower band (theta ≈ -50°): same, offset ──
      for (let k = 0; k < nUL; k++) {
        const phi = (k + 0.5) * dphiUL
        ports.push({ theta: -50, phi, radius: 0.10, zRadius: 0.10, shape: 'stadium', toroidalExtent: 0.06 })
      }

      return ports
    })(),
    antennae: [
      // ICRF antenna — large Faraday screen panel on outboard midplane
      { r: 2.73, zMin: -0.35, zMax: 0.35, phiMin: 0.50, phiMax: 0.70 },
      { r: 2.73, zMin: -0.35, zMax: 0.35, phiMin: -0.70, phiMax: -0.50 },
    ],
    fresnelStrength: 0.22,
    boltHoleScale: 0,          // smooth tiles throughout — no fasteners
    divertorRegion: {
      zThreshold: -1.2,
      tileColor: [20, 18, 16],
      gridSpacing: { poloidal: 0.08, toroidal: 0.08 },
    },
  },
  iter: {
    portR: 8.30, portZ: 0, portRadius: 0.60, portLength: 0.35, portPhi: 0,
    camR: 8.65, camZ: 0.06, camPhi: 0,
    lookR: 4.00, lookZ: -0.03, lookPhi: 0.22, fov: 80,
    tileColor: [38, 36, 32],
    tileGridSpacing: { poloidal: 0.15, toroidal: 0.12 },
    tileGridDarken: 0.15,
    phiMin: -Math.PI, phiMax: Math.PI,
    plasmaPhiMin: -1.40, plasmaPhiMax: 1.40,
    nWallSlices: 100, nPlasmaSlices: 40,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.18, toroidal: 0.18 },
      limiterGridSpacing: { poloidal: 0.15, toroidal: 0.30 },
      limiterZThreshold: 2.5,
    },
    extraPorts: (() => {
      // ITER: 18 equatorial ports at 20° intervals — large rectangular openings.
      // ITER has fewer but much larger ports than smaller tokamaks.
      type Port = { theta: number; phi: number; radius: number; zRadius?: number;
        shape?: 'circle' | 'square' | 'stadium'; toroidalExtent?: number; texture?: 'dark' | 'rf' }
      const ports: Port[] = []
      const nPorts = 18
      const dphi = (2 * Math.PI) / nPorts
      for (let k = 0; k < nPorts; k++) {
        const phi = k * dphi
        // Alternate RF (ICRH/ECRH launchers) and dark (diagnostic/NBI) ports
        const tex = (k % 3 === 0) ? 'rf' as const : 'dark' as const
        ports.push({ theta: 0, phi, radius: 0.55, zRadius: 0.70, shape: 'square', texture: tex })
      }
      return ports
    })(),
    antennae: [
      { r: 8.30, zMin: -0.8, zMax: 0.8, phiMin: 0.35, phiMax: 0.55 },
    ],
    fresnelStrength: 0.20,
  },
  sparc: {
    portR: 2.10, portZ: 0, portRadius: 0.35, portLength: 0.20, portPhi: 0,
    camR: 2.30, camZ: 0.04, camPhi: 0,
    lookR: 1.10, lookZ: -0.02, lookPhi: 0.28, fov: 80,
    tileColor: [36, 34, 30],
    tileGridSpacing: { poloidal: 0.08, toroidal: 0.07 },
    tileGridDarken: 0.16,
    phiMin: -Math.PI, phiMax: Math.PI,
    plasmaPhiMin: -1.40, plasmaPhiMax: 1.40,
    nWallSlices: 100, nPlasmaSlices: 40,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.08, toroidal: 0.08 },
      limiterGridSpacing: { poloidal: 0.08, toroidal: 0.14 },
      limiterZThreshold: 0.55,
    },
    extraPorts: (() => {
      const ports: { theta: number; phi: number; radius: number }[] = []
      const nSectors = 10
      for (let k = 0; k < nSectors; k++) {
        const phi = (k / nSectors) * 2 * Math.PI
        ports.push({ theta:  25, phi, radius: 0.07 })
        ports.push({ theta:  55, phi, radius: 0.06 })
        ports.push({ theta: -25, phi, radius: 0.07 })
        ports.push({ theta: -55, phi, radius: 0.06 })
      }
      return ports
    })(),
    fresnelStrength: 0.18,
  },
  jet: {
    portR: 3.80, portZ: 0, portRadius: 0.50, portLength: 0.30, portPhi: 0,
    camR: 4.10, camZ: 0.06, camPhi: 0,
    lookR: 2.00, lookZ: -0.03, lookPhi: 0.25, fov: 80,
    tileColor: [32, 30, 28],
    tileGridSpacing: { poloidal: 0.12, toroidal: 0.10 },
    tileGridDarken: 0.15,
    phiMin: -Math.PI, phiMax: Math.PI,
    plasmaPhiMin: -1.40, plasmaPhiMax: 1.40,
    nWallSlices: 100, nPlasmaSlices: 40,
    tileRegions: {
      inboardGridSpacing: { poloidal: 0.12, toroidal: 0.12 },
      limiterGridSpacing: { poloidal: 0.12, toroidal: 0.22 },
      limiterZThreshold: 1.2,
    },
    extraPorts: (() => {
      // JET: large rectangular outboard midplane ports — octant structure.
      // JET has 8 octants with very large access ports, densely spaced.
      // No circular viewports — all rectangular patches.
      type Port = { theta: number; phi: number; radius: number; zRadius?: number;
        shape?: 'circle' | 'square' | 'stadium'; toroidalExtent?: number; texture?: 'dark' | 'rf' }
      const ports: Port[] = []
      const nPorts = 16
      const dphi = (2 * Math.PI) / nPorts
      for (let k = 0; k < nPorts; k++) {
        const phi = k * dphi
        // Skip ports near the camera viewport (k=0 at viewport, k=1/k=2 right,
        // k=15 left) to avoid occluding the view into the vessel interior
        if (k === 0 || k === 1 || k === 2 || k === 15) continue
        // JET outboard midplane: mostly all RF ridges (Faraday screens)
        // Very tall — JET's ICRH antennas span most of the outboard midplane height
        if (k % 2 === 0) {
          ports.push({ theta: 0, phi, radius: 0.55, zRadius: 1.10, shape: 'square', texture: 'rf' })
        } else {
          ports.push({ theta: 0, phi, radius: 0.45, zRadius: 0.95, shape: 'square', texture: 'rf' })
        }
      }
      return ports
    })(),
    antennae: [
      // JET A2 ICRH antenna modules — 4 large Faraday screen panels
      { r: 3.80, zMin: -0.55, zMax: 0.55, phiMin: 0.30, phiMax: 0.52 },
      { r: 3.80, zMin: -0.55, zMax: 0.55, phiMin: 0.66, phiMax: 0.88 },
      { r: 3.80, zMin: -0.55, zMax: 0.55, phiMin: -0.52, phiMax: -0.30 },
      { r: 3.80, zMin: -0.55, zMax: 0.55, phiMin: -0.88, phiMax: -0.66 },
    ],
    fresnelStrength: 0.25,
    inboardStyle: 'bands',
    bandWidth: 0.16,   // centre-stack lamella height (was 0.06 — read too fine)
    // JET octant panel banding — 8 octants around the torus.
    // The toroidal grid spacing is 0.10m, and the wall has 100 slices
    // over 2π. Band width is the toroidal arc per octant: 2π*R0/8 ≈ 2.24m
    // but in grid-space coordinates: 100 slices × 0.10m / 8 ≈ 1.25m
    vertBandWidth: 0.35,
    vertBandContrast: 0.55,
    divertorRegion: {
      zThreshold: -1.0,
      tileColor: [18, 16, 14],
      gridSpacing: { poloidal: 0.08, toroidal: 0.08 },
    },
  },
}

export function getPortConfig(deviceId?: string, r0?: number, a?: number): PortConfig {
  if (deviceId && PORT_CONFIGS[deviceId]) return PORT_CONFIGS[deviceId]
  return defaultPortConfig(r0 ?? 1.7, a ?? 0.6)
}

// Per-machine separatrix opacity tuning
// DIII-D visible, JET/ITER nearly invisible except during ELMs
export const DEVICE_OPACITY_SCALE: Record<string, number> = {
  diiid: 0.08,
  centaur: 0.06,
  iter: 0.012,
  sparc: 0.10,
  jet: 0.10,
}
export const DEFAULT_OPACITY_SCALE = 0.10

// Per-machine power scaling for strike point glow.
// Hierarchy: ITER (highest heat flux) > CENTAUR > JET > DIII-D (most subtle)
export const DEVICE_POWER_SCALE: Record<string, number> = {
  diiid: 0.02,     // barely perceptible — low-power research tokamak
  centaur: 3.0,    // dazzling — high-field D-T breakeven, intense divertor load
  iter: 5.0,       // most dazzling — 500 MW fusion, extreme divertor heat flux
  sparc: 0.8,
  jet: 1.5,        // moderate — 29 MW heating, visible but not dramatic
}
export const DEFAULT_POWER_SCALE = 0.5

// ═══ Per-device glow tuning ═══
export interface GlowTuning {
  color: { r: number; g: number; b: number }
  flickerDepth: number      // 0 = uniform, 1 = full range
  pointSize: number         // sprite size in world units
}

export const DEVICE_GLOW_TUNING: Record<string, GlowTuning> = {
  // DIII-D: barely perceptible — faintest hint of warm glow
  diiid: {
    color: { r: 1.0, g: 0.45, b: 0.15 },      // warm orange
    flickerDepth: 0.05,
    pointSize: 0.08,
  },
  // CENTAUR: dazzling — 30 MW ICRH into compact NT plasma, intense divertor load
  centaur: {
    color: { r: 1.0, g: 0.25, b: 0.06 },       // deep reddish orange (D-T)
    flickerDepth: 0.40,
    pointSize: 0.40,
  },
  // ITER: most dazzling — 500 MW fusion power, extreme divertor heat flux
  iter: {
    color: { r: 1.0, g: 0.18, b: 0.05 },       // deep red
    flickerDepth: 0.55,
    pointSize: 0.75,
  },
  // SPARC: moderate
  sparc: {
    color: { r: 1.0, g: 0.35, b: 0.10 },       // reddish orange
    flickerDepth: 0.30,
    pointSize: 0.28,
  },
  // JET: moderate — visible but less intense than ITER/CENTAUR
  jet: {
    color: { r: 1.0, g: 0.22, b: 0.06 },       // deep red
    flickerDepth: 0.25,
    pointSize: 0.35,
  },
}

export const DEFAULT_GLOW_TUNING: GlowTuning = {
  color: { r: 1.0, g: 0.45, b: 0.15 },
  flickerDepth: 0.35,
  pointSize: 0.30,
}

// Rendering constants
export const STRIKE_FADE_RATE = 0.5
export const LEG_FADE_RATE = 0.4
