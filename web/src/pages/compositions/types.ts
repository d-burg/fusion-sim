import type { ReactNode } from 'react'
import type { Snapshot, TracePoint } from '../../lib/types'
import type { SimState, SimControls, PreviousPulse } from '../../lib/useSimulation'
import type { PresetId, getDevices } from '../../lib/wasm'
import type { ReportRow } from '../../lib/pulseLog'
import type { LogEvent } from '../../lib/pulseLog'

export type DeviceInfo = ReturnType<typeof getDevices>[number]

/**
 * Everything a control-room composition needs, assembled once by
 * ControlRoom.tsx. A composition is a pure layout: it decides WHAT is on
 * screen and HOW it is arranged, and reads/acts only through this object.
 */
export interface ControlRoomContext {
  // ── live simulation ──
  state: SimState
  controls: SimControls
  displaySnapshot: Snapshot | null
  history: TracePoint[]
  running: boolean
  finished: boolean
  scrubTime: number | null
  wallJson: string
  programJson: string
  events: LogEvent[]
  pulseNumber: number | null
  previousPulse: PreviousPulse | null
  /** Achieved-versus-programmed rows; null until the pulse has finished. */
  report: ReportRow[] | null
  /** Snapshot for the 3D port view (null while scrubbing). */
  plasmaSnapshot: Snapshot | null
  /** CAD limiter for the active device, if any. */
  limiterPoints?: [number, number][]
  usesIch: boolean

  // ── derived timing ──
  time: number
  duration: number
  /** 0–100 */
  progress: number

  // ── selections and handlers ──
  activeDevice: string
  devices: DeviceInfo[]
  onDeviceChange: (id: string) => void
  activePreset: PresetId
  presets: { id: PresetId; label: string }[]
  onPresetChange: (id: PresetId) => void
  fuelType: 'DD' | 'DT'
  showsFuelToggle: boolean
  onFuelChange: (fuel: 'DD' | 'DT') => void
  activeSpeed: number
  onSpeedChange: (speed: number) => void
  hasCustomProgram: boolean

  // ── pre-built UI that compositions place where they like ──
  showPlanner: boolean
  togglePlanner: () => void
  /** The pulse-planner drawer element, or null when closed. */
  plannerNode: ReactNode
  /** The settings dropdown (theme, units, tutorial restart). */
  settingsNode: ReactNode
  /** The tutorial overlay element, or null when inactive. */
  tutorialNode: ReactNode
}
