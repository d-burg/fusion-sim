import type { PresetId, PulseProgram, WaveformPoint } from './wasm'

/* ─── Types ─────────────────────────────────────────────── */

export interface ScalarParam {
  key: string
  label: string
  unit: string
  waveformKey: keyof PulseProgram
  min: number
  max: number
  step: number
  precision: number
  /** Particle sources: the range scales with plasma volume so the same
   *  fraction is reachable on every machine (base ranges are DIII-D's). */
  scalesWithVolume?: boolean
}

/** DIII-D plasma volume (m³), the reference for volume-scaled ranges. */
export const REFERENCE_VOLUME = 19.4

/** The channel's slider range for a given device. */
export function paramRange(param: ScalarParam, deviceVolume: number | undefined): { min: number; max: number; step: number } {
  if (!param.scalesWithVolume || !deviceVolume || deviceVolume <= 0) {
    return { min: param.min, max: param.max, step: param.step }
  }
  // One decimal in the scale factor keeps max an exact multiple of step
  // (the base max is one), so number inputs never flag the range invalid.
  const k = Math.max(0.1, Math.round((deviceVolume / REFERENCE_VOLUME) * 10) / 10)
  return { min: param.min * k, max: param.max * k, step: param.step * k }
}

export type MagneticConfig = 'LowerSingleNull' | 'DoubleNull' | 'UpperSingleNull'

export type OverrideValue = number | WaveformPoint[] | null

/** Everything the program page hands to the control room through router state. */
export type ProgramHandoff = {
  programJson: string
  presetId: PresetId
  overrides: Record<string, OverrideValue>
  durationOverride: number | null
  configOverride: MagneticConfig | null
}

/* ─── Seeding gas lines per device ──────────────────────── */

export type SeedingKey = 'n2_puff' | 'neon_puff' | 'argon_puff'

/**
 * Which seeding species each machine has, or would have, on its gas
 * system. DIII-D (carbon wall) has run nitrogen, neon and argon in
 * radiative-divertor experiments. JET with the ITER-like wall used nitrogen
 * for the divertor and neon as the ITER-relevant species, with argon from
 * its carbon-wall era. ITER plans neon as the baseline and argon for core
 * radiation; nitrogen is avoided because it forms ammonia with tritium.
 * CENTAUR follows SPARC, whose divertor paper (Kuang et al. 2020) scales
 * the nitrogen and neon fractions needed for dissipative operation.
 */
export const DEVICE_SEEDING: Record<string, SeedingKey[]> = {
  diiid: ['n2_puff', 'neon_puff', 'argon_puff'],
  jet: ['n2_puff', 'neon_puff', 'argon_puff'],
  iter: ['neon_puff', 'argon_puff'],
  centaur: ['n2_puff', 'neon_puff'],
}
const SEEDING_KEYS: SeedingKey[] = ['n2_puff', 'neon_puff', 'argon_puff']

/** Whether a planner channel is available on this device (seeding channels
 *  depend on the machine's gas lines; everything else is universal). */
export function channelAvailable(key: string, deviceId: string | undefined): boolean {
  if (!(SEEDING_KEYS as string[]).includes(key)) return true
  const lines = deviceId ? DEVICE_SEEDING[deviceId] : undefined
  return lines ? lines.includes(key as SeedingKey) : true
}

/* ─── Parameter definitions ─────────────────────────────── */

export const SCALAR_PARAMS: ScalarParam[] = [
  { key: 'ip', label: 'Iₚ flat-top', unit: 'MA', waveformKey: 'ip', min: 0.1, max: 20, step: 0.1, precision: 1 },
  { key: 'p_nbi', label: 'NBI power', unit: 'MW', waveformKey: 'p_nbi', min: 0, max: 40, step: 0.5, precision: 1 },
  { key: 'p_ech', label: 'ECH power', unit: 'MW', waveformKey: 'p_ech', min: 0, max: 20, step: 0.5, precision: 1 },
  { key: 'ne', label: 'Density target', unit: '10²⁰m⁻³', waveformKey: 'ne_target', min: 0.1, max: 3.0, step: 0.05, precision: 2 },
  { key: 'd2_puff', label: 'D₂ gas puff', unit: '10²⁰/s', waveformKey: 'd2_puff', min: 0, max: 10, step: 0.5, precision: 1, scalesWithVolume: true },
  { key: 'n2_puff', label: 'Nitrogen seeding', unit: '10²⁰/s', waveformKey: 'n2_puff', min: 0, max: 2.0, step: 0.05, precision: 2, scalesWithVolume: true },
  { key: 'neon_puff', label: 'Neon seeding', unit: '10²⁰/s', waveformKey: 'neon_puff', min: 0, max: 2.0, step: 0.05, precision: 2, scalesWithVolume: true },
  { key: 'argon_puff', label: 'Argon seeding', unit: '10²⁰/s', waveformKey: 'argon_puff', min: 0, max: 1.0, step: 0.02, precision: 2, scalesWithVolume: true },
  { key: 'kappa', label: 'Elongation κ', unit: '', waveformKey: 'kappa', min: 1.0, max: 2.2, step: 0.05, precision: 2 },
  { key: 'delta', label: 'Triangularity δ', unit: '', waveformKey: 'delta', min: -0.6, max: 0.8, step: 0.05, precision: 2 },
]

/* ─── Per-device duration limits ───────────────────────── */

export const DURATION_MAX: Record<string, number> = {
  diiid: 10,
  jet:   60,
  iter:  400,
}

/* ─── Helpers ───────────────────────────────────────────── */

/** Find the flat-top value of a waveform (the maximum value). */
export function getFlatTopValue(waveform: WaveformPoint[]): number {
  if (waveform.length === 0) return 0
  return Math.max(...waveform.map((p) => p[1]))
}

/**
 * Scale a waveform so its flat-top (max) value equals `newValue`.
 * Preserves the ramp shape by applying a uniform scale factor.
 * When the base waveform is all-zeros, creates a heating-phase-aligned
 * ramp (20%→80% of duration) instead of a flat constant.
 */
export function scaleWaveform(waveform: WaveformPoint[], newValue: number): WaveformPoint[] {
  const oldMax = getFlatTopValue(waveform)
  if (oldMax <= 0) {
    // Base waveform is all zeros — create a ramp during the mid-pulse
    // phase (well after H-mode transition, before rampdown) so that
    // impurity seeding doesn't radiate away a cold startup plasma.
    const tEnd = waveform.length > 0 ? waveform[waveform.length - 1][0] : 10
    const tOn = tEnd * 0.30   // start ramp at 30% of duration
    const tFlat = tEnd * 0.35 // reach flat-top at 35%
    const tOff = tEnd * 0.70  // start ramp-down at 70%
    const tDown = tEnd * 0.75 // off by 75%
    return [
      [0, 0],
      [tOn, 0],
      [tFlat, newValue],
      [tOff, newValue],
      [tDown, 0],
      [tEnd, 0],
    ]
  }
  const factor = newValue / oldMax
  return waveform.map(([t, v]) => [t, v * factor])
}

/** Every waveform channel of a programme, in `PulseProgram` order. */
const WAVEFORM_KEYS: (keyof PulseProgram)[] = [
  'ip', 'bt', 'ne_target', 'p_nbi', 'p_ech', 'p_ich', 'kappa', 'delta', 'd2_puff', 'neon_puff',
]

/**
 * The waveform a channel actually carries once overrides are applied:
 * a drawn array is used as-is, a scalar scales the base, nothing leaves
 * the base untouched.
 */
export function effectiveWaveform(
  base: PulseProgram,
  overrides: Record<string, OverrideValue>,
  param: ScalarParam,
): WaveformPoint[] {
  const ov = overrides[param.key]
  if (ov !== null && ov !== undefined) {
    if (Array.isArray(ov)) return ov
    return scaleWaveform(base[param.waveformKey] as WaveformPoint[], ov)
  }
  return base[param.waveformKey] as WaveformPoint[]
}

/**
 * Build the modified pulse programme from a base preset plus the
 * planner/program-page overrides. Channel overrides first, then the
 * duration rescales the time axis of every channel, then the magnetic
 * configuration.
 */
export function buildProgram(
  base: PulseProgram,
  overrides: Record<string, OverrideValue>,
  durationOverride: number | null,
  configOverride: MagneticConfig | null,
): PulseProgram {
  const modified: PulseProgram = { ...base }

  // Apply waveform overrides
  for (const param of SCALAR_PARAMS) {
    const ov = overrides[param.key]
    if (ov !== null && ov !== undefined) {
      if (Array.isArray(ov)) {
        // Drawn waveform → use directly
        ;(modified as unknown as Record<string, unknown>)[param.waveformKey] = ov
      } else {
        // Scalar → scale the base waveform
        const wf = base[param.waveformKey] as WaveformPoint[]
        ;(modified as unknown as Record<string, unknown>)[param.waveformKey] = scaleWaveform(wf, ov)
      }
    }
  }

  // Apply duration override — scale time axis of all waveforms
  if (durationOverride !== null && durationOverride !== base.duration) {
    const timeScale = durationOverride / base.duration
    modified.duration = durationOverride
    for (const k of WAVEFORM_KEYS) {
      const wf = modified[k] as WaveformPoint[]
      ;(modified as unknown as Record<string, unknown>)[k] = wf.map(([t, v]) => [t * timeScale, v] as WaveformPoint)
    }
  }

  // Apply magnetic config override
  if (configOverride) {
    modified.config_override = configOverride
  }

  return modified
}
