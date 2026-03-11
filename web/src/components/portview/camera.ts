import * as THREE from 'three'
import type { PortConfig } from './types'
import { toroidal } from './types'

/**
 * Create a PerspectiveCamera from port configuration.
 * Uses Z-up coordinate system matching the tokamak convention.
 */
export function createCamera(cfg: PortConfig, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(cfg.fov, aspect, 0.01, 50)
  camera.up.set(0, 0, 1) // Z-up

  const pos = toroidal(cfg.camR, cfg.camZ, cfg.camPhi)
  camera.position.set(pos.x, pos.y, pos.z)

  const look = toroidal(cfg.lookR, cfg.lookZ, cfg.lookPhi)
  camera.lookAt(look.x, look.y, look.z)

  return camera
}

/**
 * Update camera position and aspect when config or viewport changes.
 */
export function updateCamera(camera: THREE.PerspectiveCamera, cfg: PortConfig, aspect: number): void {
  camera.fov = cfg.fov
  camera.aspect = aspect
  camera.up.set(0, 0, 1)

  const pos = toroidal(cfg.camR, cfg.camZ, cfg.camPhi)
  camera.position.set(pos.x, pos.y, pos.z)

  const look = toroidal(cfg.lookR, cfg.lookZ, cfg.lookPhi)
  camera.lookAt(look.x, look.y, look.z)

  camera.updateProjectionMatrix()
}
