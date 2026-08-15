use serde::{Deserialize, Serialize};

/// Impurity seeding and ELM regime parameters (device-specific).
///
/// Named generically ("impurity") to support future noble gas species
/// (argon, krypton, nitrogen) beyond the initial neon implementation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpurityElmParams {
    /// Impurity fraction threshold to start affecting Type I ELM frequency
    pub impurity_type1_onset: f64,
    /// Impurity fraction for Type I → Type II (grassy) transition.
    /// A negative value is a sentinel meaning "always grassy": the device
    /// never produces Type-I ELMs while the q95/shaping gates are met (SPARC).
    pub impurity_type2_threshold: f64,
    /// Impurity fraction for full ELM suppression (QCE window)
    pub impurity_qce_threshold: f64,
    /// Greenwald fraction above which the plasma enters QCE by the *density*
    /// route, independent of impurity seeding.
    ///
    /// This is the physically dominant path: the quasi-continuous exhaust
    /// regime is accessed at high shaping and high separatrix density, where
    /// ballooning modes at the pedestal foot replace Type-I crashes with
    /// continuous filamentary transport (Faitsch/Harrer, AUG + JET). Published
    /// access threshold is a *separatrix* density of 0.3–0.4 n_GW; the 0D model
    /// only carries the line-averaged Greenwald fraction, so this value is a
    /// tuned proxy for that criterion, not the published number itself.
    ///
    /// Values > 1.0 disable the route (f_GW > 1 disrupts first).
    pub qce_fgw_threshold: f64,
    /// Impurity fraction above which QCE access is *lost* again.
    ///
    /// Seeding radiates power out of the SOL and depresses the separatrix
    /// density — for SPARC, ≈50 % reduction in n_e,sep at 2 % separatrix Ne
    /// (Lomanowski et al., arXiv:2607.18558). Since QCE needs high n_e,sep,
    /// heavy seeding works *against* the regime even though it protects the
    /// divertor. Set ≥ 1.0 (unreachable) on devices where seeding is instead
    /// the thing that drives suppression.
    pub qce_impurity_ceiling: f64,
    /// Impurity fraction above which radiative collapse begins
    pub impurity_collapse_threshold: f64,
    /// q95 range for grassy/Type II ELMs (min, max)
    pub q95_grassy_range: (f64, f64),
    /// Minimum delta (triangularity) for grassy ELMs
    pub delta_grassy_min: f64,
}

/// Tokamak device geometry and operational parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub name: String,
    pub id: String,
    /// Major radius (m)
    pub r0: f64,
    /// Minor radius (m)
    pub a: f64,
    /// Maximum toroidal field on axis (T)
    pub bt_max: f64,
    /// Maximum plasma current (MA)
    pub ip_max: f64,
    /// Reference elongation at the separatrix (κ_sep).
    ///
    /// This is the *shape* elongation: it drives the Cerfon–Freidberg boundary
    /// and everything rendered from it. It is NOT the right quantity for the
    /// confinement and safety-factor scalings — see `kappa_areal`.
    pub kappa: f64,
    /// Areal elongation κ_a = S / (π a²), where S is the poloidal cross-section
    /// area.
    ///
    /// IPB98(y,2) and the Uckan q* formula are both defined in terms of the
    /// areal elongation, which is systematically lower than κ_sep (for SPARC,
    /// 1.75 vs 1.97 — a 10 % difference in τ_E). Using κ_sep in the scalings
    /// silently inflates confinement, so the two are kept separate: `kappa`
    /// shapes the plasma, `kappa_areal` feeds the scalings.
    ///
    /// For DIII-D / ITER / JET / CENTAUR this is set equal to `kappa` to
    /// preserve their existing calibration — those values were tuned as a
    /// blend of the two definitions, and separating them properly would
    /// require re-tuning `confinement_factor` and `p_lh_factor` against the
    /// physics audit. Flagged in SPARC_SCOPING.md as a follow-up.
    pub kappa_areal: f64,
    /// Reference upper triangularity
    pub delta_upper: f64,
    /// Reference lower triangularity
    pub delta_lower: f64,
    /// Plasma volume (m³)
    pub volume: f64,
    /// Plasma surface area (m²)
    pub surface_area: f64,
    /// Default ion mass number (deuterium = 2)
    pub mass_number: f64,
    /// Default effective charge
    pub z_eff: f64,
    /// Vertical offset of the plasma center above the geometric midplane (m).
    /// Positive z0 shifts the plasma (and X-point) upward.
    pub z0: f64,
    /// Scale applied to the minor radius *for the parametric equilibrium only*.
    ///
    /// The Cerfon–Freidberg boundary,
    ///   R = R₀ + a·cos(θ + arcsin(δ)·sinθ),  Z = κ·a·sinθ
    /// is a smooth analytic approximation. Real separatrices are squarer, and
    /// on tightly fitted machines the analytic curve can bulge past a wall the
    /// true separatrix clears comfortably.
    ///
    /// SPARC is the case in point: checked against the published GEQDSK, the
    /// real PRD separatrix sits inside the published first wall everywhere
    /// (7 mm minimum gap, 25 mm median), while the analytic boundary at the
    /// same R₀/a/κ/δ falls outside it at the upper and lower inboard corners
    /// (θ ≈ 120–135°), where the SPARC wall chamfers in from R = 1.269 m at
    /// the midplane to R = 1.46 m at Z = 1.10 m.
    ///
    /// This scales only the equilibrium and the wall-contact check. Greenwald
    /// density, plasma volume, surface area and every transport scaling keep
    /// the published `a`. DIII-D and JET instead fudge `a` itself for the same
    /// reason, which distorts their Greenwald limits; this field is the
    /// cleaner mechanism and they should migrate to it.
    pub equilibrium_a_scale: f64,
    /// Rigid radial shift of the parametric equilibrium (m, negative = inboard).
    ///
    /// Applied to the equilibrium's centre only — Greenwald density, volume and
    /// every transport scaling keep the published R₀. The Cerfon–Freidberg
    /// solved contour is not symmetric about its parametrised boundary: the
    /// outboard side bulges a few cm beyond the analytic curve, so a fit that
    /// clears the wall analytically can still intersect it once solved. A
    /// small inboard shift recentres the *solved* contour inside the wall.
    pub equilibrium_r0_shift: f64,
    /// Scale on the elongation used by the parametric equilibrium only.
    ///
    /// Compensates `equilibrium_a_scale`: shrinking the minor radius for wall
    /// clearance also shrinks the vertical extent, dropping the X-points well
    /// below where the published separatrix puts them. Scaling κ back up
    /// restores the X-point height (SPARC GEQDSK: X-points at |Z| ≈ 1.11 m)
    /// so the divertor legs enter the baffle throats at the right place.
    /// Physics (IPB98, q*) is untouched — it uses `kappa_areal`.
    pub equilibrium_kappa_scale: f64,
    /// Squareness passed to the parametric equilibrium's curvature
    /// constraints (Cerfon–Freidberg α_s; 0 = standard shape).
    ///
    /// Positive squareness reduces the inboard midplane curvature
    /// (N2 = (1−α_s)²/εκ²), producing a straighter inboard side that holds
    /// its R higher up before turning over — which is how the published SPARC
    /// separatrix follows the vessel's inboard chamfer at a ~55 mm gap all
    /// the way to the X-point. The plain analytic shape instead cuts inboard
    /// at height and would clip the chamfer.
    pub equilibrium_squareness: f64,
    /// Strike-point sweep frequency (Hz). 0 disables sweeping.
    ///
    /// SPARC's divertor is inertially cooled; the published mitigation for the
    /// steady-state target load is sweeping the strike points at ~1 Hz across
    /// the target faces for the whole flat-top (Kuang et al. 2020, §3).
    /// Implemented as a small oscillation of the equilibrium triangularity, so
    /// the X-points, separatrix legs, strike points and divertor glow all move
    /// together self-consistently instead of being animated separately.
    pub strike_sweep_hz: f64,
    /// Vertical-rock amplitude of the sweep (m). 0 disables.
    ///
    /// The δ modulation moves the X-points radially, but the inner divertor
    /// slot runs nearly parallel to the inner leg's response, so the inner
    /// strike barely moves (~7 mm measured). Rocking the plasma vertically —
    /// which is how real DN machines actually sweep strike points and share
    /// power between the upper and lower divertors — slides the landing along
    /// the angled slot faces directly: the upper strikes go deeper while the
    /// lower go shallower, alternating each half-cycle.
    pub strike_sweep_z: f64,
    /// Peak triangularity excursion of the sweep (dimensionless δ units).
    ///
    /// δ → X-point mapping: R_x = R₀(1 − 1.01·ε·δ), so dR_x ≈ 0.5 m × dδ at
    /// SPARC's aspect ratio — an amplitude of 0.04 moves the X-point ±~20 mm,
    /// which the divertor-leg flux expansion magnifies to a strike-point
    /// excursion of order 0.1–0.2 m along the target, consistent with the
    /// published 0.3–0.4 m swept arcs.
    pub strike_sweep_delta: f64,
    /// Wall outline for display: (R, Z) points in meters
    pub wall_outline: Vec<(f64, f64)>,
    /// Magnetic configuration
    pub config: MagneticConfig,
    /// Impurity seeding / ELM regime parameters
    pub impurity_elm: ImpurityElmParams,
    /// L-H power threshold correction factor (multiplies Martin 2008 scaling).
    /// Accounts for isotope effects (D-T has lower P_LH than pure D) and
    /// known overestimation of Martin scaling for very large surface areas.
    /// 1.0 = unmodified Martin scaling, <1.0 = easier H-mode access.
    pub p_lh_factor: f64,
    /// Device-specific energy confinement correction factor.
    /// Multiplies tau_E after all physics-based corrections (IPB98, H-factor,
    /// triangularity, DT boost). Accounts for device-specific effects not
    /// captured by generic scalings: wall conditioning, NBI deposition
    /// geometry, divertor closure, etc. 1.0 = unmodified.
    pub confinement_factor: f64,
    /// Back-transition (H→L) threshold, as a fraction of the L→H threshold.
    ///
    /// The L-H transition is hysteretic: sustaining H-mode takes appreciably
    /// less power than entering it. Martin & Takizuka (2008) document the
    /// effect, and Hughes et al. (2020) explicitly call the no-hysteresis
    /// assumption *conservative* when projecting SPARC.
    ///
    /// It matters most for high-density regimes. The Martin threshold rises as
    /// n^0.717, so a fuelling ramp into QCE raises P_LH faster than it raises
    /// the heating — with no hysteresis the plasma drops out of H-mode exactly
    /// when the edge density gets high enough to be interesting, which is not
    /// what AUG and JET observe.
    ///
    /// 0.8 is the historical value here and is kept for every pre-existing
    /// device so their calibration is untouched.
    pub h_mode_sustain_factor: f64,
    /// Confinement multiplier applied while the plasma is in the ELM-suppressed
    /// (QCE) regime.
    ///
    /// QCE buys type-I ELM-free operation by holding the pedestal below the
    /// peeling–ballooning limit, which costs pedestal pressure and therefore
    /// global confinement. Hughes et al. (2020) §4.2 give the bracket for
    /// SPARC: a 2× pedestal reduction still leaves Q > 2, against Q = 11 at
    /// full pedestal. 1.0 = no penalty (the pre-existing behaviour for every
    /// device that reaches QCE by seeding).
    pub qce_confinement_factor: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum MagneticConfig {
    Limited,
    LowerSingleNull,
    UpperSingleNull,
    DoubleNull,
}

impl Device {
    /// Inverse aspect ratio ε = a/R₀
    pub fn epsilon(&self) -> f64 {
        self.a / self.r0
    }

    /// Ratio κ_a / κ_sep, used to convert a *programmed* (separatrix)
    /// elongation into the areal elongation the scalings expect.
    ///
    /// The pulse program ramps κ from 1.0 up to `device.kappa`, so the
    /// scalings cannot simply read `kappa_areal` — they need the same ramp
    /// applied. Multiplying the programmed value by this ratio preserves the
    /// ramp while landing on κ_a at flat-top.
    pub fn areal_ratio(&self) -> f64 {
        if self.kappa > 0.0 {
            self.kappa_areal / self.kappa
        } else {
            1.0
        }
    }

    /// Greenwald density limit (10²⁰ m⁻³), given Ip in MA
    pub fn greenwald_density(&self, ip_ma: f64) -> f64 {
        ip_ma / (std::f64::consts::PI * self.a * self.a)
    }
}

/// Approximate DIII-D first wall outline (hand-crafted polygon).
///
/// Based on the actual DIII-D vessel cross-section with a D-shaped upper
/// wall, inboard limiters, and open lower divertor with inner/outer baffles
/// and a divertor floor. Coordinates in (R, Z) meters.
///
/// Traversed clockwise starting from the outboard midplane.
fn diiid_wall() -> Vec<(f64, f64)> {
    vec![
        // Outboard midplane → top (outer wall, slight D-shape)
        (2.37, 0.00),
        (2.36, 0.20),
        (2.33, 0.40),
        (2.28, 0.60),
        (2.20, 0.80),
        (2.08, 0.95),
        // Top dome (flattened, shifted inward)
        (1.93, 1.07),
        (1.75, 1.14),
        (1.58, 1.17),
        (1.40, 1.14),
        (1.25, 1.07),
        // Inboard wall (vertical high-field side)
        (1.13, 0.95),
        (1.04, 0.75),
        (1.01, 0.50),
        (1.01, 0.25),
        (1.01, 0.00),
        (1.01, -0.25),
        (1.01, -0.50),
        (1.04, -0.75),
        (1.10, -0.92),
        // Inner divertor baffle (shelf turning toward floor)
        (1.13, -1.02),
        (1.15, -1.10),
        (1.13, -1.18),
        (1.10, -1.25),
        // Divertor floor (flat bottom, connects inner→outer)
        (1.15, -1.36),
        (1.25, -1.42),
        (1.40, -1.46),
        (1.55, -1.48),
        (1.70, -1.46),
        (1.85, -1.42),
        (1.95, -1.36),
        // Outer divertor baffle (shelf rising from floor)
        (2.04, -1.25),
        (2.10, -1.10),
        (2.14, -1.00),
        // Outboard lower wall → midplane
        (2.22, -0.85),
        (2.30, -0.65),
        (2.34, -0.45),
        (2.36, -0.22),
        (2.37, 0.00),
    ]
}

/// Approximate JET wall outline (simplified D-shaped polygon).
///
/// Based on the JET Mk2 ITER-Like Wall cross-section with a D-shaped outer
/// wall, vertical inboard limiters, and open lower divertor.
/// Traversed clockwise starting from the outboard midplane.
fn jet_wall() -> Vec<(f64, f64)> {
    vec![
        // Outboard midplane → top (outer wall, D-shape)
        (3.88, 0.00),
        (3.88, 0.20),
        (3.86, 0.45),
        (3.82, 0.70),
        (3.74, 0.95),
        (3.64, 1.15),
        // Top dome
        (3.45, 1.35),
        (3.20, 1.55),
        (2.96, 1.70),
        (2.70, 1.80),
        (2.50, 1.85),
        (2.30, 1.82),
        (2.10, 1.72),
        // Inboard wall
        (1.97, 1.55),
        (1.92, 1.30),
        (1.88, 1.00),
        (1.85, 0.70),
        (1.84, 0.40),
        (1.84, 0.10),
        (1.84, -0.10),
        (1.84, -0.40),
        (1.85, -0.70),
        (1.88, -1.00),
        (1.93, -1.20),
        // Inner divertor
        (1.97, -1.30),
        (2.01, -1.40),
        // Divertor floor
        (2.15, -1.50),
        (2.40, -1.60),
        (2.65, -1.64),
        (2.90, -1.60),
        // Outer divertor
        (3.10, -1.50),
        (3.25, -1.35),
        (3.40, -1.15),
        // Outboard lower wall → midplane
        (3.55, -0.95),
        (3.67, -0.70),
        (3.76, -0.45),
        (3.82, -0.25),
        (3.86, -0.10),
        (3.88, 0.00),
    ]
}

/// Approximate ITER wall outline (simplified polygon)
fn iter_wall() -> Vec<(f64, f64)> {
    let n = 60;
    let r0 = 6.2;
    let a_wall = 2.5;
    let kappa_wall = 2.2;
    let delta_wall: f64 = 0.50;
    let mut wall = Vec::with_capacity(n + 1);
    for i in 0..=n {
        let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
        let r = r0 + a_wall * (theta + delta_wall.asin() * theta.sin()).cos();
        let z = kappa_wall * a_wall * theta.sin();
        wall.push((r, z));
    }
    wall
}

pub fn diiid() -> Device {
    Device {
        name: "DIII-D".to_string(),
        id: "diiid".to_string(),
        r0: 1.67,
        a: 0.56, // effective plasma minor radius in diverted operation (limiter is ~0.67m)
        bt_max: 2.2,
        ip_max: 3.0,
        kappa: 1.70,
        kappa_areal: 1.70, // = kappa: preserves existing DIII-D calibration
        delta_upper: 0.50,
        delta_lower: 0.50,
        volume: 19.4,
        surface_area: 47.0,
        mass_number: 2.0,
        z_eff: 1.5,
        z0: 0.0,
        equilibrium_a_scale: 1.0,
        equilibrium_r0_shift: 0.0,
        equilibrium_kappa_scale: 1.0,
        equilibrium_squareness: 0.0,
        strike_sweep_hz: 0.0,
        strike_sweep_z: 0.0,
        strike_sweep_delta: 0.0,
        wall_outline: diiid_wall(),
        config: MagneticConfig::LowerSingleNull,
        impurity_elm: ImpurityElmParams {
            impurity_type1_onset: 0.0005,
            impurity_type2_threshold: 0.001,
            impurity_qce_threshold: 0.003,
            // Seeding-driven QCE only — no density route, no seeding ceiling.
            qce_fgw_threshold: 9.9,
            qce_impurity_ceiling: 1.0,
            impurity_collapse_threshold: 0.02,
            q95_grassy_range: (6.0, 7.5),
            delta_grassy_min: 0.4,
        },
        p_lh_factor: 1.0, // well-characterized; Martin scaling fits DIII-D data directly
        confinement_factor: 1.0,
        h_mode_sustain_factor: 0.8,
        qce_confinement_factor: 1.0,
    }
}

pub fn iter() -> Device {
    Device {
        name: "ITER".to_string(),
        id: "iter".to_string(),
        r0: 6.0,
        a: 1.7,
        bt_max: 5.3,
        ip_max: 15.0,
        kappa: 2.10,
        kappa_areal: 2.10, // = kappa: preserves existing ITER calibration
        delta_upper: 0.55,
        delta_lower: 0.55,
        volume: 837.0,
        surface_area: 683.0,
        mass_number: 2.0, // DD default (commissioning phase); DT via fuel toggle
        z_eff: 1.7,
        z0: 0.35, // plasma center above vessel midplane (X-point into lower divertor)
        equilibrium_a_scale: 1.0,
        equilibrium_r0_shift: 0.0,
        equilibrium_kappa_scale: 1.0,
        equilibrium_squareness: 0.0,
        strike_sweep_hz: 0.0,
        strike_sweep_z: 0.0,
        strike_sweep_delta: 0.0,
        wall_outline: iter_wall(),
        config: MagneticConfig::LowerSingleNull,
        impurity_elm: ImpurityElmParams {
            impurity_type1_onset: 0.0003,
            impurity_type2_threshold: 0.0008,
            impurity_qce_threshold: 0.002,
            // Seeding-driven QCE only — no density route, no seeding ceiling.
            qce_fgw_threshold: 9.9,
            qce_impurity_ceiling: 1.0,
            impurity_collapse_threshold: 0.015,
            q95_grassy_range: (4.5, 6.0),
            delta_grassy_min: 0.3,
        },
        // D-T isotope correction (~0.8×) + large-device geometry correction +
        // radiation model mismatch (our P_rad includes edge/SOL radiation that
        // shouldn't reduce P_loss for L-H comparison in experiments).
        // Target P_LH ≈ 30–35 MW so net_heating (≈40 MW) crosses threshold.
        p_lh_factor: 0.35,
        confinement_factor: 1.0,
        h_mode_sustain_factor: 0.8,
        qce_confinement_factor: 1.0,
    }
}

pub fn jet() -> Device {
    Device {
        name: "JET".to_string(),
        id: "jet".to_string(),
        r0: 2.85,
        a: 0.80, // effective plasma minor radius — conservative for parametric equilibrium
        bt_max: 3.45,
        ip_max: 4.8,
        kappa: 1.95,
        kappa_areal: 1.95, // = kappa: preserves existing JET calibration
        delta_upper: 0.20,
        delta_lower: 0.20,
        volume: 80.0,
        surface_area: 120.0,
        mass_number: 2.0,
        z_eff: 1.6,
        z0: 0.20, // slight upward shift to center plasma in vessel
        equilibrium_a_scale: 1.0,
        equilibrium_r0_shift: 0.0,
        equilibrium_kappa_scale: 1.0,
        equilibrium_squareness: 0.0,
        strike_sweep_hz: 0.0,
        strike_sweep_z: 0.0,
        strike_sweep_delta: 0.0,
        wall_outline: jet_wall(),
        config: MagneticConfig::LowerSingleNull,
        impurity_elm: ImpurityElmParams {
            impurity_type1_onset: 0.0004,
            impurity_type2_threshold: 0.001,
            impurity_qce_threshold: 0.0025,
            // Seeding-driven QCE only — no density route, no seeding ceiling.
            qce_fgw_threshold: 9.9,
            qce_impurity_ceiling: 1.0,
            impurity_collapse_threshold: 0.018,
            q95_grassy_range: (5.0, 7.0),
            delta_grassy_min: 0.35,
        },
        p_lh_factor: 0.9, // slight correction for JET ILW vs carbon wall
        // JET DTE2 achieved better confinement than generic IPB98 at matched
        // parameters, attributed to optimized NBI deposition, high shaping,
        // and ILW wall conditioning. 1.25× brings P_fus into the 5-15 MW
        // range consistent with DTE2/DTE3 results.
        confinement_factor: 1.35,
        h_mode_sustain_factor: 0.8,
        qce_confinement_factor: 1.0,
    }
}

/// Approximate CENTAUR wall outline (simplified polygon).
///
/// Based on the CENTAUR design study cross-section. Negative triangularity
/// vessel with elongated NT-shaped vacuum vessel enclosing the limiter.
/// The vessel is wider at the midplane and features divertor structures
/// at top and bottom. Vertically symmetric.
/// Traversed clockwise starting from the outboard midplane.
fn centaur_wall() -> Vec<(f64, f64)> {
    vec![
        // Outboard midplane → top
        (2.85, 0.00),
        (2.84, 0.25),
        (2.82, 0.50),
        (2.78, 0.80),
        (2.72, 1.05),
        (2.68, 1.20),
        // Upper divertor region (outboard)
        (2.75, 1.35),
        (2.80, 1.50),
        (2.55, 1.65),
        (2.35, 1.70),
        // Top dome (narrower — NT shape)
        (2.15, 1.65),
        (1.90, 1.45),
        (1.60, 1.10),
        (1.35, 0.80),
        // Inboard wall (compact)
        (1.18, 0.55),
        (1.10, 0.30),
        (1.08, 0.00),
        // Inboard lower wall
        (1.10, -0.30),
        (1.18, -0.55),
        (1.35, -0.80),
        (1.60, -1.10),
        (1.90, -1.45),
        // Lower divertor region
        (2.15, -1.65),
        (2.35, -1.70),
        (2.55, -1.65),
        (2.80, -1.50),
        (2.75, -1.35),
        // Outboard lower wall → midplane
        (2.68, -1.20),
        (2.72, -1.05),
        (2.78, -0.80),
        (2.82, -0.50),
        (2.84, -0.25),
        (2.85, 0.00),
    ]
}

pub fn centaur() -> Device {
    Device {
        name: "CENTAUR".to_string(),
        id: "centaur".to_string(),
        r0: 2.0,
        a: 0.72,
        bt_max: 10.9,
        ip_max: 9.6,
        kappa: 1.65,
        kappa_areal: 1.65, // = kappa: preserves existing CENTAUR calibration
        delta_upper: -0.55, // Negative triangularity!
        delta_lower: -0.55,
        volume: 29.7,
        surface_area: 63.0, // estimated from geometry
        mass_number: 2.5,   // D-T mix for Q > 1 operation
        z_eff: 1.43,
        z0: 0.0, // vertically symmetric
        equilibrium_a_scale: 1.0,
        equilibrium_r0_shift: 0.0,
        equilibrium_kappa_scale: 1.0,
        equilibrium_squareness: 0.0,
        strike_sweep_hz: 0.0,
        strike_sweep_z: 0.0,
        strike_sweep_delta: 0.0,
        wall_outline: centaur_wall(),
        config: MagneticConfig::DoubleNull,
        impurity_elm: ImpurityElmParams {
            // NT plasmas are inherently ELM-free — these thresholds are
            // set high since ELMs don't naturally occur in NT geometry.
            impurity_type1_onset: 0.002,
            impurity_type2_threshold: 0.005,
            impurity_qce_threshold: 0.01,
            // Seeding-driven QCE only — no density route, no seeding ceiling.
            qce_fgw_threshold: 9.9,
            qce_impurity_ceiling: 1.0,
            impurity_collapse_threshold: 0.025,
            q95_grassy_range: (5.0, 7.0),
            delta_grassy_min: 0.3,
        },
        // NT plasmas have a higher L-H threshold (harder to transition to
        // H-mode). CENTAUR is designed to operate ELM-free in L-mode/NT
        // regime, achieving near-H-mode confinement (H98y2 ≈ 0.96) without
        // the ELM penalty. High factor keeps the plasma in L-mode.
        p_lh_factor: 3.0,
        confinement_factor: 1.0,
        h_mode_sustain_factor: 0.8,
        qce_confinement_factor: 1.0,
    }
}

/// SPARC first wall outline, decimated from published data.
///
/// Source: the 555-point limiter contour carried in the SPARC Primary
/// Reference Discharge GEQDSK files in `cfs-energy/SPARCPublic` (MIT licence),
/// generated with FreeGS. Reduced to 45 points with Ramer–Douglas–Peucker at a
/// 5 mm tolerance, which preserves the divertor baffle and target structure.
/// The published contour is exactly up-down symmetric and this reduction keeps
/// that symmetry.
///
/// R ∈ [1.269, 2.430] m, Z ∈ [−1.599, 1.599] m.
/// Traversed counter-clockwise from the outboard midplane.
///
/// Note: CFS describe this as a *simplified* first wall, not the engineering
/// geometry. Acknowledgement per the SPARCPublic README: "The information,
/// data, or work presented herein builds on the SPARC primary reference
/// discharge and X-point target discharge data provided by Commonwealth Fusion
/// Systems."
fn sparc_wall() -> Vec<(f64, f64)> {
    vec![
        // Outboard midplane → top
        (2.4295, 0.0000),
        (2.4193, 0.1406),
        (2.3883, 0.2812),
        (2.3557, 0.3750),
        (2.3047, 0.4845),
        (2.3047, 0.5090),
        (2.2516, 0.5972),
        (2.1187, 0.7679),
        (1.9063, 0.9813),
        (1.8039, 1.0658),
        (1.6719, 1.1510),
        (1.6450, 1.1818),
        (1.6450, 1.2168),
        // Upper divertor: baffle, target plate, then back to the inboard side
        (1.7293, 1.4085),
        (1.8398, 1.4100),
        (1.8500, 1.4157),
        (1.8492, 1.5903),
        (1.8193, 1.5992),
        (1.4795, 1.1781),
        (1.2850, 1.2332),
        (1.2913, 1.2205),
        (1.4597, 1.1002),
        // Inboard wall (high-field side, straight centre column)
        (1.2689, 0.5000),
        (1.2689, -0.5000),
        (1.4597, -1.1002),
        // Lower divertor (mirror of the upper)
        (1.2913, -1.2205),
        (1.2850, -1.2332),
        (1.4795, -1.1781),
        (1.8193, -1.5992),
        (1.8492, -1.5903),
        (1.8500, -1.4157),
        (1.8398, -1.4100),
        (1.7293, -1.4085),
        (1.6450, -1.2168),
        (1.6450, -1.1818),
        (1.6719, -1.1510),
        (1.8039, -1.0658),
        (1.9063, -0.9813),
        (2.1187, -0.7679),
        (2.2516, -0.5972),
        (2.3047, -0.5090),
        (2.3047, -0.4845),
        (2.3557, -0.3750),
        (2.3883, -0.2812),
        (2.4193, -0.1406),
        (2.4295, 0.0000),
    ]
}

/// SPARC — compact high-field D-T tokamak (Commonwealth Fusion Systems).
///
/// All parameters are from the open literature; nothing here is proprietary.
/// Machine parameters: Creely et al., *Overview of the SPARC tokamak*,
/// J. Plasma Phys. 86, 865860502 (2020), tables 1 and 2.
/// Volume and surface area were computed by revolving the Primary Reference
/// Discharge separatrix from the public GEQDSK (LSN: 20.1 m³, 58.7 m²).
///
/// Regime note: SPARC's default scenario in this simulator is the QCE
/// (quasi-continuous exhaust) regime, not the Type-I ELMy Primary Reference
/// Discharge. Unmitigated SPARC ELMs are projected at 1.4–2.2 MJ, 2.7–15 Hz
/// (Hughes et al. 2020) — enough to flash-melt an inertially cooled divertor.
/// See SPARC_SCOPING.md §11.
pub fn sparc() -> Device {
    Device {
        name: "SPARC".to_string(),
        id: "sparc".to_string(),
        r0: 1.85,
        a: 0.57,
        bt_max: 12.2,
        ip_max: 8.7,
        kappa: 1.97,        // κ_sep — shapes the boundary
        kappa_areal: 1.75,  // κ_a — feeds IPB98(y,2) and q*; Creely §4
        delta_upper: 0.54,  // δ_sep
        delta_lower: 0.54,
        volume: 20.1,
        surface_area: 58.7,
        mass_number: 2.5, // 50:50 D-T (Hughes table 1)
        z_eff: 1.5,
        z0: 0.0, // GEQDSK z_magnetic_axis = −0.002 m; vessel is up-down symmetric
        equilibrium_a_scale: 0.92,
        // Fitted by `examples/fit_sparc_shape.rs` (grid search over the SOLVED
        // contour vs. the published wall, both strike-sweep extremes checked):
        //   • X-point lands at (1.522, ±1.122) — published DN GEQDSK: (1.53, ±1.11)
        //   • bulk minimum wall clearance 21 mm at both sweep extremes, zero
        //     intersections
        //   • inner leg strikes ~145 mm down the inboard slot at (1.31, ±1.20)
        //   • outer leg runs up the inboard side of the outboard channel and
        //     strikes the ROOF DIAGONAL, resting at (1.80, ±1.57) — 33 mm
        //     from the back corner with 33 mm minimum baffle clearance over
        //     the whole flat-top, reproducible across RNG-varied pulses
        //     (measured live at the 96×144 separatrix grid). The X-points
        //     trace a purely LATERAL arc: the δ-only sweep moves them
        //     side-to-side with zero vertical excursion. The leg meets the
        //     diagonal at grazing incidence near its top, so this landing is
        //     bistable with the corner branch — the β-compensated strike
        //     control below is what holds the deep branch; a vertical rock
        //     was tried and rejected (it bobbed the X-points and flipped the
        //     landing onto the corner baffle). The programmed κ ramp still
        //     passes through the corner-landing band during shape
        //     formation/termination (two brief ≤0.2 s corner traverses per
        //     pulse are physical and accepted). Tune against the LIVE
        //     equilibrium only; the fixed-pressure fit harness disagrees by
        //     one κ notch
        //   • the 1 Hz sweep excursions to HIGHER δ, so the strike walks
        //     ~240 mm INBOARD along the diagonal and back — never toward the
        //     baffle
        // Re-run the example after touching any of these or the wall geometry.
        equilibrium_r0_shift: -0.05,
        equilibrium_kappa_scale: 1.1025,
        equilibrium_squareness: 0.10,
        // Analytic boundary bulges past the published wall at the
        // inboard corners; see the field doc. At 0.92 the worst-corner
        // clearance is ~7 mm in the DN shape (0.93 left only ~2 mm, which
        // the strike-point sweep then violated). Hand-tuned — the §15
        // boundary-fit optimizer in SPARC_SCOPING.md should replace this.
        // ~1 Hz strike-point sweep across both divertors — the published heat
        // exhaust strategy for the inertially cooled targets.
        strike_sweep_hz: 1.0,
        // No vertical rock: the X-points trace a purely LATERAL arc (the δ
        // modulation moves them side-to-side; δ does not enter the X-point
        // height at all). A vertical rock was tried for inner-strike motion
        // but rejected on review — it bobbed the X-points visibly and kept
        // flipping the grazing outer landing onto the back-corner baffle.
        strike_sweep_z: 0.0,
        strike_sweep_delta: 0.03,
        wall_outline: sparc_wall(),
        config: MagneticConfig::DoubleNull, // vessel is exactly up-down symmetric; DN operation planned from the start
        impurity_elm: ImpurityElmParams {
            // SPARC reaches QCE by the *density* route, not by seeding — see
            // qce_fgw_threshold. The impurity thresholds below therefore only
            // shape the Type-I → Type-II progression on the way there.
            // Impurity thresholds are an order of magnitude below the other
            // devices because radiated power scales as n_e²·V: at SPARC's
            // 3.7×10²⁰ m⁻³ in 20 m³, a neon fraction of just 5×10⁻⁴ radiates
            // ~29 MW and collapses the plasma outright. DIII-D tolerates 3×10⁻³
            // comfortably; SPARC does not.
            impurity_type1_onset: 0.00008,
            // Negative sentinel: the Type-II (grassy) condition is always
            // satisfied, making grassy the FLOOR regime whenever SPARC is in
            // ELMing H-mode. SPARC is designed to avoid Type-I ELMs at all
            // costs — a single unmitigated 1.4–2.2 MJ crash risks flash-melting
            // the inertially cooled tungsten targets (Hughes 2020, Kuang 2020)
            // — so even outside the QCE window the worst the machine shows is
            // small grassy ELMs, at whatever heating power the user dials in.
            impurity_type2_threshold: -1.0,
            impurity_qce_threshold: 0.99, // seeding alone never gets you there
            // Line-averaged proxy for the published separatrix criterion of
            // 0.3–0.4 n_GW. Tuned so the QCE preset crosses it partway into
            // flat-top, reproducing the observed L-H → transient Type-I → QCE
            // entry sequence seen on AUG and JET.
            qce_fgw_threshold: 0.42,
            // Heavy Ne seeding starves the SOL and collapses n_e,sep, which
            // costs QCE access (Lomanowski et al. 2026): ≈50 % n_e,sep
            // reduction at 2 % separatrix Ne. Over-seed and the ELMs return —
            // roughly 3× the default seeding rate crosses this.
            qce_impurity_ceiling: 0.00028,
            impurity_collapse_threshold: 0.02,
            q95_grassy_range: (2.0, 9.0), // wide: grassy must hold anywhere H-mode survives
            delta_grassy_min: 0.4,        // QCE needs strong shaping
        },
        // Hughes et al. (2020): P_th ≈ 21 MW in D-T (Martin with the isotope
        // correction and radiated power subtracted) against 25 MW of ICRF —
        // and > 25 MW in D-D, so H-mode access in deuterium is not assured.
        // Calibrated against those two numbers rather than picked by feel.
        // Calibrated, not guessed: at the PRD density (⟨n_e⟩ = 3.1×10²⁰ m⁻³,
        // B₀ = 12.2 T, S = 58.7 m²) the Martin scaling times this factor gives
        // P_LH = 21.0 MW, which is exactly the D-T threshold Hughes et al.
        // (2020) project for SPARC against 25 MW of installed ICRF.
        p_lh_factor: 0.556,
        confinement_factor: 1.0,
        // Stronger hysteresis than the 0.8 default. Required to hold H-mode
        // through the QCE fuelling ramp: at f_GW ≈ 0.5 the Martin threshold
        // reaches ~30 MW against ~28 MW of net heating, so with no hysteresis
        // the plasma drops out of H-mode the moment the edge density becomes
        // high enough for QCE. Experimental H→L back-transitions are commonly
        // 0.6–0.7× the L→H threshold.
        h_mode_sustain_factor: 0.65,
        // Degraded pedestal in QCE, expressed as a *global* confinement
        // penalty. The intended pedestal reduction is ≈0.78 of the Type-I
        // value, bracketed by Hughes §4.2 (a 2× pedestal cut still leaves
        // Q > 2, against Q = 11 at full pedestal). That does not map 1:1 onto
        // τ_E: the pedestal carries roughly a third to a half of the stored
        // energy, so a 22 % pedestal cut is ≈8–11 % off global confinement.
        // Applying 0.78 directly to τ_E double-counts the loss and sends the
        // plasma into an alpha-power death spiral.
        qce_confinement_factor: 0.88,
    }
}

pub fn get_device(id: &str) -> Option<Device> {
    match id {
        "diiid" => Some(diiid()),
        "iter" => Some(iter()),
        "jet" => Some(jet()),
        "centaur" => Some(centaur()),
        "sparc" => Some(sparc()),
        _ => None,
    }
}

pub fn all_devices() -> Vec<Device> {
    vec![diiid(), sparc(), centaur(), iter(), jet()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_params() {
        let d = diiid();
        assert!((d.epsilon() - 0.3353).abs() < 0.01); // a/R₀ = 0.56/1.67
        // Greenwald density at 2 MA
        let ngw = d.greenwald_density(2.0);
        assert!(ngw > 1.0 && ngw < 2.5); // a=0.56 → ngw ≈ 1.59
    }

    #[test]
    fn test_iter_params() {
        let d = iter();
        assert!((d.epsilon() - 0.2833).abs() < 0.01); // a/R₀ = 1.7/6.0
        let ngw = d.greenwald_density(15.0);
        assert!(ngw > 1.0 && ngw < 2.5); // a=1.7 → ngw ≈ 1.65
        assert!((d.z0 - 0.35).abs() < 0.01, "ITER z0 should be 0.35m");
    }

    #[test]
    fn test_wall_outlines() {
        let d = diiid();
        assert!(!d.wall_outline.is_empty());
        // Wall should be closed (first ≈ last)
        let first = d.wall_outline.first().unwrap();
        let last = d.wall_outline.last().unwrap();
        assert!((first.0 - last.0).abs() < 0.01);
        assert!((first.1 - last.1).abs() < 0.01);
    }
}
