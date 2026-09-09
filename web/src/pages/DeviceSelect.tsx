import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getDevices, type Device } from '../lib/wasm'
import PlasmaBackdrop from '../components/PlasmaBackdrop'
import { DIIID_LIMITER } from '../lib/diiid-geometry'
import { JET_LIMITER } from '../lib/jet-geometry'
import { ITER_LIMITER } from '../lib/iter-geometry'
import { CENTAUR_LIMITER } from '../lib/centaur-geometry'

/** Extra display-only metadata keyed by device id. */
const DEVICE_META: Record<string, { location: string; status?: string; desc: string }> = {
  diiid: {
    location: 'San Diego, USA',
    desc: 'Scenario development workhorse dating back to the late 1980s. The most extensively diagnosed tokamak in the world.',
  },
  centaur: {
    location: 'Conceptual design',
    desc: 'Compact negative-triangularity breakeven tokamak. ELM-free Q > 1 at 10.9 T with HTS magnets.',
  },
  iter: {
    location: 'Cadarache, France',
    status: 'Under construction',
    desc: "The world's largest tokamak, designed to demonstrate 500 MW of fusion power (Q ≥ 10).",
  },
  jet: {
    location: 'Culham, UK',
    status: 'Decommissioned',
    desc: "Europe's largest tokamak. Holds the world record for fusion energy with its ITER-Like Wall.",
  },
}

const DEVICE_LIMITERS: Record<string, [number, number][]> = {
  diiid: DIIID_LIMITER,
  centaur: CENTAUR_LIMITER,
  jet: JET_LIMITER,
  iter: ITER_LIMITER,
}

/** SVG cross-section silhouette from limiter geometry (or wall outline fallback). */
function DeviceSilhouette({ device, large = false }: { device: Device; large?: boolean }) {
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

  // Scale stroke width to viewBox so all devices appear equally bright.
  // Target ~1px at the rendered size, so strokeWidth ≈ viewBox extent / px height.
  const pxHeight = large ? 192 : 128
  const extent = Math.max(w, h)
  const sw = extent / pxHeight
  const markerR = extent * 0.006

  return (
    <svg
      viewBox={`${rMin - pad} ${-zMax - pad} ${w} ${h}`}
      className={`w-full ${large ? 'h-48' : 'h-32'} opacity-40`}
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={pathData}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        className="text-gray-300"
      />
      {/* Magnetic axis marker */}
      <circle
        cx={device.r0}
        cy={0}
        r={markerR}
        className="fill-current text-gray-300 opacity-60"
      />
    </svg>
  )
}

export default function DeviceSelect() {
  const navigate = useNavigate()
  const devices = useMemo(() => getDevices(), [])
  // Offer the tour inline unless the user already took or dismissed it.
  const [showTutorialPrompt, setShowTutorialPrompt] = useState(
    () => !sessionStorage.getItem('tutorial-dismissed'),
  )

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
    <div className="page-enter relative">
      {/* ── Top nav (persists above everything) ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between gap-4 px-6 sm:px-10 py-3 border-b border-gray-800 bg-[var(--c-base)]/85 backdrop-blur">
        <span className="hidden sm:inline font-mono text-xs tracking-[0.16em] text-gray-300">
          fusionsimulator<span className="text-gray-600">.io</span>
        </span>
        <div className="flex items-center gap-5 text-sm text-gray-500">
          <Link to="/bibliography" className="hover:text-cyan-400 transition-colors">Bibliography</Link>
          <a
            href="https://github.com/d-burg/fusion-sim"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-cyan-400 transition-colors"
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* ── Hero (pinned; the device panel parallax-slides over it) ── */}
      <header className="sticky top-0 z-0 h-[70svh] px-6 sm:px-10 overflow-hidden flex items-center">
        <PlasmaBackdrop className="absolute inset-0 w-full h-full pointer-events-none" />
        {/* Fade the plasma into the page on the left so the wordmark stays crisp */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-[var(--c-base)] via-[var(--c-base)]/60 to-transparent" />
        <div className="relative max-w-6xl mx-auto w-full z-10 -mt-12">
          <h1 className="stagger-1 whitespace-nowrap text-[clamp(1.7rem,8.5vw,4.5rem)] font-bold tracking-tight text-white">
            fusionsimulator<span className="text-gray-600">.io</span>
          </h1>
          <p className="stagger-2 mt-4 text-gray-400 text-base sm:text-lg">
            Real-time tokamak plasma simulator
          </p>
        </div>
      </header>

      {/* ── Device selection (slides up over the pinned hero) ── */}
      <main className="relative z-10 bg-[var(--c-base)] border-t border-gray-800 px-6 sm:px-10 pt-12 pb-16">
        <div className="max-w-6xl mx-auto">
          <div className="panel-title pb-2 mb-px">Select a device</div>

          {/* Inline tour offer (dismissable) */}
          {showTutorialPrompt && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-x border-gray-800 bg-gray-900 px-4 py-3">
              <p className="text-sm text-gray-400 flex-1 min-w-[16rem]">
                New here? A 2-minute guided tour walks through each control-room panel
                using DIII-D in H-mode as a reference pulse.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleStartTutorial}
                  className="bg-cyan-600 px-3 py-1.5 text-sm text-white cursor-pointer transition-colors"
                >
                  Take the guided tour
                </button>
                <button
                  onClick={handleSkipTutorial}
                  className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* Hairline-tiled device row; the first machine reads as primary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--c-line)] border-y border-gray-800">
            {devices.map((d, i) => {
              const meta = DEVICE_META[d.id] ?? { location: '', desc: '' }
              const primary = i === 0
              return (
                <button
                  key={d.id}
                  onClick={() => navigate(`/program/${d.id}`)}
                  className={`stagger-${i + 3} group bg-gray-900 p-6 text-left
                             hover:bg-[var(--c-raised)] transition-colors duration-200 cursor-pointer
                             flex ${primary ? 'md:col-span-3 md:flex-row md:items-center md:gap-8' : ''} flex-col`}
                >
                  {/* Cross-section silhouette */}
                  <div className={primary ? 'md:w-72 shrink-0' : 'h-40'}>
                    <DeviceSilhouette device={d} large={primary} />
                  </div>

                  <div className="flex flex-col flex-1">
                    {/* Machine name */}
                    <h2
                      className={`font-mono ${primary ? 'text-3xl md:mt-0' : 'text-xl'} font-bold tracking-tight
                                  text-white group-hover:text-cyan-400 transition-colors mt-3`}
                    >
                      {d.name}
                    </h2>
                    <div className="text-xs text-gray-500 mb-3 mt-0.5">
                      {meta.location}{meta.status ? ` · ${meta.status}` : ''}
                    </div>

                    {/* Stats */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400 mb-3 font-mono tabular-nums">
                      <span>R₀ = {d.r0.toFixed(2)} m</span>
                      <span>a = {d.a.toFixed(2)} m</span>
                      <span>Iₚ ≤ {d.ip_max} MA</span>
                      <span>Bₜ ≤ {d.bt_max} T</span>
                    </div>

                    {/* Description */}
                    <p className={`text-gray-500 leading-relaxed flex-grow ${primary ? 'text-base max-w-2xl' : 'text-sm'}`}>
                      {meta.desc}
                    </p>

                    {/* Arrow */}
                    <div className="mt-4 text-sm text-gray-500 group-hover:text-cyan-400 transition-colors">
                      Select →
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <footer className="mt-12 space-y-4 text-xs leading-relaxed">
            <div className="border-l border-gray-800 pl-4 py-1 text-gray-500 max-w-3xl">
              <span className="font-medium text-gray-300">Disclaimer:</span> This simulator uses
              zero-dimensional scaling laws and analytic approximations (0D power balance,
              IPB98(y,2) confinement scaling, Cerfon-Freidberg equilibrium).
              Results are designed for <em>qualitative educational use</em> and should not be
              interpreted as engineering predictions or used for reactor design.
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 pt-2">
              <span>Open-source, educational</span>
              <span className="text-gray-500">·</span>
              <Link to="/bibliography" className="hover:text-cyan-400 transition-colors">
                Physics bibliography
              </Link>
              <span className="text-gray-500">·</span>
              <a
                href="https://github.com/d-burg/fusion-sim"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-cyan-400 transition-colors"
              >
                GitHub
              </a>
              <span className="text-gray-500">·</span>
              <span className="font-mono tabular-nums">v{__APP_VERSION__}</span>
            </div>
            <p className="text-xs text-gray-500">
              © 2026 Daniel Burgess · Columbia Fusion Research Center
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}
