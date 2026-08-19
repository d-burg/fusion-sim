import { Link } from 'react-router-dom'

/* ─────────────────────────────────────────────
 * Bibliography & Physics Reference
 *
 * Comprehensive list of every equation, scaling law,
 * approximation, and formalism used in the simulator.
 * ───────────────────────────────────────────── */

interface Ref {
  id: string
  authors: string
  title: string
  journal: string
  year: number
  doi?: string
}

const REFERENCES: Ref[] = [
  {
    id: 'creely2020',
    authors: 'A. J. Creely et al.',
    title: 'Overview of the SPARC tokamak',
    journal: 'J. Plasma Phys. 86, 865860502',
    year: 2020,
    doi: '10.1017/S0022377820001257',
  },
  {
    id: 'hughes2020',
    authors: 'J. W. Hughes et al.',
    title: 'Projections of H-mode access and edge pedestal in the SPARC tokamak',
    journal: 'J. Plasma Phys. 86, 865860504',
    year: 2020,
    doi: '10.1017/S0022377820001300',
  },
  {
    id: 'kuang2020',
    authors: 'A. Q. Kuang et al.',
    title: 'Divertor heat flux challenge and mitigation in SPARC',
    journal: 'J. Plasma Phys. 86, 865860505',
    year: 2020,
    doi: '10.1017/S0022377820001117',
  },
  {
    id: 'rodriguezfernandez2022',
    authors: 'P. Rodriguez-Fernandez et al.',
    title: 'Overview of the SPARC physics basis towards the exploration of burning-plasma regimes in high-field, compact tokamaks',
    journal: 'Nucl. Fusion 62, 042003',
    year: 2022,
    doi: '10.1088/1741-4326/ac1654',
  },
  {
    id: 'faitsch2023',
    authors: 'M. Faitsch, T. Eich, L. Gil, et al.',
    title: 'Analysis and expansion of the quasi-continuous exhaust (QCE) regime in ASDEX Upgrade',
    journal: 'Nucl. Fusion 63, 076013',
    year: 2023,
    doi: '10.1088/1741-4326/acd464',
  },
  {
    id: 'harrer2022',
    authors: 'G. F. Harrer et al.',
    title: 'Development of a physics understanding of the quasi-continuous exhaust regime: pedestal profile and ballooning stability analysis',
    journal: 'Nucl. Fusion 62, 076044',
    year: 2022,
    doi: '10.1088/1741-4326/ac6d6a',
  },
  {
    id: 'kalis2024',
    authors: 'J. Kalis et al.',
    title: 'Experimental characterization of the quasi-coherent mode in EDA H-mode and QCE scenarios at ASDEX Upgrade',
    journal: 'Nucl. Fusion 64, 016038',
    year: 2024,
    doi: '10.1088/1741-4326/ad0d32',
  },
  {
    id: 'greenwald1999',
    authors: 'M. Greenwald et al.',
    title: 'Characterization of enhanced Dα high-confinement modes in Alcator C-Mod',
    journal: 'Phys. Plasmas 6, 1943',
    year: 1999,
    doi: '10.1063/1.873451',
  },
  {
    id: 'lomanowski2026',
    authors: 'B. Lomanowski, T. Eich, J. D. Lore, J.-S. Park, T. Body, and P. Stangeby',
    title: 'The power exhaust constrained SPARC separatrix operational space',
    journal: 'arXiv:2607.18558',
    year: 2026,
    doi: '10.48550/arXiv.2607.18558',
  },
  {
    id: 'cerfon2010',
    authors: 'A. J. Cerfon and J. P. Freidberg',
    title: '"One size fits all" analytic solutions to the Grad-Shafranov equation',
    journal: 'Phys. Plasmas 17, 032502',
    year: 2010,
    doi: '10.1063/1.3328818',
  },
  {
    id: 'iter1999',
    authors: 'ITER Physics Basis Editors et al.',
    title: 'Chapter 2: Plasma confinement and transport',
    journal: 'Nucl. Fusion 39, 2175',
    year: 1999,
    doi: '10.1088/0029-5515/39/12/301',
  },
  {
    id: 'bosch1992',
    authors: 'H.-S. Bosch and G. M. Hale',
    title: 'Improved formulas for fusion cross-sections and thermal reactivities',
    journal: 'Nucl. Fusion 32, 611',
    year: 1992,
    doi: '10.1088/0029-5515/32/4/I07',
  },
  {
    id: 'troyon1984',
    authors: 'F. Troyon, R. Gruber, H. Saurenmann, S. Semenzato, and S. Succi',
    title: 'MHD limits to plasma confinement',
    journal: 'Plasma Phys. Control. Fusion 26, 209',
    year: 1984,
    doi: '10.1088/0741-3335/26/1A/319',
  },
  {
    id: 'greenwald2002',
    authors: 'M. Greenwald',
    title: 'Density limits in toroidal plasmas',
    journal: 'Plasma Phys. Control. Fusion 44, R27',
    year: 2002,
    doi: '10.1088/0741-3335/44/8/201',
  },
  {
    id: 'eich2013',
    authors: 'T. Eich et al.',
    title: 'Scaling of the tokamak near the scrape-off layer H-mode power width and implications for ITER',
    journal: 'Nucl. Fusion 53, 093031',
    year: 2013,
    doi: '10.1088/0029-5515/53/9/093031',
  },
  {
    id: 'martin2008',
    authors: 'Y. R. Martin, T. Takizuka, and the ITPA CDBM H-mode Threshold Database Working Group',
    title: 'Power requirement for accessing the H-mode in ITER',
    journal: 'J. Phys.: Conf. Ser. 123, 012033',
    year: 2008,
    doi: '10.1088/1742-6596/123/1/012033',
  },
  {
    id: 'wagner1982',
    authors: 'F. Wagner et al.',
    title: 'Regime of improved confinement and high beta in neutral-beam-heated divertor discharges of the ASDEX tokamak',
    journal: 'Phys. Rev. Lett. 49, 1408',
    year: 1982,
    doi: '10.1103/PhysRevLett.49.1408',
  },
  {
    id: 'pitts2017',
    authors: 'R. A. Pitts et al.',
    title: 'Physics conclusions in support of ITER W divertor monoblock shaping',
    journal: 'Nucl. Mater. Energy 12, 60',
    year: 2017,
    doi: '10.1016/j.nme.2017.03.005',
  },
  {
    id: 'loarte2003',
    authors: 'A. Loarte et al.',
    title: 'Characteristics of type I ELM energy and particle losses in existing devices and their extrapolation to ITER',
    journal: 'Plasma Phys. Control. Fusion 45, 1549',
    year: 2003,
    doi: '10.1088/0741-3335/45/9/302',
  },
  {
    id: 'cordey1999',
    authors: 'J. G. Cordey et al.',
    title: 'Plasma confinement in JET H-mode plasmas with H, D, DT and T isotopes',
    journal: 'Nucl. Fusion 39, 301',
    year: 1999,
    doi: '10.1088/0029-5515/39/3/301',
  },
  {
    id: 'marinoni2021',
    authors: 'A. Marinoni et al.',
    title: 'H-mode grade confinement in L-mode edge plasmas at negative triangularity on DIII-D',
    journal: 'Nucl. Fusion 61, 116010',
    year: 2021,
    doi: '10.1088/1741-4326/ac1f04',
  },
  {
    id: 'hirai2018',
    authors: 'T. Hirai et al.',
    title: 'ITER full tungsten divertor qualification program and progress',
    journal: 'Fusion Eng. Des. 127, 66',
    year: 2018,
    doi: '10.1016/j.fusengdes.2017.12.003',
  },
  {
    id: 'matthews2013',
    authors: 'G. F. Matthews et al.',
    title: 'JET ITER-like wall — overview and experimental programme',
    journal: 'J. Nucl. Mater. 438, S2',
    year: 2013,
    doi: '10.1016/j.jnucmat.2013.01.282',
  },
  {
    id: 'wesson2011',
    authors: 'J. Wesson',
    title: 'Tokamaks',
    journal: '4th edition, Oxford University Press',
    year: 2011,
  },
  {
    id: 'freidberg2014',
    authors: 'J. P. Freidberg',
    title: 'Ideal MHD',
    journal: 'Cambridge University Press',
    year: 2014,
  },
  {
    id: 'spitzer1953',
    authors: 'L. Spitzer and R. Harm',
    title: 'Transport phenomena in a completely ionized gas',
    journal: 'Phys. Rev. 89, 977',
    year: 1953,
    doi: '10.1103/PhysRev.89.977',
  },
]

function RefTag({ id }: { id: string }) {
  return (
    <a
      href={`#ref-${id}`}
      className="text-cyan-400 hover:text-cyan-300 text-[10px] align-super ml-0.5 no-underline"
    >
      [{REFERENCES.findIndex((r) => r.id === id) + 1}]
    </a>
  )
}

/* ── Section wrapper ── */
function Section({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-white mb-3 flex items-baseline gap-2">
        <span className="text-cyan-500 font-mono text-sm">{number}.</span>
        {title}
      </h2>
      <div className="text-gray-300 text-sm leading-relaxed space-y-3 pl-1">{children}</div>
    </section>
  )
}

/* ── Equation block ── */
function Eq({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 px-4 py-2.5 bg-gray-900/80 border border-gray-700/50 rounded font-mono text-sm text-cyan-200 overflow-x-auto">
      {children}
    </div>
  )
}

export default function Bibliography() {
  return (
    <div className="min-h-screen bg-black text-gray-200">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-gray-800 px-6 sm:px-10 py-3 flex items-center justify-between">
        <Link
          to="/"
          className="font-mono text-[10px] tracking-[0.18em] uppercase text-gray-500 hover:text-cyan-400 transition-colors"
        >
          ← Back to simulator
        </Link>
        <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-gray-300">
          fusionsimulator<span className="text-gray-600">.io</span>
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-6 sm:px-10 py-12">
        {/* Page header */}
        <div className="mb-10">
          <div className="panel-title mb-2">Reference</div>
          <h1 className="text-3xl font-bold text-white mb-3">Physics Bibliography</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            Complete reference of every equation, scaling law, approximation, and formalism
            implemented in the simulator. This page is intended as a companion for students
            and researchers who want to understand the physics behind each panel.
          </p>
          <div className="mt-5 border-l-2 border-gray-700 pl-4 py-1 text-gray-500 text-xs leading-relaxed max-w-2xl">
            <span className="font-mono uppercase tracking-wider text-gray-400">Note</span>
            {' — '}This simulator uses a zero-dimensional (0D) global power-balance transport
            model with analytic equilibrium solutions. Results are approximate and intended for
            qualitative educational use. They should not be used for engineering design or
            quantitative predictions.
          </div>
        </div>

        {/* ─── 1. MHD Equilibrium ─── */}
        <Section number={1} title="MHD Equilibrium: Grad-Shafranov Equation">
          <p>
            The magnetic equilibrium is computed using the analytic Cerfon-Freidberg solution to the
            Grad-Shafranov (GS) equation under the Solov'ev ansatz (constant p' and FF').<RefTag id="cerfon2010" />
          </p>
          <p>
            The GS equation describes the balance between the plasma pressure gradient and the
            magnetic (Lorentz) force in an axisymmetric toroidal configuration. The Cerfon-Freidberg
            method decomposes the poloidal flux into a particular solution plus a linear combination
            of 12 homogeneous basis functions:
          </p>
          <Eq>
            {'ψ(x, y) = ψ_p(x, A) + Σ c_i · ψ_i(x, y),  i = 1..12'}
          </Eq>
          <p>The particular solution is:</p>
          <Eq>{'ψ_p(x, A) = x⁴/8 + A · (x² ln x / 2 − x⁴/8)'}</Eq>
          <p>
            where <em>x = R/R₀</em> is the normalized major radius and <em>A</em> is a free parameter
            related to the pressure/current profile. The 12 coefficients <em>c_i</em> are determined
            by imposing boundary conditions at the plasma boundary (e.g. lower single-null X-point
            geometry), yielding a 12 &times; 12 linear system solved by Gaussian elimination with partial
            pivoting.
          </p>
          <p>
            Curvature constraints at the outer equatorial, inner equatorial, and X-point/top boundary are:
          </p>
          <Eq>
            {'N₁ = −(1 + ε²κ²) / (ε κ²)  [outer midplane]'}<br />
            {'N₂ =  (1 − ε²κ²) / (ε κ²)  [inner midplane]'}<br />
            {'N₃ = −κ / (ε cos²α)          [X-point], α = arcsin(δ)'}
          </Eq>
          <p>
            Flux surface contours are extracted using the <strong>Marching Squares</strong> algorithm,
            and the magnetic axis is located via gradient ascent on ψ.
          </p>
        </Section>

        {/* ─── 2. Energy Confinement ─── */}
        <Section number={2} title="Energy Confinement: IPB98(y,2) Scaling">
          <p>
            The energy confinement time in H-mode is computed from the ITER Physics Basis
            IPB98(y,2) ELMy H-mode scaling law:<RefTag id="iter1999" />
          </p>
          <Eq>
            {'τ_E = 0.0562 · I_p^0.93 · B_t^0.15 · n̄_e19^0.41 · P^(−0.69) · R₀^1.97 · ε^0.58 · κ^0.78 · M^0.19'}
          </Eq>
          <p>
            where <em>I_p</em> is in MA, <em>B_t</em> in T, <em>n̄_e19</em> in 10¹⁹ m⁻³,
            <em> P</em> = total heating power in MW, <em>R₀</em> in m,
            <em> ε = a/R₀</em> (inverse aspect ratio), <em>κ</em> = elongation,
            and <em>M</em> = main ion mass in AMU. An H-factor multiplier is applied:
            τ<sub>E</sub> → H · τ<sub>E</sub>.
          </p>
          <p>
            This empirical scaling is a multi-machine regression fit to a database of tokamak
            experiments. The negative exponent on power reflects the degradation of confinement
            with increasing heating — a fundamental feature of turbulent plasma transport.
          </p>
          <p>
            <strong>Triangularity correction:</strong> Higher positive triangularity (δ) stabilizes
            edge MHD modes and broadens the pressure profile, improving confinement. A correction
            of τ<sub>E</sub> × (1 + 0.20 · (δ − 0.40)), clamped to [0.92, 1.10], is applied in
            H-mode. At ITER's δ = 0.55, this gives ~3% improvement.
          </p>
          <p>
            <strong>D-T isotope enhancement:</strong> D-T plasmas receive a 1.10× confinement
            enhancement beyond the IPB98 M<sup>0.19</sup> scaling, representing residual isotope
            effects on turbulent transport. Combined with the M<sup>0.19</sup> factor (1.19× for
            DT vs DD), the total confinement advantage is ~1.31×. The dominant DT performance
            gain comes from alpha self-heating in the power balance.<RefTag id="cordey1999" />
          </p>
          <p>
            <strong>Device-specific correction:</strong> A per-device confinement factor accounts
            for effects not captured by generic scalings (wall conditioning, NBI geometry, divertor
            closure). JET receives a 1.35× factor to match DTE2/DTE3 optimized scenarios; other
            devices use 1.0.
          </p>
          <p>
            <strong>Negative triangularity:</strong> For NT configurations (CENTAUR), an
            H-factor of ~0.65 (between L-mode and H-mode) is used, with a 1.05× DT isotope
            boost. NT plasmas operate ELM-free with a small ballooning-limited
            pedestal.<RefTag id="marinoni2021" />
          </p>
        </Section>

        {/* ─── 3. L-H Transition ─── */}
        <Section number={3} title="L-H Transition Power Threshold">
          <p>
            The minimum power required to access H-mode is estimated from the Martin 2008 scaling:<RefTag id="martin2008" /><RefTag id="wagner1982" />
          </p>
          <Eq>
            {'P_LH = 0.0488 · n̄_e20^0.717 · B_t^0.803 · S^0.941  [MW]'}
          </Eq>
          <p>
            where <em>n̄_e20</em> is the line-averaged density in 10²⁰ m⁻³, <em>B_t</em> in T,
            and <em>S</em> is the plasma surface area in m². A device-specific correction
            factor is applied (DIII-D: 1.0, JET: 0.9, ITER: 0.35).
          </p>
        </Section>

        {/* ─── 4. Safety Factor ─── */}
        <Section number={4} title="Safety Factor q₉₅">
          <p>
            The edge safety factor at the 95% flux surface is estimated from the cylindrical
            approximation with a shape correction:<RefTag id="wesson2011" />
          </p>
          <Eq>
            {'f_shape = [1 + κ²(1 + 2δ² − 1.2δ³)] / 2'}<br />
            {'q₉₅ = 5 a² B_t f_shape / (R₀ I_p)'}
          </Eq>
          <p>
            where <em>a</em> in m, <em>B_t</em> in T, <em>R₀</em> in m, <em>I_p</em> in MA,
            <em> κ</em> = elongation, <em>δ</em> = triangularity. Values below q₉₅ ≈ 2
            indicate proximity to the external kink stability boundary.
          </p>
        </Section>

        {/* ─── SPARC: QCE regime and the synthetic magnetics diagnostic ─── */}
        <section className="mb-10">
          <h2 className="panel-title mb-3">SPARC · QCE regime and magnetics</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-3">
            SPARC's default scenario here is the <strong>quasi-continuous exhaust (QCE)</strong>{' '}
            regime rather than the published Primary Reference Discharge. Unmitigated SPARC ELMs
            are projected at 1.4–2.2 MJ every 0.07–0.4 s (Hughes 2020), which an inertially cooled
            divertor cannot absorb. QCE is a type-I ELM-free H-mode reached at high shaping and high
            separatrix density, where ballooning modes at the pedestal foot replace discrete crashes
            with continuous filamentary transport (Harrer 2022, Faitsch 2023).
          </p>
          <p className="text-gray-400 text-sm leading-relaxed mb-3">
            Access is driven by <em>fuelling and shaping</em>, not by impurity seeding. For SPARC
            specifically, neon seeding depresses the separatrix density through SOL power starvation
            and therefore works against QCE access, even though the divertor needs the radiation
            (Lomanowski 2026) — so the simulator makes those two knobs compete. The pulse reproduces
            the entry sequence observed on ASDEX Upgrade and JET: L–H transition, a transient type-I
            ELMy phase, then QCE held for the rest of the flat-top.
          </p>
          <p className="text-gray-400 text-sm leading-relaxed mb-3">
            The QCE pedestal is degraded relative to the type-I pedestal, which costs fusion gain.
            Hughes 2020 §4.2 brackets the trade: even a 2× pedestal reduction leaves Q &gt; 2,
            against Q = 11 at full pedestal. The value used here is a ≈0.78 pedestal reduction,
            applied as a ≈0.88 global confinement penalty because the core carries most of the
            stored energy. That specific factor is our interpolation, not a published SPARC number.
          </p>
          <div className="border-l-2 border-amber-700/60 pl-4 py-1 text-gray-500 text-sm max-w-3xl mb-3">
            <span className="font-mono uppercase tracking-wider text-amber-500/80 text-xs">
              Synthetic diagnostic
            </span>
            {' — '}The magnetics panel (Mirnov trace and spectrogram) is <em>reconstructed</em>, not
            predicted: this is a 0D transport model and computes no edge MHD. The quasi-coherent
            mode is synthesised from published parameters — Alcator C-Mod EDA H-mode at ≈50–150 kHz
            with n ≈ 17 in the pedestal density-gradient region (Greenwald 1999), and ASDEX Upgrade
            at 15–35 kHz localised at ρ_pol = 0.993 (Kalis 2024). The EDA/QCE discriminator shown —
            a mode bandwidth below 10 kHz reading as EDA, broader as QCE — is also from Kalis 2024.
          </div>
        </section>

        {/* ─── 5. Greenwald Density Limit ─── */}
        <Section number={5} title="Greenwald Density Limit">
          <p>
            The empirical density limit is given by the Greenwald formula:<RefTag id="greenwald2002" />
          </p>
          <Eq>
            {'n_GW = I_p / (π a²)  [10²⁰ m⁻³, with I_p in MA, a in m]'}
          </Eq>
          <p>
            The Greenwald fraction <em>f_GW = n̄_e / n_GW</em> is a key operational parameter.
            Approaching f_GW &gt; 1 greatly increases disruption risk, while f_GW ≈ 0.7
            promotes divertor detachment, which is beneficial for heat exhaust.
          </p>
        </Section>

        {/* ─── 6. Troyon Beta Limit ─── */}
        <Section number={6} title="Troyon Beta Limit">
          <p>
            The normalized beta and the MHD stability boundary are given by the Troyon
            parameterization:<RefTag id="troyon1984" />
          </p>
          <Eq>
            {'β_t = ⟨p⟩ / (B² / 2μ₀) × 100  [%]'}<br />
            {'β_N = β_t · a B_t / I_p'}
          </Eq>
          <p>
            The no-wall ideal MHD stability limit is at β_N ≈ 2.8 (the Troyon limit).
            Exceeding this value risks triggering a disruption through resistive wall modes
            or other MHD instabilities. The simulator enforces a hard clamp at β_N = 4.0.
          </p>
          <p>
            The volume-averaged pressure is computed as <em>{'⟨p⟩ = 2 n_e T_e × 1.602 × 10⁴'}</em> Pa,
            assuming a single-fluid model with T<sub>i</sub> = T<sub>e</sub>.
          </p>
        </Section>

        {/* ─── 7. Spitzer Resistivity ─── */}
        <Section number={7} title="Spitzer Resistivity and Ohmic Heating">
          <p>
            Plasma resistivity is computed from the classical Spitzer formula:<RefTag id="spitzer1953" /><RefTag id="wesson2011" />
          </p>
          <Eq>
            {'η = 2.8 × 10⁻⁸ · Z_eff / T_e^(3/2)  [Ω·m]'}<br />
            {'R_plasma = η · 2πR₀ / (πa²κ)  [Ω]'}<br />
            {'P_ohmic = R_plasma · I_p²  [MW]'}
          </Eq>
          <p>
            This gives the resistive power dissipated in the plasma by the driven toroidal current,
            where <em>Z_eff</em> is the effective charge state including impurities and T<sub>e</sub> is
            in keV.
          </p>
        </Section>

        {/* ─── 8. Radiation ─── */}
        <Section number={8} title="Radiation Losses">
          <p>
            Four radiation channels are modeled:<RefTag id="wesson2011" />
          </p>
          <p><strong>Bremsstrahlung</strong> (electron-ion free-free radiation):</p>
          <Eq>
            {'P_brem = 5.35 × 10⁻³⁷ · n_e² · Z_eff · T_e^(1/2) · V  [MW]'}
          </Eq>
          <p><strong>Intrinsic impurity radiation</strong> (wall material — carbon, tungsten, beryllium):</p>
          <Eq>
            {'P_intrinsic = (0.10 · max(Z_eff − 1, 0.2) + 0.05) · P_external'}
          </Eq>
          <p>
            Scaled with external heating power rather than n<sub>e</sub>²V to avoid unphysical
            machine-size dependence. Produces ~10–15% radiative fraction for typical H-mode.
          </p>
          <p><strong>Line radiation</strong> (residual, on top of intrinsic):</p>
          <Eq>
            {'P_line = P_brem × 0.15 × max(Z_eff − 1, 0)'}
          </Eq>
          <p><strong>Neon seeding radiation</strong> (intentional impurity injection):</p>
          <Eq>
            {'P_neon = f_imp · n_e² · L_z,eff · V  [MW]'}
          </Eq>
          <p>
            Total radiated power: P<sub>rad</sub> = P<sub>brem</sub> + P<sub>intrinsic</sub> +
            P<sub>line</sub> + P<sub>neon</sub>.
            Radiation fractions above ~80% of total input power pose a risk of radiative collapse and disruption.
          </p>
        </Section>

        {/* ─── 9. Power Balance ─── */}
        <Section number={9} title="0D Power Balance Transport Model">
          <p>
            The core of the simulator is a global (0D) power balance equation for the
            stored thermal energy:
          </p>
          <Eq>
            {'dW_th/dt = P_input − W_th/τ_E − P_rad'}
          </Eq>
          <p>
            where <em>P_input = P_ohmic + P_aux</em> (auxiliary heating from NBI, ECRH, ICRH),
            <em> W_th/τ_E</em> is the transport loss, and <em>P_rad</em> is the total radiated power.
            This ODE is integrated in time using a forward Euler step.
          </p>
          <p>The stored energy is related to the average temperature by:</p>
          <Eq>
            {'W_th = 3 · n_e · T_e · V · 1.602 × 10⁻²  [MJ]'}
          </Eq>
          <p>
            This assumes a single-fluid model (T<sub>i</sub> = T<sub>e</sub>) where
            <em> W = (3/2)(n_e T_e + n_i T_i) V ≈ 3 n_e T_e V</em>, with the factor of 3
            coming from equal ion and electron contributions.
          </p>
        </Section>

        {/* ─── 10. Fusion Reactivity ─── */}
        <Section number={10} title="Fusion Reactivity (Bosch-Hale)">
          <p>
            Thermonuclear fusion reactivities for D-T and D-D reactions use the Bosch-Hale
            parameterization:<RefTag id="bosch1992" />
          </p>
          <Eq>
            {'θ = T / (1 − T(C₂ + T(C₄ + TC₆)) / (1 + T(C₃ + T(C₅ + TC₇))))'}<br />
            {'ξ = (B_G² / 4θ)^(1/3)'}<br />
            {'⟨σv⟩ = C₁ · θ · √(ξ / (m_rc² T³)) · exp(−3ξ)  [cm³/s]'}
          </Eq>
          <p>
            with <em>B_G</em> = 34.3827 (the Gamow constant for D-T) and the C-coefficients from
            Bosch-Hale Table IV. D-T reaction products: 14.07 MeV neutron + 3.52 MeV alpha particle
            (17.59 MeV total). D-D reactions are modeled as the sum of the D(d,n)He-3 and D(d,p)T branches.
          </p>
        </Section>

        {/* ─── 11. Fusion Power ─── */}
        <Section number={11} title="Fusion Power and Q">
          <p>Fusion power is computed by volume integration over the 51-point radial profiles:</p>
          <Eq>
            {'P_fus = ∫ (n_D · n_T) · ⟨σv⟩(T_e(ρ)) · E_fus · dV'}
          </Eq>
          <p>
            using cylindrical shells with dV ∝ ρ dρ and the tanh-pedestal Te/ne profiles.
            For D-T: n<sub>D</sub> = n<sub>T</sub> = n<sub>e</sub> · f<sub>fuel</sub> / 2 (50-50 mix).
            This profile-integrated P<sub>fus</sub> is used for the status panel display
            and the P<sub>fus</sub> trace.
          </p>
          <p>
            The 0D alpha self-heating (for the transport power balance feedback loop) uses a
            simplified estimate: T<sub>i,eff</sub> = 0.70 · T<sub>e0</sub> with a profile
            correction factor f<sub>profile</sub> = 0.48, calibrated against the full profile
            integration.
          </p>
          <Eq>{'Q_plasma = P_fusion / P_external'}</Eq>
          <p>
            where P<sub>external</sub> = P<sub>input</sub> − P<sub>α</sub> (externally supplied
            heating excluding alpha self-heating). A burning plasma
            regime is Q &gt; 5, and ignition corresponds to Q → ∞ (self-sustaining).
          </p>
        </Section>

        {/* ─── 12. SOL & Divertor ─── */}
        <Section number={12} title="Scrape-Off Layer and Divertor Heat Flux">
          <p>
            The SOL power decay width uses the Eich scaling:<RefTag id="eich2013" />
          </p>
          <Eq>
            {'B_pol = μ₀ I_p / (2π a √κ)  [T]'}<br />
            {'λ_q = max(1.35 × 10⁻³ / B_pol^0.9, 0.5 mm)  [m]'}
          </Eq>
          <p>
            The divertor target heat flux is:<RefTag id="pitts2017" />
          </p>
          <Eq>
            {'A_wet = 2π(R₀ − a) · λ_q · 4 · f_x  [m²]'}<br />
            {'q_div = P_SOL / A_wet  [MW/m²]'}
          </Eq>
          <p>
            where <em>f_x</em> is the poloidal flux expansion factor (~5-10 in typical divertors).
            P<sub>SOL</sub> = P<sub>input</sub> + P<sub>alpha</sub> − P<sub>rad</sub> is the power
            crossing the separatrix.
          </p>
        </Section>

        {/* ─── 13. Detachment ─── */}
        <Section number={13} title="Divertor Detachment Model">
          <p>
            The divertor detachment fraction is modeled as a sigmoid function of the
            Greenwald fraction:
          </p>
          <Eq>
            {'f_detach = min(1 − 1/(1 + (f_GW / 0.7)⁶), 0.97)'}
          </Eq>
          <p>
            Detachment is a regime where the divertor plasma cools and recombines before reaching
            the target plates, dramatically reducing the heat flux. It typically occurs at high
            Greenwald fraction due to increased edge radiation and volumetric power dissipation.
          </p>
        </Section>

        {/* ─── 14. Divertor Surface Temperature ─── */}
        <Section number={14} title="Divertor Surface Temperature (0D Lumped Thermal Model)">
          <p>
            The divertor surface temperature is computed using a 0D lumped thermal capacitance model
            that evolves in time:<RefTag id="hirai2018" /><RefTag id="matthews2013" />
          </p>
          <Eq>
            {'C_th · dT/dt = q_total − h_cool · (T − T_coolant)'}
          </Eq>
          <p>
            where <em>C_th = ρ · c_p · L</em> is the thermal capacitance per unit area (J/m²/K),
            <em> q_total</em> is the total heat flux (inter-ELM + ELM transients),
            <em> h_cool</em> is the effective heat transfer coefficient to the coolant, and
            <em> T_coolant</em> is the coolant temperature. For inertially cooled devices
            (DIII-D, JET), h_cool = 0 and the temperature rises monotonically during the pulse.
            For actively cooled devices (ITER, CENTAUR), the temperature equilibrates at
            T_eq = T_coolant + q / h_cool.
          </p>
          <p>
            Device-specific thermal parameters are calibrated against published values:
            DIII-D carbon tiles reach ~300-600°C during 3 s pulses; JET ILW tungsten
            reaches ~600-1000°C during 8 s pulses (JOI operational limit: 1200°C);
            ITER actively-cooled tungsten monoblocks equilibrate at ~1200-1500°C under
            10 MW/m² steady-state heat flux.
          </p>
          <p>
            ELM heat flux transients are added as impulses using the Loarte energy scaling
            (Section 19) deposited over a characteristic ELM crash time of ~0.5-1.0 ms.<RefTag id="loarte2003" />
          </p>
          <div className="mt-3 px-3 py-2 bg-amber-900/20 border border-amber-700/30 rounded text-amber-200/80 text-xs leading-relaxed">
            <strong className="text-amber-300">Known limitation — single-layer approximation:</strong>{' '}
            The model treats the divertor armor as a single thermal lump with uniform temperature.
            In reality, ELM energy deposits in a very thin surface skin (~0.1 mm thermal diffusion
            depth at τ_ELM ~ 1 ms). This means ELM temperature spikes are underestimated (the real
            surface during an unmitigated Type I ELM on ITER can transiently exceed tungsten's melting
            point of 3422°C), and the temperature recovery is too slow (real surface cools in ~10-100 ms,
            not seconds). The inter-ELM steady-state temperatures are well-calibrated against published values.
            Tungsten recrystallization occurs above ~1200°C, degrading mechanical integrity — a key
            constraint on divertor lifetime.
          </div>
        </Section>

        {/* ─── 15. Profiles: H-mode ─── */}
        <Section number={15} title="Radial Profiles: H-Mode Pedestal (OMFIT/Tanh)">
          <p>
            Temperature and density profiles in H-mode use the standard modified hyperbolic
            tangent (mtanh) pedestal parameterization:
          </p>
          <Eq>
            {'f(ρ) = h_ped · [tanh((ρ_ped − ρ)/w) + 1] / 2 + f_peak · (1 − (ρ/ρ_ped)^α_in)^α_out'}
          </Eq>
          <p>
            where <em>h_ped</em> is the pedestal height, <em>ρ_ped</em> is the pedestal location,
            <em> w</em> is the pedestal width, and the second term represents core peaking.
            This is the same form used in the OMFIT and EFIT profile fitting frameworks.
          </p>
          <p>
            The pedestal height scales with triangularity: T<sub>e,ped</sub> = (0.30 + 0.20·δ) · T<sub>e0</sub>
            (clamped to 0.25–0.50), reflecting peeling-ballooning stability improvement at higher δ.
            For NT plasmas, a small ballooning-limited pedestal is maintained: T<sub>e,ped</sub> ≈ 0.12 · T<sub>e0</sub>.
          </p>
          <p>
            The core Te is rescaled after profile construction so that the profile-integrated
            stored energy matches the 0D W<sub>th</sub> from the transport model. The pedestal
            height is preserved (set by MHD stability), and only the core peaking adjusts.
          </p>
        </Section>

        {/* ─── 16. Profiles: L-mode ─── */}
        <Section number={16} title="Radial Profiles: L-Mode (Parabolic)">
          <p>In L-mode, simpler parabolic profiles are used:</p>
          <Eq>
            {'T_e(ρ) = T_edge + (T_core − T_edge) · (1 − ρ²)^α_T'}<br />
            {'n_e(ρ) = n_edge + (n_core − n_edge) · (1 − ρ²)^α_n'}
          </Eq>
          <p>
            where <em>α_T</em> and <em>α_n</em> are peaking exponents (typically 1.5-2.5).
            These profiles lack the sharp edge pedestal characteristic of H-mode.
          </p>
        </Section>

        {/* ─── 17. Internal Inductance ─── */}
        <Section number={17} title="Internal Inductance">
          <p>
            The internal inductance l<sub>i</sub> is computed from the current density profile,
            assuming Spitzer conductivity (j ∝ T<sub>e</sub><sup>3/2</sup>):
          </p>
          <Eq>
            {'l_i = ⟨B_pol²⟩ / B_pol(a)²'}
          </Eq>
          <p>
            where the numerator is the volume-averaged poloidal field squared and the denominator
            is the poloidal field at the plasma edge. l<sub>i</sub> characterizes the peakedness
            of the current profile — a higher l<sub>i</sub> indicates a more peaked current
            distribution.
          </p>
        </Section>

        {/* ─── 18. Density Evolution ─── */}
        <Section number={18} title="Density Evolution">
          <p>
            The line-averaged density relaxes toward a target with a particle confinement time:
          </p>
          <Eq>
            {'τ_p ≈ 5 τ_E'}<br />
            {'dn̄_e/dt = (n_target − n̄_e) / τ_p'}
          </Eq>
          <p>
            This simplified model captures the timescale separation between energy and particle
            confinement, with the particle confinement time typically ~5 times longer.
          </p>
        </Section>

        {/* ─── 19. ELMs ─── */}
        <Section number={19} title="Edge-Localized Modes (ELMs)">
          <p>
            Three ELM regimes are modeled depending on edge collisionality, shaping, and
            proximity to operational limits:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Type I ELMs:</strong> Large periodic crashes at 5-25 Hz, each ejecting 5-13% of stored energy</li>
            <li><strong>Type II (grassy) ELMs:</strong> Small frequent crashes at 80-200 Hz, each ejecting 0.5-1.5% of W<sub>th</sub></li>
            <li><strong>QCE (Quasi-Continuous Exhaust):</strong> Continuous enhanced transport, no discrete crashes</li>
          </ul>
          <p>
            Each ELM crash is modeled as a rapid pedestal collapse followed by profile recovery on a
            characteristic rebuilding timescale. Type I ELMs are the most damaging to divertor components
            due to their large transient heat pulses.
          </p>
        </Section>

        {/* ─── 20. Disruption Model ─── */}
        <Section number={20} title="Disruption Risk Model">
          <p>
            Disruption risk is computed from multiple operational limit proximities using
            sigmoid activation functions:
          </p>
          <Eq>
            {'σ(x, c, w) = 1 / (1 + exp(−(x − c) / w))'}
          </Eq>
          <p>Individual risk contributions:</p>
          <ul className="list-disc pl-5 space-y-0.5 text-xs font-mono">
            <li>Greenwald: σ(f<sub>GW</sub>, 1.0, 0.08)</li>
            <li>Troyon: σ(β<sub>N</sub>/2.8, 0.85, 0.06)</li>
            <li>Kink: σ(2.2/q<sub>95</sub>, 0.90, 0.05)</li>
            <li>Radiation: σ(P<sub>rad</sub>/P<sub>total</sub>, 0.80, 0.08)</li>
          </ul>
          <p>Combined disruption probability per timestep (Poisson process):</p>
          <Eq>
            {'risk = 1 − (1−r_GW³)(1−r_β³)(1−r_q³)(1−r_rad³)(1−r_LM)'}<br />
            {'P(disruption in dt) = 1 − exp(−risk · dt)'}
          </Eq>
        </Section>

        {/* ─── 21. Disruption Sequence ─── */}
        <Section number={21} title="Disruption Sequence (4-Phase)">
          <p>When a disruption is triggered, it proceeds through four phases:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Precursor</strong> (50-100 ms): Growing locked mode oscillation with exponential growth rate ~20 s⁻¹</li>
            <li><strong>Thermal Quench</strong> (1-2 ms): Exponential T<sub>e</sub> collapse to ~1% of pre-disruption value</li>
            <li><strong>Current Quench</strong> (5-50 ms): L/R decay with transient I<sub>p</sub> overshoot spike</li>
            <li><strong>Termination</strong>: Plasma current reaches zero, pulse ended</li>
          </ol>
        </Section>

        {/* ─── 22. Synthetic Diagnostics ─── */}
        <Section number={22} title="Synthetic Diagnostic Signals">
          <p>Simulated diagnostic signals include noise based on realistic measurement uncertainties:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong>Soft X-ray:</strong> SXR ∝ n<sub>e</sub>² T<sub>e</sub><sup>0.5</sup></li>
            <li><strong>Neutron rate:</strong> Γ<sub>n</sub> ∝ n<sub>e</sub>² T<sub>i</sub>²</li>
            <li><strong>Loop voltage:</strong> V<sub>loop</sub> ∝ I<sub>p</sub> / T<sub>e</sub><sup>3/2</sup></li>
          </ul>
          <p>
            Gaussian noise is generated via the Box-Muller transform. Typical diagnostic noise
            levels: I<sub>p</sub> 0.2%, n<sub>e</sub> 1%, T<sub>e</sub> 2%, P<sub>rad</sub> 5%.
          </p>
        </Section>

        {/* ─── 23. Geometry ─── */}
        <Section number={23} title="Device Geometry">
          <p>
            Plasma geometry is characterized by the following standard tokamak parameters:
          </p>
          <Eq>
            {'ε = a / R₀  [inverse aspect ratio]'}<br />
            {'S = 4π² R₀ a κ × f_corr  [plasma surface area, m²]'}<br />
            {'V = 2π² R₀ a² κ  [plasma volume, m³]'}
          </Eq>
          <p>
            SPARC's first-wall contour is reduced from the 555-point polygon in the SPARC Primary Reference Discharge GEQDSK files published in the MIT-licensed cfs-energy/SPARCPublic repository; CFS describe it as a simplified first wall rather than engineering geometry. Wall/limiter outlines for DIII-D, JET, ITER, and CENTAUR are parameterized from published machine
            geometries and used for both the equilibrium cross-section display and the 3D port view
            rendering.
          </p>
        </Section>

        {/* ─── References ─── */}
        <section className="mt-16 pt-8 border-t border-gray-800">
          <h2 className="text-xl font-bold text-white mb-6">References</h2>
          <ol className="space-y-3">
            {REFERENCES.map((ref, i) => (
              <li
                key={ref.id}
                id={`ref-${ref.id}`}
                className="text-sm text-gray-400 leading-relaxed flex gap-3"
              >
                <span className="text-cyan-500 font-mono text-xs mt-0.5 shrink-0">[{i + 1}]</span>
                <div>
                  <span className="text-gray-300">{ref.authors}</span>,{' '}
                  <em>{ref.title}</em>,{' '}
                  {ref.journal} ({ref.year}).
                  {ref.doi && (
                    <>
                      {' '}
                      <a
                        href={`https://doi.org/${ref.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-500 hover:text-cyan-400 transition-colors"
                      >
                        doi:{ref.doi}
                      </a>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ─── Page footer ─── */}
        <footer className="mt-16 pt-6 border-t border-gray-800 text-center text-gray-600 text-xs space-y-1 pb-12">
          <p>&copy; 2026 Daniel Burgess and the Columbia Fusion Research Center</p>
          <p>
            <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors">
              fusionsimulator.io
            </Link>
          </p>
        </footer>
      </main>
    </div>
  )
}
