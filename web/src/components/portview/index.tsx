import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import type { Snapshot } from '../../lib/types'
import { getPortConfig, DEVICE_OPACITY_SCALE, DEFAULT_OPACITY_SCALE, DEVICE_GLOW_TUNING, DEFAULT_GLOW_TUNING } from './config'
import { createCamera, updateCamera } from './camera'
import { buildWallGeometry, buildPortGeometry, resolveExtraPortPositions } from './geometry'
import { createWallMaterial, createPortMaterial, setExtraPortUniforms, updateStrikePoints } from './wallMaterial'
import { createPlasmaGroup } from './plasma'
import { createGlowGroup, findStrikePoints, type StrikePoint } from './glow'
import { createPostProcessing } from './postprocessing'
import { DivertorVisuals } from './divertorVisuals'
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
  /**
   * Animation clock (seconds) driving glow flicker and ELM swirl. Advances
   * with real time, but ONLY while the simulation is actually stepping — so
   * pausing the pulse freezes the plasma visuals instead of leaving them
   * shimmering. Tracked via the wall-clock time of the last sim-time change.
   */
  animTime: number
  lastSimTime: number
  lastSimAdvanceWall: number
}

/** No sim-time change for this long ⇒ treat the pulse as paused. */
const PAUSE_GRACE_MS = 200

export default function PortView({ snapshot, limiterPoints, deviceId, wallJson, deviceR0, deviceA }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const glowIntensityRef = useRef(0)
  // Strike positions low-pass filtered (EMA) — tracks slow equilibrium drift
  // (strike sweeps, ramp-down) without frame-to-frame jitter.
  const emaStrikePointsRef = useRef<StrikePoint[]>([])
  const divertorVisRef = useRef<DivertorVisuals | null>(null)
  const peakIpRef = useRef(0)
  const peakStableFramesRef = useRef(0)
  const flatTopReachedRef = useRef(false)
  const prevStrikeFingerprint = useRef('')
  const strikeStableFramesRef = useRef(0)
  const prevDisruptedRef = useRef(false)
  const disruptionFlashRef = useRef(0)  // 1.0 at disruption moment, decays to 0

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
      animTime: 0,
      lastSimTime: -1,
      lastSimAdvanceWall: 0,
    }
    stateRef.current = state

    // Animation loop — paused while the tab is hidden to save GPU/battery.
    let rafRunning = false
    const animate = () => {
      state.animFrameId = requestAnimationFrame(animate)
      // Time-based animation (glow shimmer, ELM swirl) runs at display rate
      // here; simulation-driven state updates arrive via the snapshot effect
      // at physics-tick rate. The animation clock is frozen while the pulse is
      // paused so the plasma holds still rather than shimmering on.
      // Clamped so resuming a hidden tab (where the loop was stopped) cannot
      // jump the animation clock by the whole time spent hidden.
      const dt = Math.min(state.clock.getDelta(), 0.1)
      const running = performance.now() - state.lastSimAdvanceWall < PAUSE_GRACE_MS
      if (running) state.animTime += dt
      state.plasmaGroup?.tick(state.animTime)
      state.glowGroup?.tick(state.animTime)
      postProcessing.composer.render()
    }
    const startLoop = () => {
      if (rafRunning) return
      rafRunning = true
      animate()
    }
    const stopLoop = () => {
      if (!rafRunning) return
      rafRunning = false
      cancelAnimationFrame(state.animFrameId)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopLoop()
      else startLoop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    startLoop()

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
      stopLoop()
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      // Dispose all GPU resources — geometry rebuilds dispose the previous
      // generation, but the final generation must be released here.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = (mesh as THREE.Mesh).material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat) mat.dispose()
      })
      postProcessing.composer.dispose()
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

    // Remove old geometry and release its GPU resources
    const disposeObject = (obj: THREE.Object3D) => {
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat) mat.dispose()
      })
    }
    if (state.wallMesh) {
      state.scene.remove(state.wallMesh)
      disposeObject(state.wallMesh)
    }
    if (state.portMesh) {
      state.scene.remove(state.portMesh)
      disposeObject(state.portMesh)
    }
    if (state.plasmaGroup) {
      state.scene.remove(state.plasmaGroup.group)
      disposeObject(state.plasmaGroup.group)
    }
    if (state.glowGroup) {
      state.scene.remove(state.glowGroup.group)
      disposeObject(state.glowGroup.group)
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

    // Pass extra port positions to wall shader as uniforms
    const resolvedPorts = resolveExtraPortPositions(cfg, pts)
    setExtraPortUniforms(wallMat, resolvedPorts)

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
      // Reset all glow state when device changes — prevents stale strike
      // positions from the old device bleeding into the new one.
      glowIntensityRef.current = 0
      emaStrikePointsRef.current = []
      divertorVisRef.current = null
      peakIpRef.current = 0
      peakStableFramesRef.current = 0
      flatTopReachedRef.current = false
      prevStrikeFingerprint.current = ''
      strikeStableFramesRef.current = 0
    }

    if (!snapshot) {
      // Simulation was reset or preset switched — clear all plasma visuals.
      // This prevents frozen glow/plasma from lingering when e.g. switching DD→DT.
      glowIntensityRef.current = 0
      emaStrikePointsRef.current = []
      divertorVisRef.current?.reset()
      peakIpRef.current = 0
      peakStableFramesRef.current = 0
      flatTopReachedRef.current = false
      prevStrikeFingerprint.current = ''
      strikeStableFramesRef.current = 0
      // Clear glow sprites and wall illumination
      if (state.glowGroup) {
        state.glowGroup.update({
          strikePoints: [], intensity: 0,
          axisR: 0, time: 0,
        })
      }
      if (state.wallMaterial) {
        updateStrikePoints(state.wallMaterial, [])
      }
      // Hide plasma mesh
      if (state.plasmaGroup) state.plasmaGroup.group.visible = false
      return
    }

    // Note when sim time last advanced — the RAF loop uses this to decide
    // whether the pulse is running, and freezes animation while it is paused.
    if (snapshot.time !== state.lastSimTime) {
      state.lastSimTime = snapshot.time
      state.lastSimAdvanceWall = performance.now()
    }

    getPortConfig(deviceId, deviceR0, deviceA)
    const opacityScale = DEVICE_OPACITY_SCALE[deviceId ?? ''] ?? DEFAULT_OPACITY_SCALE
    const glowTuning = DEVICE_GLOW_TUNING[deviceId ?? ''] ?? DEFAULT_GLOW_TUNING

    // Physics-driven divertor state: q_peak → brightness, λ_q → band width,
    // thermal model → tile incandescence. Keyed to the snapshot's device id
    // (authoritative, and reflects DD/DT fuel via mass_number).
    if (!divertorVisRef.current) {
      divertorVisRef.current = new DivertorVisuals(snapshot.device_id)
    }
    const divVis = divertorVisRef.current.update(snapshot)

    // Glow tint: device recycling-light color shifting toward blackbody
    // incandescence as the target tiles heat up.
    const incand = divVis.incandescence
    const glowColor = {
      r: glowTuning.color.r + (divVis.blackbody.r - glowTuning.color.r) * incand * 0.7,
      g: glowTuning.color.g + (divVis.blackbody.g - glowTuning.color.g) * incand * 0.7,
      b: glowTuning.color.b + (divVis.blackbody.b - glowTuning.color.b) * incand * 0.7,
    }

    // Set strike illumination color on wall material (warm-shifted for tiles)
    if (state.wallMaterial) {
      state.wallMaterial.uniforms.u_strikeColor.value.set(
        glowColor.r, glowColor.g * 0.6, glowColor.b)
    }

    // Parse limiter points for strike detection
    let pts = limiterPoints
    if (!pts && wallJson) {
      try {
        const parsed = JSON.parse(wallJson)
        if (Array.isArray(parsed) && parsed.length > 0) pts = parsed as [number, number][]
      } catch { /* ignore */ }
    }

    // Re-show plasma group if it was hidden by a previous null-snapshot clear,
    // but keep it hidden when disrupted (plasma has terminated).
    if (state.plasmaGroup) {
      state.plasmaGroup.group.visible = !snapshot.disrupted
    }

    // Update plasma — skip when disrupted
    if (state.plasmaGroup && pts && !snapshot.disrupted) {
      state.plasmaGroup.update({
        separatrix: snapshot.separatrix,
        axisR: snapshot.axis_r,
        axisZ: snapshot.axis_z,
        xpointR: snapshot.xpoint_r,
        xpointZ: snapshot.xpoint_z,
        xpointUpperR: snapshot.xpoint_upper_r,
        xpointUpperZ: snapshot.xpoint_upper_z,
        inHmode: snapshot.in_hmode,
        elmActive: snapshot.elm_active,
        te0: snapshot.te0,
        q95: snapshot.q95,
        elmEnergyLoss: snapshot.elm_energy_loss,
        fGreenwald: snapshot.f_greenwald,
        impurityFraction: snapshot.impurity_fraction,
        neonPuff: snapshot.neon_puff,
        pRadFrac: snapshot.p_loss > 0.1 ? snapshot.p_rad / snapshot.p_loss : 0,
        opacity: opacityScale,
        limiterPts: pts,
        time: state.animTime,
      })
    }

    // Update glow with smooth fade in/out — skip when disrupted
    if (state.glowGroup && pts && !snapshot.disrupted) {
      // ── Flat-top detection for glow activation ──
      // Glow should only appear once the equilibrium has settled at flat-top,
      // NOT during ramp-up when the separatrix strike points are still moving.
      // We track Ip stability AND strike-point position stability — the actual
      // positions on the wall must stop changing before the glow appears.
      if (snapshot.ip < 0.01 || snapshot.time < 0.01) {
        peakIpRef.current = 0
        peakStableFramesRef.current = 0
        flatTopReachedRef.current = false
        prevStrikeFingerprint.current = ''
        strikeStableFramesRef.current = 0
      }
      const prevPeak = peakIpRef.current
      if (snapshot.prog_ip > peakIpRef.current) {
        peakIpRef.current = snapshot.prog_ip
      }
      if (peakIpRef.current > prevPeak + 0.001) {
        peakStableFramesRef.current = 0
      } else {
        peakStableFramesRef.current++
      }

      // Always compute strike points so we can track their stability
      const isDiverted = snapshot.xpoint_r > 0
      const candidateStrikes = isDiverted ? findStrikePoints(
        snapshot.separatrix.points,
        pts,
        snapshot.xpoint_r,
        snapshot.xpoint_z,
        snapshot.axis_r,
        snapshot.xpoint_upper_r,
        snapshot.xpoint_upper_z,
      ) : []

      // Track strike point position stability — fingerprint with 3mm precision.
      // During ramp-up the strike points shift each frame; at flat-top they freeze.
      const strikeFP = candidateStrikes
        .map(sp => `${(sp.r * 333).toFixed(0)},${(sp.z * 333).toFixed(0)}`)
        .join(':')
      if (strikeFP !== prevStrikeFingerprint.current) {
        strikeStableFramesRef.current = 0
        prevStrikeFingerprint.current = strikeFP
      } else {
        strikeStableFramesRef.current++
      }

      // Declare flat-top when Ip is stable AND strike positions have settled
      const ipStable = peakStableFramesRef.current >= 5 && peakIpRef.current > 0.5
      const eqSettled = strikeStableFramesRef.current >= 15
      if (ipStable && eqSettled) {
        flatTopReachedRef.current = true
      }
      // End flat-top when prog_ip drops below 95% of peak (ramp-down started)
      if (snapshot.prog_ip < 0.95 * peakIpRef.current) {
        flatTopReachedRef.current = false
      }

      const hasSOLPower = snapshot.p_loss > 1.0 && snapshot.ip > 0.5
      const glowActive = isDiverted && flatTopReachedRef.current && (snapshot.in_hmode || hasSOLPower)
      // Physics-driven brightness: log-mapped q_peak (ELMs spike it,
      // detachment dims it, ramp-down fades it) × per-device art scale.
      const targetGlow = glowActive ? divVis.intensity : 0
      // Asymmetric: slow rise so the glow fades in smoothly at flat-top onset
      // without popping, but a quick fall so an ELM pulse drops back to the
      // inter-ELM baseline promptly instead of lingering.
      const rising = targetGlow > glowIntensityRef.current
      const glowLerpRate = glowActive ? (rising ? 0.08 : 0.32) : 0.25
      glowIntensityRef.current += (targetGlow - glowIntensityRef.current) * glowLerpRate
      if (glowIntensityRef.current < 0.005) glowIntensityRef.current = 0
      const glowIntensity = glowIntensityRef.current

      // EMA-smoothed strike positions — kills frame-to-frame jitter but keeps
      // tracking slow drift (strike sweeps, ramp-down), unlike the previous
      // freeze-on-activation approach.
      const ema = emaStrikePointsRef.current
      if (candidateStrikes.length !== ema.length) {
        emaStrikePointsRef.current = candidateStrikes.map(sp => ({ ...sp }))
      } else {
        const alpha = 0.12
        for (let i = 0; i < ema.length; i++) {
          ema[i].r += (candidateStrikes[i].r - ema[i].r) * alpha
          ema[i].z += (candidateStrikes[i].z - ema[i].z) * alpha
        }
      }
      const strikePoints: StrikePoint[] =
        glowIntensity > 0.005 ? emaStrikePointsRef.current : []

      state.glowGroup.update({
        strikePoints,
        intensity: glowIntensity,
        bandWidth: divVis.bandWidth,
        color: glowColor,
        axisR: snapshot.axis_r,
        time: state.animTime,
      })

      // Update wall illumination from strike points, proportional to glow
      if (state.wallMaterial && strikePoints.length > 0 && glowIntensity > 0.01) {
        const spUniforms: { x: number; y: number; z: number; intensity: number }[] = []
        const phis = [-1.2, -0.6, 0, 0.6, 1.2]
        for (const sp of strikePoints) {
          for (const phi of phis) {
            if (spUniforms.length >= 8) break
            const v = toroidal(sp.r, sp.z, phi)
            const fadeFactor = Math.exp(-Math.abs(phi) * 0.5)
            spUniforms.push({ x: v.x, y: v.y, z: v.z, intensity: glowIntensity * 0.9 * fadeFactor })
          }
        }
        updateStrikePoints(state.wallMaterial, spUniforms)
      } else if (state.wallMaterial) {
        updateStrikePoints(state.wallMaterial, [])
      }
    }

    // ── Disruption flash ──
    // Detect the moment of disruption (transition from false → true).
    // Trigger a bright reddish flash that decays over ~15 frames, then
    // immediately clear all plasma/glow from the portview.
    const isDisrupted = !!snapshot.disrupted
    if (isDisrupted && !prevDisruptedRef.current) {
      // Moment of disruption — trigger flash
      disruptionFlashRef.current = 1.0
      // Immediately clear plasma and glow
      glowIntensityRef.current = 0
      emaStrikePointsRef.current = []
      if (state.glowGroup) {
        state.glowGroup.update({
          strikePoints: [], intensity: 0,
          axisR: snapshot.axis_r, time: 0,
        })
      }
      if (state.wallMaterial) updateStrikePoints(state.wallMaterial, [])
      if (state.plasmaGroup) state.plasmaGroup.group.visible = false
    }
    prevDisruptedRef.current = isDisrupted

    // Decay the flash
    if (disruptionFlashRef.current > 0.01) {
      disruptionFlashRef.current *= 0.88  // exponential decay ~15 frames
    } else {
      disruptionFlashRef.current = 0
    }

    // Set clear color based on flash state
    const flash = disruptionFlashRef.current
    if (flash > 0.01) {
      // Reddish flash: blend from bright red-orange toward dark background
      const r = Math.floor(5 + flash * 180)
      const g = Math.floor(5 + flash * 40)
      const b = Math.floor(7 + flash * 20)
      state.renderer.setClearColor(new THREE.Color(r / 255, g / 255, b / 255), 1)
    } else if (snapshot.elm_active) {
      state.renderer.setClearColor(0x0c0c0e, 1)
    } else {
      state.renderer.setClearColor(0x050507, 1)
    }
  }, [snapshot, deviceId, deviceR0, deviceA, limiterPoints, wallJson, rebuildGeometry])

  return (
    <div className="w-full h-full min-h-[200px] relative">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-2 left-3 panel-title pointer-events-none z-10">
        Port view
      </div>
    </div>
  )
}
