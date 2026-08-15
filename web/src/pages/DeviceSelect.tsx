import { useMemo, useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getDevices, type Device } from '../lib/wasm'
import PlasmaBackdrop from '../components/PlasmaBackdrop'
import { DIIID_LIMITER } from '../lib/diiid-geometry'
import { JET_LIMITER } from '../lib/jet-geometry'
import { ITER_LIMITER } from '../lib/iter-geometry'
import { CENTAUR_LIMITER } from '../lib/centaur-geometry'
import { SPARC_LIMITER } from '../lib/sparc-geometry'

/** Extra display-only metadata keyed by device id. */
const DEVICE_META: Record<string, { location: string; status?: string; desc: string }> = {
  diiid: {
    location: 'San Diego, USA',
    desc: 'Scenario development workhorse dating back to the late 1980s. The most extensively diagnosed tokamak in the world.',
  },
  sparc: {
    location: 'Devens, USA',
    status: 'Under construction',
    desc: 'Compact high-field D-T tokamak — Q > 1 at 12.2 T with HTS magnets, running ELM-free in the QCE regime.',
  },
  centaur: {
    location: 'Conceptual design',
    desc: 'Compact negative-triangularity breakeven tokamak — ELM-free Q > 1 at 10.9 T with HTS magnets.',
  },
  iter: {
    location: 'Cadarache, France',
    status: 'Under construction',
    desc: "The world's largest tokamak — designed to demonstrate 500 MW of fusion power (Q ≥ 10).",
  },
  jet: {
    location: 'Culham, UK',
    status: 'Decommissioned',
    desc: "Europe's largest tokamak — holds the world record for fusion energy with its ITER-Like Wall.",
  },
}

const DEVICE_LIMITERS: Record<string, [number, number][]> = {
  diiid: DIIID_LIMITER,
  sparc: SPARC_LIMITER,
  centaur: CENTAUR_LIMITER,
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

  // Scale stroke width to viewBox so all devices appear equally bright.
  // Target ~1px at the rendered size: the SVG is h-32 (128px),
  // so strokeWidth ≈ viewBox extent / 128.
  const extent = Math.max(w, h)
  const sw = extent / 128
  const markerR = extent * 0.006

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
        strokeWidth={sw}
        className="text-cyan-400"
      />
      {/* Magnetic axis marker */}
      <circle
        cx={device.r0}
        cy={0}
        r={markerR}
        className="fill-cyan-400 opacity-50"
      />
    </svg>
  )
}

export default function DeviceSelect() {
  const navigate = useNavigate()
  const devices = useMemo(() => getDevices(), [])
  const [showTutorialPrompt, setShowTutorialPrompt] = useState(false)
  // After "Skip tutorial" the page just sits on the hero — flash the
  // scroll-down affordance for a few seconds so the next step is obvious.
  const [flashScrollHint, setFlashScrollHint] = useState(false)

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
    setFlashScrollHint(true)
    setTimeout(() => setFlashScrollHint(false), 7000)
  }

  return (
    <div className="page-enter relative">
      {/* ── Top nav (persists above everything) ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between gap-4 px-6 sm:px-10 py-3 border-b border-gray-800 bg-[var(--c-base)]/85 backdrop-blur">
        <span className="hidden sm:inline font-mono text-[11px] tracking-[0.22em] uppercase text-gray-300">
          fusionsimulator<span className="text-gray-600">.io</span>
        </span>
        <div className="flex items-center gap-5 font-mono text-[10px] tracking-[0.18em] uppercase text-gray-500">
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
      <header className="sticky top-0 z-0 h-[100svh] px-6 sm:px-10 overflow-hidden flex items-center">
        <PlasmaBackdrop className="absolute inset-0 w-full h-full pointer-events-none" />
        {/* Fade the plasma into the page on the left so the wordmark stays crisp */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-[var(--c-base)] via-[var(--c-base)]/60 to-transparent" />
        <div className="relative max-w-6xl mx-auto w-full z-10 -mt-12">
          <h1 className="stagger-1 whitespace-nowrap text-[clamp(1.7rem,8.5vw,4.5rem)] font-bold tracking-tight text-white">
            fusionsimulator<span className="text-gray-600">.io</span>
          </h1>
          <p className="stagger-2 mt-4 text-gray-400 text-base sm:text-lg font-mono tracking-tight">
            Real-time tokamak plasma simulator
          </p>
          <p className="stagger-2 mt-2 text-gray-600 text-[11px] font-mono tracking-wider uppercase">
            0D transport &middot; MHD equilibrium &middot; ELM dynamics &middot; Fusion diagnostics
          </p>
        </div>
        {/* Scroll affordance — clickable, and flashes after tutorial skip */}
        <button
          onClick={() =>
            document.getElementById('device-panel')?.scrollIntoView({ behavior: 'smooth' })
          }
          className={`absolute bottom-7 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5
                      font-mono text-[10px] tracking-[0.18em] uppercase cursor-pointer transition-colors
                      ${flashScrollHint
                        ? 'text-cyan-300 animate-bounce'
                        : 'text-gray-600 hover:text-cyan-400 scroll-hint'}`}
        >
          <span>Select a device</span>
          <span className="text-base leading-none">↓</span>
        </button>
      </header>

      {/* ── Device selection (slides up over the pinned hero) ── */}
      <main id="device-panel" className="relative z-10 bg-[var(--c-base)] border-t border-gray-800 shadow-[0_-28px_60px_rgba(0,0,0,0.6)] px-6 sm:px-10 pt-12 pb-16">
        <div className="max-w-6xl mx-auto">
          <div className="panel-title pb-2 mb-px">
            <span className="panel-num">01 · </span>Select a device
          </div>

          {/* Hairline-tiled device row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--c-line)] border-y border-gray-800">
            {devices.map((d, i) => {
              const meta = DEVICE_META[d.id] ?? { location: '', desc: '' }
              return (
                <button
                  key={d.id}
                  onClick={() => navigate(`/program/${d.id}`)}
                  className={`stagger-${i + 3} group bg-gray-900 p-6 text-left
                             hover:bg-[var(--c-raised)] transition-colors duration-200 cursor-pointer
                             flex flex-col`}
                >
                  {/* Cross-section silhouette */}
                  <div className="h-40">
                    <DeviceSilhouette device={d} />
                  </div>

                  {/* Machine name */}
                  <h2 className="font-mono text-xl font-bold tracking-tight text-white group-hover:text-cyan-400 transition-colors mt-3">
                    {d.name}
                  </h2>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-gray-600 mb-3 mt-0.5">
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
                  <p className="text-gray-500 text-sm leading-relaxed flex-grow">
                    {meta.desc}
                  </p>

                  {/* Arrow */}
                  <div className="mt-4 font-mono text-[11px] uppercase tracking-wider text-gray-600 group-hover:text-cyan-400 transition-colors">
                    Select →
                  </div>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <footer className="mt-12 space-y-4 text-[11px] leading-relaxed">
            <div className="border-l-2 border-gray-700 pl-4 py-1 text-gray-500 max-w-3xl">
              <span className="font-mono uppercase tracking-wider text-gray-400">Disclaimer</span>
              {' — '}This simulator uses zero-dimensional scaling laws and analytic approximations
              (0D power balance, IPB98(y,2) confinement scaling, Cerfon-Freidberg equilibrium).
              Results are designed for <em>qualitative educational use</em> and should not be
              interpreted as engineering predictions or used for reactor design.
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-gray-600 pt-2">
              <span>Open-source · Educational</span>
              <span className="text-gray-700">·</span>
              <Link to="/bibliography" className="hover:text-cyan-400 transition-colors">
                Physics Bibliography
              </Link>
              <span className="text-gray-700">·</span>
              <a
                href="https://github.com/d-burg/fusion-sim"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-cyan-400 transition-colors"
              >
                GitHub
              </a>
              <span className="text-gray-700">·</span>
              <span>v{__APP_VERSION__}</span>
            </div>
            <p className="font-mono text-[10px] text-gray-700">
              © 2026 Daniel Burgess · Columbia Fusion Research Center
            </p>
          </footer>
        </div>
      </main>

      {/* ─── Tutorial prompt overlay ─── */}
      {showTutorialPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm
                        animate-[fadeIn_0.3s_ease-out]">
          <div className="bg-gray-950 border border-gray-700 rounded-lg shadow-2xl
                          max-w-md w-full mx-4 overflow-hidden animate-[slideUp_0.4s_ease-out]">
            {/* Accent bar */}
            <div className="h-0.5 bg-cyan-500" />

            <div className="p-6">
              <div className="text-center mb-4">
                <svg
                  className="w-9 h-9 mx-auto mb-3 text-cyan-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.25}
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
                  <ellipse cx="12" cy="12" rx="10" ry="4.2" />
                  <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
                  <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
                </svg>
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
                The tour will load DIII-D in H-mode as a reference pulse
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
