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
    /// Extra squareness added to the parametric equilibrium's equatorial
    /// curvature constraints; 0 = the plain Cerfon–Freidberg shape.
    ///
    /// The equatorial rows use α_s = arcsin(δ) + squareness, so this is a
    /// perturbation *on top of* the triangularity, not a replacement for it
    /// (it was the latter until issue #2 — see `equilibrium.rs`). The crown
    /// row keeps the unmodified α = arcsin(δ).
    ///
    /// Raising α_s tightens the inboard midplane curvature (N2 = (1−α_s)²/εκ²)
    /// and lowering it straightens the inboard side, so it holds its R higher
    /// up before turning over — which is how the published SPARC separatrix
    /// follows the vessel's inboard chamfer all the way to the X-point. The
    /// plain analytic shape instead cuts inboard at height and clips the
    /// chamfer, which is why SPARC carries a negative value here.
    pub equilibrium_squareness: f64,
    /// Outboard counterpart of `equilibrium_squareness`: offset on α in the
    /// OUTBOARD equatorial curvature row N₁ only. Lowering it flattens the
    /// outboard midplane curvature so the boundary holds its width higher up
    /// (a fuller shoulder) without touching the inboard side. Equal values
    /// reproduce the pre-split single-knob behaviour exactly.
    pub equilibrium_squareness_out: f64,
    /// Upper triangularity used by the parametric equilibrium ONLY.
    ///
    /// The GEQDSK-anchored shape fits want a different δ than the published
    /// reference values that calibrate q*, the L-H threshold and ELM gating
    /// (`delta_upper`/`delta_lower`), so the two are kept separate exactly
    /// like `kappa` vs `kappa_areal`. The running simulation applies the
    /// difference as a rigid offset on the programmed δ waveform, so ramps
    /// and the strike sweep carry through unchanged.
    pub equilibrium_delta_upper: f64,
    /// Lower-triangularity counterpart of `equilibrium_delta_upper`.
    pub equilibrium_delta_lower: f64,
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

/// DIII-D first wall / limiter contour.
///
/// Single source of truth, shared with the front end: this is the same
/// contour as the matching `*_LIMITER` export in `web/src/lib/*-geometry.ts`,
/// which `DeviceSelect`/`ControlRoom` render. Keep the two in sync — the
/// limiter-contact check in `simulation.rs` uses this one, so a divergence
/// means the plasma is collision-checked against a vessel nobody sees.
fn diiid_wall() -> Vec<(f64, f64)> {
    vec![
        (1.0193, 1.1159),
        (1.0350, 1.1639),
        (1.0384, 1.1624),
        (1.0612, 1.1636),
        (1.0990, 1.1659),
        (1.1381, 1.1682),
        (1.1619, 1.1745),
        (1.1901, 1.1870),
        (1.2101, 1.2019),
        (1.2308, 1.2250),
        (1.2394, 1.2386),
        (1.2611, 1.2863),
        (1.2808, 1.3340),
        (1.2808, 1.3481),
        (1.3306, 1.3481),
        (1.4195, 1.3475),
        (1.4195, 1.3104),
        (1.3741, 1.3069),
        (1.3674, 1.2641),
        (1.3679, 1.2265),
        (1.3723, 1.1948),
        (1.4156, 1.1565),
        (1.4259, 1.1628),
        (1.4470, 1.1820),
        (1.4880, 1.2190),
        (1.4911, 1.2135),
        (1.4950, 1.1617),
        (1.4817, 1.1159),
        (1.4910, 1.1127),
        (1.5294, 1.1048),
        (1.6020, 1.0931),
        (1.6469, 1.0785),
        (1.7834, 1.0721),
        (2.0452, 1.0391),
        (2.0560, 1.0432),
        (2.1064, 0.9997),
        (2.0857, 0.8693),
        (2.2222, 0.5191),
        (2.2429, 0.4486),
        (2.3115, 0.2797),
        (2.3401, 0.2199),
        (2.3464, 0.1987),
        (2.3483, 0.0633),
        (2.3511, 0.0421),
        (2.3483, -0.2548),
        (2.3464, -0.2727),
        (2.3511, -0.4206),
        (2.2783, -0.5934),
        (2.2384, -0.6883),
        (2.2359, -0.6941),
        (2.1954, -0.7906),
        (2.1939, -0.7941),
        (2.1559, -0.8847),
        (2.1526, -0.8882),
        (1.9237, -1.0162),
        (1.9203, -1.0196),
        (1.7866, -1.1607),
        (1.7767, -1.1665),
        (1.7409, -1.2398),
        (1.6452, -1.2448),
        (1.4012, -1.2448),
        (1.3856, -1.2482),
        (1.3749, -1.2583),
        (1.3695, -1.2694),
        (1.3682, -1.2755),
        (1.3686, -1.3225),
        (1.3726, -1.3247),
        (1.4277, -1.3247),
        (1.4277, -1.3578),
        (1.1645, -1.3589),
        (1.0175, -1.2170),
        (1.0173, -0.0010),
        (1.0173, 0.0000),
        (1.0193, 1.1159),
    ]
}

/// JET first wall / limiter contour.
///
/// Single source of truth, shared with the front end: this is the same
/// contour as the matching `*_LIMITER` export in `web/src/lib/*-geometry.ts`,
/// which `DeviceSelect`/`ControlRoom` render. Keep the two in sync — the
/// limiter-contact check in `simulation.rs` uses this one, so a divergence
/// means the plasma is collision-checked against a vessel nobody sees.
fn jet_wall() -> Vec<(f64, f64)> {
    vec![
        (3.2832, -1.1244),
        (3.3119, -1.0832),
        (3.3284, -1.0631),
        (3.3524, -1.0387),
        (3.3732, -1.0172),
        (3.4233, -0.9599),
        (3.4473, -0.9323),
        (3.4943, -0.8719),
        (3.5168, -0.8428),
        (3.5591, -0.7815),
        (3.5805, -0.7501),
        (3.6193, -0.6868),
        (3.6390, -0.6539),
        (3.6736, -0.5877),
        (3.6880, -0.5609),
        (3.7223, -0.4850),
        (3.7350, -0.4576),
        (3.7682, -0.3714),
        (3.7758, -0.3524),
        (3.8026, -0.2692),
        (3.8108, -0.2446),
        (3.8333, -0.1580),
        (3.8396, -0.1348),
        (3.8565, -0.0508),
        (3.8621, -0.0243),
        (3.8752, 0.0685),
        (3.8784, 0.0888),
        (3.8857, 0.1762),
        (3.8879, 0.1963),
        (3.8905, 0.2904),
        (3.8914, 0.3134),
        (3.8886, 0.4076),
        (3.8884, 0.4267),
        (3.8803, 0.5199),
        (3.8789, 0.5396),
        (3.8656, 0.6323),
        (3.8635, 0.6497),
        (3.8445, 0.7435),
        (3.8409, 0.7627),
        (3.8171, 0.8532),
        (3.8130, 0.8705),
        (3.7837, 0.9613),
        (3.7790, 0.9770),
        (3.7441, 1.0672),
        (3.7382, 1.0834),
        (3.6987, 1.1705),
        (3.6918, 1.1866),
        (3.6749, 1.2188),
        (3.6674, 1.2364),
        (3.6373, 1.3339),
        (3.6421, 1.4077),
        (3.6214, 1.4266),
        (3.6208, 1.4271),
        (3.5941, 1.4514),
        (3.5935, 1.4519),
        (3.5668, 1.4762),
        (3.5662, 1.4767),
        (3.5395, 1.5010),
        (3.5389, 1.5016),
        (3.5122, 1.5258),
        (3.5116, 1.5264),
        (3.4849, 1.5507),
        (3.4844, 1.5512),
        (3.4577, 1.5755),
        (3.4571, 1.5760),
        (3.4304, 1.6003),
        (3.4298, 1.6008),
        (3.4031, 1.6251),
        (3.4025, 1.6257),
        (3.3818, 1.6445),
        (3.3315, 1.7041),
        (3.2818, 1.7387),
        (3.1863, 1.8175),
        (3.1366, 1.8521),
        (3.0010, 1.8834),
        (2.8689, 1.9396),
        (2.8525, 1.9453),
        (2.7756, 1.9680),
        (2.7576, 1.9720),
        (2.6790, 1.9829),
        (2.6589, 1.9840),
        (2.5779, 1.9829),
        (2.5606, 1.9811),
        (2.4801, 1.9677),
        (2.4660, 1.9642),
        (2.3884, 1.9389),
        (2.3742, 1.9331),
        (2.2980, 1.8947),
        (2.2875, 1.8884),
        (2.1954, 1.8228),
        (2.1824, 1.8237),
        (2.1657, 1.7908),
        (2.1653, 1.7901),
        (2.1490, 1.7579),
        (2.1486, 1.7572),
        (2.1323, 1.7251),
        (2.1319, 1.7243),
        (2.1156, 1.6922),
        (2.1152, 1.6915),
        (2.0989, 1.6593),
        (2.0985, 1.6586),
        (2.0822, 1.6264),
        (2.0818, 1.6257),
        (2.0682, 1.5988),
        (2.0676, 1.5982),
        (2.0547, 1.5645),
        (2.0544, 1.5637),
        (2.0415, 1.5300),
        (2.0412, 1.5293),
        (2.0283, 1.4956),
        (2.0280, 1.4949),
        (2.0151, 1.4612),
        (2.0148, 1.4604),
        (2.0019, 1.4267),
        (2.0016, 1.4260),
        (1.9888, 1.3923),
        (1.9885, 1.3915),
        (1.9756, 1.3578),
        (1.9753, 1.3571),
        (1.9613, 1.3206),
        (1.9299, 1.2730),
        (1.9270, 1.2610),
        (1.9226, 1.2540),
        (1.9425, 1.2346),
        (1.9273, 1.1583),
        (1.9250, 1.1380),
        (1.9124, 1.0607),
        (1.9097, 1.0400),
        (1.8984, 0.9621),
        (1.8957, 0.9401),
        (1.8858, 0.8624),
        (1.8830, 0.8407),
        (1.8731, 0.7630),
        (1.8704, 0.7417),
        (1.8605, 0.6641),
        (1.8584, 0.6429),
        (1.8499, 0.5655),
        (1.8482, 0.5452),
        (1.8418, 0.4671),
        (1.8410, 0.4462),
        (1.8372, 0.3683),
        (1.8370, 0.3474),
        (1.8359, 0.2700),
        (1.8364, 0.2485),
        (1.8379, 0.1710),
        (1.8391, 0.1497),
        (1.8431, 0.0714),
        (1.8450, 0.0507),
        (1.8517, -0.0275),
        (1.8542, -0.0478),
        (1.8634, -0.1248),
        (1.8666, -0.1455),
        (1.8785, -0.2231),
        (1.8823, -0.2432),
        (1.8967, -0.3202),
        (1.9013, -0.3402),
        (1.9182, -0.4168),
        (1.9234, -0.4365),
        (1.9427, -0.5120),
        (1.9486, -0.5319),
        (1.9706, -0.6069),
        (1.9597, -0.6265),
        (1.9618, -0.6576),
        (2.0091, -0.7840),
        (2.0204, -0.8113),
        (2.0207, -0.8120),
        (2.0345, -0.8454),
        (2.0348, -0.8461),
        (2.0486, -0.8794),
        (2.0490, -0.8802),
        (2.0628, -0.9135),
        (2.0631, -0.9143),
        (2.0769, -0.9476),
        (2.0772, -0.9483),
        (2.0910, -0.9817),
        (2.0913, -0.9824),
        (2.1051, -1.0157),
        (2.1055, -1.0167),
        (2.1193, -1.0500),
        (2.1196, -1.0507),
        (2.1334, -1.0841),
        (2.1337, -1.0848),
        (2.1475, -1.1181),
        (2.1478, -1.1189),
        (2.1616, -1.1522),
        (2.1619, -1.1530),
        (2.1757, -1.1863),
        (2.1761, -1.1870),
        (2.1899, -1.2204),
        (2.1902, -1.2211),
        (2.2015, -1.2484),
        (2.1446, -1.2749),
        (2.2936, -1.3148),
        (2.2936, -1.3314),
        (2.2954, -1.3344),
        (2.3599, -1.3344),
        (2.3962, -1.3732),
        (2.4091, -1.4003),
        (2.4122, -1.4220),
        (2.4129, -1.4315),
        (2.4129, -1.4685),
        (2.4122, -1.4768),
        (2.4076, -1.5044),
        (2.3980, -1.5164),
        (2.4192, -1.5922),
        (2.4212, -1.6102),
        (2.4188, -1.6428),
        (2.4163, -1.6561),
        (2.4057, -1.6897),
        (2.3150, -1.7387),
        (2.3535, -1.7387),
        (2.3743, -1.7350),
        (2.4274, -1.7135),
        (2.4462, -1.7098),
        (2.5237, -1.7098),
        (2.5246, -1.7000),
        (2.5591, -1.6550),
        (2.5530, -1.6380),
        (2.5739, -1.6018),
        (2.6330, -1.6171),
        (2.6337, -1.6199),
        (2.6938, -1.6355),
        (2.6943, -1.6382),
        (2.7544, -1.6548),
        (2.7552, -1.6566),
        (2.8147, -1.6720),
        (2.8147, -1.7079),
        (2.8043, -1.7116),
        (2.8570, -1.7116),
        (2.8785, -1.7160),
        (2.9364, -1.7414),
        (2.9573, -1.7459),
        (2.9870, -1.7459),
        (2.8977, -1.6823),
        (2.8820, -1.6228),
        (2.8816, -1.5916),
        (2.9005, -1.5104),
        (2.8905, -1.4984),
        (2.8879, -1.4892),
        (2.8859, -1.4740),
        (2.8859, -1.4357),
        (2.8895, -1.4171),
        (2.9008, -1.3928),
        (2.9133, -1.3762),
        (2.9635, -1.3348),
        (3.0097, -1.3348),
        (3.0600, -1.2978),
        (3.1940, -1.2140),
        (3.2022, -1.2089),
        (3.3063, -1.2089),
        (3.2832, -1.1244),
    ]
}

/// ITER first wall / limiter contour, including the lower divertor
/// cassette (inner target, dome, outer target).
///
/// Single source of truth, shared with the front end: this is the same
/// contour as the matching `*_LIMITER` export in `web/src/lib/*-geometry.ts`,
/// which `DeviceSelect`/`ControlRoom` render. Keep the two in sync — the
/// limiter-contact check in `simulation.rs` uses this one, so a divergence
/// means the plasma is collision-checked against a vessel nobody sees.
fn iter_wall() -> Vec<(f64, f64)> {
    vec![
        (4.0455, -2.5063),
        (4.0455, -1.5000),
        (4.0455, -0.4836),
        (4.0455, 0.5328),
        (4.0455, 1.5492),
        (4.0455, 2.5656),
        (4.0455, 3.5820),
        (4.3109, 4.3240),
        (4.9037, 4.7115),
        (5.7538, 4.5323),
        (6.5870, 3.8934),
        (7.4672, 3.0833),
        (7.9338, 2.4024),
        (8.2703, 1.6814),
        (8.3944, 0.6329),
        (8.3063, -0.4215),
        (7.8987, -1.3417),
        (7.2829, -2.2570),
        (6.2665, -3.0461),
        (6.1710, -3.2350),
        (5.9821, -3.2822),
        (5.8150, -3.3823),
        (5.6842, -3.5265),
        (5.6008, -3.7024),
        (5.5720, -3.8950),
        (5.5720, -3.8960),
        (5.5720, -3.9956),
        (5.5720, -3.9961),
        (5.5650, -4.0962),
        (5.5650, -4.2494),
        (5.5650, -4.4026),
        (5.5650, -4.5559),
        (5.2727, -4.2636),
        (5.2628, -4.1244),
        (5.2529, -3.9852),
        (5.1496, -3.8382),
        (4.9982, -3.7414),
        (4.8215, -3.7090),
        (4.6456, -3.7460),
        (4.5687, -3.8276),
        (4.4918, -3.9092),
        (4.1799, -3.8847),
        (4.2457, -3.7497),
        (4.3115, -3.6148),
        (4.3773, -3.4799),
        (4.4062, -3.4048),
        (4.4064, -3.4043),
        (4.4670, -3.2801),
        (4.5157, -3.1139),
        (4.5066, -2.9410),
        (4.4408, -2.7808),
        (4.3257, -2.6514),
        (4.1742, -2.5674),
        (4.0455, -2.5063),
    ]
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
        equilibrium_a_scale: 0.94,
        equilibrium_r0_shift: 0.03,
        equilibrium_kappa_scale: 1.1,
        equilibrium_squareness: -0.6,
        equilibrium_delta_upper: 0.426,
        equilibrium_delta_lower: 0.770,
        equilibrium_squareness_out: -0.6,
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
        // Fitted by examples/fit_to_geqdsk.rs against the default ITER
        // equilibrium shipped inside OpenFUSIONToolkit
        // (src/tests/physics/ITER_test.eqdsk, R0 6.22, a 1.98, kappa 1.82,
        // delta 0.33/0.57 — read locally, never committed): boundary RMS vs
        // that reference dropped 383 -> 78 mm. The device card's a = 1.70
        // underquotes the real ITER minor radius to keep the transport
        // calibration; a_scale 1.14 restores the rendered plasma to the
        // reference's true size (narrowed one notch from the raw optimum of
        // 1.14 on user review — at kappa_scale 0.90 the RMS actually improves
        // and the wall gap grows to 67 mm), the same mechanism as
        // SPARC. Equilibrium deltas stay at the published 0.55/0.55 — the
        // fit's asymmetric option (0.44/0.57) measured very slightly WORSE
        // on the full-vessel metric, so the simpler choice wins. Strikes on
        // the cassette's inner (4.35, -3.90) and outer (5.22, -3.94)
        // vertical targets.
        equilibrium_a_scale: 1.12,
        equilibrium_r0_shift: 0.16,
        equilibrium_kappa_scale: 0.9,
        equilibrium_squareness: -0.75,
        equilibrium_delta_upper: 0.55,
        equilibrium_delta_lower: 0.55,
        equilibrium_squareness_out: -0.45,
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
        equilibrium_delta_upper: 0.20,
        equilibrium_delta_lower: 0.20,
        equilibrium_squareness_out: 0.0,
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

/// CENTAUR first wall / limiter contour, including the upper and lower
/// divertor slots.
///
/// Single source of truth, shared with the front end: this is the same
/// contour as the matching `*_LIMITER` export in `web/src/lib/*-geometry.ts`,
/// which `DeviceSelect`/`ControlRoom` render. Keep the two in sync — the
/// limiter-contact check in `simulation.rs` uses this one, so a divergence
/// means the plasma is collision-checked against a vessel nobody sees.
fn centaur_wall() -> Vec<(f64, f64)> {
    vec![
        (1.2600, -0.2700),
        (1.4500, -0.6900),
        (2.1780, -1.2000),
        (2.1780, -1.2930),
        (2.2830, -1.5600),
        (2.4630, -1.3747),
        (2.7000, -1.4200),
        (2.6740, -1.2375),
        (2.6000, -1.1000),
        (2.7300, -0.4552),
        (2.7300, 0.4552),
        (2.6000, 1.1000),
        (2.6740, 1.2375),
        (2.7000, 1.4200),
        (2.4630, 1.3747),
        (2.2830, 1.5600),
        (2.1780, 1.2930),
        (2.1780, 1.2000),
        (1.4500, 0.6900),
        (1.2600, 0.2700),
        (1.2600, -0.2700),
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
        equilibrium_a_scale: 0.94,
        equilibrium_r0_shift: 0.03,
        equilibrium_kappa_scale: 1.08,
        equilibrium_squareness: 0.9,
        equilibrium_delta_upper: -0.550,
        equilibrium_delta_lower: -0.540,
        equilibrium_squareness_out: 0.9,
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

/// SPARC first wall / limiter contour, including the baffled divertor
/// slots.
///
/// Single source of truth, shared with the front end: this is the same
/// contour as the matching `*_LIMITER` export in `web/src/lib/*-geometry.ts`,
/// which `DeviceSelect`/`ControlRoom` render. Keep the two in sync — the
/// limiter-contact check in `simulation.rs` uses this one, so a divergence
/// means the plasma is collision-checked against a vessel nobody sees.
fn sparc_wall() -> Vec<(f64, f64)> {
    vec![
        (2.4295, 0.0000),
        (2.4284, 0.0469),
        (2.4250, 0.0938),
        (2.4193, 0.1406),
        (2.4113, 0.1875),
        (2.4010, 0.2344),
        (2.3883, 0.2812),
        (2.3733, 0.3281),
        (2.3557, 0.3750),
        (2.3357, 0.4219),
        (2.3047, 0.4845),
        (2.3047, 0.5090),
        (2.2516, 0.5972),
        (2.1984, 0.6721),
        (2.1187, 0.7679),
        (2.0656, 0.8243),
        (1.9063, 0.9813),
        (1.8536, 1.0275),
        (1.8039, 1.0658),
        (1.7567, 1.0979),
        (1.6941, 1.1354),
        (1.6719, 1.1510),
        (1.6541, 1.1665),
        (1.6450, 1.1818),
        (1.6418, 1.1980),
        (1.6450, 1.2168),
        (1.7293, 1.4085),
        (1.7443, 1.4100),
        (1.8398, 1.4100),
        (1.8500, 1.4157),
        (1.8492, 1.5903),
        (1.8193, 1.5992),
        (1.7462, 1.5152),
        (1.4795, 1.1781),
        (1.4656, 1.1786),
        (1.2985, 1.2308),
        (1.2850, 1.2332),
        (1.2913, 1.2205),
        (1.4597, 1.1002),
        (1.2689, 0.5000),
        (1.2689, -0.5000),
        (1.4597, -1.1002),
        (1.2913, -1.2205),
        (1.2850, -1.2332),
        (1.2985, -1.2308),
        (1.4656, -1.1786),
        (1.4795, -1.1781),
        (1.7462, -1.5152),
        (1.8193, -1.5992),
        (1.8492, -1.5903),
        (1.8500, -1.4157),
        (1.8398, -1.4100),
        (1.7443, -1.4100),
        (1.7293, -1.4085),
        (1.6450, -1.2168),
        (1.6418, -1.2006),
        (1.6450, -1.1818),
        (1.6541, -1.1665),
        (1.6719, -1.1510),
        (1.6941, -1.1354),
        (1.7567, -1.0979),
        (1.8039, -1.0658),
        (1.8536, -1.0275),
        (1.9063, -0.9813),
        (2.0656, -0.8243),
        (2.1187, -0.7679),
        (2.1984, -0.6721),
        (2.2516, -0.5972),
        (2.3047, -0.5090),
        (2.3047, -0.4845),
        (2.3357, -0.4219),
        (2.3557, -0.3750),
        (2.3733, -0.3281),
        (2.3883, -0.2812),
        (2.4010, -0.2344),
        (2.4113, -0.1875),
        (2.4193, -0.1406),
        (2.4250, -0.0938),
        (2.4284, -0.0469),
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
        equilibrium_a_scale: 0.96,
        // Fitted by `examples/fit_to_geqdsk.rs` against the 2026-07 SPARC
        // scenario equilibrium (sparc_bt87_ip60_17MW blend-ped, read locally,
        // never committed), after the issue-#2 basis corrections and with the
        // split squareness (α offsets applied per side, see
        // equilibrium_squareness_out):
        //   • boundary RMS vs the reference LCFS: 10.6 mm (84 mm shipped)
        //   • δ = 0.590 is the user-adopted baseline and the strike-sweep
        //     MIDPOINT; the sweep runs δ = 0.555..0.625 (strike_sweep_delta
        //     is the full width, sweep symmetric about rest)
        //   • strikes verified ON-TARGET at every sweep phase by first-impact
        //     clipping: inner (1.461..1.389, |Z| 1.180..1.202) stays on the
        //     wedge-slot faces — 5 mm from the slot mouth at the low-δ
        //     extreme, which is what caps the sweep width — and outer
        //     (1.637..1.554, |Z| 1.378..1.272) stays on the roof diagonal,
        //     baffle-clear; outer transit 135 mm per half-cycle (2.0x the
        //     pre-split band)
        // Re-run the example after touching any of these or the wall geometry.
        equilibrium_r0_shift: 0.0,
        equilibrium_kappa_scale: 1.02,
        equilibrium_squareness: -0.6,
        equilibrium_delta_upper: 0.590,
        equilibrium_delta_lower: 0.590,
        equilibrium_squareness_out: -0.45,
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
        strike_sweep_delta: 0.07,
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
