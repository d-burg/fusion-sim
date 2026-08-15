/**
 * WASM initialization singleton.
 * Call `initWasm()` once at app startup; it caches the result.
 */
import init, {
  get_devices_json,
  get_device_json,
  preset_hmode_json,
  preset_lmode_json,
  preset_density_limit_json,
  SimHandle,
} from '../wasm/tok_sym_core'

let initialized = false
let initPromise: Promise<void> | null = null

export async function initWasm(): Promise<void> {
  if (initialized) return
  if (initPromise) return initPromise
  initPromise = init().then(() => {
    initialized = true
  })
  return initPromise
}

export function isWasmReady(): boolean {
  return initialized
}

/** Device info as returned from the Rust engine. */
export interface Device {
  name: string
  id: string
  r0: number
  a: number
  bt_max: number
  ip_max: number
  /** Separatrix elongation κ_sep — the plasma shape. */
  kappa: number
  /** Areal elongation κ_a = S/(πa²) — what IPB98(y,2) and q* are defined with. */
  kappa_areal: number
  delta_upper: number
  delta_lower: number
  volume: number
  surface_area: number
  mass_number: number
  z_eff: number
  wall_outline: [number, number][]
  config: string
}

/** A waveform point: [time_s, value] */
export type WaveformPoint = [number, number]

/** Pulse program as returned from Rust. */
export interface PulseProgram {
  ip: WaveformPoint[]
  bt: WaveformPoint[]
  ne_target: WaveformPoint[]
  p_nbi: WaveformPoint[]
  p_ech: WaveformPoint[]
  p_ich: WaveformPoint[]
  kappa: WaveformPoint[]
  delta: WaveformPoint[]
  d2_puff: WaveformPoint[]
  neon_puff: WaveformPoint[]
  duration: number
  config_override?: string
}

export function getDevices(): Device[] {
  const json = get_devices_json()
  return JSON.parse(json)
}

export function getDevice(id: string): Device | null {
  const json = get_device_json(id)
  if (!json) return null
  return JSON.parse(json)
}

export type PresetId = 'hmode' | 'lmode' | 'density_limit'

export function getPreset(deviceId: string, preset: PresetId): PulseProgram | null {
  let json = ''
  switch (preset) {
    case 'hmode':
      json = preset_hmode_json(deviceId)
      break
    case 'lmode':
      json = preset_lmode_json(deviceId)
      break
    case 'density_limit':
      json = preset_density_limit_json(deviceId)
      break
  }
  if (!json) return null
  return JSON.parse(json)
}

export { SimHandle }
