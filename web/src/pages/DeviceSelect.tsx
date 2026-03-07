import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDevices, type Device } from '../lib/wasm'

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

/** Tiny SVG cross-section silhouette from the wall outline. */
function DeviceSilhouette({ device }: { device: Device }) {
  const wall = device.wall_outline
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

  const pathData =
    wall
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
      .join(' ') + ' Z'

  return (
    <svg
      viewBox={`${rMin - pad} ${zMin - pad} ${w} ${h}`}
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold tracking-tight mb-2">
          <span className="text-cyan-400">Tok</span>
          <span className="text-amber-400">Sym</span>
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
              className="group bg-gray-900 border border-gray-700 rounded-xl p-6 text-left
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
    </div>
  )
}
