import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import type { Snapshot } from '../../lib/types'
import { getPortConfig, DEVICE_OPACITY_SCALE, DEFAULT_OPACITY_SCALE, DEVICE_POWER_SCALE, DEFAULT_POWER_SCALE, DEVICE_GLOW_TUNING, DEFAULT_GLOW_TUNING } from './config'
import { createCamera, updateCamera } from './camera'
import { buildWallGeometry, buildPortGeometry } from './geometry'
import { createWallMaterial, createPortMaterial, updateStrikePoints } from './wallMaterial'
import { createPlasmaGroup } from './plasma'
import { createGlowGroup, findStrikePoints, type StrikePoint } from './glow'
import { createPostProcessing } from './postprocessing'
import { toroidal } from './types'

interface Props {
  snapshot: Snapshot | null
  limiterPoints?: [number, number][]
  deviceId?: string
  wallJson?: string
  deviceR0?: number
  deviceA?: number
}

interface SceneState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  wallMesh: THREE.Mesh | null
  portMesh: THREE.Mesh | null
  wallMaterial: THREE.ShaderMaterial | null
  plasmaGroup: ReturnType<typeof createPlasmaGroup> | null
  glowGroup: ReturnType<typeof createGlowGroup> | null
  postProcessing: ReturnType<typeof createPostProcessing> | null
  animFrameId: number
  lastDeviceId: string | null
  lastWallJson: string | null
  clock: THREE.Clock
}

export default function PortView({ snapshot, limiterPoints, deviceId, wallJson, deviceR0, deviceA }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const glowIntensityRef = useRef(0)
  const frozenStrikePointsRef = useRef<StrikePoint[]>([])

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.85
    renderer.setClearColor(0x050507, 1)

    const rect = container.getBoundingClientRect()
    renderer.setSize(rect.width, rect.height)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const cfg = getPortConfig(deviceId, deviceR0, deviceA)
    const camera = createCamera(cfg, rect.width / rect.height)

    // Ambient light — very dim, divertor glow is the primary illumination
    const ambient = new THREE.AmbientLight(0x0a0a0a)
    scene.add(ambient)

    // Post-processing
    const postProcessing = createPostProcessing(renderer, scene, camera)

    const clock = new THREE.Clock()

    const state: SceneState = {
      renderer, scene, camera,
      wallMesh: null, portMesh: null, wallMaterial: null,
      plasmaGroup: null, glowGroup: null,
      postProcessing,
      animFrameId: 0,
      lastDeviceId: null,
      lastWallJson: null,
      clock,
    }
    stateRef.current = state

    // Animation loop
    const animate = () => {
      state.animFrameId = requestAnimationFrame(animate)
      postProcessing.composer.render()
    }
    animate()

    // Resize handler
    const onResize = () => {
      const r = container.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const pr = Math.min(window.devicePixelRatio, 2)
      renderer.setSize(r.width, r.height)
      renderer.setPixelRatio(pr)
      camera.aspect = r.width / r.height
      camera.updateProjectionMatrix()
      postProcessing.resize(r.width, r.height, pr)

      // Update glow pixel ratio
      if (state.glowGroup) {
        state.glowGroup.pixelRatio = pr
      }
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(container)

    return () => {
      cancelAnimationFrame(state.animFrameId)
      resizeObserver.disconnect()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild wall/port geometry when device or wall data changes
  const rebuildGeometry = useCallback(() => {
    const state = stateRef.current
    if (!state) return

    const cfg = getPortConfig(deviceId, deviceR0, deviceA)
    const axisR = snapshot?.axis_r ?? deviceR0 ?? 1.7
    const aspect = state.camera.aspect

    updateCamera(state.camera, cfg, aspect)

    // Parse limiter points
    let pts = limiterPoints
    if (!pts && wallJson) {
      try {
        const parsed = JSON.parse(wallJson)
        if (Array.isArray(parsed) && parsed.length > 0) {
          pts = parsed as [number, number][]
        }
      } catch { /* ignore */ }
    }
    if (!pts || pts.length < 4) return

    // Remove old geometry
    if (state.wallMesh) {
      state.scene.remove(state.wallMesh)
      state.wallMesh.geometry.dispose()
    }
    if (state.portMesh) {
      state.scene.remove(state.portMesh)
      state.portMesh.geometry.dispose()
    }
    if (state.plasmaGroup) {
      state.scene.remove(state.plasmaGroup.group)
    }
    if (state.glowGroup) {
      state.scene.remove(state.glowGroup.group)
    }

    // Build wall
    const { geometry: wallGeom } = buildWallGeometry(pts, cfg, axisR)

    // Compute total poloidal arc for UV mapping
    let totalArc = 0
    for (let i = 1; i < pts.length; i++) {
      const dR = pts[i][0] - pts[i - 1][0]
      const dZ = pts[i][1] - pts[i - 1][1]
      totalArc += Math.sqrt(dR * dR + dZ * dZ)
    }

    const wallMat = createWallMaterial(cfg, totalArc)
    const wallMesh = new THREE.Mesh(wallGeom, wallMat)
    wallMesh.renderOrder = 0
    state.scene.add(wallMesh)
    state.wallMesh = wallMesh
    state.wallMaterial = wallMat

    // Build port cylinder
    const portGeom = buildPortGeometry(cfg)
    const portMat = createPortMaterial()
    const portMesh = new THREE.Mesh(portGeom, portMat)
    portMesh.renderOrder = 4
    state.scene.add(portMesh)
    state.portMesh = portMesh

    // Create plasma group
    const plasma = createPlasmaGroup(cfg)
    state.scene.add(plasma.group)
    state.plasmaGroup = plasma

    // Create glow group with per-device tuning
    const glowTuning = DEVICE_GLOW_TUNING[deviceId ?? ''] ?? DEFAULT_GLOW_TUNING
    const glow = createGlowGroup(cfg, glowTuning)
    glow.pixelRatio = Math.min(window.devicePixelRatio, 2)
    state.scene.add(glow.group)
    state.glowGroup = glow

    state.lastDeviceId = deviceId ?? null
    state.lastWallJson = wallJson ?? null
  }, [deviceId, deviceR0, deviceA, limiterPoints, wallJson, snapshot?.axis_r])

  // Update scene when snapshot or device changes
  useEffect(() => {
    const state = stateRef.current
    if (!state) return

    // Rebuild geometry if device changed
    const needsRebuild =
      state.lastDeviceId !== (deviceId ?? null) ||
      state.lastWallJson !== (wallJson ?? null) ||
      !state.wallMesh

    if (needsRebuild) {
      rebuildGeometry()
    }

    if (!snapshot) return

    const cfg = getPortConfig(deviceId, deviceR0, deviceA)
    const opacityScale = DEVICE_OPACITY_SCALE[deviceId ?? ''] ?? DEFAULT_OPACITY_SCALE
    const powerScale = DEVICE_POWER_SCALE[deviceId ?? ''] ?? DEFAULT_POWER_SCALE
    const glowTuning = DEVICE_GLOW_TUNING[deviceId ?? ''] ?? DEFAULT_GLOW_TUNING

    // Set per-device strike illumination color on wall material
    if (state.wallMaterial) {
      const sc = glowTuning.color
      state.wallMaterial.uniforms.u_strikeColor.value.set(sc.r, sc.g * 0.5, sc.b)
    }

    // Parse limiter points for strike detection
    let pts = limiterPoints
    if (!pts && wallJson) {
      try {
        const parsed = JSON.parse(wallJson)
        if (Array.isArray(parsed) && parsed.length > 0) pts = parsed as [number, number][]
      } catch { /* ignore */ }
    }

    // Update plasma
    if (state.plasmaGroup && pts) {
      state.plasmaGroup.update({
        separatrix: snapshot.separatrix,
        fluxSurfaces: snapshot.flux_surfaces,
        axisR: snapshot.axis_r,
        axisZ: snapshot.axis_z,
        xpointR: snapshot.xpoint_r,
        xpointZ: snapshot.xpoint_z,
        xpointUpperR: snapshot.xpoint_upper_r,
        xpointUpperZ: snapshot.xpoint_upper_z,
        inHmode: snapshot.in_hmode,
        elmActive: snapshot.elm_active,
        te0: snapshot.te0,
        betaN: snapshot.beta_n,
        opacity: opacityScale,
        limiterPts: pts,
      })
    }

    // Update glow with smooth fade in/out
    if (state.glowGroup && pts) {
      // Smooth glow intensity — fade in slowly, fade out quickly at ramp-down
      const targetGlow = snapshot.in_hmode ? 0.8 : 0
      const glowLerpRate = snapshot.in_hmode ? 0.04 : 0.25
      glowIntensityRef.current += (targetGlow - glowIntensityRef.current) * glowLerpRate
      // Snap to zero when very small to avoid lingering traces
      if (glowIntensityRef.current < 0.005) glowIntensityRef.current = 0
      const glowIntensity = glowIntensityRef.current

      // Strike point position logic:
      // - In H-mode: compute from current separatrix and save as frozen reference
      // - Fading out: use frozen positions so glow doesn't follow moving equilibrium
      let strikePoints: StrikePoint[]
      if (snapshot.in_hmode) {
        strikePoints = findStrikePoints(
          snapshot.separatrix.points,
          pts,
          snapshot.xpoint_r,
          snapshot.xpoint_z,
          snapshot.axis_r,
        )
        // Save current positions — these become the frozen fade-out positions
        frozenStrikePointsRef.current = strikePoints
      } else if (glowIntensity > 0.01) {
        // Fading out — use the last known H-mode strike positions
        strikePoints = frozenStrikePointsRef.current
      } else {
        strikePoints = []
        frozenStrikePointsRef.current = []
      }

      state.glowGroup.update({
        strikePoints,
        intensity: glowIntensity,
        powerScale,
        axisR: snapshot.axis_r,
        time: state.clock.getElapsedTime(),
      })

      // Update wall illumination from strike points
      // Scale wall illumination proportionally with glow intensity
      const wallGlowFactor = glowIntensity / 0.8
      if (state.wallMaterial && strikePoints.length > 0 && wallGlowFactor > 0.01) {
        const spUniforms: { x: number; y: number; z: number; intensity: number }[] = []
        const phis = [-1.2, -0.6, 0, 0.6, 1.2]
        for (const sp of strikePoints) {
          for (const phi of phis) {
            if (spUniforms.length >= 8) break
            const v = toroidal(sp.r, sp.z, phi)
            const fadeFactor = Math.exp(-Math.abs(phi) * 0.5)
            spUniforms.push({ x: v.x, y: v.y, z: v.z, intensity: powerScale * 0.5 * fadeFactor * wallGlowFactor })
          }
        }
        updateStrikePoints(state.wallMaterial, spUniforms)
      } else if (state.wallMaterial) {
        updateStrikePoints(state.wallMaterial, [])
      }
    }

    // ELM flash — brief white overlay
    if (snapshot.elm_active) {
      state.renderer.setClearColor(0x0c0c0e, 1)
    } else if (snapshot.disrupted) {
      state.renderer.setClearColor(0x100505, 1)
    } else {
      state.renderer.setClearColor(0x050507, 1)
    }
  }, [snapshot, deviceId, deviceR0, deviceA, limiterPoints, wallJson, rebuildGeometry])

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px]"
      style={{ position: 'relative' }}
    />
  )
}
