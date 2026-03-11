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
    tileColor: [58, 58, 62],
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
    extraPorts: [
      { r: 2.35, z: 0.42, phi: 0.18, radius: 0.09 },
      { r: 2.35, z: -0.48, phi: -0.12, radius: 0.08 },
      { r: 2.35, z: 0.12, phi: -0.32, radius: 0.07 },
      { r: 2.35, z: -0.15, phi: 0.42, radius: 0.06 },
    ],
    antennae: [
      { r: 2.35, zMin: -0.28, zMax: 0.28, phiMin: 0.55, phiMax: 0.72 },
      { r: 2.35, zMin: -0.12, zMax: 0.12, phiMin: -0.60, phiMax: -0.48 },
    ],
    fresnelStrength: 0.55,
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
    extraPorts: [
      { r: 2.10, z: 0.30, phi: 0.15, radius: 0.06 },
      { r: 2.10, z: -0.25, phi: -0.20, radius: 0.05 },
    ],
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

export function getPortConfig(deviceId?: string, r0?: number, a?: number): PortConfig {
  if (deviceId && PORT_CONFIGS[deviceId]) return PORT_CONFIGS[deviceId]
  return defaultPortConfig(r0 ?? 1.7, a ?? 0.6)
}

// Per-machine opacity tuning
export const DEVICE_OPACITY_SCALE: Record<string, number> = {
  diiid: 0.08,
  iter: 0.04,
  sparc: 0.10,
  jet: 0.06,
}
export const DEFAULT_OPACITY_SCALE = 0.10

// Per-machine power scaling for strike point glow
export const DEVICE_POWER_SCALE: Record<string, number> = {
  diiid: 0.6,
  iter: 1.8,
  sparc: 0.8,
  jet: 1.3,
}
export const DEFAULT_POWER_SCALE = 0.5

// Rendering constants
export const STRIKE_FADE_RATE = 0.5
export const LEG_FADE_RATE = 0.4
