import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SimHandle, type PresetId, getPreset } from './wasm'
import type { Snapshot, TracePoint, ProfileFrame, ProcessedProfile } from './types'
import { processProfileFrames } from './profileUtils'

const DT = 0.005 // 5 ms physics timestep
// Trace history (lightweight: ~200 bytes/entry) — large buffer for full-discharge coverage.
// 30,000 entries ≈ 500s at 60fps (enough for ITER 400s shots at 1x speed). ~6 MB.
const MAX_TRACE_HISTORY = 30000
// Snapshot history (heavy: ~50 KB/entry with equilibrium contours) — moderate buffer.
// 2,000 entries ≈ 33s at 60fps. Post-discharge scrubbing uses time-based lookup,
// so sparser snapshots just mean slightly less smooth equilibrium scrubbing.  ~100 MB max.
const MAX_SNAPSHOT_HISTORY = 2000

export interface SimState {
  snapshot: Snapshot | null            // live (latest) snapshot
  displaySnapshot: Snapshot | null     // scrubbed or live — for rendering components
  history: TracePoint[]
  snapshotHistory: Snapshot[]          // full snapshots for scrub→equilibrium sync
  running: boolean
  wallJson: string
  programJson: string                  // current discharge program JSON for target traces
  scrubTime: number | null             // null = live, number = sim time for scrub position
  finished: boolean                    // true when status is Complete or Disrupted
  processedProfiles: ProcessedProfile[] | null  // null while running, populated post-discharge
  profileTeMax: number
  profileNeMax: number
  profilePMax: number
}

export interface SimControls {
  start: () => void
  pause: () => void
  reset: () => void
  switchPreset: (deviceId: string, preset: PresetId) => void
  runProgram: (deviceId: string, programJson: string) => void
  setScrubTime: (time: number | null) => void
  setSpeed: (speed: number) => void
}

export function useSimulation(
  initialDeviceId: string,
  initialPreset: PresetId,
): [SimState, SimControls] {
  const simRef = useRef<SimHandle | null>(null)
  const historyRef = useRef<TracePoint[]>([])
  const snapshotHistoryRef = useRef<Snapshot[]>([])
  const runningRef = useRef(false)
  const rafRef = useRef<number>(0)
  const wallJsonRef = useRef<string>('[]')
  const programJsonRef = useRef<string>('{}')
  const speedRef = useRef(1.0)
  const stepAccRef = useRef(0.0)  // fractional step accumulator for sub-1x speeds
  const profileFramesRef = useRef<ProfileFrame[]>([])
  const lastProfileTimeRef = useRef<number>(-Infinity)

  const [state, setState] = useState<SimState>({
    snapshot: null,
    displaySnapshot: null,
    history: [],
    snapshotHistory: [],
    running: false,
    wallJson: '[]',
    programJson: '{}',
    scrubTime: null,
    finished: false,
    processedProfiles: null,
    profileTeMax: 0,
    profileNeMax: 0,
    profilePMax: 0,
  })

  // Create a new sim handle from a preset
  const createSim = useCallback((deviceId: string, preset: PresetId) => {
    // Clean up old handle
    if (simRef.current) {
      simRef.current.free()
    }
    const handle = SimHandle.from_preset(deviceId, preset)
    simRef.current = handle
    historyRef.current = []
    snapshotHistoryRef.current = []
    profileFramesRef.current = []
    lastProfileTimeRef.current = -Infinity
    wallJsonRef.current = handle.wall_outline_json()

    // Get the program JSON for target traces
    const program = getPreset(deviceId, preset)
    programJsonRef.current = program ? JSON.stringify(program) : '{}'

    runningRef.current = false
    setState({
      snapshot: null,
      displaySnapshot: null,
      history: [],
      snapshotHistory: [],
      running: false,
      wallJson: wallJsonRef.current,
      programJson: programJsonRef.current,
      scrubTime: null,
      finished: false,
      processedProfiles: null,
      profileTeMax: 0,
      profileNeMax: 0,
      profilePMax: 0,
    })
  }, [])

  // Create a new sim handle from custom program JSON
  const createSimFromProgram = useCallback((deviceId: string, programJson: string) => {
    // Clean up old handle
    if (simRef.current) {
      simRef.current.free()
    }
    const handle = new SimHandle(deviceId, programJson)
    simRef.current = handle
    historyRef.current = []
    snapshotHistoryRef.current = []
    profileFramesRef.current = []
    lastProfileTimeRef.current = -Infinity
    wallJsonRef.current = handle.wall_outline_json()
    programJsonRef.current = programJson

    runningRef.current = false
    setState({
      snapshot: null,
      displaySnapshot: null,
      history: [],
      snapshotHistory: [],
      running: false,
      wallJson: wallJsonRef.current,
      programJson: programJsonRef.current,
      scrubTime: null,
      finished: false,
      processedProfiles: null,
      profileTeMax: 0,
      profileNeMax: 0,
      profilePMax: 0,
    })
  }, [])

  // Initialize on mount
  useEffect(() => {
    createSim(initialDeviceId, initialPreset)
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (simRef.current) {
        simRef.current.free()
        simRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The animation loop
  const tick = useCallback(() => {
    if (!runningRef.current || !simRef.current) return

    const sim = simRef.current

    // Step physics multiple times per frame for real-time feel
    // (at 60fps, 3 steps of 5ms = 15ms sim time per frame ≈ 1x speed)
    // Use fractional accumulator so sub-1x speeds are accurate on average
    const BASE_STEPS = 3
    stepAccRef.current += BASE_STEPS * speedRef.current
    const stepsThisFrame = Math.floor(stepAccRef.current)
    stepAccRef.current -= stepsThisFrame
    let snap: Snapshot | null = null
    // Track peak Dα and any ELM across all sub-steps so that ELMs
    // are reliably captured even when many physics steps are skipped.
    let maxDAlpha = 0
    let anyElmActive = false

    for (let i = 0; i < stepsThisFrame; i++) {
      const json = sim.step(DT)
      snap = JSON.parse(json)
      if (snap) {
        if (snap.diagnostics.d_alpha > maxDAlpha) maxDAlpha = snap.diagnostics.d_alpha
        if (snap.elm_active) anyElmActive = true
      }
      if (snap && (snap.status === 'Complete' || snap.status === 'Disrupted')) {
        runningRef.current = false
        break
      }
    }

    if (snap) {
      // Append to trace history ring buffer (lightweight — large limit)
      // Use peak d_alpha and any-ELM flag from all sub-steps for reliable display
      const pt: TracePoint = {
        t: snap.time,
        ip: snap.ip,
        te0: snap.te0,
        ne_bar: snap.ne_bar,
        w_th: snap.w_th,
        p_input: snap.p_input,
        p_rad: snap.p_rad,
        p_loss: snap.p_loss,
        d_alpha: maxDAlpha,
        beta_n: snap.beta_n,
        disruption_risk: snap.disruption_risk,
        li: snap.li,
        q95: snap.q95,
        v_loop: snap.diagnostics.v_loop,
        h_factor: snap.h_factor,
        f_greenwald: snap.f_greenwald,
        ne_ped: snap.ne_ped,
        te_ped: snap.te_ped,
        ne_line: snap.ne_line,
        impurity_fraction: snap.impurity_fraction,
        elm_suppressed: snap.elm_suppressed,
      }
      historyRef.current.push(pt)
      if (historyRef.current.length > MAX_TRACE_HISTORY) {
        historyRef.current = historyRef.current.slice(-MAX_TRACE_HISTORY)
      }

      // Append to full snapshot history (for scrubbing) — separate, smaller limit
      snapshotHistoryRef.current.push(snap)
      if (snapshotHistoryRef.current.length > MAX_SNAPSHOT_HISTORY) {
        snapshotHistoryRef.current = snapshotHistoryRef.current.slice(-MAX_SNAPSHOT_HISTORY)
      }

      // Capture profile frame every 50ms for post-discharge viewing
      if (snap.te_profile && snap.time - lastProfileTimeRef.current >= 0.05) {
        profileFramesRef.current.push({
          time: snap.time,
          te_profile: [...snap.te_profile],
          ne_profile: [...snap.ne_profile],
          in_hmode: snap.in_hmode,
        })
        lastProfileTimeRef.current = snap.time
      }

      const isFinished = snap.status === 'Complete' || snap.status === 'Disrupted'

      setState((prev) => {
        // Post-discharge: process accumulated profile frames (only once)
        let processedProfiles = prev.processedProfiles
        let profileTeMax = prev.profileTeMax
        let profileNeMax = prev.profileNeMax
        let profilePMax = prev.profilePMax
        if (isFinished && !prev.processedProfiles && profileFramesRef.current.length > 0) {
          const result = processProfileFrames(profileFramesRef.current)
          processedProfiles = result.profiles
          profileTeMax = result.teMax
          profileNeMax = result.neMax
          profilePMax = result.pMax
        }

        return {
          snapshot: snap!,
          displaySnapshot: snap!,
          history: historyRef.current,
          snapshotHistory: snapshotHistoryRef.current,
          running: runningRef.current,
          wallJson: wallJsonRef.current,
          programJson: programJsonRef.current,
          scrubTime: null,
          finished: isFinished,
          processedProfiles,
          profileTeMax,
          profileNeMax,
          profilePMax,
        }
      })
    }

    if (runningRef.current) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [])

  const start = useCallback(() => {
    if (!simRef.current) return
    runningRef.current = true
    setState((s) => ({ ...s, running: true }))
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const pause = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    setState((s) => ({ ...s, running: false }))
  }, [])

  const reset = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    if (simRef.current) {
      simRef.current.reset()
    }
    historyRef.current = []
    snapshotHistoryRef.current = []
    profileFramesRef.current = []
    lastProfileTimeRef.current = -Infinity
    setState((s) => ({
      ...s,
      snapshot: null,
      displaySnapshot: null,
      history: [],
      snapshotHistory: [],
      running: false,
      scrubTime: null,
      finished: false,
      processedProfiles: null,
      profileTeMax: 0,
      profileNeMax: 0,
      profilePMax: 0,
    }))
  }, [])

  const switchPreset = useCallback(
    (deviceId: string, preset: PresetId) => {
      cancelAnimationFrame(rafRef.current)
      createSim(deviceId, preset)
    },
    [createSim],
  )

  const runProgram = useCallback(
    (deviceId: string, programJson: string) => {
      cancelAnimationFrame(rafRef.current)
      createSimFromProgram(deviceId, programJson)
    },
    [createSimFromProgram],
  )

  const setSpeed = useCallback((speed: number) => {
    speedRef.current = speed
    stepAccRef.current = 0
  }, [])

  // Time-based scrubbing: find the closest snapshot by time for equilibrium display.
  // Trace panel uses scrubTime directly for cursor and value readout.
  const setScrubTime = useCallback((time: number | null) => {
    setState((prev) => {
      if (time === null) {
        return {
          ...prev,
          scrubTime: null,
          displaySnapshot: prev.snapshot,
        }
      }
      // Binary search snapshotHistory for closest time
      const snaps = prev.snapshotHistory
      if (snaps.length === 0) {
        return { ...prev, scrubTime: time, displaySnapshot: prev.snapshot }
      }
      let lo = 0
      let hi = snaps.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (snaps[mid].time < time) lo = mid + 1
        else hi = mid
      }
      // Check which of lo and lo-1 is closer
      let bestIdx = lo
      if (lo > 0 && Math.abs(snaps[lo - 1].time - time) < Math.abs(snaps[lo].time - time)) {
        bestIdx = lo - 1
      }
      return {
        ...prev,
        scrubTime: time,
        displaySnapshot: snaps[bestIdx],
      }
    })
  }, [])

  // Memoize controls to keep a stable reference
  const controls = useMemo<SimControls>(
    () => ({ start, pause, reset, switchPreset, runProgram, setScrubTime, setSpeed }),
    [start, pause, reset, switchPreset, runProgram, setScrubTime, setSpeed],
  )

  return [state, controls]
}
