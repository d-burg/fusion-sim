import { useCallback, useMemo, useState } from 'react'
import WaveformDrawer from './WaveformDrawer'
import {
  getPreset,
  getDevice,
  type PresetId,
  type WaveformPoint,
} from '../lib/wasm'
import {
  buildProgram,
  effectiveWaveform,
  getFlatTopValue,
  DURATION_MAX,
  SCALAR_PARAMS,
  type MagneticConfig,
  type OverrideValue,
  type ScalarParam,
} from '../lib/program'

/* ─── Types ─────────────────────────────────────────────── */

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

/* ─── Helpers ───────────────────────────────────────────── */

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
      return effectiveWaveform(baseProgram, overrides, param)
    },
    [overrides, baseProgram],
  )

  const effectiveDuration = durationOverride ?? baseProgram?.duration ?? 10
  const [drawingParam, setDrawingParam] = useState<string | null>(null)

  // Build the modified program and run
  const handleRun = useCallback(() => {
    if (!baseProgram) return
    const modified = buildProgram(baseProgram, overrides, durationOverride, configOverride)
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
    ne: '#a78bfa',
    d2_puff: '#60a5fa',
    neon_puff: '#86efac',
    kappa: '#f59e0b',
    delta: '#ef4444',
  }

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-700 z-50
                    flex flex-col shadow-2xl shadow-black/50">
      {/* Header */}
      {/* border-gray-700, not -800: `.border-b.border-gray-800` in index.css is
          the top-nav treatment (translucent + backdrop-blur); this is a drawer
          header, not a nav bar. */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div>
          <h2 className="panel-title">Pulse planner</h2>
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
          <label className="text-xs text-gray-500">Base preset</label>
          <div className="flex rounded overflow-hidden border border-gray-700 mt-1">
            {(deviceId === 'centaur'
              ? (['hmode', 'density_limit'] as PresetId[])
              : (['hmode', 'lmode', 'density_limit'] as PresetId[])
            ).map((p) => (
              <button
                key={p}
                onClick={() => onPresetChange(p)}
                className={`flex-1 px-2 py-1.5 text-sm transition-colors cursor-pointer
                  ${
                    basePreset === p
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
              >
                {p === 'hmode'
                  ? (deviceId === 'centaur' ? 'NT-edge' : 'H-mode')
                  : p === 'lmode' ? 'L-mode' : 'Dens. lim.'}
              </button>
            ))}
          </div>
        </div>

        {/* Magnetic config selector — DIII-D only */}
        {deviceId === 'diiid' && (
          <div>
            <label className="text-xs text-gray-500">Magnetic configuration</label>
            <div className="flex rounded overflow-hidden border border-gray-700 mt-1">
              {([
                ['LowerSingleNull', 'Lower SN'],
                ['DoubleNull', 'Double Null'],
                ['UpperSingleNull', 'Upper SN'],
              ] as [MagneticConfig, string][]).map(([cfg, label]) => (
                <button
                  key={cfg}
                  onClick={() => onConfigChange(configOverride === cfg ? null : cfg)}
                  className={`flex-1 px-2 py-1.5 text-sm transition-colors cursor-pointer
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
          <label className="text-xs text-gray-500">Duration</label>
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
                         text-cyan-400 font-mono tabular-nums text-right focus:outline-none focus:border-cyan-600"
            />
            <span className="text-xs text-gray-500 w-4">s</span>
          </div>
        </div>

        {/* Scalar parameter editors */}
        {SCALAR_PARAMS.map((param) => {
          const value = getEffectiveValue(param)
          const waveform = getEffectiveWaveform(param)
          const color = paramColors[param.key] ?? '#94a3b8'

          return (
            <div key={param.key}>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500">
                  {param.label}
                </label>
                <button
                  onClick={() => setDrawingParam(param.key)}
                  className="relative cursor-pointer rounded"
                  title="Click to draw waveform"
                >
                  <WaveformSparkline waveform={waveform} color={color} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={value}
                  onChange={(e) =>
                    onOverridesChange({
                      ...overrides,
                      [param.key]: parseFloat(e.target.value),
                    })
                  }
                  className="flex-1 accent-cyan-500"
                />
                <input
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={value.toFixed(param.precision)}
                  onChange={(e) =>
                    onOverridesChange({
                      ...overrides,
                      [param.key]: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs
                             text-cyan-400 font-mono tabular-nums text-right focus:outline-none focus:border-cyan-600"
                />
                <span className="text-xs text-gray-500 w-14 truncate">{param.unit}</span>
              </div>
            </div>
          )
        })}

        {/* Device info */}
        <div className="text-xs text-gray-600 space-y-0.5 pt-2 border-t border-gray-800">
          <div>Device: {device.name}</div>
          <div>R₀ = <span className="font-mono tabular-nums">{device.r0.toFixed(2)}</span> m, a = <span className="font-mono tabular-nums">{device.a.toFixed(2)}</span> m</div>
          <div>Bₜ,max = <span className="font-mono tabular-nums">{device.bt_max.toFixed(1)}</span> T, Iₚ,max = <span className="font-mono tabular-nums">{device.ip_max.toFixed(1)}</span> MA</div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-800 space-y-2">
        <button
          onClick={() => { onOverridesChange({}); onDurationChange(null); onConfigChange(null) }}
          className="w-full px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm
                     transition-colors cursor-pointer"
        >
          ↺ Reset parameters
        </button>
        <button
          onClick={handleRun}
          className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm
                     transition-colors cursor-pointer"
        >
          ▶ Run pulse
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
