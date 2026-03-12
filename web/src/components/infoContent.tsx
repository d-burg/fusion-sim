/**
 * Physics and engineering documentation for info popups.
 * Written at an undergraduate level with references to key review papers.
 */

/* ─── Helpers ────────────────────────────────────────── */

function Cite({ doi, children }: { doi?: string; children: React.ReactNode }) {
  if (doi) {
    return (
      <a
        href={`https://doi.org/${doi}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-600 hover:underline"
      >
        {children}
      </a>
    )
  }
  return <span className="text-gray-500 italic">{children}</span>
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="text-cyan-400 font-bold text-[11px] mt-2 mb-0.5">{children}</div>
}

function Ref({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-500 text-[10px] italic mt-1">{children}</p>
}

/* ─── Equilibrium ────────────────────────────────────── */

export const equilibriumInfo = (
  <>
    <Heading>The Grad-Shafranov Equation</Heading>
    <p>
      In a tokamak, the plasma is confined by magnetic fields in an
      axisymmetric toroidal geometry. The force balance between the
      plasma pressure gradient and the magnetic (Lorentz) force is
      described by the <b>Grad-Shafranov (GS) equation</b>:
    </p>
    <p className="text-cyan-300 text-center my-1">
      R&thinsp;&part;/&part;R&thinsp;(R⁻&sup1;&thinsp;&part;&psi;/&part;R) + &part;&sup2;&psi;/&part;Z&sup2;
      = &minus;&mu;&#x2080;R&sup2;p'(&psi;) &minus; FF'(&psi;)
    </p>
    <p>
      Here <b>&psi;</b> is the poloidal magnetic flux function &mdash;
      its contours define the nested <b>flux surfaces</b> on which
      plasma properties are constant. The terms <b>p'(&psi;)</b> and{' '}
      <b>FF'(&psi;)</b> encode the pressure and toroidal field profiles.
    </p>

    <Heading>Equilibrium Reconstruction</Heading>
    <p>
      In real experiments, codes like{' '}
      <b>EFIT</b> solve the GS equation as an inverse problem:
      given magnetic measurements from sensors around the vessel,
      the code iteratively reconstructs the flux map and plasma
      boundary. This is the standard tool for interpreting tokamak
      discharges.
    </p>

    <Heading>Our Approximation: Cerfon-Freidberg</Heading>
    <p>
      This simulator uses the <b>Cerfon-Freidberg analytic solution</b>.
      Under the <b>Solov'ev ansatz</b> &mdash; assuming p' and FF' are
      constants &mdash; the GS equation becomes a linear PDE with an
      exact analytic solution:
    </p>
    <p className="text-cyan-300 text-center my-1">
      &psi;(R,Z) = &psi;<sub>particular</sub>(R) + &Sigma;<sub>i=1..12</sub> c<sub>i</sub>&thinsp;&psi;<sub>i</sub>(R,Z)
    </p>
    <p>
      The 12 coefficients c<sub>i</sub> are determined by enforcing
      shape constraints: <b>elongation (&kappa;)</b>,{' '}
      <b>triangularity (&delta;)</b>, and the <b>X-point location</b>.
      This is computationally fast (no iterative PDE solve), yet
      produces physically realistic equilibria for a wide variety
      of tokamak shapes.
    </p>

    <Heading>What the Plot Shows</Heading>
    <p>
      The contour plot displays constant-&psi; surfaces (flux surfaces).
      The <b>separatrix</b> (last closed flux surface / LCFS) is the
      outermost closed contour. The <b>magnetic axis</b> sits at the
      &psi; extremum (center of the bull's-eye). In a diverted plasma,
      an <b>X-point</b> appears where the poloidal field vanishes,
      directing exhaust particles into the divertor.
    </p>

    <Ref>
      <Cite doi="10.1063/1.3328818">Cerfon & Freidberg, Phys. Plasmas 17, 032502 (2010)</Cite>{' '}
      &mdash; the analytic solution used here.
    </Ref>
    <Ref>
      Freidberg, <i>Ideal MHD</i>, Cambridge Univ. Press (2014) &mdash; MHD equilibrium and stability theory.
    </Ref>
    <Ref>
      Wesson, <i>Tokamaks</i>, 4th ed., Oxford Univ. Press (2011) &mdash; comprehensive tokamak reference.
    </Ref>
  </>
)

/* ─── Trace descriptions ─────────────────────────────── */

export const traceDescriptions: Record<string, React.ReactNode> = {
  ip: (
    <>
      <b>Plasma current (I<sub>p</sub>)</b> &mdash; the toroidal current
      flowing through the plasma, typically 0.5&ndash;15 MA. It generates
      the poloidal magnetic field needed for confinement and is the primary
      control knob for the safety factor q. Measured externally by Rogowski coils.
    </>
  ),
  beta_n: (
    <>
      <b>Normalized beta (&beta;<sub>N</sub>)</b> &mdash; the ratio of
      plasma kinetic pressure to magnetic pressure, normalized to remove
      trivial dependences: &beta;<sub>N</sub> = &beta;<sub>t</sub>&thinsp;aB<sub>t</sub>/I<sub>p</sub>.
      The Troyon stability limit is &beta;<sub>N</sub> &asymp; 2.8; exceeding
      it risks pressure-driven disruptions.{' '}
      <Cite doi="10.1088/0741-3335/26/1A/209">Troyon et al., PPCF 26, 209 (1984)</Cite>.
    </>
  ),
  li: (
    <>
      <b>Internal inductance (l<sub>i</sub>)</b> &mdash; a dimensionless
      measure of current-profile peakedness. l<sub>i</sub> &asymp; 1 indicates
      a broad, stable profile. Very peaked profiles (high l<sub>i</sub>)
      can trigger sawtooth crashes; very broad profiles may approach the
      kink stability boundary.
    </>
  ),
  d_alpha: (
    <>
      <b>D-alpha (D<sub>&alpha;</sub>)</b> &mdash; emission from the
      deuterium Balmer-&alpha; line at 656.1 nm. It is a proxy for
      edge recycling (neutral deuterium interacting with the plasma edge).
      A sudden <b>drop</b> signals the <b>L&ndash;H transition</b>; periodic
      spikes indicate <b>edge-localized modes (ELMs)</b>.{' '}
      <Cite doi="10.1103/PhysRevLett.49.1408">Wagner et al., PRL 49, 1408 (1982)</Cite>.
    </>
  ),
  q95: (
    <>
      <b>Edge safety factor (q<sub>95</sub>)</b> &mdash; the number of
      toroidal transits a field line makes per poloidal transit, evaluated
      at the 95% poloidal flux surface. Must remain above &sim;2 to avoid
      the external kink instability. Typical H-mode operation: q<sub>95</sub> &asymp; 3&ndash;5.
    </>
  ),
  h_factor: (
    <>
      <b>H-factor (H<sub>98</sub>)</b> &mdash; confinement quality relative
      to the ITER IPB98(y,2) scaling law. H = 1.0 is the baseline;
      H &gt; 1 indicates better-than-expected confinement. ITER's Q = 10
      scenario targets H<sub>98</sub> &asymp; 1.0.{' '}
      <Cite doi="10.1088/0029-5515/39/12/301">ITER Physics Basis, Nucl. Fusion 39 (1999)</Cite>.
    </>
  ),
  f_greenwald: (
    <>
      <b>Greenwald fraction (f<sub>GW</sub>)</b> &mdash; the ratio of
      line-averaged density to the empirical density limit
      n<sub>GW</sub> = I<sub>p</sub>/(&pi;a&sup2;). Operating above
      f<sub>GW</sub> &asymp; 0.85&ndash;1.0 risks a radiative collapse
      and density-limit disruption.{' '}
      <Cite doi="10.1088/0741-3335/44/8/201">Greenwald, PPCF 44, R27 (2002)</Cite>.
    </>
  ),
  ne_bar: (
    <>
      <b>Line-averaged electron density (n&#x0304;<sub>e</sub>)</b> &mdash;
      the electron density averaged along a chord through the plasma,
      typically measured by interferometry. A key control parameter
      for fusion power and confinement.
    </>
  ),
  ne_ped: (
    <>
      <b>Pedestal electron density (n<sub>e,ped</sub>)</b> &mdash; the
      density at the top of the H-mode pedestal (edge transport barrier).
      The pedestal sets the boundary condition for the core profiles;
      higher pedestals generally lead to better core performance.
    </>
  ),
  te0: (
    <>
      <b>Central electron temperature (T<sub>e0</sub>)</b> &mdash; the
      peak electron temperature at the magnetic axis, measured by
      Thomson scattering or ECE diagnostics. In large tokamaks,
      T<sub>e0</sub> can exceed 10&ndash;30 keV during high-performance
      discharges.
    </>
  ),
  te_ped: (
    <>
      <b>Pedestal electron temperature (T<sub>e,ped</sub>)</b> &mdash; the
      temperature at the top of the H-mode pedestal. Along with
      n<sub>e,ped</sub>, it determines the pedestal pressure, which
      strongly influences overall confinement and fusion performance.
    </>
  ),
  ne_line: (
    <>
      <b>Line-integrated electron density (n<sub>e,line</sub>)</b> &mdash;
      the total electron density integrated along a diagnostic line of sight,
      measured directly by interferometers. Related to n&#x0304;<sub>e</sub>
      by dividing by the chord length.
    </>
  ),
  w_th: (
    <>
      <b>Thermal stored energy (W<sub>th</sub>)</b> &mdash; the total
      thermal energy content: W = &int;(3/2)(n<sub>e</sub>T<sub>e</sub> +
      n<sub>i</sub>T<sub>i</sub>)dV. Measured from equilibrium
      reconstruction (diamagnetic flux) or kinetic profile integration.
      A key metric for confinement: &tau;<sub>E</sub> = W<sub>th</sub>/P<sub>loss</sub>.
    </>
  ),
  p_input: (
    <>
      <b>Input power (P<sub>in</sub>)</b> &mdash; total heating power
      delivered to the plasma: P<sub>in</sub> = P<sub>OH</sub> +
      P<sub>NBI</sub> + P<sub>ECH</sub>. The threshold for L&ndash;H
      transition scales with density and magnetic field. In the
      steady state, P<sub>in</sub> &asymp; P<sub>loss</sub> + P<sub>rad</sub>.
    </>
  ),
  p_rad: (
    <>
      <b>Radiated power (P<sub>rad</sub>)</b> &mdash; power lost by
      electromagnetic radiation, primarily bremsstrahlung and line
      radiation from impurities. Measured by bolometer arrays.
      High P<sub>rad</sub>/P<sub>in</sub> ratios can lead to radiative
      collapse.
    </>
  ),
  p_loss: (
    <>
      <b>Loss power (P<sub>loss</sub>)</b> &mdash; the power conducted
      and convected across the separatrix to the scrape-off layer:
      P<sub>loss</sub> = P<sub>in</sub> &minus; P<sub>rad,core</sub> &minus;
      dW/dt. This is the power that must be handled by the divertor.
    </>
  ),
  v_loop: (
    <>
      <b>Loop voltage (V<sub>loop</sub>)</b> &mdash; the toroidal
      electric field driving the plasma current, measured by flux loops.
      In steady-state (fully driven) plasmas, V<sub>loop</sub> &rarr; 0.
      A spike in V<sub>loop</sub> often precedes a disruption as the
      current channel collapses.
    </>
  ),
  impurity_fraction: (
    <>
      <b>Impurity fraction (f<sub>Imp</sub>)</b> &mdash; the fraction of
      impurity ions (carbon, tungsten, etc.) relative to the main
      fuel species. Impurities dilute the fuel and increase
      radiative losses. Wall conditioning (boronization, glow discharge
      cleaning) is used to minimize impurity influx.
    </>
  ),
  disruption_risk: (
    <>
      <b>Disruption risk (D<sub>risk</sub>)</b> &mdash; a model estimate
      of the probability of an imminent disruption, based on proximity
      to known operational limits: q<sub>95</sub> &lt; 2 (kink),
      &beta;<sub>N</sub> &gt; 2.8 (Troyon), f<sub>GW</sub> &gt; 1
      (Greenwald). Real-time disruption predictors are an active area
      of research for ITER and future devices.
    </>
  ),
}

/* ─── Trace panel (composite) ────────────────────────── */

export function traceInfoContent(traces: { key: string; label: string; unit: string; color: string }[]) {
  return (
    <>
      <p className="mb-2">
        Time traces show the evolution of key plasma parameters throughout
        the discharge. Each trace is updated at the simulation timestep.
      </p>
      {traces.map(t => (
        <div key={t.key} className="mb-2 pl-1 border-l-2" style={{ borderColor: t.color }}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: t.color }}
            />
            <span className="text-gray-200 font-bold text-[11px]">
              {t.label}
              {t.unit && <span className="text-gray-500 font-normal ml-1">[{t.unit}]</span>}
            </span>
          </div>
          <p className="text-[10px] leading-relaxed">
            {traceDescriptions[t.key] ?? 'No description available.'}
          </p>
        </div>
      ))}
      <Ref>
        <Cite doi="10.1088/0029-5515/39/12/301">ITER Physics Basis, Nucl. Fusion 39 (1999)</Cite>{' '}
        &mdash; confinement scaling and operational limits.
      </Ref>
      <Ref>
        Wesson, <i>Tokamaks</i>, 4th ed., Oxford Univ. Press (2011).
      </Ref>
    </>
  )
}

/* ─── Status Panel: Plasma Parameters ────────────────── */

export const plasmaParamsInfo = (
  <>
    <p>
      These six quantities define the fundamental state of the plasma:
    </p>
    <Heading>I<sub>p</sub> &mdash; Plasma Current</Heading>
    <p>
      The toroidal current (MA) creates the poloidal field that, combined
      with the toroidal field from external coils, produces the helical
      field lines needed for confinement. Higher I<sub>p</sub> means
      lower q and better confinement, but approaches MHD stability limits.
    </p>
    <Heading>B<sub>t</sub> &mdash; Toroidal Field</Heading>
    <p>
      The magnetic field (T) produced by external toroidal field coils.
      Fusion power scales strongly with B<sub>t</sub>; high-field
      designs (HTS magnets) enable more compact reactors.
    </p>
    <Heading>T<sub>e0</sub> &mdash; Central Temperature</Heading>
    <p>
      The peak electron temperature (keV) at the magnetic axis.
      Fusion reactivity peaks near 15&ndash;20 keV for D-T fuel.
      Central temperatures of 10+ keV are needed for net energy gain.
    </p>
    <Heading>n&#x0304;<sub>e</sub> &mdash; Average Density</Heading>
    <p>
      Line-averaged electron density (10&sup2;&#x2070;/m&sup3;). Fusion
      power scales as n&sup2;, but density is limited by the Greenwald
      limit. The operating point balances high density (more fusion)
      against stability and confinement degradation.
    </p>
    <Heading>W<sub>th</sub> &mdash; Stored Energy</Heading>
    <p>
      Total thermal energy (MJ) in the plasma volume. Related to
      confinement time by &tau;<sub>E</sub> = W<sub>th</sub>/P<sub>loss</sub>.
      During a disruption, W<sub>th</sub> is deposited on plasma-facing
      components in milliseconds &mdash; a key engineering challenge.
    </p>
    <Heading>&tau;<sub>E</sub> &mdash; Energy Confinement Time</Heading>
    <p>
      The characteristic time (seconds) for the plasma to lose its
      stored energy in the absence of heating. The Lawson criterion
      for fusion ignition requires n&thinsp;&tau;<sub>E</sub>&thinsp;T
      &gt; 3&times;10&sup2;&sup1; keV&middot;s/m&sup3;.
    </p>
    <Ref>
      <Cite doi="10.1088/0029-5515/39/12/301">ITER Physics Basis, Nucl. Fusion 39 (1999)</Cite>{' '}
      &mdash; scaling laws and confinement.
    </Ref>
    <Ref>
      Wesson, <i>Tokamaks</i>, 4th ed., Oxford Univ. Press (2011).
    </Ref>
  </>
)

/* ─── Status Panel: Stability ────────────────────────── */

export const stabilityInfo = (
  <>
    <p>
      These parameters measure how close the plasma is to known
      operational limits. Exceeding them can trigger a <b>disruption</b> &mdash;
      a sudden loss of confinement.
    </p>
    <Heading>q<sub>95</sub> &mdash; Edge Safety Factor</Heading>
    <p>
      Must stay above &sim;2 to avoid the external kink mode. The warning
      threshold (yellow) is q<sub>95</sub> &lt; 2.5; danger (red) is
      q<sub>95</sub> &lt; 2.0. Typical operating range: 3&ndash;5.
    </p>
    <Heading>&beta;<sub>N</sub> &mdash; Normalized Beta</Heading>
    <p>
      The Troyon limit at &beta;<sub>N</sub> &asymp; 2.8 bounds the
      achievable plasma pressure. Warning above 2.5, danger above 2.8.
      Advanced tokamak scenarios push toward higher &beta;<sub>N</sub>
      with active feedback stabilization.{' '}
      <Cite doi="10.1088/0741-3335/26/1A/209">Troyon et al. (1984)</Cite>.
    </p>
    <Heading>f<sub>GW</sub> &mdash; Greenwald Fraction</Heading>
    <p>
      The empirical density limit. Warning above 0.8, danger above 0.9.
      Exceeding f<sub>GW</sub> &asymp; 1 typically leads to a MARFE
      (multifaceted asymmetric radiation from the edge) and radiative
      collapse.{' '}
      <Cite doi="10.1088/0741-3335/44/8/201">Greenwald (2002)</Cite>.
    </p>
    <Heading>H<sub>98</sub> &mdash; Confinement Quality</Heading>
    <p>
      Ratio of measured confinement time to the IPB98(y,2) scaling.
      H = 1.0 is the baseline; H &gt; 1 is favorable. Confinement
      degradation (H &lt; 1) may indicate impurity accumulation,
      MHD activity, or loss of H-mode.
    </p>
    <Heading>l<sub>i</sub> &mdash; Internal Inductance</Heading>
    <p>
      Indicates current profile shape. Very low l<sub>i</sub>
      (broad current) can approach the vertical stability boundary;
      very high l<sub>i</sub> (peaked current) increases sawtooth
      activity and may destabilize tearing modes.
    </p>
    <Heading>V<sub>loop</sub> &mdash; Loop Voltage</Heading>
    <p>
      The inductive drive. A sudden rise in V<sub>loop</sub> is a
      precursor to current quench and disruption. In steady-state
      scenarios with full non-inductive current drive, V<sub>loop</sub> &rarr; 0.
    </p>
    <Ref>
      Freidberg, <i>Ideal MHD</i>, Cambridge Univ. Press (2014) &mdash; stability theory.
    </Ref>
    <Ref>
      Wesson, <i>Tokamaks</i>, 4th ed., Oxford Univ. Press (2011).
    </Ref>
  </>
)

/* ─── Status Panel: Power Balance ────────────────────── */

export const powerBalanceInfo = (
  <>
    <p>
      The plasma energy evolves according to the power balance:
    </p>
    <p className="text-cyan-300 text-center my-1">
      dW<sub>th</sub>/dt = P<sub>in</sub> &minus; P<sub>loss</sub> &minus; P<sub>rad</sub>
    </p>
    <p>
      In steady state (dW/dt = 0), all input power is exhausted through
      conduction/convection to the edge (P<sub>loss</sub>) and radiation
      (P<sub>rad</sub>).
    </p>
    <Heading>P<sub>OH</sub> &mdash; Ohmic Heating</Heading>
    <p>
      Resistive (Joule) heating from the plasma current: P<sub>OH</sub> =
      I<sub>p</sub>&thinsp;&middot;&thinsp;V<sub>loop</sub>. Dominant at
      low temperature. Decreases as the plasma heats up (resistivity
      scales as T<sub>e</sub><sup>&minus;3/2</sup>).
    </p>
    <Heading>P<sub>NBI</sub> &mdash; Neutral Beam Injection</Heading>
    <p>
      High-energy neutral atoms (typically 50&ndash;100 keV deuterium)
      are injected, ionized, and thermalized in the plasma. Provides
      both heating and current drive. The dominant auxiliary heating
      method on most large tokamaks.
    </p>
    <Heading>P<sub>ECH</sub> &mdash; Electron Cyclotron Heating</Heading>
    <p>
      Microwave power at the electron cyclotron frequency (100&ndash;170 GHz).
      Absorbed resonantly at specific flux surfaces, enabling
      localized heating and current drive. Used for NTM stabilization
      and sawtooth control.
    </p>
    <Heading>P<sub>rad</sub> &mdash; Radiated Power</Heading>
    <p>
      Power lost through bremsstrahlung, cyclotron radiation, and line
      radiation from impurities. Measured by bolometers. Controlled
      intentionally via impurity seeding (N<sub>2</sub>, Ne, Ar) to
      reduce divertor heat loads in future reactors.
    </p>
    <Ref>
      <Cite doi="10.1088/0029-5515/39/12/301">ITER Physics Basis, Nucl. Fusion 39 (1999)</Cite>{' '}
      &mdash; power balance and confinement scaling.
    </Ref>
    <Ref>
      Wesson, <i>Tokamaks</i>, 4th ed., Oxford Univ. Press (2011) &mdash; Ch. 3 (Power balance).
    </Ref>
  </>
)
