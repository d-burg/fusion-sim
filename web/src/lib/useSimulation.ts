import { useCallback, useEffect, useRef, useState } from 'react'
import { SimHandle, type PresetId } from './wasm'
import type { Snapshot, TracePoint } from './types'

const DT = 0.005 // 5 ms physics timestep
const MAX_HISTORY = 2000 // ring buffer length (~10 s at 200 Hz display)

export interface SimState {
  snapshot: Snapshot | null
  history: TracePoint[]
  running: boolean
  wallJson: string
}

export interface SimControls {
  start: () => void
  pause: () => void
  reset: () => void
  switchPreset: (deviceId: string, preset: PresetId) => void
}

export function useSimulation(
  initialDeviceId: string,
  initialPreset: PresetId,
): [SimState, SimControls] {
  const simRef = useRef<SimHandle | null>(null)
  const historyRef = useRef<TracePoint[]>([])
  const runningRef = useRef(false)
  const rafRef = useRef<number>(0)
  const wallJsonRef = useRef<string>('[]')

  const [state, setState] = useState<SimState>({
    snapshot: null,
    history: [],
    running: false,
    wallJson: '[]',
  })

  // Create a new sim handle
  const createSim = useCallback((deviceId: string, preset: PresetId) => {
    // Clean up old handle
    if (simRef.current) {
      simRef.current.free()
    }
    const handle = SimHandle.from_preset(deviceId, preset)
    simRef.current = handle
    historyRef.current = []
    wallJsonRef.current = handle.wall_outline_json()
    runningRef.current = false
    setState({
      snapshot: null,
      history: [],
      running: false,
      wallJson: wallJsonRef.current,
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
    // (at 60fps, we want ~0.016s wall time → 3 steps of 5ms = 15ms sim time per frame)
    const stepsPerFrame = 3
    let snap: Snapshot | null = null

    for (let i = 0; i < stepsPerFrame; i++) {
      const json = sim.step(DT)
      snap = JSON.parse(json)
      if (snap && (snap.status === 'Complete' || snap.status === 'Disrupted')) {
        runningRef.current = false
        break
      }
    }

    if (snap) {
      // Append to history ring buffer
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
      }
      historyRef.current.push(pt)
      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current = historyRef.current.slice(-MAX_HISTORY)
      }

      setState({
        snapshot: snap,
        history: historyRef.current,
        running: runningRef.current,
        wallJson: wallJsonRef.current,
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
    setState((s) => ({
      ...s,
      snapshot: null,
      history: [],
      running: false,
    }))
  }, [])

  const switchPreset = useCallback(
    (deviceId: string, preset: PresetId) => {
      cancelAnimationFrame(rafRef.current)
      createSim(deviceId, preset)
    },
    [createSim],
  )

  return [state, { start, pause, reset, switchPreset }]
}
