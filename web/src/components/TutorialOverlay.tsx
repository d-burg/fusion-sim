import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react'
import { usePhone } from '../pages/compositions/usePhone'

/* ═══════════════════════════════════════════════════════════════════
   TutorialOverlay — step-by-step guided tour of the control room.

   Steps anchor on `[data-tutorial="…"]` elements. A composition that lacks
   an anchor simply has that step skipped; the welcome and final steps have
   no anchor and are always shown. The card follows the Standard room's
   grammar: a hairline-bordered panel on the flat field, tracked-caps title
   with a step counter, body in a plain sans, text controls with a dotted
   underline, the target outlined by a 1 px hairline in the warm hue over
   a flat 55 % mask. It reads the room's CSS variables where they exist and
   falls back to its own values elsewhere.
   ═══════════════════════════════════════════════════════════════════ */

interface TutorialStep {
  /** CSS selector for the element to outline (null = centered card, always shown) */
  target: string | null
  title: string
  content: React.ReactNode
  /** Where the card sits relative to the outlined element */
  placement: 'right' | 'left' | 'top' | 'bottom' | 'center'
}

const H = ({ children }: { children: React.ReactNode }) => <p className="tour-h">{children}</p>

const STEPS: TutorialStep[] = [
  /* ─── Welcome ─── */
  {
    target: null,
    title: 'Welcome to the fusion simulator',
    placement: 'center',
    content: (
      <>
        <p>
          You are looking at the <b>control room</b> of a tokamak, a
          donut-shaped device that confines a superheated plasma with powerful
          magnetic fields to produce energy from nuclear fusion, the same
          process that powers the Sun.
        </p>
        <p>
          A <b>tokamak</b> works by driving a large electrical current through
          a ring of ionized hydrogen gas (plasma) while surrounding it with
          external magnetic coils. The combination of the toroidal (donut-direction)
          field from the coils and the poloidal field from the plasma current creates
          helical field lines that keep the 100-million-degree plasma suspended
          away from the walls.
        </p>
        <p>
          Each simulation run is called a <b>pulse</b>. You
          will program the heating power, plasma current, density, and shaping,
          then watch the plasma respond in real time. Your job is to keep the
          plasma stable, avoid disruptions, and maximize fusion performance.
        </p>
        <p className="tour-dim">
          Let's walk through the room so you know what you're looking at.
        </p>
      </>
    ),
  },

  /* ─── Equilibrium ─── */
  {
    target: '[data-tutorial="equilibrium"]',
    title: 'Equilibrium cross-section',
    placement: 'right',
    content: (
      <>
        <p>
          This is a <b>poloidal cross-section</b> of the tokamak: imagine
          slicing the donut vertically. You're looking at a 2D slice of the
          3D torus, drawn to scale in R and Z (metres on the axes).
        </p>

        <H>Flux surfaces</H>
        <p>
          The nested white contours are <b>flux surfaces</b>: closed
          surfaces of constant magnetic flux. Because transport along
          field lines is much faster than across them, temperature and
          density are roughly constant on each flux surface. The core is
          at the center; the edge is on the outside.
        </p>

        <H>Separatrix and X-point</H>
        <p>
          The one bright line is the <b>separatrix</b>, the outermost closed flux
          surface and the boundary between confined and unconfined plasma.
          At the bottom it forms an <b>X-point</b> (the small square) where the
          poloidal magnetic field is zero. Field lines outside the
          separatrix are "open" and guide escaping particles and heat
          downward to the <b>divertor</b> target plates. The caption gives the
          configuration (LSN, USN, DN or LIMITED) and the toroidal field B<sub>T</sub>.
        </p>

        <H>Plasma shape</H>
        <p>
          The shape of the plasma cross-section is characterized by its
          <b> elongation (κ)</b>, how tall it is versus wide, and its
          <b> triangularity (δ)</b>, how D-shaped it is. Elongated,
          D-shaped plasmas are more stable and confine energy better.
          The shape is controlled by currents in external shaping coils.
        </p>

        <H>Strike points</H>
        <p>
          The points where the separatrix intersects the divertor plates
          are called <b>strike points</b>. The exhaust heat is concentrated
          in a narrow band around these points, creating extreme heat loads
          that must be managed to protect the wall.
        </p>
      </>
    ),
  },

  /* ─── Traces ─── */
  {
    target: '[data-tutorial="traces"]',
    title: 'Time traces',
    placement: 'top',
    content: (
      <>
        <p>
          These strips show the <b>time evolution</b> of the pulse, like a
          strip-chart recorder in a real control room: the plasma
          current <b>I<sub>P</sub></b>, the line-averaged density <b>N̄<sub>E</sub></b> with
          the Greenwald fraction <b>F<sub>GW</sub></b>, the stored energy <b>W<sub>TH</sub></b>,
          the input power <b>P<sub>IN</sub></b> with the radiated power <b>P<sub>RAD</sub></b>,
          and the <b>D<sub>α</sub></b> emission whose spikes are ELMs.
        </p>

        <H>Reading the strips</H>
        <p>
          Time runs left to right across the whole pulse; the stations
          below mark ramp-up, flat-top, ramp-down and the end. The dotted
          line is the <b>programmed target</b>, what you asked for; the
          solid line is the <b>actual plasma response</b>. The plasma does not
          always follow the program; it has its own physics. If the solid
          line diverges far from the dotted one, you may be pushing the
          plasma too hard. The live value sits at the top right of each strip.
        </p>

        <H>Linking and explaining</H>
        <p>
          Hover a strip to light it and its matching readout in the block on
          the left; hover a readout to light its strip. The underlined labels
          open an explanation of each quantity.
        </p>

        <H>Scrubbing</H>
        <p>
          After a pulse finishes, drag the circle on the timeline, or drag
          across the strips, to <b>scrub</b> through time and replay the
          equilibrium and diagnostics at any moment in the pulse.
        </p>
      </>
    ),
  },

  /* ─── Plasma parameters ─── */
  {
    target: '[data-tutorial="status"]',
    title: 'Plasma parameters',
    placement: 'right',
    content: (
      <>
        <p>
          This block shows the <b>instantaneous state</b> of the plasma as
          twelve readouts. Every underlined label can be hovered or tapped
          for an explanation of the quantity.
        </p>

        <H>Core parameters</H>
        <p>
          The plasma current <b>I<sub>P</sub></b> (MA), line-averaged
          density <b>N̄<sub>E</sub></b>, stored thermal energy <b>W<sub>TH</sub></b> (MJ),
          central electron temperature <b>T<sub>E0</sub></b> (keV), confinement
          time <b>τ<sub>E</sub></b> (s), confinement quality <b>H<sub>98</sub></b> and
          loop voltage <b>V<sub>LOOP</sub></b>. Together these define the
          thermodynamic state of the plasma. You want high temperature and
          density for fusion, but the plasma has limits on how far you can push.
          The toroidal field B<sub>T</sub> is in the equilibrium caption.
        </p>

        <H>Power balance</H>
        <p>
          Power goes <i>in</i> through ohmic heating (resistive), neutral beam injection
          (NBI), and electron cyclotron heating (ECH), summed as <b>P<sub>IN</sub></b>. Part of it
          comes <i>out</i> as radiation, <b>P<sub>RAD</sub></b>; the rest is conducted to the edge.
          The balance between input and output determines whether the plasma is heating
          up, cooling down, or in steady state. The P IN strip below draws both.
        </p>

        <H>Stability and disruption risk</H>
        <p>
          Key stability metrics, <b>q<sub>95</sub></b> (safety factor),
          <b> β<sub>N</sub></b> (normalized beta), and <b>f<sub>GW</sub></b> (Greenwald fraction), tell you how close the plasma is to known
          operational limits. Push past these limits and you risk a
          <b> disruption</b> — a sudden, violent loss of confinement where
          the plasma dumps all its energy onto the wall in milliseconds.
          These three values turn amber in the warning band and red in the
          danger band; when the plasma disrupts, the title reads DISRUPT.
        </p>

        <H>Fusion performance</H>
        <p>
          The NEUTRONS bar below the readouts shows the fusion reaction rate and
          <b> Q</b>, the ratio of fusion power produced to
          heating power supplied. Q = 1 is "breakeven"; Q = 10 is the
          ITER target. On smaller machines running D-D fuel, Q will be
          tiny — but on ITER with D-T fuel, the energy of the reactions puts us in a regime where generating electricity from fusion becomes a possibility.
        </p>
      </>
    ),
  },

  /* ─── Divertor ─── */
  {
    target: '[data-tutorial="status"]',
    title: 'Divertor heat flux',
    placement: 'right',
    content: (
      <>
        <p>
          The <b>Q⊥ DIVERTOR</b> bar under the readouts
          deserves special attention. It covers one of the biggest engineering
          challenges in fusion.
        </p>

        <H>The exhaust problem</H>
        <p>
          All the power that crosses the separatrix flows along field lines
          in a thin <b>scrape-off layer</b> (SOL), typically only a few
          millimeters wide, and slams into the divertor target plates.
          This concentrates megawatts of power onto a tiny area, creating
          heat fluxes comparable to a rocket nozzle or the surface of the
          Sun (~10 MW/m²).
        </p>

        <H>Reading the bar</H>
        <p>
          The fill is the <b>peak heat flux</b> at the strike point on a
          25 MW/m² scale: white while it is modest, amber above 5 MW/m², red
          above 10 MW/m² or when a tungsten target passes its recrystallization
          temperature. Beside it are the SOL width <b>λ<sub>q</sub></b> (mm), the
          detachment fraction <b>f<sub>det</sub></b>, and the regime word:
          ATTACHED, PARTIAL or DETACHED.
        </p>

        <H>Why this matters</H>
        <p>
          Tungsten undergoes <b>recrystallization</b> above ~1200–1300°C,
          which makes it brittle and prone to cracking under thermal cycling.
          This effectively limits steady-state heat flux to ~10 MW/m². If the
          bar turns red, you need to either
          reduce the input power, increase impurity seeding to promote
          radiative cooling (detachment), or adjust the magnetic geometry to
          spread the heat over a larger area.
        </p>

        <H>Detachment</H>
        <p>
          The ideal operating regime is <b>detachment</b>, where the divertor
          plasma becomes cold and dense enough that most exhaust power is
          radiated away before reaching the plates. Impurity seeding with
          neon or nitrogen promotes detachment. Watch the detachment fraction
          — higher is better for protecting the wall.
        </p>
      </>
    ),
  },

  /* ─── Port view ─── */
  {
    target: '[data-tutorial="portview"]',
    title: 'Port view',
    placement: 'left',
    content: (
      <>
        <p>
          This is a <b>3D view</b> looking through a diagnostic port into the
          tokamak vessel, similar to what a visible-light camera would see in
          a real experiment.
        </p>

        <H>What you're seeing</H>
        <p>
          The glowing column in the center is the <b>plasma</b>. The color
          and intensity reflect the plasma state: it glows brighter with
          higher temperature and density.
        </p>
        <p>
          The structures at the bottom are the <b>divertor plates</b>. They
          change color based on the heat flux — from cool blue through cyan
          and yellow to dangerous red/white at high heat loads. This is the
          same heat flux the Q⊥ DIVERTOR bar reports, visualized spatially.
        </p>

        <H>In a real tokamak</H>
        <p>
          Real tokamaks have cameras that capture visible and infrared images
          through shielded viewports. Engineers use infrared thermography to
          monitor wall temperatures in real time and protect against hot spots.
          What you see here is a simplified rendering of that view.
        </p>
      </>
    ),
  },

  /* ─── Controls ─── */
  {
    target: '[data-tutorial="controls"]',
    title: 'Running the pulse',
    placement: 'top',
    content: (
      <>
        <p>
          The circle on the timeline is the control: it <b>starts</b> the pulse,
          <b> pauses</b> it while running, and <b>replays</b> once it has ended.
          After the pulse, drag the circle (or the strips above) to scrub
          through time; the time under it follows.
        </p>
        <p>
          The <b>speed</b> figures at the top of the page set the playback rate,
          0.5 to 2 times real time. The device and scenario links beside them
          switch machines and presets; EDIT opens the pulse planner to write
          your own program; RESET clears the pulse.
        </p>
      </>
    ),
  },

  /* ─── Mission ─── */
  {
    target: null,
    title: 'Your mission',
    placement: 'center',
    content: (
      <>
        <H>Run pulses in a fusion power plant that:</H>
        <ul className="tour-list">
          <li>
            <b>Don't disrupt</b> — disruptions dump all stored energy onto the
            wall in milliseconds. On large machines, this can cause serious
            structural damage, melt armor tiles, and generate runaway electron
            beams. A single unmitigated disruption on ITER could end a
            campaign.
          </li>
          <li>
            <b>Avoid ELMs</b> — Edge-Localized Modes are periodic bursts that
            expel energy from the edge pedestal. Each ELM transiently heats
            the divertor, and repeated ELMs cause the tungsten to
            recrystallize and crack. On ITER-scale devices, uncontrolled ELMs
            are unacceptable.
          </li>
          <li>
            <b>Achieve sufficient fusion power</b> — maximize the neutron
            rate and <b>Q</b>. This requires high temperature,
            high density, and good confinement, all while staying within
            stability limits.
          </li>
          <li>
            <b>Protect the divertor</b> — keep the heat flux below
            the tungsten recrystallization threshold. Use impurity seeding
            and detachment to spread the exhaust heat.
          </li>
        </ul>

        <H>Strategy tip</H>
        <p>
          The <b>smaller and lower-field</b> the device, the better for
          testing scenarios in a lower-consequence environment. A disruption
          on DIII-D is a nuisance; a disruption on ITER is a crisis.
        </p>
        <p>
          The <b>larger and/or higher-field</b> the device, the higher the
          risk from individual disruptions and even ELMs — but also the
          higher the potential fusion performance and Q.
        </p>
        <p>
          <b>Start small and work your way up. Good luck.</b>
        </p>

        <H>Quick recap</H>
        <ul className="tour-list">
          <li><b>Circle</b>: start, pause, replay; drag to scrub after the pulse</li>
          <li><b>Speed</b>: 0.5 · 0.75 · 1 · 2 times real time</li>
          <li><b>Device</b>: DIII-D, CENTAUR, ITER, JET</li>
          <li><b>Scenario</b>: H-mode, L-mode, or density limit</li>
          <li><b>EDIT</b>: open the pulse planner to customize the program</li>
          <li><b>Underlined labels</b>: hover or tap for an explanation</li>
        </ul>
      </>
    ),
  },
]

/* ═══════════════════════════════════════════════════════════════════ */

interface TutorialOverlayProps {
  onComplete: () => void
}

const CARD_W = 380
const GAP = 14
const MARGIN = 8
/** Phone sheet: room left at the bottom for the pinned control strip when it cannot be measured. */
const STRIP_FALLBACK = 110

/** Height of the phone's pinned control strip, read from the controls anchor when it sits along the bottom. */
function stripHeight(): number {
  const el = document.querySelector('[data-tutorial="controls"]')
  if (!el) return STRIP_FALLBACK
  const r = el.getBoundingClientRect(), vh = window.innerHeight
  return r.height > 0 && r.top > vh / 2 && Math.abs(r.bottom - vh) < 2 ? Math.round(vh - r.top) : STRIP_FALLBACK
}

/** Is a step available on the current page? Target-less steps always are. */
function available(s: TutorialStep): boolean {
  return !s.target || !!document.querySelector(s.target)
}

export default function TutorialOverlay({ onComplete }: TutorialOverlayProps) {
  const [step, setStep] = useState(0)
  const [avail, setAvail] = useState<boolean[]>(() => STEPS.map((s) => !s.target))
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<React.CSSProperties>({})
  const cardRef = useRef<HTMLDivElement>(null)
  // Below 768 px (and on landscape phones) the card is a bottom sheet above the control strip.
  const phone = usePhone()

  const current = STEPS[step]

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  // Which steps exist on this page: measured after the page has committed, and again per step.
  useEffect(() => {
    const measure = () => setAvail(STEPS.map(available))
    const raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [step])

  // The outlined element, re-measured on resize.
  useEffect(() => {
    if (!current.target) { setRect(null); return }
    const el = document.querySelector(current.target)
    if (!el) { setRect(null); return }
    const measure = () => setRect(el.getBoundingClientRect())
    measure()
    window.addEventListener('resize', measure)
    // On a phone the page scrolls under the sheet, so the outline follows the target.
    if (phone) window.addEventListener('scroll', measure, { capture: true, passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, { capture: true })
    }
  }, [step, current.target, phone])

  // Phone: bring the target into the space above the sheet. scroll-margin-bottom
  // set to the sheet and strip heights makes block 'center' center the target
  // in that free band rather than in the whole viewport.
  useEffect(() => {
    if (!phone || !current.target) return
    const el = document.querySelector<HTMLElement>(current.target)
    if (!el) return
    const raf = requestAnimationFrame(() => {
      const below = (cardRef.current?.offsetHeight ?? 0) + stripHeight()
      const prev = el.style.scrollMarginBottom
      el.style.scrollMarginBottom = `${below}px`
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.style.scrollMarginBottom = prev
    })
    return () => cancelAnimationFrame(raf)
  }, [step, current.target, phone])

  useEffect(() => { cardRef.current?.scrollTo(0, 0) }, [step])

  // Place the card beside its target without covering it, then clamp to the viewport.
  useLayoutEffect(() => {
    if (phone) {
      setPos({ left: 0, right: 0, bottom: stripHeight() })
      return
    }
    const card = cardRef.current
    const vw = window.innerWidth, vh = window.innerHeight
    const h = card?.offsetHeight ?? 300
    if (!rect || current.placement === 'center') {
      setPos({ top: Math.max(MARGIN, (vh - h) / 2), left: Math.max(MARGIN, (vw - CARD_W) / 2) })
      return
    }
    const fitsRight = rect.right + GAP + CARD_W <= vw - MARGIN
    const fitsLeft = rect.left - GAP - CARD_W >= MARGIN
    const fitsBelow = rect.bottom + GAP + h <= vh - MARGIN
    const fitsAbove = rect.top - GAP - h >= MARGIN
    let top: number, left: number
    let side = current.placement
    if (side === 'right' && !fitsRight && fitsLeft) side = 'left'
    else if (side === 'left' && !fitsLeft && fitsRight) side = 'right'
    else if (side === 'top' && !fitsAbove && fitsBelow) side = 'bottom'
    else if (side === 'bottom' && !fitsBelow && fitsAbove) side = 'top'
    switch (side) {
      case 'right': left = rect.right + GAP; top = rect.top; break
      case 'left': left = rect.left - GAP - CARD_W; top = rect.top; break
      case 'top': left = rect.left; top = rect.top - GAP - h; break
      default: left = rect.left; top = rect.bottom + GAP
    }
    left = Math.max(MARGIN, Math.min(left, vw - CARD_W - MARGIN))
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN))
    setPos({ top, left })
  }, [rect, step, current.placement, phone])

  const finish = useCallback(() => { setVisible(false); setTimeout(onComplete, 300) }, [onComplete])

  const next = useCallback(() => {
    let i = step + 1
    while (i < STEPS.length && !available(STEPS[i])) i++
    if (i < STEPS.length) setStep(i); else finish()
  }, [step, finish])

  const prev = useCallback(() => {
    let i = step - 1
    while (i >= 0 && !available(STEPS[i])) i--
    if (i >= 0) setStep(i)
  }, [step])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      else if (e.key === 'Escape') finish()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [next, prev, finish])

  const shown = STEPS.map((_, i) => avail[i]).filter(Boolean).length
  const index = STEPS.slice(0, step + 1).filter((_, i) => avail[i]).length
  const pad = (n: number) => String(n).padStart(2, '0')
  const isLast = !STEPS.slice(step + 1).some((_, k) => avail[step + 1 + k])
  const isFirst = !STEPS.slice(0, step).some((_, k) => avail[k])

  const mask: React.CSSProperties | undefined = rect
    ? { clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${rect.left - 4}px ${rect.top - 4}px, ${rect.left - 4}px ${rect.bottom + 4}px, ${rect.right + 4}px ${rect.bottom + 4}px, ${rect.right + 4}px ${rect.top - 4}px, ${rect.left - 4}px ${rect.top - 4}px)` }
    : undefined

  // The outline sits 4 px outside the target. On a phone a full-width target
  // (the pinned control strip) would put that off-screen or under the sheet,
  // so the box is kept inside the viewport and below the sheet's lower edge.
  let outline: React.CSSProperties | undefined
  if (rect) {
    let top = rect.top - 4, left = rect.left - 4, right = rect.right + 4, bottom = rect.bottom + 4
    if (phone) {
      const vw = window.innerWidth, vh = window.innerHeight
      const sheetBottom = vh - (typeof pos.bottom === 'number' ? pos.bottom : 0)
      if (rect.top >= sheetBottom - 4) top = Math.max(top, sheetBottom)
      left = Math.max(0, left); right = Math.min(vw, right); bottom = Math.min(vh, bottom)
    }
    outline = { top, left, width: right - left, height: bottom - top }
  }

  return (
    <div className="tour-root" data-visible={visible} data-phone={phone || undefined}>
      <style>{TOUR_CSS}</style>
      <div className="tour-mask" style={mask} onClick={(e) => { if (e.target === e.currentTarget) next() }} />
      {rect && (
        <div className="tour-outline" style={outline} />
      )}
      <div ref={cardRef} className="tour-card" style={phone ? pos : { ...pos, width: CARD_W }} role="dialog" aria-label={current.title}>
        <div className="tour-head">
          <span className="tour-count">{pad(index)} / {pad(shown)}</span>
          <span className="tour-title">{current.title}</span>
        </div>
        <div className="tour-body">{current.content}</div>
        <div className="tour-foot">
          <button className="tour-link" onClick={prev} disabled={isFirst}>BACK</button>
          <button className="tour-link tour-skip" onClick={finish}>SKIP</button>
          <button className="tour-link" onClick={next}>{isLast ? 'BEGIN' : 'NEXT'}</button>
        </div>
      </div>
    </div>
  )
}

/* The card's grammar. It reads the room's type variables where they exist
   (the Standard room sets --kd-caps / --kd-body) and falls back otherwise. */
const TOUR_CSS = `
.tour-root { position: fixed; inset: 0; z-index: 200; opacity: 0; transition: opacity 300ms linear; pointer-events: none; }
.tour-root[data-visible="true"] { opacity: 1; pointer-events: auto; }
.tour-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.55); }
.tour-outline { position: absolute; border: 1px solid var(--kd-warm, #f0a98a); pointer-events: none; }
.tour-card {
  position: absolute; max-height: 75vh; overflow-y: auto; box-sizing: border-box;
  background: #0c1018; border: 1px solid rgba(255,255,255,0.22); color: rgba(255,255,255,0.82);
  padding: 0; border-radius: 0; box-shadow: none;
  font-family: var(--kd-body, 'Mona Sans', system-ui, sans-serif); font-stretch: 100%; font-weight: 400;
  font-size: 13.5px; line-height: 1.55; letter-spacing: 0; text-transform: none; user-select: text;
}
.tour-head { position: sticky; top: 0; z-index: 1; background: #0c1018; display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; padding: 14px 18px 8px; border-bottom: 1px solid rgba(255,255,255,0.12);
  font-family: var(--kd-caps, 'Mona Sans', sans-serif); font-weight: var(--kd-caps-weight, 400); font-stretch: var(--kd-caps-stretch, 125%);
  font-size: 9px; letter-spacing: var(--kd-caps-track, 0.12em); text-transform: uppercase; }
.tour-count { color: rgba(255,255,255,0.5); white-space: nowrap; font-variant-numeric: tabular-nums; }
.tour-title { color: #fff; }
.tour-body { padding: 0 18px; }
.tour-body p { margin: 0 0 8px; }
.tour-body b { color: #fff; font-weight: 500; }
.tour-body .tour-h { margin: 12px 0 3px; color: #fff; font-weight: 500; }
.tour-body .tour-dim { color: rgba(255,255,255,0.55); }
.tour-body .tour-list { margin: 0 0 8px; padding-left: 16px; }
.tour-body .tour-list li { margin: 0 0 5px; }
.tour-body sub { font-size: 0.72em; }
.tour-foot { position: sticky; bottom: 0; z-index: 1; background: #0c1018; display: flex; align-items: baseline; justify-content: space-between; margin-top: 10px; padding: 8px 18px 12px; border-top: 1px solid rgba(255,255,255,0.12);
  font-family: var(--kd-caps, 'Mona Sans', sans-serif); font-weight: var(--kd-caps-weight, 400); font-stretch: var(--kd-caps-stretch, 125%);
  font-size: 9px; letter-spacing: var(--kd-caps-track, 0.12em); text-transform: uppercase; }
.tour-foot .tour-link { background: none; border: 0; border-bottom: 1px dotted rgba(255,255,255,0.45); padding: 2px 0; margin: 0; color: rgba(255,255,255,0.85); font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; border-radius: 0; }
.tour-foot .tour-link:hover { color: #fff; border-bottom-color: #fff; }
.tour-foot .tour-link:disabled { color: rgba(255,255,255,0.3); border-bottom-color: rgba(255,255,255,0.15); cursor: default; }
.tour-foot .tour-skip { color: rgba(255,255,255,0.55); }

/* Phone: a full-width bottom sheet above the pinned control strip. The root and
   mask let touches through so the page still scrolls; only the sheet takes input. */
.tour-root[data-phone][data-visible="true"] { pointer-events: none; }
.tour-root[data-phone] .tour-mask { pointer-events: none; }
.tour-root[data-phone][data-visible="true"] .tour-card { pointer-events: auto; }
.tour-root[data-phone] .tour-card { width: auto; max-height: 42vh; border-left: 0; border-right: 0; overscroll-behavior: contain; }
.tour-root[data-phone] .tour-head { padding: 12px 16px 8px; font-size: 10px; }
.tour-root[data-phone] .tour-body { padding: 0 16px; }
.tour-root[data-phone] .tour-foot { margin-top: 6px; padding: 0 16px; font-size: 11px; align-items: center; }
.tour-root[data-phone] .tour-foot .tour-link { min-height: 44px; padding: 0 8px; margin: 0 -8px; border-bottom: 0; text-decoration: underline dotted rgba(255,255,255,0.45); text-underline-offset: 4px; }
.tour-root[data-phone] .tour-foot .tour-link:disabled { text-decoration-color: rgba(255,255,255,0.15); }
`
