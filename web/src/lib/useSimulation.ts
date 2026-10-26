import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SimHandle, type PresetId, getPreset, getDevice } from './wasm'
import type { Snapshot, TracePoint, ProfileFrame, ProcessedProfile } from './types'
import { processProfileFrames } from './profileUtils'
import { computeFusion } from './fusionPhysics'
import { deriveEvents, newLogContext, nextPulseNumber, type LogContext, type LogEvent } from './pulseLog'

const DT = 0.005 // 5 ms physics timestep
// Through the thermal and current quench the physics is stepped and recorded
// at this resolution instead, so the Ip spike (1-3 ms) and the L/R decay
// (5-50 ms) render as curves rather than one or two points.
const DT_QUENCH = 0.00025
const inQuench = (s: Snapshot | null | undefined) =>
  !!s && s.disrupted && (s.disruption_phase === 'thermal_quench' || s.disruption_phase === 'current_quench')
// Trace history (lightweight: ~200 bytes/entry) — large buffer for full-pulse coverage.
// 30,000 entries ≈ 500s at 60fps (enough for ITER 400s pulses at 1x speed). ~6 MB.
const MAX_TRACE_HISTORY = 30000
// Snapshot history (heavy: ~50 KB/entry with equilibrium contours).
// 8,000 entries ≈ 133s at 60fps — enough for ITER's full 100s pulse.
// Post-pulse scrubbing uses time-based lookup. ~400 MB max.
const MAX_SNAPSHOT_HISTORY = 8000

/** The previous pulse on this device, kept as a reference trace. */
export interface PreviousPulse {
  number: number | null
  deviceId: string
  history: TracePoint[]
}

export interface SimState {
  snapshot: Snapshot | null            // live (latest) snapshot
  displaySnapshot: Snapshot | null     // scrubbed or live — for rendering components
  history: TracePoint[]
  snapshotHistory: Snapshot[]          // full snapshots for scrub→equilibrium sync
  running: boolean
  wallJson: string
  programJson: string                  // current pulse program JSON for target traces
  scrubTime: number | null             // null = live, number = sim time for scrub position
  finished: boolean                    // true when status is Complete or Disrupted
  processedProfiles: ProcessedProfile[] | null  // null while running, populated post-pulse
  profileTeMax: number
  profileNeMax: number
  profilePMax: number
  events: LogEvent[]                   // append-only control-room log for this pulse
  pulseNumber: number | null           // issued on Start, persistent across visits
  previousPulse: PreviousPulse | null  // last pulse's traces, for the reference overlay
  elmCount: number
  disruptionTime: number | null
}

export interface SimControls {
  start: () => void
  pause: () => void
  reset: () => void
  switchPreset: (deviceId: string, preset: PresetId) => void
  runProgram: (deviceId: string, programJson: string) => void
  setScrubTime: (time: number | null) => void
  setSpeed: (speed: number) => void
  setMassNumber: (mass: number | null) => void
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
  const massOverrideRef = useRef<number | null>(null)
  const currentDeviceRef = useRef(initialDeviceId)
  const currentDeviceObjRef = useRef(getDevice(initialDeviceId))
  const currentPresetRef = useRef(initialPreset)
  const wallJsonRef = useRef<string>('[]')
  const programJsonRef = useRef<string>('{}')
  const speedRef = useRef(1.0)
  const stepAccRef = useRef(0.0)  // fractional step accumulator for sub-1x speeds
  const pFusSmoothedRef = useRef(0.0) // smoothed P_fus for ELM resilience
  const profileFramesRef = useRef<ProfileFrame[]>([])
  const lastProfileTimeRef = useRef<number>(-Infinity)
  const eventsRef = useRef<LogEvent[]>([])
  // The last snapshot as the engine produced it. The copy kept in
  // snapshotHistory has elm_active latched true for the whole tick, which
  // would hide the rising edge of an ELM on the next tick's first step.
  const lastRawSnapshotRef = useRef<Snapshot | null>(null)
  const logCtxRef = useRef<LogContext | null>(null)
  const pulseNumberRef = useRef<number | null>(null)
  const previousPulseRef = useRef<PreviousPulse | null>(null)

  // Keep the pulse that is about to be discarded as the reference trace,
  // provided it ran long enough to be worth comparing against.
  const archivePulse = () => {
    if (historyRef.current.length > 20) {
      previousPulseRef.current = {
        number: pulseNumberRef.current,
        deviceId: currentDeviceRef.current,
        history: historyRef.current,
      }
    }
    pulseNumberRef.current = null
    eventsRef.current = []
    logCtxRef.current = null
    lastRawSnapshotRef.current = null
  }

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
    events: [],
    pulseNumber: null,
    previousPulse: null,
    elmCount: 0,
    disruptionTime: null,
  })

  // Create a new sim handle from a preset
  const createSim = useCallback((deviceId: string, preset: PresetId) => {
    archivePulse()
    currentDeviceRef.current = deviceId
    const dev = getDevice(deviceId)
    if (dev && massOverrideRef.current !== null) {
      dev.mass_number = massOverrideRef.current
    }
    currentDeviceObjRef.current = dev
    currentPresetRef.current = preset
    // Clean up old handle
    if (simRef.current) {
      simRef.current.free()
    }

    let handle: SimHandle
    const program = getPreset(deviceId, preset)

    handle = SimHandle.from_preset(deviceId, preset)
    programJsonRef.current = program ? JSON.stringify(program) : '{}'

    if (massOverrideRef.current !== null) {
      handle.set_mass_number(massOverrideRef.current)
    }
    simRef.current = handle
    historyRef.current = []
    pFusSmoothedRef.current = 0
    snapshotHistoryRef.current = []
    profileFramesRef.current = []
    lastProfileTimeRef.current = -Infinity
    wallJsonRef.current = handle.wall_outline_json()

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
      events: [],
      pulseNumber: null,
      previousPulse: previousPulseRef.current,
      elmCount: 0,
      disruptionTime: null,
    })
  }, [])

  // Create a new sim handle from custom program JSON
  const createSimFromProgram = useCallback((deviceId: string, programJson: string) => {
    archivePulse()
    currentDeviceRef.current = deviceId
    currentDeviceObjRef.current = getDevice(deviceId)
    // Clean up old handle
    if (simRef.current) {
      simRef.current.free()
    }
    const handle = new SimHandle(deviceId, programJson)
    if (massOverrideRef.current !== null) {
      handle.set_mass_number(massOverrideRef.current)
    }
    simRef.current = handle
    historyRef.current = []
    pFusSmoothedRef.current = 0
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
      events: [],
      pulseNumber: null,
      previousPulse: previousPulseRef.current,
      elmCount: 0,
      disruptionTime: null,
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

    // Step physics at a fixed rate of 3 steps × 5ms = 15ms sim time per tick.
    // Speed multiplier controls how many ticks run per animation frame:
    //   ≥1x: run multiple batches of 3 steps per frame (more computation)
    //   <1x: skip frames (fewer ticks per second, same computation per tick)
    // This ensures the physics timestep grouping is always identical
    // regardless of playback speed — same dt, same steps-per-batch.
    const STEPS_PER_TICK = 3
    const speed = speedRef.current

    // Sub-1x: skip frames to slow down. Accumulate fractional ticks.
    if (speed < 1.0) {
      stepAccRef.current += speed
      if (stepAccRef.current < 1.0) {
        // Skip this frame — schedule next and return without stepping
        if (runningRef.current) {
          rafRef.current = requestAnimationFrame(tick)
        }
        return
      }
      stepAccRef.current -= 1.0
    }

    // Number of tick batches this frame: 1 at ≤1x, proportional at >1x
    const tickBatches = speed >= 1.0 ? Math.round(speed) : 1

    // Build a trace point from a snapshot. `dAlpha`/`elmActive` may be latched
    // over several sub-steps; `dtRecorded` is the simulated time this point
    // represents, used to smooth P_fus with tau_E.
    const makeTracePoint = (s: Snapshot, dAlpha: number, elmActive: boolean, dtRecorded: number): TracePoint => {
      const raw = currentDeviceObjRef.current ? computeFusion(s, currentDeviceObjRef.current).p_fus : 0
      // Fusion reactions are concentrated in the hot core, which acts as a
      // thermal low-pass filter; edge ELM crashes don't affect the core
      // fusion rate on ELM timescales.
      const tau = Math.max(s.tau_e ?? 0.1, 0.05)
      const alpha = Math.min(dtRecorded / tau, 1.0)
      pFusSmoothedRef.current += (raw - pFusSmoothedRef.current) * alpha
      return {
        t: s.time,
        ip: s.ip,
        te0: s.te0,
        ne_bar: s.ne_bar,
        w_th: s.w_th,
        p_input: s.p_input,
        p_rad: s.p_rad,
        p_loss: s.p_loss,
        d_alpha: dAlpha,
        beta_n: s.beta_n,
        disruption_risk: s.disruption_risk,
        li: s.li,
        q95: s.q95,
        v_loop: s.diagnostics.v_loop,
        psi_oh: s.flux_consumed ?? 0,
        i_ni: (s.i_bootstrap ?? 0) + (s.i_cd ?? 0),
        h_factor: s.h_factor,
        f_greenwald: s.f_greenwald,
        ne_ped: s.ne_ped,
        te_ped: s.te_ped,
        ne_line: s.ne_line,
        impurity_fraction: s.impurity_fraction,
        p_fus: pFusSmoothedRef.current,
        elm_suppressed: s.elm_suppressed,
        elm_active: elmActive,
        in_hmode: s.in_hmode,
      }
    }
    let snap: Snapshot | null = null
    // Track peak Dα and any ELM across all sub-steps so that ELMs
    // are reliably captured even when many physics steps are skipped.
    // The simulation runs multiple steps per animation frame; an ELM
    // might fire on step 1 and its cooldown expire by step 3, so the
    // final snapshot would show elm_active=false. Latching here ensures
    // every ELM triggers the label, portview flash, and divertor spike.
    let maxDAlpha = 0
    let anyElmActive = false
    let elmEnergyLoss = 0
    let elmType = 0

    const totalSteps = tickBatches * STEPS_PER_TICK
    // Fixed budget of simulated time per tick. Outside a quench that is
    // totalSteps coarse steps; inside one it is many fine steps, each of
    // which is recorded as its own trace point.
    const budget = totalSteps * DT
    let advanced = 0
    let lastWasFine = false
    let prev: Snapshot | null = lastRawSnapshotRef.current ?? snapshotHistoryRef.current[snapshotHistoryRef.current.length - 1] ?? null
    while (advanced < budget - 1e-9) {
      const fine = inQuench(prev)
      const dt = fine ? DT_QUENCH : DT
      const json = sim.step(dt)
      snap = JSON.parse(json)
      advanced += dt
      lastWasFine = fine
      if (snap) {
        if (logCtxRef.current) deriveEvents(prev, snap, logCtxRef.current, eventsRef.current)
        prev = snap
        if (snap.diagnostics.d_alpha > maxDAlpha) maxDAlpha = snap.diagnostics.d_alpha
        if (snap.elm_active) {
          anyElmActive = true
          elmType = snap.elm_type ?? elmType
          elmEnergyLoss = Math.max(snap.elm_energy_loss ?? 0, elmEnergyLoss)
        }
        if (fine) {
          historyRef.current.push(makeTracePoint(snap, snap.diagnostics.d_alpha, snap.elm_active, dt))
        }
      }
      if (snap && (snap.status === 'Complete' || snap.status === 'Disrupted')) {
        runningRef.current = false
        break
      }
    }

    if (snap) lastRawSnapshotRef.current = { ...snap }

    // Patch the final snapshot with latched ELM state from any sub-step
    if (snap && anyElmActive) {
      snap.elm_active = true
      if (elmType) snap.elm_type = elmType
      if (elmEnergyLoss) snap.elm_energy_loss = elmEnergyLoss
    }

    if (snap) {
      // Append the tick-level trace point, unless the quench loop above has
      // already recorded this snapshot at fine resolution.
      if (!lastWasFine) {
        historyRef.current.push(makeTracePoint(snap, maxDAlpha, anyElmActive, totalSteps * DT))
      }
      if (historyRef.current.length > MAX_TRACE_HISTORY) {
        historyRef.current = historyRef.current.slice(-MAX_TRACE_HISTORY)
      }

      // Append to full snapshot history (for scrubbing) — separate, smaller limit
      snapshotHistoryRef.current.push(snap)
      if (snapshotHistoryRef.current.length > MAX_SNAPSHOT_HISTORY) {
        snapshotHistoryRef.current = snapshotHistoryRef.current.slice(-MAX_SNAPSHOT_HISTORY)
      }

      // Capture profile frame every 50ms for post-pulse viewing
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
        // Post-pulse: process accumulated profile frames (only once)
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
          events: eventsRef.current,
          pulseNumber: pulseNumberRef.current,
          previousPulse: previousPulseRef.current,
          elmCount: logCtxRef.current?.elmCount ?? 0,
          disruptionTime: logCtxRef.current?.disruptionTime ?? null,
        }
      })
    }

    if (runningRef.current) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [])

  const start = useCallback(() => {
    if (!simRef.current) return
    // A fresh pulse (nothing recorded yet) gets the next pulse number and a
    // new log; resuming from Pause keeps both.
    if (pulseNumberRef.current === null) {
      pulseNumberRef.current = nextPulseNumber()
      eventsRef.current = []
      let program = null
      try { program = JSON.parse(programJsonRef.current) } catch { /* no programme */ }
      logCtxRef.current = newLogContext(
        pulseNumberRef.current,
        currentDeviceObjRef.current?.name ?? currentDeviceRef.current,
        program,
      )
    }
    runningRef.current = true
    setState((s) => ({ ...s, running: true, pulseNumber: pulseNumberRef.current, events: eventsRef.current }))
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
    archivePulse()
    historyRef.current = []
    pFusSmoothedRef.current = 0
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
      events: [],
      pulseNumber: null,
      previousPulse: previousPulseRef.current,
      elmCount: 0,
      disruptionTime: null,
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

  const setMassNumber = useCallback((mass: number | null) => {
    massOverrideRef.current = mass
    // Recreate the sim with the new fuel — this re-runs createSim which
    // applies the massOverride after constructing the SimHandle.
    cancelAnimationFrame(rafRef.current)
    createSim(currentDeviceRef.current, currentPresetRef.current)
  }, [createSim])

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
    () => ({ start, pause, reset, switchPreset, runProgram, setScrubTime, setSpeed, setMassNumber }),
    [start, pause, reset, switchPreset, runProgram, setScrubTime, setSpeed, setMassNumber],
  )

  return [state, controls]
}
