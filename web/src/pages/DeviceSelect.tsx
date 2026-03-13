import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDevices, type Device } from '../lib/wasm'
import { DIIID_LIMITER } from '../lib/diiid-geometry'
import { JET_LIMITER } from '../lib/jet-geometry'
import { ITER_LIMITER } from '../lib/iter-geometry'

/** Extra display-only metadata keyed by device id. */
const DEVICE_META: Record<string, { location: string; desc: string }> = {
  diiid: {
    location: 'San Diego, USA',
    desc: 'General Atomics workhorse — advanced shape control and the birthplace of the H-mode recipe.',
  },
  iter: {
    location: 'Cadarache, France',
    desc: "The world's largest tokamak — designed to demonstrate 500 MW of fusion power (Q ≥ 10).",
  },
  jet: {
    location: 'Culham, UK',
    desc: "Europe's largest tokamak — holds the world record for fusion energy with its ITER-Like Wall.",
  },
}

const DEVICE_LIMITERS: Record<string, [number, number][]> = {
  diiid: DIIID_LIMITER,
  jet: JET_LIMITER,
  iter: ITER_LIMITER,
}

/** SVG cross-section silhouette from limiter geometry (or wall outline fallback). */
function DeviceSilhouette({ device }: { device: Device }) {
  const wall = DEVICE_LIMITERS[device.id] ?? device.wall_outline
  if (wall.length === 0) return null

  // Find bounds for viewBox
  const rs = wall.map((p) => p[0])
  const zs = wall.map((p) => p[1])
  const rMin = Math.min(...rs)
  const rMax = Math.max(...rs)
  const zMin = Math.min(...zs)
  const zMax = Math.max(...zs)
  const pad = 0.05
  const w = rMax - rMin + 2 * pad
  const h = zMax - zMin + 2 * pad

  // Flip Z so higher Z appears visually higher (matching EquilibriumCanvas)
  const pathData =
    wall
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${-p[1]}`)
      .join(' ') + ' Z'

  return (
    <svg
      viewBox={`${rMin - pad} ${-zMax - pad} ${w} ${h}`}
      className="w-full h-32 opacity-30 group-hover:opacity-60 transition-opacity"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={pathData}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.015}
        className="text-cyan-400"
      />
      {/* Magnetic axis marker */}
      <circle
        cx={device.r0}
        cy={0}
        r={0.04}
        className="fill-cyan-400 opacity-50"
      />
    </svg>
  )
}

export default function DeviceSelect() {
  const navigate = useNavigate()
  const devices = useMemo(() => getDevices(), [])
  const [showTutorialPrompt, setShowTutorialPrompt] = useState(false)

  // Show tutorial prompt after 1 second
  useEffect(() => {
    // Don't show if user has already seen or dismissed the tutorial
    const dismissed = sessionStorage.getItem('tutorial-dismissed')
    if (dismissed) return
    const t = setTimeout(() => setShowTutorialPrompt(true), 1000)
    return () => clearTimeout(t)
  }, [])

  const handleStartTutorial = () => {
    setShowTutorialPrompt(false)
    sessionStorage.setItem('tutorial-dismissed', '1')
    navigate('/run/diiid?preset=hmode&tutorial=true')
  }

  const handleSkipTutorial = () => {
    setShowTutorialPrompt(false)
    sessionStorage.setItem('tutorial-dismissed', '1')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-2 text-white">
          fusionsimulator<span className="text-gray-500">.io</span>
        </h1>
        <p className="text-gray-400 text-lg">
          Real-time tokamak discharge simulator
        </p>
      </div>

      {/* Device cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
        {devices.map((d) => {
          const meta = DEVICE_META[d.id] ?? { location: '', desc: '' }
          return (
            <button
              key={d.id}
              onClick={() => navigate(`/program/${d.id}`)}
              className="group bg-gray-900 border border-gray-700 rounded-lg p-6 text-left
                         hover:border-cyan-500 hover:shadow-lg hover:shadow-cyan-500/10
                         transition-all duration-200 cursor-pointer"
            >
              {/* Cross-section silhouette */}
              <DeviceSilhouette device={d} />

              {/* Machine name */}
              <div className="flex items-baseline justify-between mb-1 mt-3">
                <h2 className="text-2xl font-bold text-white group-hover:text-cyan-400 transition-colors">
                  {d.name}
                </h2>
                <span className="text-xs text-gray-500">{meta.location}</span>
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400 mb-3 font-mono">
                <span>R₀ = {d.r0.toFixed(2)} m</span>
                <span>a = {d.a.toFixed(2)} m</span>
                <span>Iₚ ≤ {d.ip_max} MA</span>
                <span>Bₜ ≤ {d.bt_max} T</span>
                <span>κ = {d.kappa.toFixed(1)}</span>
                <span>V = {d.volume} m³</span>
              </div>

              {/* Description */}
              <p className="text-gray-500 text-sm leading-relaxed">
                {meta.desc}
              </p>

              {/* Arrow */}
              <div className="mt-4 text-right text-gray-600 group-hover:text-cyan-400 transition-colors">
                Select →
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <p className="mt-12 text-gray-600 text-xs">
        Open-source · Educational · Not for engineering use
      </p>

      {/* ─── Tutorial prompt overlay ─── */}
      {showTutorialPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm
                        animate-[fadeIn_0.3s_ease-out]">
          <div className="bg-gray-950 border border-cyan-500/30 rounded-lg shadow-2xl shadow-cyan-500/10
                          max-w-md w-full mx-4 overflow-hidden animate-[slideUp_0.4s_ease-out]">
            {/* Accent bar */}
            <div className="h-1 bg-gradient-to-r from-cyan-500 via-cyan-400 to-cyan-600" />

            <div className="p-6">
              <div className="text-center mb-4">
                <div className="text-3xl mb-2">⚛</div>
                <h2 className="text-xl font-bold text-white mb-1">New to Fusion?</h2>
                <p className="text-gray-400 text-sm">
                  Take a 2-minute guided tour of the control room to learn
                  what each panel does, how tokamaks work, and what your
                  objectives are.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleStartTutorial}
                  className="w-full px-4 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm
                             font-semibold transition-colors cursor-pointer text-white
                             flex items-center justify-center gap-2"
                >
                  Take the Guided Tour →
                </button>
                <button
                  onClick={handleSkipTutorial}
                  className="w-full px-4 py-2 text-gray-500 hover:text-gray-300 text-sm
                             transition-colors cursor-pointer"
                >
                  Skip — I know what I'm doing
                </button>
              </div>

              <p className="text-center text-gray-600 text-[10px] mt-4">
                The tour will load DIII-D in H-mode as a reference discharge
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
