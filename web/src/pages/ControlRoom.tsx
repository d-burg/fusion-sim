import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useSimulation } from '../lib/useSimulation'
import { getDevices, type PresetId } from '../lib/wasm'
import EquilibriumCanvas from '../components/EquilibriumCanvas'
import UnifiedTracePanel from '../components/UnifiedTracePanel'
import StatusPanel from '../components/StatusPanel'
import ShotPlanner from '../components/ShotPlanner'
import PortView from '../components/portview'
import SettingsDropdown from '../components/SettingsDropdown'
import TutorialOverlay from '../components/TutorialOverlay'
import { DIIID_LIMITER } from '../lib/diiid-geometry'
import { JET_LIMITER } from '../lib/jet-geometry'
import { ITER_LIMITER } from '../lib/iter-geometry'

const DEVICE_LIMITERS: Record<string, [number, number][]> = {
  diiid: DIIID_LIMITER,
  jet: JET_LIMITER,
  iter: ITER_LIMITER,
}

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'hmode', label: 'H-mode' },
  { id: 'lmode', label: 'L-mode' },
  { id: 'density_limit', label: 'Density limit' },
]

export default function ControlRoom() {
  const { deviceId: routeDeviceId } = useParams<{ deviceId: string }>()
  const [searchParams] = useSearchParams()
  const routePreset = (searchParams.get('preset') || 'hmode') as PresetId
  const showTutorial = searchParams.get('tutorial') === 'true'

  // Local state so user can switch without navigating
  const [tutorialActive, setTutorialActive] = useState(showTutorial)
  const [activeDevice, setActiveDevice] = useState(routeDeviceId ?? 'diiid')
  const [activePreset, setActivePreset] = useState<PresetId>(routePreset)
  const [showPlanner, setShowPlanner] = useState(false)
  const [activeSpeed, setActiveSpeed] = useState(1.0)

  // Persistent Shot Planner state — survives open/close of the drawer
  const [plannerOverrides, setPlannerOverrides] = useState<Record<string, number | null>>({})
  const [plannerDuration, setPlannerDuration] = useState<number | null>(null)
  const [plannerPreset, setPlannerPreset] = useState<PresetId>(routePreset)
  const [hasCustomProgram, setHasCustomProgram] = useState(false)
  const [configOverride, setConfigOverride] = useState<'LowerSingleNull' | 'DoubleNull' | 'UpperSingleNull' | null>(null)

  const devices = useMemo(() => getDevices(), [])

  const [state, controls] = useSimulation(activeDevice, activePreset)
  const {
    displaySnapshot,
    history,
    running,
    wallJson,
    programJson,
    scrubTime,
    finished,
  } = state

  const time = displaySnapshot?.time ?? 0
  const duration = displaySnapshot?.duration ?? 10
  const progress = duration > 0 ? (time / duration) * 100 : 0

  const handleDeviceChange = (newDeviceId: string) => {
    setActiveDevice(newDeviceId)
    setPlannerOverrides({})
    setPlannerDuration(null)
    setHasCustomProgram(false)
    setConfigOverride(null)
    controls.switchPreset(newDeviceId, activePreset)
  }

  const handlePresetChange = (newPreset: PresetId) => {
    setActivePreset(newPreset)
    setPlannerPreset(newPreset)
    setPlannerOverrides({})
    setPlannerDuration(null)
    setHasCustomProgram(false)
    setConfigOverride(null)
    controls.switchPreset(activeDevice, newPreset)
  }

  // PlasmaGlow gets null when scrubbing → dark viewport
  const plasmaSnapshot = scrubTime !== null ? null : displaySnapshot

  // Limiter geometry — only for DIII-D (other devices fall back to wallJson)
  const limiterPoints = DEVICE_LIMITERS[activeDevice]

  const handleSpeedChange = (speed: number) => {
    setActiveSpeed(speed)
    controls.setSpeed(speed)
  }

  const handleRunProgram = (devId: string, json: string) => {
    controls.runProgram(devId, json)
    setShowPlanner(false)
    setHasCustomProgram(true)
  }

  const handlePlannerPresetChange = (preset: PresetId) => {
    setPlannerPreset(preset)
    setPlannerOverrides({})
    setPlannerDuration(null)
    setConfigOverride(null)
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0e17] overflow-hidden">
      {/* ─── Top bar ─── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 gap-2">
        {/* Device & preset selectors */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Device selector */}
          <select
            value={activeDevice}
            onChange={(e) => handleDeviceChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-cyan-400 text-xs font-bold
                       rounded px-1.5 py-1 cursor-pointer hover:border-cyan-600
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
                className={`px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer
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
        <div className="flex items-center gap-1.5">
          {!running ? (
            <button
              onClick={controls.start}
              className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-xs font-semibold
                         transition-colors cursor-pointer flex items-center gap-1"
            >
              ▶ Start
            </button>
          ) : (
            <button
              onClick={controls.pause}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-xs font-semibold
                         transition-colors cursor-pointer flex items-center gap-1"
            >
              ⏸ Pause
            </button>
          )}
          {!(running && hasCustomProgram) && (
            <button
              onClick={controls.reset}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-semibold
                         transition-colors cursor-pointer"
            >
              {hasCustomProgram ? '↺ Reset Machine' : '↺ Reset'}
            </button>
          )}

          {/* Speed selector */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {[4, 2, 1.0, 0.75, 0.5].map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                className={`px-1.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer
                  ${
                    activeSpeed === s
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                  }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Edit Program button — always visible */}
          <button
            onClick={() => setShowPlanner(!showPlanner)}
            className="px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-[11px] font-semibold
                       transition-colors cursor-pointer flex items-center gap-1"
          >
            {showPlanner ? '✕ Close' : '📋 Edit'}
          </button>
        </div>

        {/* Time readout + Settings */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="font-mono text-xs text-gray-400 tabular-nums whitespace-nowrap">
            t={time.toFixed(3)}s / {duration.toFixed(1)}s
            {finished && (
              <span className="ml-1 text-[10px] text-gray-600">
                {scrubTime !== null ? '(scrub)' : '(done)'}
              </span>
            )}
          </div>
          <SettingsDropdown />
        </div>
      </div>

      {/* ─── Main grid ─── */}
      <div className="flex-1 grid grid-cols-[1fr_1.5fr_1fr] grid-rows-[1.1fr_1fr] gap-2 p-2 min-h-0">
        {/* Top-left: Equilibrium cross-section (single cell) */}
        <div data-tutorial="equilibrium" className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <EquilibriumCanvas snapshot={displaySnapshot} wallJson={wallJson} limiterPoints={limiterPoints} />
        </div>

        {/* Top row, cols 2-3: Unified trace panel */}
        <div data-tutorial="traces" className="col-span-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <UnifiedTracePanel
            history={history}
            programJson={programJson}
            deviceId={activeDevice}
            duration={duration}
            finished={finished}
            scrubTime={scrubTime}
            onScrub={controls.setScrubTime}
            elmActive={displaySnapshot?.elm_active ?? false}
          />
        </div>

        {/* Bottom row, cols 1-2: Status panel (extends under equilibrium) */}
        <div data-tutorial="status" className="col-span-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <StatusPanel
            snapshot={displaySnapshot}
            finished={finished}
            processedProfiles={state.processedProfiles}
            profileTeMax={state.profileTeMax}
            profileNeMax={state.profileNeMax}
            profilePMax={state.profilePMax}
            displayTime={displaySnapshot?.time ?? null}
          />
        </div>

        {/* Bottom-right: 3D port view */}
        <div data-tutorial="portview" className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <PortView
            snapshot={plasmaSnapshot}
            limiterPoints={limiterPoints}
            deviceId={activeDevice}
            wallJson={wallJson}
            deviceR0={devices.find(d => d.id === activeDevice)?.r0}
            deviceA={devices.find(d => d.id === activeDevice)?.a}
          />
        </div>
      </div>

      {/* ─── Progress bar ─── */}
      <div className="h-1.5 bg-gray-900">
        <div
          className="h-full bg-cyan-500 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* ─── Shot Planner drawer ─── */}
      {showPlanner && (
        <ShotPlanner
          deviceId={activeDevice}
          onRun={handleRunProgram}
          onClose={() => setShowPlanner(false)}
          overrides={plannerOverrides}
          onOverridesChange={setPlannerOverrides}
          durationOverride={plannerDuration}
          onDurationChange={setPlannerDuration}
          basePreset={plannerPreset}
          onPresetChange={handlePlannerPresetChange}
          configOverride={configOverride}
          onConfigChange={setConfigOverride}
        />
      )}

      {/* ─── Tutorial overlay ─── */}
      {tutorialActive && (
        <TutorialOverlay onComplete={() => setTutorialActive(false)} />
      )}
    </div>
  )
}
