/**
 * The envelope matrix: every pulse program a visitor can reach from the
 * planner with one control moved at a time, built through the same
 * `buildProgram` path the planner uses. The Rust envelope test
 * (`crates/tok-sym-core/tests/envelope.rs`) runs every entry through the
 * native engine and checks the outputs for plausibility, so the fixture it
 * reads must be regenerated whenever a preset, a slider range or the program
 * builder changes:
 *
 *   npm run matrix:emit
 *
 * `npm run matrix:check` fails when the committed fixture is stale.
 */
import type { Device, PresetId, PulseProgram } from './wasm'
import {
  buildProgram,
  channelAvailable,
  paramRange,
  DURATION_MAX,
  SCALAR_PARAMS,
  type MagneticConfig,
  type OverrideValue,
} from './program'

export const PRESETS: PresetId[] = ['hmode', 'lmode', 'density_limit']
export const MAGNETIC_CONFIGS: MagneticConfig[] = ['LowerSingleNull', 'DoubleNull', 'UpperSingleNull']
/** Slider levels as fractions of the device-scaled range. */
export const SLIDER_LEVELS = [0, 0.25, 0.5, 0.75, 1]
/** The planner's duration slider runs from 1 s to the device limit (30 s when unlisted). */
export const DURATION_MIN = 1
export const DURATION_FALLBACK = 30

export interface MatrixEntry {
  /** `<device>/<preset>/<knob>/<level>` */
  id: string
  device: string
  preset: PresetId
  /** A slider key, `duration`, `fuel`, `config`, or `base` for the untouched preset. */
  knob: string
  level: number
  /** The slider value, duration in seconds, mass number, or configuration name. */
  value: number | string | null
  /** Mass number the control room applies after construction; null leaves the device default. */
  mass_number: number | null
  program: PulseProgram
}

/** Fuel the control room selects when a device is opened (DT on the DT machines). */
export function defaultMassNumber(deviceId: string): number | null {
  return deviceId === 'iter' || deviceId === 'jet' ? 2.5 : null
}

/** Snap a value to the slider's step from its minimum, as the range input does. */
export function snapToStep(value: number, min: number, step: number): number {
  const snapped = min + Math.round((value - min) / step) * step
  return Number(snapped.toPrecision(10))
}

export function durationLevels(deviceId: string): number[] {
  const max = DURATION_MAX[deviceId] ?? DURATION_FALLBACK
  return SLIDER_LEVELS.map((f) => (f === 0 ? DURATION_MIN : Number((max * f).toPrecision(10))))
}

/**
 * Enumerate the matrix for the given devices. `getPreset` returns the base
 * preset program for a device, as the wasm API does.
 */
export function generateMatrix(
  devices: Device[],
  getPreset: (deviceId: string, preset: PresetId) => PulseProgram | null,
): MatrixEntry[] {
  const out: MatrixEntry[] = []
  for (const device of devices) {
    for (const preset of PRESETS) {
      const base = getPreset(device.id, preset)
      if (!base) throw new Error(`no ${preset} preset for ${device.id}`)
      const mass = defaultMassNumber(device.id)
      const add = (knob: string, level: number, value: number | string | null, program: PulseProgram, massNumber = mass) =>
        out.push({ id: `${device.id}/${preset}/${knob}/${level}`, device: device.id, preset, knob, level, value, mass_number: massNumber, program })

      add('base', 0, null, buildProgram(base, {}, null, null))

      // The other fuel: DD machines offered DT, DT machines offered DD.
      add('fuel', 0, mass === null ? 2.5 : 2.0, buildProgram(base, {}, null, null), mass === null ? 2.5 : 2.0)

      for (const [level, duration] of durationLevels(device.id).entries()) {
        if (duration === base.duration) continue
        add('duration', level, duration, buildProgram(base, {}, duration, null))
      }

      if (device.id === 'diiid') {
        for (const [level, cfg] of MAGNETIC_CONFIGS.entries()) {
          add('config', level, cfg, buildProgram(base, {}, null, cfg))
        }
      }

      for (const param of SCALAR_PARAMS) {
        if (!channelAvailable(param.key, device.id)) continue
        const range = paramRange(param, device)
        for (const [level, f] of SLIDER_LEVELS.entries()) {
          const value = snapToStep(range.min + f * (range.max - range.min), range.min, range.step)
          const overrides: Record<string, OverrideValue> = { [param.key]: value }
          add(param.key, level, value, buildProgram(base, overrides, null, null))
        }
      }
    }
  }
  return out
}

/** Stable serialization of the matrix, one entry per line. */
export function serializeMatrix(entries: MatrixEntry[]): string {
  return `[\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`
}
