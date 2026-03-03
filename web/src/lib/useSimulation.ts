import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SimHandle, type PresetId, getPreset } from './wasm'
import type { Snapshot, TracePoint } from './types'

const DT = 0.005 // 5 ms physics timestep
const MAX_HISTORY = 2000 // ring buffer length (~10 s at 200 Hz display)

export interface SimState {
  snapshot: Snapshot | null            // live (latest) snapshot
  displaySnapshot: Snapshot | null     // scrubbed or live — for rendering components
  history: TracePoint[]
  snapshotHistory: Snapshot[]          // full snapshots for scrub→equilibrium sync
  running: boolean
  wallJson: string
  programJson: string                  // current discharge program JSON for target traces
  scrubIndex: number | null            // null = live, number = index into snapshotHistory
  finished: boolean                    // true when status is Complete or Disrupted
}

export interface SimControls {
  start: () => void
  pause: () => void
  reset: () => void
  switchPreset: (deviceId: string, preset: PresetId) => void
  runProgram: (deviceId: string, programJson: string) => void
  setScrubIndex: (index: number | null) => void
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

  const [state, setState] = useState<SimState>({
    snapshot: null,
    displaySnapshot: null,
    history: [],
    snapshotHistory: [],
    running: false,
    wallJson: '[]',
    programJson: '{}',
    scrubIndex: null,
    finished: false,
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
      scrubIndex: null,
      finished: false,
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
      scrubIndex: null,
      finished: false,
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

    for (let i = 0; i < stepsThisFrame; i++) {
      const json = sim.step(DT)
      snap = JSON.parse(json)
      if (snap && (snap.status === 'Complete' || snap.status === 'Disrupted')) {
        runningRef.current = false
        break
      }
    }

    if (snap) {
      // Append to trace history ring buffer
      const pt: TracePoint = {
        t: snap.time,
        ip: snap.ip,
        te0: snap.te0,
        ne_bar: snap.ne_bar,
        w_th: snap.w_th,
        p_input: snap.p_input,
        p_rad: snap.p_rad,
        p_loss: snap.p_loss,
        d_alpha: snap.diagnostics.d_alpha,
        beta_n: snap.beta_n,
        disruption_risk: snap.disruption_risk,
        li: snap.li,
        q95: snap.q95,
        v_loop: snap.diagnostics.v_loop,
      }
      historyRef.current.push(pt)
      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current = historyRef.current.slice(-MAX_HISTORY)
      }

      // Append to full snapshot history (for scrubbing)
      snapshotHistoryRef.current.push(snap)
      if (snapshotHistoryRef.current.length > MAX_HISTORY) {
        snapshotHistoryRef.current = snapshotHistoryRef.current.slice(-MAX_HISTORY)
      }

      const isFinished = snap.status === 'Complete' || snap.status === 'Disrupted'

      setState({
        snapshot: snap,
        displaySnapshot: snap,
        history: historyRef.current,
        snapshotHistory: snapshotHistoryRef.current,
        running: runningRef.current,
        wallJson: wallJsonRef.current,
        programJson: programJsonRef.current,
        scrubIndex: null,
        finished: isFinished,
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
    setState((s) => ({
      ...s,
      snapshot: null,
      displaySnapshot: null,
      history: [],
      snapshotHistory: [],
      running: false,
      scrubIndex: null,
      finished: false,
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

  const setScrubIndex = useCallback((index: number | null) => {
    setState((prev) => {
      const displaySnapshot =
        index !== null && prev.snapshotHistory[index]
          ? prev.snapshotHistory[index]
          : prev.snapshot
      return {
        ...prev,
        scrubIndex: index,
        displaySnapshot,
      }
    })
  }, [])

  // Memoize controls to keep a stable reference
  const controls = useMemo<SimControls>(
    () => ({ start, pause, reset, switchPreset, runProgram, setScrubIndex, setSpeed }),
    [start, pause, reset, switchPreset, runProgram, setScrubIndex, setSpeed],
  )

  return [state, controls]
}
