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

const STEPS: TutorialStep[] = [
  /* ─── 0: Welcome ─── */
  {
    target: null,
    title: 'Welcome to the Fusion Simulator',
    placement: 'center',
    content: (
      <>
        <p>
          You are looking at the <b>control room</b> of a tokamak — a
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
          Each simulation run is called a <b>discharge</b> or <b>shot</b>. You
          will program the heating power, plasma current, density, and shaping —
          then watch the plasma respond in real time. Your job is to keep the
          plasma stable, avoid disruptions, and maximize fusion performance.
        </p>
        <p className="mt-2 text-gray-400 text-[10px]">
          Let's walk through each panel so you know what you're looking at.
        </p>
      </>
    ),
  },

  /* ─── 1: Equilibrium ─── */
  {
    target: '[data-tutorial="equilibrium"]',
    title: 'Equilibrium Cross-Section',
    placement: 'right',
    content: (
      <>
        <p>
          This is a <b>poloidal cross-section</b> of the tokamak — imagine
          slicing the donut vertically. You're looking at a 2D slice of the
          3D torus.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Flux Surfaces</p>
        <p>
          The colored contours are <b>flux surfaces</b> — nested, closed
          surfaces of constant magnetic flux. Because transport along
          field lines is much faster than across them, temperature and
          density are roughly constant on each flux surface. The hot core
          (warm colors) is in the center; the cooler edge (blue) is on the
          outside.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Separatrix & X-Point</p>
        <p>
          The outermost closed flux surface — the <b>separatrix</b> (red
          outline) — is the boundary between confined and unconfined plasma.
          At the bottom, the separatrix forms an <b>X-point</b> where the
          poloidal magnetic field is zero. Field lines outside the
          separatrix are "open" and guide escaping particles and heat
          downward to the <b>divertor</b> target plates.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Plasma Shape</p>
        <p>
          The shape of the plasma cross-section is characterized by its
          <b> elongation (κ)</b> — how tall vs. wide it is — and its
          <b> triangularity (δ)</b> — how D-shaped it is. Elongated,
          D-shaped plasmas are more stable and confine energy better.
          The shape is controlled by currents in external shaping coils.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Strike Points</p>
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
    title: 'Time Traces',
    placement: 'bottom-left',
    content: (
      <>
        <p>
          This panel shows the <b>time evolution</b> of key plasma parameters
          throughout the discharge, like an oscilloscope or strip-chart
          recorder in a real control room.
        </p>

        <p className="mt-2">
          By default you'll see the <b>plasma current (I<sub>p</sub>)</b>,
          <b> normalized beta (β<sub>N</sub>)</b>,
          <b> internal inductance (l<sub>i</sub>)</b>, and
          <b> D-alpha (D<sub>α</sub>) emission</b>. You can add or remove
          traces using the dropdown at the top-left of the panel.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Reading the Traces</p>
        <p>
          The horizontal axis is time (seconds). The dashed lines show
          the <b>programmed targets</b> — what you asked for. The solid
          lines show the <b>actual plasma response</b>. The plasma doesn't
          always follow the program — it has its own physics. If the solid
          line diverges far from the dashed line, you may be pushing the
          plasma too hard.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Scrubbing</p>
        <p>
          After a discharge finishes, you can click and drag on this panel
          to <b>scrub</b> through time — replaying the equilibrium and
          diagnostics at any moment in the shot.
        </p>
      </>
    ),
  },

  /* ─── 3: Plasma Parameters & Power Balance ─── */
  {
    target: '[data-tutorial="status"]',
    title: 'Plasma Parameters & Power Balance',
    placement: 'bottom-right',
    content: (
      <>
        <p>
          The status panel shows the <b>instantaneous state</b> of the plasma.
          It's organized into several sections:
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Core Parameters</p>
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

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Power Balance</p>
        <p>
          Power goes <i>in</i> through ohmic heating (resistive), neutral beam injection
          (NBI), and electron cyclotron heating (ECH). Power comes <i>out</i> as
          radiation (P<sub>rad</sub>) and losses conducted to the edge (P<sub>loss</sub>).
          The balance between input and output determines whether the plasma is heating
          up, cooling down, or in steady state. The colored bars give you a quick visual
          sense of the power flows.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Stability & Disruption Risk</p>
        <p>
          Key stability metrics like <b>q<sub>95</sub></b> (safety factor),
          <b> β<sub>N</sub></b> (normalized beta), and <b>f<sub>GW</sub></b>
          (Greenwald fraction) tell you how close the plasma is to known
          operational limits. Push past these limits and you risk a
          <b> disruption</b> — a sudden, violent loss of confinement where
          the plasma dumps all its energy onto the wall in milliseconds.
          The disruption risk gauge turns red when you're in danger.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Fusion Performance</p>
        <p>
          The neutron diagnostic shows the fusion reaction rate and
          <b> Q<sub>plasma</sub></b> — the ratio of fusion power produced to
          heating power supplied. Q = 1 is "breakeven"; Q = 10 is the
          ITER target. On smaller machines running D-D fuel, Q will be
          tiny — but on ITER with D-T fuel, it's the whole game.
        </p>
      </>
    ),
  },

  /* ─── 4: Divertor ─── */
  {
    target: '[data-tutorial="status"]',
    title: 'Divertor Temperature',
    placement: 'bottom-right',
    content: (
      <>
        <p>
          Within the status panel, the <b>divertor diagnostics</b> section
          deserves special attention — it's one of the biggest engineering
          challenges in fusion.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">The Exhaust Problem</p>
        <p>
          All the power that crosses the separatrix flows along field lines
          in a thin <b>scrape-off layer</b> (SOL) — typically only a few
          millimeters wide — and slams into the divertor target plates.
          This concentrates megawatts of power onto a tiny area, creating
          heat fluxes comparable to a rocket nozzle or the surface of the
          Sun (~10 MW/m²).
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Peak Heat Flux & Surface Temperature</p>
        <p>
          The panel shows the <b>peak heat flux</b> (MW/m²) at the strike
          point and the resulting <b>surface temperature</b> of the divertor
          tiles. Modern tokamaks use <b>tungsten</b> armor tiles cooled by
          pressurized water.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Why This Matters</p>
        <p>
          Tungsten undergoes <b>recrystallization</b> above ~1200–1300°C,
          which makes it brittle and prone to cracking under thermal cycling.
          This effectively limits steady-state heat flux to ~10 MW/m². If you
          see the surface temperature climbing above 1000°C, you need to either
          reduce the input power, increase impurity seeding to promote
          radiative cooling (detachment), or adjust the magnetic geometry to
          spread the heat over a larger area.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">Detachment</p>
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
    title: '3D Port View',
    placement: 'left',
    content: (
      <>
        <p>
          This is a <b>3D view</b> looking through a diagnostic port into the
          tokamak vessel — similar to what a visible-light camera would see in
          a real experiment.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">What You're Seeing</p>
        <p>
          The glowing column in the center is the <b>plasma</b>. The color
          and intensity reflect the plasma state — it glows brighter with
          higher temperature and density.
        </p>
        <p className="mt-1">
          The structures at the bottom are the <b>divertor plates</b>. They
          change color based on the heat flux — from cool blue through cyan
          and yellow to dangerous red/white at high heat loads. This is the
          same heat flux information shown in the divertor diagnostics, but
          visualized spatially.
        </p>

        <p className="mt-2 text-cyan-300 font-semibold text-[11px]">In a Real Tokamak</p>
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
    title: 'Your Mission',
    placement: 'center',
    content: (
      <>
        <p className="text-cyan-300 font-semibold">
          Run discharges in a fusion power plant that:
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
            high density, and good confinement — all while staying within
            stability limits.
          </li>
          <li>
            <b>Protect the divertor</b> — keep the surface temperature below
            the tungsten recrystallization threshold. Use impurity seeding
            and detachment to spread the exhaust heat.
          </li>
        </ul>

        <div className="mt-3 p-2 bg-gray-800/60 rounded border border-gray-700/50">
          <p className="text-cyan-300 font-semibold text-[11px] mb-1">Strategy Tip</p>
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
          <p className="mt-1 text-amber-400 font-semibold">
            Start small and work your way up. Good luck.
          </p>
        </div>

        <div className="mt-3 p-2 bg-gray-800/40 rounded border border-gray-700/30 text-[10px] text-gray-400">
          <p className="font-semibold text-gray-300 mb-1">Quick Controls Recap</p>
          <ul className="space-y-0.5">
            <li><b>▶ Start / ⏸ Pause</b> — run or pause the discharge</li>
            <li><b>Speed buttons</b> — 0.5x to 4x playback speed</li>
            <li><b>Device dropdown</b> — switch between tokamaks (DIII-D, JET, ITER)</li>
            <li><b>Preset buttons</b> — H-mode, L-mode, or Density Limit scenarios</li>
            <li><b>📋 Edit</b> — open the shot planner to customize the discharge program</li>
            <li><b>After discharge</b> — click on the trace panel to scrub through time</li>
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

  // Compute card position
  const cardStyle = computeCardPosition(currentStep, highlightRect)

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
          className="absolute border-2 border-cyan-400/60 rounded-lg pointer-events-none
                     shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all duration-500"
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
        className="absolute bg-gray-950/95 border border-cyan-500/30 rounded-lg shadow-2xl
                   shadow-cyan-500/10 backdrop-blur-sm overflow-y-auto
                   transition-all duration-500 tutorial-card"
        style={cardStyle}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-950/95 backdrop-blur-sm px-4 pt-3 pb-2 border-b border-gray-800/50 z-10">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-cyan-500 font-mono">
                {step + 1}/{STEPS.length}
              </span>
              <h3 className="text-cyan-400 font-bold text-sm">{currentStep.title}</h3>
            </div>
            <button
              onClick={skip}
              className="text-gray-500 hover:text-white text-xs transition-colors cursor-pointer"
            >
              Skip tour ✕
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
        <div className="px-4 py-3 text-gray-300 text-xs leading-relaxed">
          {currentStep.content}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-950/95 backdrop-blur-sm px-4 py-2 border-t border-gray-800/50
                        flex items-center justify-between z-10">
          <button
            onClick={prev}
            disabled={step === 0}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer
              ${step === 0
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
          >
            ← Back
          </button>
          <button
            onClick={next}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-xs font-semibold
                       transition-colors cursor-pointer text-white"
          >
            {step === STEPS.length - 1 ? 'Start Operating →' : 'Next →'}
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
  const clampTop = (t: number) => Math.max(8, Math.min(t, vh - 200))

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
