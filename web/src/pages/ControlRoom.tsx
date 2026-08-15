import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useSimulation } from '../lib/useSimulation'
import { getDevices, type PresetId } from '../lib/wasm'
import EquilibriumCanvas from '../components/EquilibriumCanvas'
import UnifiedTracePanel from '../components/UnifiedTracePanel'
import StatusPanel from '../components/StatusPanel'
import PulsePlanner from '../components/PulsePlanner'
import PortView from '../components/portview'
import SettingsDropdown from '../components/SettingsDropdown'
import TutorialOverlay from '../components/TutorialOverlay'
import MagneticsPanel from '../components/MagneticsPanel'
import { DIIID_LIMITER } from '../lib/diiid-geometry'
import { JET_LIMITER } from '../lib/jet-geometry'
import { ITER_LIMITER } from '../lib/iter-geometry'
import { CENTAUR_LIMITER } from '../lib/centaur-geometry'
import { SPARC_LIMITER } from '../lib/sparc-geometry'

const DEVICE_LIMITERS: Record<string, [number, number][]> = {
  diiid: DIIID_LIMITER,
  sparc: SPARC_LIMITER,
  centaur: CENTAUR_LIMITER,
  jet: JET_LIMITER,
  iter: ITER_LIMITER,
}

function getPresets(deviceId: string): { id: PresetId; label: string }[] {
  if (deviceId === 'sparc') {
    // SPARC's default is the QCE (quasi-continuous exhaust) regime, not the
    // Type-I ELMy Primary Reference Discharge — unmitigated SPARC ELMs are
    // projected at 1.4–2.2 MJ, which the inertially cooled divertor cannot
    // take. Type-I ELMy H-mode is reachable from the pulse planner by raising
    // ICRF power out of the QCE window.
    return [
      { id: 'hmode', label: 'QCE' },
      { id: 'lmode', label: 'L-mode' },
      { id: 'density_limit', label: 'Density limit' },
    ]
  }
  if (deviceId === 'centaur') {
    // CENTAUR operates in negative-triangularity edge mode; no conventional L-mode
    return [
      { id: 'hmode', label: 'NT-edge' },
      { id: 'density_limit', label: 'Density limit' },
    ]
  }
  return [
    { id: 'hmode', label: 'H-mode' },
    { id: 'lmode', label: 'L-mode' },
    { id: 'density_limit', label: 'Density limit' },
  ]
}

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

  // Persistent Pulse Planner state — survives open/close of the drawer
  const [plannerOverrides, setPlannerOverrides] = useState<Record<string, number | import('../lib/wasm').WaveformPoint[] | null>>({})
  const [plannerDuration, setPlannerDuration] = useState<number | null>(null)
  const [plannerPreset, setPlannerPreset] = useState<PresetId>(routePreset)
  const [hasCustomProgram, setHasCustomProgram] = useState(false)
  // Bottom-right cell is shared between the 3D port view and the magnetics
  // diagnostic. Magnetics only exists for SPARC, where the QCE regime makes
  // the quasi-coherent mode the thing worth looking at.
  const [bottomRightTab, setBottomRightTab] = useState<'portview' | 'magnetics'>('portview')
  const [configOverride, setConfigOverride] = useState<'LowerSingleNull' | 'DoubleNull' | 'UpperSingleNull' | null>(null)
  const defaultFuel = (id: string): 'DD' | 'DT' =>
    (id === 'iter' || id === 'jet' || id === 'sparc') ? 'DT' : 'DD'
  const [fuelType, setFuelType] = useState<'DD' | 'DT'>(defaultFuel(activeDevice))

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

  // Set initial fuel type for devices that default to DT
  useEffect(() => {
    const fuel = defaultFuel(activeDevice)
    if (fuel === 'DT') {
      controls.setMassNumber(2.5)
    }
  }, [activeDevice]) // eslint-disable-line react-hooks/exhaustive-deps

  const time = displaySnapshot?.time ?? 0
  // Extract duration from snapshot, or fall back to the program's duration
  const duration = displaySnapshot?.duration ?? (() => {
    try {
      const prog = JSON.parse(programJson || '{}')
      // Program duration = last time point on any waveform (typically ip)
      if (prog.ip && Array.isArray(prog.ip) && prog.ip.length > 0) {
        return prog.ip[prog.ip.length - 1][0] as number
      }
    } catch { /* ignore */ }
    return 10
  })()
  const progress = duration > 0 ? (time / duration) * 100 : 0

  // Whether this pulse programs any ICH power — used to reserve the P_ICH
  // power-balance row from the start so it doesn't pop in and shift the layout.
  const usesIch = useMemo(() => {
    try {
      const prog = JSON.parse(programJson || '{}')
      return Array.isArray(prog.p_ich) && prog.p_ich.some((pt: [number, number]) => pt[1] > 0)
    } catch {
      return false
    }
  }, [programJson])

  const handleDeviceChange = (newDeviceId: string) => {
    setActiveDevice(newDeviceId)
    setPlannerOverrides({})
    setPlannerDuration(null)
    setHasCustomProgram(false)
    setConfigOverride(null)
    const fuel = defaultFuel(newDeviceId)
    setFuelType(fuel)
    controls.setMassNumber(fuel === 'DT' ? 2.5 : null)
    controls.switchPreset(newDeviceId, activePreset)
  }

  const handleFuelChange = (fuel: 'DD' | 'DT') => {
    setFuelType(fuel)
    controls.setMassNumber(fuel === 'DT' ? 2.5 : 2.0)
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

  // The magnetics diagnostic is modelled only for SPARC (QCE demo)
  const hasMagnetics = activeDevice === 'sparc'

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
    <div className="page-enter h-screen flex flex-col bg-[#0a0e17] overflow-hidden">
      {/* ─── Top bar ─── */}
      {/* Three-column grid rather than justify-between: the side columns take
          an equal share of the free space, so the playback controls stay
          centred on the page even as the side content changes width (DD/DT
          toggle appearing per device, "(done)" suffix at end of pulse). */}
      <div className="relative z-50 grid grid-cols-[1fr_auto_1fr] items-center px-2 sm:px-3 py-1 sm:py-1.5 border-b border-gray-800 gap-1 sm:gap-2">
        {/* Device, Scenario, Fuel selectors */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 justify-self-start">
          {/* Device selector */}
          <select
            value={activeDevice}
            onChange={(e) => handleDeviceChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-cyan-400 text-[11px] sm:text-xs font-bold
                       rounded px-1 sm:px-1.5 py-1 cursor-pointer hover:border-cyan-600
                       focus:outline-none focus:border-cyan-500 transition-colors"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Scenario selector (replaces button group) */}
          <select
            value={activePreset}
            onChange={(e) => handlePresetChange(e.target.value as PresetId)}
            className="bg-gray-800 border border-gray-700 text-amber-400 text-[11px] sm:text-xs font-bold
                       rounded px-1 sm:px-1.5 py-1 cursor-pointer hover:border-amber-600
                       focus:outline-none focus:border-amber-500 transition-colors"
          >
            {getPresets(activeDevice).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          {/* DD/DT fuel toggle — JET and ITER */}
          {(activeDevice === 'jet' || activeDevice === 'iter') && (
            <div className="flex rounded overflow-hidden border border-gray-700">
              {(['DD', 'DT'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => handleFuelChange(f)}
                  className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer
                    ${fuelType === f
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Playback controls — fixed widths on the buttons whose label changes
            so the row never reflows as the pulse state changes. */}
        <div className="flex items-center gap-1 sm:gap-1.5 justify-self-center">
          {!running ? (
            <button
              onClick={controls.start}
              className="px-2 sm:px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-[11px] sm:text-xs font-semibold
                         transition-colors cursor-pointer flex items-center justify-center gap-1 min-w-[4.5rem] sm:min-w-[5rem]"
            >
              ▶ Start
            </button>
          ) : (
            <button
              onClick={controls.pause}
              className="px-2 sm:px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-[11px] sm:text-xs font-semibold
                         transition-colors cursor-pointer flex items-center justify-center gap-1 min-w-[4.5rem] sm:min-w-[5rem]"
            >
              ⏸ Pause
            </button>
          )}
          {/* Kept in the layout (invisible) while hidden, so removing it does
              not shift the surrounding controls. */}
          <button
            onClick={controls.reset}
            aria-hidden={running && hasCustomProgram}
            className={`px-2 sm:px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[11px] sm:text-xs font-semibold
                       transition-colors cursor-pointer ${running && hasCustomProgram ? 'invisible' : ''}`}
          >
            ↺ Reset
          </button>

          {/* Speed selector */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {[2, 1.0, 0.75, 0.5].map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                className={`px-1 sm:px-1.5 py-1 text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer
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

          {/* Edit Program button */}
          <button
            onClick={() => setShowPlanner(!showPlanner)}
            className="px-1.5 sm:px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-[10px] sm:text-[11px] font-semibold
                       transition-colors cursor-pointer flex items-center justify-center gap-1 sm:min-w-[4.25rem]"
          >
            {showPlanner ? (
              '✕'
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931ZM19.5 7.125 16.875 4.5" />
              </svg>
            )}
            <span className="hidden sm:inline">{showPlanner ? 'Close' : 'Edit'}</span>
          </button>
        </div>

        {/* Time readout + Settings */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 justify-self-end">
          <div className="font-mono text-[10px] sm:text-xs text-gray-400 tabular-nums whitespace-nowrap">
            t={time.toFixed(3)}s / {duration.toFixed(1)}s
            {(finished || (!running && scrubTime !== null)) && (
              <span className="ml-1 text-[9px] sm:text-[10px] text-gray-600">
                {scrubTime !== null ? '(scrub)' : '(done)'}
              </span>
            )}
          </div>
          <SettingsDropdown onRestartTutorial={() => setTutorialActive(true)} />
        </div>
      </div>

      {/* ─── Main grid ─── */}
      <div className="flex-1 overflow-x-auto">
      <div className="min-w-[768px] h-full grid grid-cols-[1fr_1.5fr_1fr] grid-rows-[1.1fr_1fr] gap-px min-h-0 bg-[var(--c-line)]">
        {/* Top-left: Equilibrium cross-section (single cell) */}
        <div data-tutorial="equilibrium" className="stagger-1 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <EquilibriumCanvas snapshot={displaySnapshot} wallJson={wallJson} limiterPoints={limiterPoints} />
        </div>

        {/* Top row, cols 2-3: Unified trace panel */}
        <div data-tutorial="traces" className="stagger-2 col-span-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <UnifiedTracePanel
            history={history}
            programJson={programJson}
            deviceId={activeDevice}
            duration={duration}
            scrubbable={finished || !running}
            scrubTime={scrubTime}
            onScrub={controls.setScrubTime}
            elmActive={displaySnapshot?.elm_active ?? false}
          />
        </div>

        {/* Bottom row, cols 1-2: Status panel (extends under equilibrium) */}
        <div data-tutorial="status" className="stagger-3 col-span-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <StatusPanel
            snapshot={displaySnapshot}
            finished={finished}
            processedProfiles={state.processedProfiles}
            profileTeMax={state.profileTeMax}
            profileNeMax={state.profileNeMax}
            profilePMax={state.profilePMax}
            displayTime={displaySnapshot?.time ?? null}
            usesIch={usesIch}
          />
        </div>

        {/* Bottom-right: 3D port view, or magnetics on SPARC */}
        <div data-tutorial="portview" className="stagger-4 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden relative flex flex-col">
          {hasMagnetics && (
            <div className="absolute top-2 right-2 z-10 flex rounded overflow-hidden border border-gray-700">
              {(['portview', 'magnetics'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBottomRightTab(tab)}
                  className={`px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors cursor-pointer
                    ${bottomRightTab === tab
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-900/80 text-gray-400 hover:bg-gray-800'}`}
                >
                  {tab === 'portview' ? 'Port' : 'Magnetics'}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 min-h-0">
            {hasMagnetics && bottomRightTab === 'magnetics' ? (
              <MagneticsPanel snapshot={displaySnapshot} deviceId={activeDevice} history={history} />
            ) : (
              <PortView
                snapshot={plasmaSnapshot}
                limiterPoints={limiterPoints}
                deviceId={activeDevice}
                wallJson={wallJson}
                deviceR0={devices.find(d => d.id === activeDevice)?.r0}
                deviceA={devices.find(d => d.id === activeDevice)?.a}
              />
            )}
          </div>
        </div>
      </div>
      </div>

      {/* ─── Progress bar ─── */}
      <div className="h-1.5 bg-gray-900">
        <div
          className="h-full bg-cyan-500 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* ─── Pulse Planner drawer ─── */}
      {showPlanner && (
        <PulsePlanner
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
