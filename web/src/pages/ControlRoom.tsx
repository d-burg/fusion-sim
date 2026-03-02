import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useSimulation } from '../lib/useSimulation'
import { getDevices, type PresetId } from '../lib/wasm'
import EquilibriumCanvas from '../components/EquilibriumCanvas'
import TimeTraces from '../components/TimeTraces'
import DisruptionGauge from '../components/DisruptionGauge'
import StatusPanel from '../components/StatusPanel'

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'hmode', label: 'H-mode' },
  { id: 'lmode', label: 'L-mode' },
  { id: 'density_limit', label: 'Density limit' },
]

export default function ControlRoom() {
  const { deviceId: routeDeviceId } = useParams<{ deviceId: string }>()
  const [searchParams] = useSearchParams()
  const routePreset = (searchParams.get('preset') || 'hmode') as PresetId

  // Local state so user can switch without navigating
  const [activeDevice, setActiveDevice] = useState(routeDeviceId ?? 'diiid')
  const [activePreset, setActivePreset] = useState<PresetId>(routePreset)

  const devices = useMemo(() => getDevices(), [])

  const [state, controls] = useSimulation(activeDevice, activePreset)
  const { snapshot, history, running, wallJson } = state

  const time = snapshot?.time ?? 0
  const duration = snapshot?.duration ?? 10
  const progress = duration > 0 ? (time / duration) * 100 : 0

  const handleDeviceChange = (newDeviceId: string) => {
    setActiveDevice(newDeviceId)
    controls.switchPreset(newDeviceId, activePreset)
  }

  const handlePresetChange = (newPreset: PresetId) => {
    setActivePreset(newPreset)
    controls.switchPreset(activeDevice, newPreset)
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0e17] overflow-hidden">
      {/* ─── Top bar ─── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 gap-4">
        {/* Device & preset selectors */}
        <div className="flex items-center gap-2">
          {/* Device selector */}
          <select
            value={activeDevice}
            onChange={(e) => handleDeviceChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-cyan-400 text-sm font-bold
                       rounded px-2 py-1.5 cursor-pointer hover:border-cyan-600
                       focus:outline-none focus:border-cyan-500 transition-colors"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <span className="text-gray-700">|</span>

          {/* Preset selector as button group */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePresetChange(p.id)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer
                  ${
                    activePreset === p.id
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                  }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-2">
          {!running ? (
            <button
              onClick={controls.start}
              className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-semibold
                         transition-colors cursor-pointer flex items-center gap-1"
            >
              ▶ Start
            </button>
          ) : (
            <button
              onClick={controls.pause}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-sm font-semibold
                         transition-colors cursor-pointer flex items-center gap-1"
            >
              ⏸ Pause
            </button>
          )}
          <button
            onClick={controls.reset}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-semibold
                       transition-colors cursor-pointer"
          >
            ↺ Reset
          </button>
        </div>

        {/* Time readout */}
        <div className="font-mono text-sm text-gray-400 tabular-nums whitespace-nowrap">
          t = {time.toFixed(3)} s / {duration.toFixed(1)} s
        </div>
      </div>

      {/* ─── Main grid ─── */}
      <div className="flex-1 grid grid-cols-[1fr_1.5fr_280px] grid-rows-[1fr_1fr] gap-2 p-2 min-h-0">
        {/* Left column: Equilibrium (spans 2 rows) */}
        <div className="row-span-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <EquilibriumCanvas snapshot={snapshot} wallJson={wallJson} />
        </div>

        {/* Centre top: Time traces */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <div className="p-1 h-full overflow-y-auto">
            <TimeTraces history={history} duration={duration} />
          </div>
        </div>

        {/* Right top: Disruption gauge */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <DisruptionGauge snapshot={snapshot} />
        </div>

        {/* Centre bottom: Status panel */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <StatusPanel snapshot={snapshot} />
        </div>

        {/* Right bottom: Plasma viewport placeholder */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
          <PlasmaGlow snapshot={snapshot} />
        </div>
      </div>

      {/* ─── Progress bar ─── */}
      <div className="h-1.5 bg-gray-900">
        <div
          className="h-full bg-cyan-500 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

/** Simple placeholder plasma glow — will become WebGL later. */
function PlasmaGlow({ snapshot }: { snapshot: import('../lib/types').Snapshot | null }) {
  if (!snapshot) {
    return <span className="text-gray-600 text-sm font-mono">No plasma</span>
  }

  const temp = Math.min(snapshot.te0 / 10, 1) // 0→1 normalised
  const dens = Math.min(snapshot.ne_bar / 1.5, 1)
  const brightness = temp * dens
  const disrupted = snapshot.disrupted

  // Color shifts from red-orange (cold) to blue-white (hot)
  const r = Math.round(255 - temp * 100)
  const g = Math.round(100 + temp * 120)
  const b = Math.round(150 + temp * 105)
  const alpha = disrupted ? 0.05 : 0.15 + brightness * 0.6

  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
      {/* Port frame */}
      <div className="absolute inset-4 rounded-full border-4 border-gray-700 overflow-hidden">
        {/* Glow */}
        <div
          className="w-full h-full transition-all duration-200"
          style={{
            background: `radial-gradient(ellipse 70% 90% at 50% 50%, rgba(${r},${g},${b},${alpha}) 0%, transparent 100%)`,
          }}
        />
        {/* ELM flash */}
        {snapshot.elm_active && (
          <div className="absolute inset-0 bg-amber-300 opacity-30 animate-pulse" />
        )}
      </div>
      {/* Label */}
      <div className="absolute bottom-2 text-[10px] text-gray-600 font-mono">
        Port view
      </div>
    </div>
  )
}
