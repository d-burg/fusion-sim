import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { getDevices, type Device } from '../lib/wasm'
import PlasmaBackdrop, { type BackdropVariant } from '../components/PlasmaBackdrop'
import SettingsDropdown from '../components/SettingsDropdown'
import { DIIID_LIMITER } from '../lib/diiid-geometry'
import { JET_LIMITER } from '../lib/jet-geometry'
import { ITER_LIMITER } from '../lib/iter-geometry'
import { CENTAUR_LIMITER } from '../lib/centaur-geometry'
import './standard.css'

const TOUR_URL = '/run/diiid?preset=hmode&tutorial=true'

/** Place and status as captions, never sentences. */
const DEVICE_META: Record<string, { location: string; status?: string }> = {
  diiid: { location: 'San Diego . USA' },
  centaur: { location: 'Conceptual design' },
  iter: { location: 'Cadarache . France', status: 'Under construction' },
  jet: { location: 'Culham . UK', status: 'Decommissioned' },
}

const DEVICE_LIMITERS: Record<string, [number, number][]> = {
  diiid: DIIID_LIMITER,
  centaur: CENTAUR_LIMITER,
  jet: JET_LIMITER,
  iter: ITER_LIMITER,
}

/**
 * The nav row shared by the landing and program pages, the same row the
 * control room carries: wordmark at left, tracked-caps links at right, the
 * active page as a white square, the settings menu where the control room
 * has it. `left` takes the page's own links (the program page's devices).
 */
export function StandardNav({ active, left, tour }: { active?: 'devices'; left?: ReactNode; tour?: boolean }) {
  const navigate = useNavigate()
  return (
    <nav className="sp-nav">
      <div className="sp-nav-l">
        <Link to="/" className="sp-brand">FUSIONSIMULATOR.IO</Link>
        {left}
      </div>
      <div />
      <div className="sp-nav-r">
        <Link to="/" className="sp-link" data-on={active === 'devices'}>DEVICES</Link>
        {tour && <button type="button" className="sp-link" onClick={() => navigate(TOUR_URL)}>TOUR</button>}
        <Link to="/bibliography" className="sp-link">BIBLIOGRAPHY</Link>
        <a href="https://github.com/d-burg/fusion-sim" target="_blank" rel="noopener noreferrer" className="sp-link">GITHUB</a>
        <span className="sp-settings"><SettingsDropdown onRestartTutorial={() => navigate(TOUR_URL)} /></span>
      </div>
    </nav>
  )
}

/** VALUE over a tiny caption, as the control room's readouts. */
function Readout({ value, unit, caption }: { value: string; unit?: string; caption: ReactNode }) {
  return (
    <div className="sp-ro">
      <div className="sp-ro-v">{value}{unit && <span className="sp-ro-u"> {unit}</span>}</div>
      <div className="sp-ro-c">{caption}</div>
    </div>
  )
}

/** SVG cross-section silhouette from limiter geometry (or wall outline fallback). */
function DeviceSilhouette({ device }: { device: Device }) {
  const wall = DEVICE_LIMITERS[device.id] ?? device.wall_outline
  if (wall.length === 0) return null

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
  const pathData = wall.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${-p[1]}`).join(' ') + ' Z'

  // Scale stroke width to viewBox so all devices appear equally bright (~1px at the rendered size).
  const pxHeight = 96
  const extent = Math.max(w, h)
  const sw = extent / pxHeight
  const marker = extent * 0.018

  return (
    <svg viewBox={`${rMin - pad} ${-zMax - pad} ${w} ${h}`} className="sp-sil" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={pathData} fill="none" stroke="currentColor" strokeWidth={sw} />
      {/* Magnetic axis: the grammar's tiny square marker */}
      <rect x={device.r0 - marker / 2} y={-marker / 2} width={marker} height={marker} fill="currentColor" />
    </svg>
  )
}

export default function DeviceSelect() {
  const navigate = useNavigate()
  const devices = useMemo(() => getDevices(), [])
  // Backdrop comparison for this round only: ?nest=a (published nest) or ?nest=b (grammar ramp).
  const [search] = useSearchParams()
  const nest: BackdropVariant = search.get('nest') === 'b' ? 'b' : 'a'

  // Devices sit in a single horizontally scrolling row so the list can
  // grow without wrapping into a mostly-empty second row. The nudge
  // controls only render when the row actually overflows; a partly
  // visible tile at the edge is the primary "there is more" cue.
  const stripRef = useRef<HTMLDivElement>(null)
  const [strip, setStrip] = useState({ left: false, right: false })
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setStrip({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 })
    }
    // ResizeObserver fires once on observe, which covers the initial state.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [devices.length])

  const nudge = (dir: 1 | -1) => {
    const el = stripRef.current
    if (!el) return
    const tile = el.firstElementChild as HTMLElement | null
    const step = (tile?.getBoundingClientRect().width ?? 260) + 1
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * step, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div data-page="landing" className="page-enter">
      {/* ── Hero: the nav on the picture, the wordmark, one rule, one line ── */}
      <header className="sp-hero">
        <PlasmaBackdrop variant={nest} />
        <StandardNav active="devices" tour />
        <div className="sp-hero-text">
          <h1 className="sp-wordmark">FUSIONSIMULATOR<span className="sp-wordmark-tld">.IO</span></h1>
          <div className="sp-hero-rule" aria-hidden="true" />
          <p className="sp-hero-line">Real-time tokamak plasma simulator.</p>
        </div>
      </header>

      {/* ── 01 . DEVICES ── */}
      <main className="sp-section">
        <div className="sp-section-head">
          <div className="sp-head"><span className="sp-num">01</span> . DEVICES</div>
          {(strip.left || strip.right) && (
            <div className="sp-strip-nav" role="group" aria-label="Scroll the device list">
              <button type="button" onClick={() => nudge(-1)} disabled={!strip.left} aria-label="Previous devices">PREVIOUS</button>
              <button type="button" onClick={() => nudge(1)} disabled={!strip.right} aria-label="Next devices">NEXT</button>
            </div>
          )}
        </div>

        {/* Every machine gets the same tile: devices are parallel choices, not a
            ranking. Tiles stretch to fill the row while they fit and hold a 260px
            minimum once they don't, so the row scrolls sideways instead of wrapping.
            Hairline verticals separate them; nothing is boxed. */}
        <div ref={stripRef} className="sp-strip">
          {devices.map((d) => {
            const meta = DEVICE_META[d.id] ?? { location: '' }
            return (
              <button key={d.id} type="button" onClick={() => navigate(`/program/${d.id}`)} className="sp-tile">
                <DeviceSilhouette device={d} />
                <h2 className="sp-tile-name">{d.name}</h2>
                <div className="sp-tile-loc">{meta.location}{meta.status ? ` . ${meta.status}` : ''}</div>
                <div className="sp-tile-params">
                  <Readout value={d.r0.toFixed(2)} unit="M" caption={<>R<sub>0</sub></>} />
                  <Readout value={d.a.toFixed(2)} unit="M" caption={<span className="sp-g">a</span>} />
                  <Readout value={String(d.ip_max)} unit="MA" caption={<>I<sub>P</sub> MAX</>} />
                  <Readout value={String(d.bt_max)} unit="T" caption={<>B<sub>T</sub> MAX</>} />
                </div>
                <span className="sp-select sp-dotted">SELECT</span>
              </button>
            )
          })}
        </div>
      </main>

      <footer className="sp-foot">
        <span>0D scaling model . educational use</span>
        <span>© 2026 Daniel Burgess . Columbia Fusion Research Center . v{__APP_VERSION__}</span>
      </footer>
    </div>
  )
}
