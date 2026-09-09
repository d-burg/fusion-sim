import { useState, useEffect, useCallback, useRef } from 'react'

/* ═══════════════════════════════════════════════════════════════════
   TutorialOverlay — step-by-step guided tour of the Control Room
   ═══════════════════════════════════════════════════════════════════ */

interface TutorialStep {
  /** CSS selector for the panel to highlight (null = centered card) */
  target: string | null
  title: string
  content: React.ReactNode
  /** Where to place the explanation card relative to the highlight */
  placement: 'right' | 'left' | 'center' | 'bottom-right' | 'bottom-left'
}

/** Same glyph the control room's Edit button uses. */
function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931ZM19.5 7.125 16.875 4.5" />
    </svg>
  )
}

const STEPS: TutorialStep[] = [
  /* ─── 0: Welcome ─── */
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
        <p className="mt-2">
          A <b>tokamak</b> works by driving a large electrical current through
          a ring of ionized hydrogen gas (plasma) while surrounding it with
          external magnetic coils. The combination of the toroidal (donut-direction)
          field from the coils and the poloidal field from the plasma current creates
          helical field lines that keep the 100-million-degree plasma suspended
          away from the walls.
        </p>
        <p className="mt-2">
          Each simulation run is called a <b>pulse</b>. You
          will program the heating power, plasma current, density, and shaping,
          then watch the plasma respond in real time. Your job is to keep the
          plasma stable, avoid disruptions, and maximize fusion performance.
        </p>
        <p className="mt-2 text-gray-500">
          Let's walk through each panel so you know what you're looking at.
        </p>
      </>
    ),
  },

  /* ─── 1: Equilibrium ─── */
  {
    target: '[data-tutorial="equilibrium"]',
    title: 'Equilibrium cross-section',
    placement: 'right',
    content: (
      <>
        <p>
          This is a <b>poloidal cross-section</b> of the tokamak: imagine
          slicing the donut vertically. You're looking at a 2D slice of the
          3D torus.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Flux surfaces</p>
        <p>
          The colored contours are <b>flux surfaces</b>: nested, closed
          surfaces of constant magnetic flux. Because transport along
          field lines is much faster than across them, temperature and
          density are roughly constant on each flux surface. The hot core
          (warm colors) is in the center; the cooler edge (blue) is on the
          outside.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Separatrix and X-point</p>
        <p>
          The <b>separatrix</b> (red outline) is the outermost closed flux
          surface, the boundary between confined and unconfined plasma.
          At the bottom, the separatrix forms an <b>X-point</b> where the
          poloidal magnetic field is zero. Field lines outside the
          separatrix are "open" and guide escaping particles and heat
          downward to the <b>divertor</b> target plates.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Plasma shape</p>
        <p>
          The shape of the plasma cross-section is characterized by its
          <b> elongation (κ)</b>, how tall it is versus wide, and its
          <b> triangularity (δ)</b>, how D-shaped it is. Elongated,
          D-shaped plasmas are more stable and confine energy better.
          The shape is controlled by currents in external shaping coils.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Strike points</p>
        <p>
          The points where the separatrix intersects the divertor plates
          are called <b>strike points</b>. The exhaust heat is concentrated
          in a narrow band around these points, creating extreme heat loads
          that must be managed to protect the wall.
        </p>
      </>
    ),
  },

  /* ─── 2: Traces Overview ─── */
  {
    target: '[data-tutorial="traces"]',
    title: 'Time traces',
    placement: 'bottom-left',
    content: (
      <>
        <p>
          This panel shows the <b>time evolution</b> of key plasma parameters
          throughout the pulse, like an oscilloscope or strip-chart
          recorder in a real control room.
        </p>

        <p className="mt-2">
          By default you'll see the <b>plasma current (I<sub>p</sub>)</b>,
          <b> normalized beta (β<sub>N</sub>)</b>,
          <b> internal inductance (l<sub>i</sub>)</b>, and
          <b> D-alpha (D<sub>α</sub>) emission</b>. You can add or remove
          traces using the dropdown at the top-left of the panel.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Reading the traces</p>
        <p>
          The horizontal axis is time (seconds). The dashed lines show
          the <b>programmed targets</b>, what you asked for. The solid
          lines show the <b>actual plasma response</b>. The plasma doesn't
          always follow the program; it has its own physics. If the solid
          line diverges far from the dashed line, you may be pushing the
          plasma too hard.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Scrubbing</p>
        <p>
          After a pulse finishes, you can click and drag on this panel
          to <b>scrub</b> through time, replaying the equilibrium and
          diagnostics at any moment in the pulse.
        </p>
      </>
    ),
  },

  /* ─── 3: Plasma Parameters & Power Balance ─── */
  {
    target: '[data-tutorial="status"]',
    title: 'Plasma parameters and power balance',
    placement: 'bottom-right',
    content: (
      <>
        <p>
          The status panel shows the <b>instantaneous state</b> of the plasma.
          It's organized into several sections:
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Core parameters</p>
        <p>
          The plasma current <b>I<sub>p</sub></b> (MA), toroidal
          field <b>B<sub>t</sub></b> (T), central electron
          temperature <b>T<sub>e0</sub></b> (keV), line-averaged
          density <b>n̄<sub>e</sub></b>, stored thermal
          energy <b>W<sub>th</sub></b> (MJ), and confinement
          time <b>τ<sub>E</sub></b> (s). Together these define the
          thermodynamic state of the plasma. You want high temperature and
          density for fusion, but the plasma has limits on how far you can push.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Power balance</p>
        <p>
          Power goes <i>in</i> through ohmic heating (resistive), neutral beam injection
          (NBI), and electron cyclotron heating (ECH). Power comes <i>out</i> as
          radiation (P<sub>rad</sub>) and losses conducted to the edge (P<sub>loss</sub>).
          The balance between input and output determines whether the plasma is heating
          up, cooling down, or in steady state. The colored bars give you a quick visual
          sense of the power flows.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Stability and disruption risk</p>
        <p>
          Key stability metrics like <b>q<sub>95</sub></b> (safety factor),
          <b> β<sub>N</sub></b> (normalized beta), and <b>f<sub>GW</sub></b> (Greenwald fraction) tell you how close the plasma is to known
          operational limits. Push past these limits and you risk a
          <b> disruption</b> — a sudden, violent loss of confinement where
          the plasma dumps all its energy onto the wall in milliseconds.
          The disruption risk gauge turns red when you're in danger.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Fusion performance</p>
        <p>
          The neutron diagnostic shows the fusion reaction rate and
          <b> Q<sub>plasma</sub></b>, the ratio of fusion power produced to
          heating power supplied. Q = 1 is "breakeven"; Q = 10 is the
          ITER target. On smaller machines running D-D fuel, Q will be
          tiny — but on ITER with D-T fuel, the energy of the reactions puts us in a regime where generating electricity from fusion becomes a possibility.
        </p>
      </>
    ),
  },

  /* ─── 4: Divertor ─── */
  {
    target: '[data-tutorial="status"]',
    title: 'Divertor temperature',
    placement: 'bottom-right',
    content: (
      <>
        <p>
          Within the status panel, the <b>divertor diagnostics</b> section
          deserves special attention. It covers one of the biggest engineering
          challenges in fusion.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">The exhaust problem</p>
        <p>
          All the power that crosses the separatrix flows along field lines
          in a thin <b>scrape-off layer</b> (SOL), typically only a few
          millimeters wide, and slams into the divertor target plates.
          This concentrates megawatts of power onto a tiny area, creating
          heat fluxes comparable to a rocket nozzle or the surface of the
          Sun (~10 MW/m²).
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Peak heat flux and surface temperature</p>
        <p>
          The panel shows the <b>peak heat flux</b> (MW/m²) at the strike
          point and the resulting <b>surface temperature</b> of the divertor
          tiles. Modern tokamaks use <b>tungsten</b> armor tiles cooled by
          pressurized water.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Why this matters</p>
        <p>
          Tungsten undergoes <b>recrystallization</b> above ~1200–1300°C,
          which makes it brittle and prone to cracking under thermal cycling.
          This effectively limits steady-state heat flux to ~10 MW/m². If you
          see the surface temperature climbing above 1000°C, you need to either
          reduce the input power, increase impurity seeding to promote
          radiative cooling (detachment), or adjust the magnetic geometry to
          spread the heat over a larger area.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">Detachment</p>
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

  /* ─── 5: Port View ─── */
  {
    target: '[data-tutorial="portview"]',
    title: '3D port view',
    placement: 'left',
    content: (
      <>
        <p>
          This is a <b>3D view</b> looking through a diagnostic port into the
          tokamak vessel, similar to what a visible-light camera would see in
          a real experiment.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">What you're seeing</p>
        <p>
          The glowing column in the center is the <b>plasma</b>. The color
          and intensity reflect the plasma state: it glows brighter with
          higher temperature and density.
        </p>
        <p className="mt-1">
          The structures at the bottom are the <b>divertor plates</b>. They
          change color based on the heat flux — from cool blue through cyan
          and yellow to dangerous red/white at high heat loads. This is the
          same heat flux information shown in the divertor diagnostics, but
          visualized spatially.
        </p>

        <p className="mt-3 mb-0.5 text-sm font-medium text-gray-200">In a real tokamak</p>
        <p>
          Real tokamaks have cameras that capture visible and infrared images
          through shielded viewports. Engineers use infrared thermography to
          monitor wall temperatures in real time and protect against hot spots.
          What you see here is a simplified rendering of that view.
        </p>
      </>
    ),
  },

  /* ─── 6: Objective ─── */
  {
    target: null,
    title: 'Your mission',
    placement: 'center',
    content: (
      <>
        <p className="text-sm font-medium text-gray-200">
          Run pulses in a fusion power plant that:
        </p>
        <ul className="list-disc list-inside mt-1 space-y-1">
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
            rate and <b>Q<sub>plasma</sub></b>. This requires high temperature,
            high density, and good confinement, all while staying within
            stability limits.
          </li>
          <li>
            <b>Protect the divertor</b> — keep the surface temperature below
            the tungsten recrystallization threshold. Use impurity seeding
            and detachment to spread the exhaust heat.
          </li>
        </ul>

        <div className="mt-3 p-2 bg-gray-800 border border-gray-700">
          <p className="text-sm font-medium text-gray-200 mb-1">Strategy tip</p>
          <p>
            The <b>smaller and lower-field</b> the device, the better for
            testing scenarios in a lower-consequence environment. A disruption
            on DIII-D is a nuisance; a disruption on ITER is a crisis.
          </p>
          <p className="mt-1">
            The <b>larger and/or higher-field</b> the device, the higher the
            risk from individual disruptions and even ELMs — but also the
            higher the potential fusion performance and Q.
          </p>
          <p className="mt-1 font-medium text-gray-200">
            Start small and work your way up. Good luck.
          </p>
        </div>

        <div className="mt-3 p-2 bg-gray-800 border border-gray-700 text-xs text-gray-400">
          <p className="text-sm font-medium text-gray-200 mb-1">Quick controls recap</p>
          <ul className="space-y-0.5">
            <li><b>▶ Start / ⏸ Pause</b>: run or pause the pulse</li>
            <li><b>Speed buttons</b>: 0.5x to 2x playback speed</li>
            <li><b>Device dropdown</b>: switch between tokamaks (DIII-D, JET, ITER, CENTAUR)</li>
            <li><b>Preset buttons</b>: H-mode, L-mode, or Density limit scenarios</li>
            <li>
              <b className="inline-flex items-center gap-1 align-middle">
                <EditIcon />
                Edit
              </b>
              : open the pulse planner to customize the program
            </li>
            <li><b>After pulse</b>: click on the trace panel to scrub through time</li>
          </ul>
        </div>
      </>
    ),
  },
]

/* ═══════════════════════════════════════════════════════════════════ */

interface TutorialOverlayProps {
  onComplete: () => void
}

export default function TutorialOverlay({ onComplete }: TutorialOverlayProps) {
  const [step, setStep] = useState(0)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const [visible, setVisible] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  /* Drag & viewport-clamping state */
  const [posOverride, setPosOverride] = useState<{ top: number; left: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ mx: 0, my: 0, top: 0, left: 0 })

  const currentStep = STEPS[step]

  // Fade in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  // Measure the target element whenever the step changes
  useEffect(() => {
    if (!currentStep.target) {
      setHighlightRect(null)
      return
    }
    const el = document.querySelector(currentStep.target)
    if (!el) {
      setHighlightRect(null)
      return
    }
    const rect = el.getBoundingClientRect()
    setHighlightRect(rect)

    // Re-measure on resize
    const onResize = () => {
      const r = el.getBoundingClientRect()
      setHighlightRect(r)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [step, currentStep.target])

  // Scroll card into view when step changes
  useEffect(() => {
    cardRef.current?.scrollTo(0, 0)
  }, [step])

  // Reset position override when step changes (so computed position is used first)
  useEffect(() => {
    setPosOverride(null)
  }, [step])

  // Post-render: clamp card fully within viewport if it overflows
  useEffect(() => {
    if (!cardRef.current || posOverride !== null) return
    const raf = requestAnimationFrame(() => {
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const margin = 8

      let top = rect.top
      let left = rect.left
      let needsClamp = false

      if (rect.bottom > vh - margin) {
        top = Math.max(margin, vh - rect.height - margin)
        needsClamp = true
      }
      if (top < margin) {
        top = margin
        needsClamp = true
      }
      if (rect.right > vw - margin) {
        left = Math.max(margin, vw - rect.width - margin)
        needsClamp = true
      }
      if (left < margin) {
        left = margin
        needsClamp = true
      }

      if (needsClamp) {
        setPosOverride({ top, left })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [step, highlightRect, posOverride])

  // Drag: global mousemove / mouseup listeners
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      e.preventDefault()
      const dx = e.clientX - dragStartRef.current.mx
      const dy = e.clientY - dragStartRef.current.my
      setPosOverride({
        top: dragStartRef.current.top + dy,
        left: dragStartRef.current.left + dx,
      })
    }
    const onUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        setDragging(false)
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !cardRef.current) return
    e.preventDefault()
    isDraggingRef.current = true
    setDragging(true)
    const rect = cardRef.current.getBoundingClientRect()
    dragStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      top: rect.top,
      left: rect.left,
    }
  }, [])

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      setVisible(false)
      setTimeout(onComplete, 300)
    }
  }, [step, onComplete])

  const prev = useCallback(() => {
    if (step > 0) setStep(s => s - 1)
  }, [step])

  const skip = useCallback(() => {
    setVisible(false)
    setTimeout(onComplete, 300)
  }, [onComplete])

  // Keyboard: Enter/Right = next, Left = prev, Escape = skip
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'Escape') skip()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [next, prev, skip])

  // Compute card position (override if clamped or dragged)
  const computedStyle = computeCardPosition(currentStep, highlightRect)
  const cardStyle = posOverride
    ? { width: 380, maxHeight: '75vh' as const, top: posOverride.top, left: posOverride.left }
    : computedStyle

  // Build the overlay mask with a cutout for the highlighted panel
  const maskStyle = highlightRect
    ? buildMaskClip(highlightRect)
    : undefined

  return (
    <div
      className={`fixed inset-0 z-[200] transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Dark overlay with cutout */}
      <div
        className="absolute inset-0 bg-black/70 transition-all duration-500"
        style={maskStyle}
        onClick={(e) => {
          // Clicking the overlay (not the card) advances
          if (e.target === e.currentTarget) next()
        }}
      />

      {/* Highlight border glow around target */}
      {highlightRect && (
        <div
          className="absolute border border-amber-400 pointer-events-none
                     transition-all duration-500"
          style={{
            top: highlightRect.top - 3,
            left: highlightRect.left - 3,
            width: highlightRect.width + 6,
            height: highlightRect.height + 6,
          }}
        />
      )}

      {/* Explanation card */}
      <div
        ref={cardRef}
        className={`absolute bg-gray-900 border border-gray-700 shadow-2xl overflow-y-auto
                   ${dragging ? '' : 'transition-all duration-500'} tutorial-card`}
        style={cardStyle}
      >
        {/* Header (drag handle) */}
        <div
          className="sticky top-0 bg-gray-900 px-4 pt-3 pb-2 border-b border-gray-800 z-10 select-none"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onMouseDown={onHeaderMouseDown}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs mr-0.5" title="Drag to reposition">⠿</span>
              <span className="font-mono tabular-nums text-xs text-gray-500">
                {step + 1}/{STEPS.length}
              </span>
              <h3 className="text-base font-medium text-white">{currentStep.title}</h3>
            </div>
            <button
              onClick={skip}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              Skip tour
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Step dots */}
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === step
                    ? 'w-4 bg-cyan-400'
                    : i < step
                      ? 'w-2 bg-cyan-700'
                      : 'w-2 bg-gray-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3 text-sm text-gray-400 leading-relaxed">
          {currentStep.content}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-900 px-4 py-2 border-t border-gray-800
                        flex items-center justify-between z-10">
          <button
            onClick={prev}
            disabled={step === 0}
            className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer
              ${step === 0
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
          >
            ← Back
          </button>
          <button
            onClick={next}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-sm font-medium
                       transition-colors cursor-pointer text-white"
          >
            {step === STEPS.length - 1 ? 'Start operating →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Helpers ─── */

function computeCardPosition(
  step: TutorialStep,
  rect: DOMRect | null,
): React.CSSProperties {
  const cardWidth = 380
  const cardMaxHeight = '75vh'
  const gap = 12
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  if (step.placement === 'center' || !rect) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: cardWidth,
      maxHeight: cardMaxHeight,
    }
  }

  const base: React.CSSProperties = {
    width: cardWidth,
    maxHeight: cardMaxHeight,
  }

  // Clamp helpers
  const clampLeft = (l: number) => Math.max(8, Math.min(l, vw - cardWidth - 8))
  // Card maxHeight is 75vh — clamp top so the full card fits in the viewport.
  const maxCardH = vh * 0.75
  const clampTop = (t: number) => Math.max(8, Math.min(t, vh - maxCardH - 8))

  switch (step.placement) {
    case 'right': {
      let left = rect.right + gap
      // If card would overflow right edge, try positioning it inside the highlight area
      if (left + cardWidth > vw - 8) left = vw - cardWidth - 8
      return {
        ...base,
        top: clampTop(rect.top),
        left: clampLeft(left),
      }
    }
    case 'left': {
      let left = rect.left - cardWidth - gap
      if (left < 8) left = 8
      return {
        ...base,
        top: clampTop(rect.top),
        left: clampLeft(left),
      }
    }
    case 'bottom-right': {
      // Try to the right of the panel first; if no room, overlay on the right side of the panel
      let left = rect.right + gap
      if (left + cardWidth > vw - 8) {
        left = rect.right - cardWidth - gap
      }
      if (left < 8) left = 8
      return {
        ...base,
        top: clampTop(rect.top + 20),
        left: clampLeft(left),
      }
    }
    case 'bottom-left': {
      let left = rect.left - cardWidth - gap
      if (left < 8) left = rect.left + gap
      return {
        ...base,
        top: clampTop(rect.top),
        left: clampLeft(left),
      }
    }
    default:
      return {
        ...base,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
  }
}

function buildMaskClip(rect: DOMRect): React.CSSProperties {
  const pad = 4
  const t = Math.max(0, rect.top - pad)
  const l = Math.max(0, rect.left - pad)
  const b = rect.bottom + pad
  const r = rect.right + pad

  // Use clip-path with a polygon that has a rectangular hole
  // Outer rectangle (full viewport) wound clockwise,
  // inner rectangle (cutout) wound counter-clockwise
  return {
    clipPath: `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px
    )`,
  }
}
