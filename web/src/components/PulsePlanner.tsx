import { useCallback, useMemo, useState } from 'react'
import WaveformDrawer from './WaveformDrawer'
import {
  getPreset,
  getDevice,
  type PresetId,
  type PulseProgram,
  type WaveformPoint,
} from '../lib/wasm'

/* ─── Types ─────────────────────────────────────────────── */

interface ScalarParam {
  key: string
  label: string
  unit: string
  waveformKey: keyof PulseProgram
  min: number
  max: number
  step: number
  precision: number
}

type MagneticConfig = 'LowerSingleNull' | 'DoubleNull' | 'UpperSingleNull'

type OverrideValue = number | WaveformPoint[] | null

interface Props {
  deviceId: string
  onRun: (deviceId: string, programJson: string) => void
  onClose: () => void
  /* Lifted state from ControlRoom — persists across open/close */
  overrides: Record<string, OverrideValue>
  onOverridesChange: (overrides: Record<string, OverrideValue>) => void
  durationOverride: number | null
  onDurationChange: (d: number | null) => void
  basePreset: PresetId
  onPresetChange: (p: PresetId) => void
  configOverride: MagneticConfig | null
  onConfigChange: (cfg: MagneticConfig | null) => void
}

/* ─── Parameter definitions ─────────────────────────────── */

const SCALAR_PARAMS: ScalarParam[] = [
  { key: 'ip', label: 'Iₚ flat-top', unit: 'MA', waveformKey: 'ip', min: 0.1, max: 20, step: 0.1, precision: 1 },
  { key: 'p_nbi', label: 'NBI power', unit: 'MW', waveformKey: 'p_nbi', min: 0, max: 40, step: 0.5, precision: 1 },
  { key: 'p_ech', label: 'ECH power', unit: 'MW', waveformKey: 'p_ech', min: 0, max: 20, step: 0.5, precision: 1 },
  { key: 'p_ich', label: 'ICRF power', unit: 'MW', waveformKey: 'p_ich', min: 0, max: 40, step: 0.5, precision: 1 },
  { key: 'ne', label: 'Density target', unit: '10²⁰m⁻³', waveformKey: 'ne_target', min: 0.1, max: 3.0, step: 0.05, precision: 2 },
  { key: 'd2_puff', label: 'D₂ gas puff', unit: '10²⁰/s', waveformKey: 'd2_puff', min: 0, max: 10, step: 0.5, precision: 1 },
  { key: 'neon_puff', label: 'Neon seeding', unit: '10²⁰/s', waveformKey: 'neon_puff', min: 0, max: 2.0, step: 0.05, precision: 2 },
  { key: 'kappa', label: 'Elongation κ', unit: '', waveformKey: 'kappa', min: 1.0, max: 2.2, step: 0.05, precision: 2 },
  { key: 'delta', label: 'Triangularity δ', unit: '', waveformKey: 'delta', min: -0.6, max: 0.8, step: 0.05, precision: 2 },
]

/* ─── Heating systems a device actually has ─────────────── */

/**
 * Auxiliary heating a device physically possesses. Anything omitted here is
 * rendered disabled and pinned at zero — the planner should not let a user dial
 * in power the machine cannot produce.
 *
 * SPARC is the pointed case: its sole auxiliary heating is 25 MW of 120 MHz
 * ICRF. It has no neutral beams, and electron cyclotron heating is not viable
 * because the resonance at 12.2 T would need sources above 300 GHz, which do
 * not exist (Creely et al. 2020 §3; Rodriguez-Fernandez et al., Phys. Plasmas
 * 30, 090601, 2023).
 */
const HEATING_SYSTEMS: Record<string, { p_nbi: boolean; p_ech: boolean; p_ich: boolean }> = {
  diiid:   { p_nbi: true,  p_ech: true,  p_ich: false },
  jet:     { p_nbi: true,  p_ech: false, p_ich: true },
  iter:    { p_nbi: true,  p_ech: true,  p_ich: true },
  sparc:   { p_nbi: false, p_ech: false, p_ich: true },
  centaur: { p_nbi: false, p_ech: false, p_ich: true },
}

/** Why a heating knob is unavailable, shown on the disabled control. */
const HEATING_UNAVAILABLE_REASON: Record<string, Record<string, string>> = {
  sparc: {
    p_nbi: 'SPARC has no neutral beam injection',
    p_ech: 'No ECH — the resonance at 12.2 T needs >300 GHz sources',
  },
  centaur: {
    p_nbi: 'ICRH-only design',
    p_ech: 'ICRH-only design',
  },
}

/* ─── Per-device duration limits ───────────────────────── */

const DURATION_MAX: Record<string, number> = {
  diiid: 10,
  jet:   60,
  iter:  400,
}

/* ─── Helpers ───────────────────────────────────────────── */

/** Find the flat-top value of a waveform (the maximum value). */
function getFlatTopValue(waveform: WaveformPoint[]): number {
  if (waveform.length === 0) return 0
  return Math.max(...waveform.map((p) => p[1]))
}

/**
 * Scale a waveform so its flat-top (max) value equals `newValue`.
 * Preserves the ramp shape by applying a uniform scale factor.
 * When the base waveform is all-zeros, creates a heating-phase-aligned
 * ramp (20%→80% of duration) instead of a flat constant.
 */
function scaleWaveform(waveform: WaveformPoint[], newValue: number): WaveformPoint[] {
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

/** Tiny sparkline SVG of a waveform. */
function WaveformSparkline({ waveform, color }: { waveform: WaveformPoint[]; color: string }) {
  if (waveform.length < 2) return null

  const tMax = waveform[waveform.length - 1][0]
  const vMax = Math.max(...waveform.map((p) => p[1]), 0.01)

  const W = 110
  const H = 24
  const padding = 2

  const points = waveform
    .map(([t, v]) => {
      const x = padding + ((t / tMax) * (W - 2 * padding))
      const y = H - padding - ((v / vMax) * (H - 2 * padding))
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" opacity="0.7" />
    </svg>
  )
}

/* ─── Component ─────────────────────────────────────────── */

export default function PulsePlanner({
  deviceId,
  onRun,
  onClose,
  overrides,
  onOverridesChange,
  durationOverride,
  onDurationChange,
  basePreset,
  onPresetChange,
  configOverride,
  onConfigChange,
}: Props) {
  // Load the base program from the selected preset
  const baseProgram = useMemo(() => getPreset(deviceId, basePreset), [deviceId, basePreset])
  const device = useMemo(() => getDevice(deviceId), [deviceId])

  // Get the effective value for a parameter
  const getEffectiveValue = useCallback(
    (param: ScalarParam): number => {
      const ov = overrides[param.key]
      if (ov !== null && ov !== undefined) {
        // Array override (drawn waveform) → use its flat-top value
        if (Array.isArray(ov)) return getFlatTopValue(ov)
        return ov
      }
      if (!baseProgram) return 0
      const wf = baseProgram[param.waveformKey] as WaveformPoint[]
      return getFlatTopValue(wf)
    },
    [overrides, baseProgram],
  )

  // Get the effective waveform (with scaling or drawn waveform)
  const getEffectiveWaveform = useCallback(
    (param: ScalarParam): WaveformPoint[] => {
      if (!baseProgram) return []
      const ov = overrides[param.key]
      if (ov !== null && ov !== undefined) {
        // Array override → use the drawn waveform directly
        if (Array.isArray(ov)) return ov
        // Scalar override → scale the base waveform
        const wf = baseProgram[param.waveformKey] as WaveformPoint[]
        return scaleWaveform(wf, ov)
      }
      return baseProgram[param.waveformKey] as WaveformPoint[]
    },
    [overrides, baseProgram],
  )

  const effectiveDuration = durationOverride ?? baseProgram?.duration ?? 10
  const [drawingParam, setDrawingParam] = useState<string | null>(null)

  // Build the modified program and run
  const handleRun = useCallback(() => {
    if (!baseProgram) return

    const modified: PulseProgram = { ...baseProgram }

    // Apply waveform overrides
    const systems = HEATING_SYSTEMS[deviceId]
    for (const param of SCALAR_PARAMS) {
      // Hard-zero heating the device does not have, whatever the UI or a
      // stale override says. There must be no path to running SPARC with NBI
      // or ECH power.
      if (systems && (param.key === 'p_nbi' || param.key === 'p_ech' || param.key === 'p_ich')) {
        if (!systems[param.key as 'p_nbi' | 'p_ech' | 'p_ich']) {
          const wf = baseProgram[param.waveformKey] as WaveformPoint[]
          ;(modified as unknown as Record<string, unknown>)[param.waveformKey] =
            wf.map(([t]) => [t, 0] as WaveformPoint)
          continue
        }
      }
      const ov = overrides[param.key]
      if (ov !== null && ov !== undefined) {
        if (Array.isArray(ov)) {
          // Drawn waveform → use directly
          ;(modified as unknown as Record<string, unknown>)[param.waveformKey] = ov
        } else {
          // Scalar → scale the base waveform
          const wf = baseProgram[param.waveformKey] as WaveformPoint[]
          ;(modified as unknown as Record<string, unknown>)[param.waveformKey] = scaleWaveform(wf, ov)
        }
      }
    }

    // Apply duration override — scale time axis of all waveforms
    if (durationOverride !== null && durationOverride !== baseProgram.duration) {
      const timeScale = durationOverride / baseProgram.duration
      modified.duration = durationOverride
      const waveformKeys: (keyof PulseProgram)[] = ['ip', 'bt', 'ne_target', 'p_nbi', 'p_ech', 'p_ich', 'kappa', 'delta', 'd2_puff', 'neon_puff']
      for (const k of waveformKeys) {
        const wf = modified[k] as WaveformPoint[]
        ;(modified as unknown as Record<string, unknown>)[k] = wf.map(([t, v]) => [t * timeScale, v] as WaveformPoint)
      }
    }

    // Apply magnetic config override
    if (configOverride) {
      modified.config_override = configOverride
    }

    onRun(deviceId, JSON.stringify(modified))
  }, [baseProgram, overrides, durationOverride, configOverride, deviceId, onRun])

  if (!baseProgram || !device) {
    return (
      <div className="p-4 text-gray-500 font-mono text-sm">
        Loading program data…
      </div>
    )
  }

  const paramColors: Record<string, string> = {
    ip: '#22d3ee',
    p_nbi: '#3b82f6',
    p_ech: '#8b5cf6',
    p_ich: '#f472b6',
    ne: '#a78bfa',
    d2_puff: '#60a5fa',
    neon_puff: '#86efac',
    kappa: '#f59e0b',
    delta: '#ef4444',
  }

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-[#0d1117] border-l border-gray-700 z-50
                    flex flex-col shadow-2xl shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <div>
          <h2 className="panel-title">Pulse Planner</h2>
          <p className="text-[9px] text-gray-600 mt-0.5">Click any trace to draw a custom waveform</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors cursor-pointer text-lg"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Preset selector */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Base preset</label>
          <div className="flex rounded overflow-hidden border border-gray-700 mt-1">
            {(deviceId === 'centaur'
              ? (['hmode', 'density_limit'] as PresetId[])
              : (['hmode', 'lmode', 'density_limit'] as PresetId[])
            ).map((p) => (
              <button
                key={p}
                onClick={() => onPresetChange(p)}
                className={`flex-1 px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer
                  ${
                    basePreset === p
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
              >
                {p === 'hmode' ? (
                  deviceId === 'centaur' ? 'NT-edge' : deviceId === 'sparc' ? 'QCE' : 'H-mode'
                ) : p === 'lmode' ? (
                  'L-mode'
                ) : (
                  // Spelled out rather than abbreviated; shrunk so it still
                  // fits the shared button width alongside "H-mode"/"L-mode".
                  <span className="text-[10px] whitespace-nowrap">Density Limit</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Magnetic config selector — DIII-D only */}
        {deviceId === 'diiid' && (
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Magnetic configuration</label>
            <div className="flex rounded overflow-hidden border border-gray-700 mt-1">
              {([
                ['LowerSingleNull', 'Lower SN'],
                ['DoubleNull', 'Double Null'],
                ['UpperSingleNull', 'Upper SN'],
              ] as [MagneticConfig, string][]).map(([cfg, label]) => (
                <button
                  key={cfg}
                  onClick={() => onConfigChange(configOverride === cfg ? null : cfg)}
                  className={`flex-1 px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer
                    ${
                      configOverride === cfg
                        ? 'bg-purple-600 text-white'
                        : configOverride === null && cfg === 'LowerSingleNull'
                          ? 'bg-gray-700 text-gray-300'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Duration */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Duration</label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="range"
              min={1}
              max={DURATION_MAX[deviceId] ?? 30}
              step={DURATION_MAX[deviceId] && DURATION_MAX[deviceId] > 30 ? 5 : 0.5}
              value={effectiveDuration}
              onChange={(e) => onDurationChange(parseFloat(e.target.value))}
              className="flex-1 accent-cyan-500"
            />
            <input
              type="number"
              min={1}
              max={DURATION_MAX[deviceId] ?? 30}
              step={DURATION_MAX[deviceId] && DURATION_MAX[deviceId] > 30 ? 5 : 0.5}
              value={effectiveDuration}
              onChange={(e) => onDurationChange(parseFloat(e.target.value) || baseProgram.duration)}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs
                         text-cyan-400 font-mono text-right focus:outline-none focus:border-cyan-600"
            />
            <span className="text-[10px] text-gray-500 w-4">s</span>
          </div>
        </div>

        {/* Scalar parameter editors */}
        {SCALAR_PARAMS.map((param) => {
          const value = getEffectiveValue(param)
          const waveform = getEffectiveWaveform(param)
          const color = paramColors[param.key] ?? '#94a3b8'

          // Heating systems the device does not have are shown disabled and
          // pinned at zero rather than hidden, so it is clear *why* the knob
          // is missing rather than looking like an oversight.
          const systems = HEATING_SYSTEMS[deviceId]
          const isHeating = param.key === 'p_nbi' || param.key === 'p_ech' || param.key === 'p_ich'
          const disabled = Boolean(systems && isHeating && !systems[param.key as 'p_nbi' | 'p_ech' | 'p_ich'])
          const reason = disabled
            ? HEATING_UNAVAILABLE_REASON[deviceId]?.[param.key] ?? 'Not installed on this device'
            : undefined

          return (
            <div key={param.key} className={disabled ? 'opacity-40' : undefined}>
              <div className="flex items-center justify-between">
                <label
                  className="text-[10px] text-gray-500 uppercase tracking-wider"
                  title={reason}
                >
                  {param.label}
                  {disabled && <span className="ml-1 normal-case tracking-normal">— not installed</span>}
                </label>
                {disabled ? (
                  <div className="opacity-40" title={reason}>
                    <WaveformSparkline waveform={waveform} color={color} />
                  </div>
                ) : (
                  <button
                    onClick={() => setDrawingParam(param.key)}
                    className="relative cursor-pointer hover:opacity-100 opacity-70 transition-opacity hover:ring-1 hover:ring-cyan-600 rounded group"
                    title="Click to draw waveform"
                  >
                    <span className="absolute -top-1 -right-1 text-[7px] text-cyan-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      ✎
                    </span>
                    <WaveformSparkline waveform={waveform} color={color} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1" title={reason}>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={disabled ? 0 : value}
                  disabled={disabled}
                  onChange={(e) =>
                    onOverridesChange({
                      ...overrides,
                      [param.key]: parseFloat(e.target.value),
                    })
                  }
                  className="flex-1 accent-cyan-500 disabled:cursor-not-allowed"
                />
                <input
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={disabled ? (0).toFixed(param.precision) : value.toFixed(param.precision)}
                  disabled={disabled}
                  onChange={(e) =>
                    onOverridesChange({
                      ...overrides,
                      [param.key]: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs
                             text-cyan-400 font-mono text-right focus:outline-none focus:border-cyan-600
                             disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-gray-500 w-14 truncate">{param.unit}</span>
              </div>
            </div>
          )
        })}

        {/* Device info */}
        <div className="text-[10px] text-gray-600 space-y-0.5 pt-2 border-t border-gray-800">
          <div>Device: {device.name}</div>
          <div>R₀ = {device.r0.toFixed(2)} m, a = {device.a.toFixed(2)} m</div>
          <div>Bₜ,max = {device.bt_max.toFixed(1)} T, Iₚ,max = {device.ip_max.toFixed(1)} MA</div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-800 space-y-2">
        <button
          onClick={() => { onOverridesChange({}); onDurationChange(null); onConfigChange(null) }}
          className="w-full px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-semibold
                     transition-colors cursor-pointer"
        >
          ↺ Reset Parameters
        </button>
        <button
          onClick={handleRun}
          className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold
                     transition-colors cursor-pointer"
        >
          ▶ Run Pulse
        </button>
      </div>

      {/* Waveform drawing panel */}
      {drawingParam && (() => {
        const param = SCALAR_PARAMS.find(p => p.key === drawingParam)
        if (!param || !baseProgram) return null
        const baseWf = baseProgram[param.waveformKey] as WaveformPoint[]
        if (!baseWf || baseWf.length < 2) return null
        const effectiveWf = getEffectiveWaveform(param)
        return (
          <WaveformDrawer
            waveform={effectiveWf}
            baseWaveform={baseWf}
            duration={effectiveDuration}
            label={param.label}
            unit={param.unit}
            color={paramColors[param.key] ?? '#94a3b8'}
            min={param.min}
            max={param.max}
            onSave={(wf) => {
              onOverridesChange({ ...overrides, [param.key]: wf })
              setDrawingParam(null)
            }}
            onClose={() => setDrawingParam(null)}
          />
        )
      })()}
    </div>
  )
}
