//! 0D power balance transport model.
//!
//! Evolves plasma stored energy using global power balance with the
//! IPB98(y,2) energy confinement time scaling. Includes ohmic heating,
//! external heating (NBI, ECH, ICH), bremsstrahlung radiation, and
//! L-H mode transition logic.

use serde::{Deserialize, Serialize};

use crate::devices::Device;

/// Transport model state and parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportModel {
    /// Thermal stored energy (MJ)
    pub w_th: f64,
    /// Central electron temperature (keV)
    pub te0: f64,
    /// Central electron density (10²⁰ m⁻³)
    pub ne0: f64,
    /// Line-averaged density (10²⁰ m⁻³)
    pub ne_bar: f64,
    /// Energy confinement time (s)
    pub tau_e: f64,
    /// Ohmic heating power (MW)
    pub p_ohmic: f64,
    /// Total radiated power (MW)
    pub p_rad: f64,
    /// Total input power (MW)
    pub p_input: f64,
    /// Total loss power (MW)
    pub p_loss: f64,
    /// Alpha heating power from fusion self-heating (MW)
    pub p_alpha: f64,
    /// L-H transition power threshold (MW)
    pub p_lh_threshold: f64,
    /// H-mode confinement enhancement factor
    pub h_factor: f64,
    /// Toroidal beta (%)
    pub beta_t: f64,
    /// Normalized beta
    pub beta_n: f64,
    /// Peak β_N achieved (caps rampdown overshoot)
    beta_n_peak: f64,
    /// Peak Ip seen (for rampdown confinement degradation)
    ip_peak: f64,
    /// Safety factor at 95% flux surface
    pub q95: f64,
    /// Greenwald fraction
    pub f_greenwald: f64,
    /// Internal inductance
    pub li: f64,
    /// Whether plasma is in H-mode
    pub in_hmode: bool,
    /// ELM timer (time since last ELM, seconds)
    pub elm_timer: f64,
    /// Whether an ELM is currently happening
    pub elm_active: bool,
    /// ELM energy loss fraction
    pub elm_energy_loss: f64,
    /// Pedestal crash fraction for profile coupling (amplified from global energy loss)
    pub elm_ped_crash_frac: f64,
    /// Whether ELMs are suppressed (e.g., by neon seeding / QCE regime)
    pub elm_suppressed: bool,
    /// ELM display cooldown (s) — keeps elm_active true for multiple timesteps
    /// so the display can capture it (prevents temporal aliasing at high frame skip)
    pub elm_cooldown: f64,
    /// ELM type: 0=none, 1=Type I (large, low freq), 2=Type II (small, high freq)
    pub elm_type: u8,
    /// Simple xorshift RNG state for stochastic ELM timing/amplitude
    pub elm_rng_state: u64,
    /// Pre-computed next ELM period with stochastic jitter (s)
    pub elm_next_period: f64,
    /// Impurity fraction (relative to electron density) — currently neon,
    /// generic to support future species (argon, krypton, nitrogen).
    pub impurity_fraction: f64,
}

impl Default for TransportModel {
    fn default() -> Self {
        TransportModel {
            w_th: 0.0,
            te0: 0.1,
            ne0: 0.1,
            ne_bar: 0.1,
            tau_e: 0.01,
            p_ohmic: 0.0,
            p_rad: 0.0,
            p_input: 0.0,
            p_loss: 0.0,
            p_alpha: 0.0,
            p_lh_threshold: 1.0,
            h_factor: 0.5,
            beta_t: 0.0,
            beta_n: 0.0,
            beta_n_peak: 0.0,
            ip_peak: 0.0,
            q95: 10.0,
            f_greenwald: 0.0,
            li: 1.0,
            in_hmode: false,
            elm_timer: 0.0,
            elm_active: false,
            elm_energy_loss: 0.0,
            elm_ped_crash_frac: 0.0,
            elm_suppressed: false,
            elm_cooldown: 0.0,
            elm_type: 0,
            elm_rng_state: 54321,
            elm_next_period: 0.0,
            impurity_fraction: 0.0,
        }
    }
}

/// Programmed waveform values at the current time.
#[derive(Debug, Clone, Default)]
pub struct ProgramValues {
    /// Plasma current (MA)
    pub ip: f64,
    /// Toroidal field (T)
    pub bt: f64,
    /// Target line-averaged density (10²⁰ m⁻³)
    pub ne_target: f64,
    /// NBI power (MW)
    pub p_nbi: f64,
    /// ECH power (MW)
    pub p_ech: f64,
    /// ICH power (MW)
    pub p_ich: f64,
    /// Target elongation
    pub kappa: f64,
    /// Target triangularity
    pub delta: f64,
    /// D2 gas puff rate (10²⁰ particles/s)
    pub d2_puff: f64,
    /// Neon impurity seeding rate (10²⁰ particles/s)
    pub neon_puff: f64,
}

impl TransportModel {
    /// Simple xorshift RNG returning a value in [0, 1).
    fn next_rng(&mut self) -> f64 {
        let mut x = self.elm_rng_state;
        if x == 0 {
            x = 12345;
        }
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.elm_rng_state = x;
        (x as f64) / (u64::MAX as f64)
    }

    /// Advance the transport model by one timestep.
    ///
    /// # Arguments
    /// * `dt` - timestep in seconds
    /// * `device` - the tokamak device
    /// * `prog` - programmed waveform values at current time
    /// * `z_eff` - effective charge
    pub fn step(&mut self, dt: f64, device: &Device, prog: &ProgramValues, z_eff: f64) {
        let ip = prog.ip;
        let bt = prog.bt;

        if ip < 0.05 || bt < 0.1 {
            // No plasma yet
            self.w_th = 0.0;
            self.te0 = 0.01;
            self.ne0 = 0.01;
            self.ne_bar = 0.01;
            self.q95 = 100.0;
            self.beta_n = 0.0;
            self.beta_n_peak = 0.0;
            self.ip_peak = 0.0;
            self.beta_t = 0.0;
            self.tau_e = 0.001;
            self.p_input = 0.0;
            self.p_loss = 0.0;
            self.p_ohmic = 0.0;
            self.p_rad = 0.0;
            self.in_hmode = false;
            return;
        }

        let r0 = device.r0;
        let a = device.a;
        // Programmed (separatrix) elongation — the plasma *shape*.
        let kappa = prog.kappa;
        // Areal elongation κ_a = S/(πa²), which is what IPB98(y,2), the Uckan
        // q* formula and the poloidal cross-section area are defined against.
        // The programmed value ramps 1.0 → κ_sep, so the device ratio is
        // applied to preserve that ramp (see Device::areal_ratio).
        let kappa_a = kappa * device.areal_ratio();
        let volume = device.volume;
        let surface = device.surface_area;

        // ── Density evolution (relaxation to target + gas puffing) ──
        let ne_target = prog.ne_target;
        let tau_density = 0.3; // density response time (s)
        let ne_relaxation = (ne_target - self.ne_bar) * (1.0 - (-dt / tau_density).exp());
        // D2 gas puffing adds density source
        let fueling_eff = 0.1; // ~10% fueling efficiency (typical for gas puff)
        let ne_from_puff = prog.d2_puff * fueling_eff * dt / volume.max(1.0);
        self.ne_bar += ne_relaxation + ne_from_puff;
        self.ne_bar = self.ne_bar.max(0.01);
        // Central density peaking factor ~1.3
        self.ne0 = self.ne_bar * 1.3;

        // ── Impurity fraction evolution ──
        // Impurity (currently neon) accumulates from seeding, decays via particle transport
        let tau_impurity = 0.5; // impurity confinement time (s)
        let impurity_source = if self.ne_bar > 0.05 {
            prog.neon_puff * 0.3 / (self.ne_bar * volume).max(0.01)
        } else {
            0.0
        };
        self.impurity_fraction += (impurity_source - self.impurity_fraction / tau_impurity) * dt;
        self.impurity_fraction = self.impurity_fraction.clamp(0.0, 0.1); // max 10% impurity fraction

        // ── q95 ──
        // Cylindrical safety factor with elongation + triangularity correction.
        // Standard shape factor: f_s = (1 + κ²·(1 + 2δ² − 1.2δ³)) / 2
        // Without the δ correction, highly shaped plasmas (ITER: κ=2.1, δ=0.55)
        // get unrealistically low q95 values.
        let delta = prog.delta;
        let shape_factor =
            (1.0 + kappa_a * kappa_a * (1.0 + 2.0 * delta * delta - 1.2 * delta.powi(3))) / 2.0;
        self.q95 = 5.0 * a * a * bt * shape_factor / (r0 * ip);
        self.q95 = self.q95.max(1.0);

        // ── Internal inductance ──
        // (computed from Te profile shape in Simulation::step())

        // ── Greenwald fraction ──
        let n_greenwald = device.greenwald_density(ip);
        self.f_greenwald = self.ne_bar / n_greenwald;

        // ── Ohmic heating ──
        // Spitzer resistivity: η ∝ Z_eff * T_e^{-3/2}
        let te_avg = (self.te0 * 0.5).max(0.05); // rough volume average
        let eta = 2.8e-8 * z_eff / te_avg.powf(1.5); // Ω·m (approximate)
        let loop_length = 2.0 * std::f64::consts::PI * r0;
        // Poloidal cross-section area S = π a² κ_a — this is the *definition*
        // of the areal elongation, so κ_a is the correct factor here.
        let cross_section = std::f64::consts::PI * a * a * kappa_a;
        let resistance = eta * loop_length / cross_section; // Ω
        self.p_ohmic = resistance * (ip * 1e6).powi(2) * 1e-6; // MW
        self.p_ohmic = self.p_ohmic.min(5.0); // Cap for numerical stability

        // ── Alpha self-heating (0D estimate for burning plasma feedback) ──
        // Gamow-peak DT reactivity parameterization (valid 2–100 keV):
        //   <σv> ≈ 3.68e-18 · Ti^{-2/3} · exp(-19.94 · Ti^{-1/3})  m³/s
        // Matches NRL Plasma Formulary to within ~30% over 5–50 keV range.
        // Only significant for DT fuel (mass > 2.0) at fusion-relevant temperatures.
        let is_dt = device.mass_number > 2.0;
        self.p_alpha = if is_dt && self.te0 > 1.0 {
            let ti_eff = self.te0 * 0.70; // effective volume-averaged Ti ≈ 0.70 × Te0
            let ne_vol_m3 = self.ne_bar * 0.85 * 1e20; // volume-averaged ne (m⁻³)
            let f_fuel = (1.0 - self.impurity_fraction).max(0.5);
            let n_d = ne_vol_m3 * f_fuel / 2.0; // 50-50 D-T mix
            let n_t = n_d;

            // Bosch-Hale DT reactivity parameterization (m³/s, Ti in keV).
            // More accurate than the simplified Gamow-peak fit, especially
            // at intermediate temperatures (5–15 keV) relevant for JET/ITER.
            let ti = ti_eff.max(0.2).min(100.0);
            let bg2: f64 = 34.3827 * 34.3827;
            let mc2: f64 = 1124656.0;
            let (c1, c2, c3, c4, c5, c6, c7) = (
                1.17302e-9, 1.51361e-2, 7.51886e-2,
                4.60643e-3, 1.35e-2, -1.0675e-4, 1.366e-5,
            );
            let denom_bh = 1.0 + ti * (c3 + ti * (c5 + ti * c7));
            let numer_bh = ti * (c2 + ti * (c4 + ti * c6));
            let theta = ti / (1.0 - numer_bh / denom_bh);
            let xi = (bg2 / (4.0 * theta)).cbrt();
            let sigmav = c1 * theta * (xi / (mc2 * ti * ti * ti)).sqrt()
                * (-3.0 * xi).exp()
                * 1e-6; // cm³/s → m³/s

            let e_alpha_j = 3.52 * 1.602e-13; // alpha energy: 3.52 MeV → Joules
            let f_profile = 0.48; // profile peaking correction (<n²σv> / n_bar²·σv_bar)

            let p_alpha_w = n_d * n_t * sigmav * e_alpha_j * volume * f_profile; // Watts
            (p_alpha_w * 1e-6).max(0.0).min(500.0) // convert to MW, cap for numerical safety
        } else {
            0.0
        };

        // ── Total input power (includes alpha self-heating) ──
        self.p_input = self.p_ohmic + prog.p_nbi + prog.p_ech + prog.p_ich + self.p_alpha;

        // ── Radiation ──
        // Bremsstrahlung: P_brem ≈ 5.35e-37 * ne² * Zeff * Te^0.5 * V  (SI units)
        // Use volume-averaged density (ne_vol = 0.85 * ne_bar) since bremsstrahlung
        // is a volume integral, not a line integral.
        let ne_m3 = self.ne_bar * 0.85 * 1e20; // volume-averaged ne in m⁻³
        let p_brem = 5.35e-37 * ne_m3 * ne_m3 * z_eff * te_avg.sqrt() * volume * 1e-6; // MW
        // Intrinsic impurity radiation from wall material (carbon, tungsten).
        // In real tokamaks, edge/SOL impurities produce significant line
        // radiation even without intentional seeding, typically 15-30% of
        // total heating power. Rather than an ne²V-based model (which scales
        // poorly across machine sizes), we use a fraction of total loss power
        // calibrated to Zeff and edge temperature.
        // At Zeff=1.5: ~15% radiative fraction; at Zeff=2.0: ~25%.
        // Scale intrinsic radiation with external heating power (not alpha),
        // since wall impurity sources depend on plasma-wall interaction, not
        // fusion power. Gives ~10-20% of P_external as intrinsic radiation.
        let p_external = self.p_ohmic + prog.p_nbi + prog.p_ech + prog.p_ich;
        let rad_fraction_intrinsic = 0.10 * (z_eff - 1.0).max(0.2) + 0.05;
        let p_intrinsic = rad_fraction_intrinsic * p_external.max(0.01);
        // Line radiation (residual, on top of intrinsic)
        let p_line = p_brem * 0.15 * (z_eff - 1.0).max(0.0);
        // Impurity radiation — effective 0D Lz coefficient.
        // Physical Lz(Ne) peaks at ~5e-31 W·m³ near 0.5 keV, but in real tokamaks
        // neon concentrates in the edge/SOL, not the core volume. For our volume-
        // averaged model, we use ~50x lower effective Lz so that realistic seeding
        // rates (0.3–0.7 × 10²⁰/s) produce a few MW of radiation, not hundreds.
        // (Future: Lz becomes species-dependent for argon, krypton, nitrogen, etc.)
        //
        // The low-temperature branch below is unchanged (it is what DIII-D and
        // JET were calibrated against), but it cannot be extrapolated upward:
        // as written it makes Lz *increase* without limit with temperature,
        // which is backwards. Neon is fully stripped above ~2 keV and its
        // cooling rate falls off steeply — only bremsstrahlung remains, and
        // that is already accounted for in p_brem above.
        //
        // Without the roll-off, SPARC (⟨Te⟩ ≈ 8 keV) radiates ~8 MW from a
        // neon fraction of only 1×10⁻⁴ and collapses out of H-mode; ITER at
        // ⟨Te⟩ ≈ 12 keV is overestimated by a similar factor. The roll-off is
        // continuous at 2 keV so nothing below that changes.
        let lz_low_t = 1.0e-32 * (1.0 + 0.5 * (te_avg - 1.0).abs()).max(0.5);
        let lz_impurity = if te_avg > 2.0 {
            lz_low_t * (2.0 / te_avg).powf(1.5)
        } else {
            lz_low_t
        };
        // Radiative collapse: radiation mantle moves inward at high impurity fraction
        let imp = &device.impurity_elm;
        let collapse_factor = if self.impurity_fraction > imp.impurity_collapse_threshold {
            let excess = (self.impurity_fraction - imp.impurity_collapse_threshold)
                / imp.impurity_collapse_threshold;
            1.0 + 5.0 * excess
        } else {
            1.0
        };
        let p_impurity = self.impurity_fraction * ne_m3 * ne_m3 * lz_impurity * collapse_factor * volume * 1e-6; // MW
        self.p_rad = p_brem + p_intrinsic + p_line + p_impurity;
        self.p_rad = self.p_rad.max(0.0);

        // ── L-H transition threshold ──
        // Martin 2008 scaling: P_LH = 0.0488 * ne20^0.717 * Bt^0.803 * S^0.941
        // Device-specific p_lh_factor corrects for isotope effects (D-T ≈ 0.8×)
        // and known overestimation at large surface areas (ITER).
        self.p_lh_threshold =
            0.0488 * self.ne_bar.powf(0.717) * bt.powf(0.803) * surface.powf(0.941)
            * device.p_lh_factor;

        // ── H-mode / NT-edge logic ──
        let net_heating = self.p_input - self.p_rad;
        let ne_gw = device.greenwald_density(ip);
        let delta_avg = (device.delta_upper + device.delta_lower) / 2.0;
        let is_nt = delta_avg < -0.2;

        if is_nt {
            // Negative triangularity "NT-edge" mode: confinement between L-mode
            // and H-mode, fully ELM-free. Destabilized ballooning modes increase
            // edge transport, giving ~60-70% of H-mode confinement without an
            // edge transport barrier.
            // in_hmode stays FALSE — prevents ELMs and DT H-mode boost.
            self.in_hmode = false;
            let min_ne = 0.15 * ne_gw.max(0.3);
            if ip >= 0.2 * device.ip_max && self.ne_bar > min_ne && net_heating > 0.5 {
                // NT-edge: ~65% of H-mode confinement (DIII-D NT experiments)
                self.h_factor = 0.65;
            } else {
                self.h_factor = 0.5;
            }
        } else {
            // Standard positive-δ H-mode via L-H power threshold
            let min_ne_for_hmode = 0.20 * ne_gw.max(0.5);
            if !self.in_hmode {
                if net_heating > self.p_lh_threshold && self.q95 > 2.5
                    && ip >= 0.3 * device.ip_max
                    && self.ne_bar > min_ne_for_hmode {
                    self.in_hmode = true;
                    self.h_factor = 1.0;
                    self.elm_timer = 0.0;
                }
            } else {
                // Hysteretic back-transition: sustaining H-mode needs less
                // power than entering it (see Device::h_mode_sustain_factor).
                if net_heating < device.h_mode_sustain_factor * self.p_lh_threshold
                    || self.q95 < 2.0 {
                    self.in_hmode = false;
                    self.h_factor = 0.5;
                }
            }
        }

        // ── Energy confinement time (IPB98(y,2)) ──
        let p_total_mw = self.p_input.max(0.01);
        let ne19 = self.ne_bar * 10.0; // convert 10²⁰ → 10¹⁹
        let mass = device.mass_number;
        let eps = a / r0;

        self.tau_e = 0.0562 * ip.powf(0.93) * bt.powf(0.15) * ne19.powf(0.41)
            * p_total_mw.powf(-0.69)
            * r0.powf(1.97)
            * eps.powf(0.58)
            * kappa_a.powf(0.78) // IPB98(y,2) is defined with the areal elongation
            * mass.powf(0.19);

        // Triangularity correction to confinement (not in IPB98).
        // Higher δ stabilizes edge MHD, broadens pressure profile, and
        // improves energy confinement. Experimental scaling from DIII-D,
        // JET, ASDEX-U suggests ~10-15% improvement from δ=0.2 to δ=0.6
        // in H-mode. For positive δ only; NT plasmas handle this separately.
        if self.in_hmode {
            let delta_ref = 0.40; // reference triangularity (typical H-mode)
            let delta_correction = 1.0 + 0.20 * (delta - delta_ref);
            self.tau_e *= delta_correction.clamp(0.92, 1.10);
        }

        // DT isotope confinement enhancement beyond IPB98 M^0.19 scaling.
        // IPB98 already includes M^0.19 which gives ~1.19× for DT (M=2.5)
        // vs DD (M=2.0).  JET DTE2/TFTR showed ~40% total improvement,
        // but much of this is now captured by the calibrated alpha self-
        // heating (fix 3).  A modest 1.10× residual accounts for effects
        // beyond alpha heating (e.g., isotope mass effect on turbulence).
        // Total DT advantage: 1.19 (M^0.19) × 1.10 = 1.31× on tau_E,
        // plus strong alpha self-heating feedback on Te and W_th.
        if device.mass_number > 2.0 && self.in_hmode {
            self.tau_e *= 1.10;
        }

        // NT-edge DT isotope effect: modest, no pedestal to boost.
        // Only the mass dependence beyond IPB98 M^0.19.
        if is_nt && self.h_factor > 0.55 && device.mass_number > 2.0 {
            self.tau_e *= 1.05;
        }

        // Track peak Ip for rampdown detection
        if ip > self.ip_peak {
            self.ip_peak = ip;
        }
        // Rampdown confinement degradation: as Ip drops below its peak,
        // edge transport barrier weakens and confinement degrades toward
        // L-mode. This prevents β_N and Q from spiking during rampdown
        // because W_th decays faster as confinement drops.
        let mut h_eff = self.h_factor;
        if self.ip_peak > 0.5 && ip < 0.90 * self.ip_peak {
            // Linear degradation from current h_factor toward 0.4 (below L-mode)
            // as Ip drops from 90% to 30% of peak
            let ramp_frac = ((ip / self.ip_peak) - 0.30).max(0.0) / 0.60;
            h_eff = 0.4 + (self.h_factor - 0.4) * ramp_frac;
        }

        // Confinement mode multiplier
        self.tau_e *= h_eff;

        // Device-specific confinement correction (wall conditioning, NBI
        // geometry, divertor closure, etc.)
        self.tau_e *= device.confinement_factor;

        // QCE / small-ELM penalty. Staying type-I ELM-free means holding the
        // pedestal below the peeling-ballooning limit, which costs pedestal
        // pressure and so global confinement. Uses the suppression flag from
        // the previous step (set at the end of this same function) — the lag
        // is one dt, which is negligible against τ_E.
        if self.elm_suppressed {
            self.tau_e *= device.qce_confinement_factor;
        }

        self.tau_e = self.tau_e.max(0.001);

        // ── Power balance: dW/dt = P_input - W/τ_E - P_rad ──
        let p_loss_conduction = self.w_th / self.tau_e;
        self.p_loss = p_loss_conduction + self.p_rad;

        let dw_dt = self.p_input - self.p_loss;
        self.w_th += dw_dt * dt;
        self.w_th = self.w_th.max(0.0);

        // ── ELM model (Type-I / Type-II ELMs in H-mode, with neon suppression) ──
        //
        // Type I: Low frequency (5–25 Hz), large energy crashes (5–13% W_th),
        //         distinct Dα spikes. Standard H-mode with no/low impurity seeding.
        // Type II: High frequency (80–200 Hz), small crashes (0.5–1.5% W_th),
        //          "grassy" Dα. Partial neon seeding approaching suppression.
        // Suppressed: QCE regime with continuous small losses, no ELM crashes.
        //
        // Stochasticity: each ELM period and amplitude are randomly jittered
        // to produce realistic irregular timing as seen in experiment.

        // Decrement display cooldown — keeps elm_active AND elm_type nonzero
        // for a few timesteps so the animation frame loop reliably captures
        // the ELM event (Dα spike, label, portview flash, divertor heat).
        if self.elm_cooldown > 0.0 {
            self.elm_cooldown -= dt;
            if self.elm_cooldown <= 0.0 {
                // Cooldown expired — clear everything
                self.elm_active = false;
                self.elm_type = 0;
                self.elm_energy_loss = 0.0;
                self.elm_ped_crash_frac = 0.0;
            }
            // else: keep elm_active, elm_type, elm_energy_loss from the triggering step
        } else {
            self.elm_active = false;
            self.elm_type = 0;
            self.elm_energy_loss = 0.0;
            self.elm_ped_crash_frac = 0.0;
        }

        // Determine ELM regime based on impurity level, q95, and shaping
        let imp = &device.impurity_elm;
        // Two independent routes into the ELM-suppressed (QCE) window:
        //
        //   1. Seeding route — impurity radiation cools the pedestal below the
        //      peeling-ballooning limit. This is the original behaviour and is
        //      what DIII-D / JET / ITER / CENTAUR use.
        //   2. Density route — high separatrix density at high shaping drives
        //      the pedestal foot ballooning-unstable, and continuous filaments
        //      replace Type-I crashes (Faitsch/Harrer, AUG + JET; access at a
        //      separatrix density of 0.3–0.4 n_GW). This is the physically
        //      dominant path and the one SPARC uses.
        //
        // Seeding is not free for the density route: radiating power out of
        // the SOL depresses n_e,sep and therefore *costs* QCE access
        // (Lomanowski et al. 2026 for SPARC). Past `qce_impurity_ceiling` the
        // large ELMs come back — the divertor-protection and regime-access
        // knobs genuinely compete.
        let qce_by_seeding = self.impurity_fraction >= imp.impurity_qce_threshold;

        // The density needed for QCE is not fixed — it rises with the power
        // crossing the separatrix. QCE and EDA sit at *higher* fuelling as the
        // heating goes up (AUG: EDA at lower separatrix density and power, QCE
        // at higher), and if the power outruns the fuelling the pedestal climbs
        // back to the peeling-ballooning limit and Type-I ELMs return.
        //
        // The L-H threshold is the natural power scale to normalise against,
        // so the requirement is expressed relative to it. Consequence in the
        // control room: turning the ICRF up past the QCE window brings the
        // large ELMs back, which is the intended discovery.
        let power_ratio = if self.p_lh_threshold > 0.1 {
            (net_heating / self.p_lh_threshold).max(0.5)
        } else {
            1.0
        };
        // Exponent 0.65 (was 0.35): at 0.35 the required density rose so
        // weakly with power that even 25 MW held all pulse stayed inside the
        // QCE window ((25 MW net + alphas)/P_LH ≈ 1.2 → needed 0.446 <
        // operating 0.461), erasing the intended "turn the RF up and the
        // ELMs come back" behavior. At 0.65 the full-power burning case
        // (ratio ≈ 1.2) needs f_GW ≈ 0.475 — above the operating point once
        // the alphas build — while the nominal 17 MW flat-top (ratio ≈ 0.76
        // → needed ≈ 0.35) keeps a wide margin, and the brief 24 MW entry
        // transient (ratio ≈ 1.1, alphas still small) stays just inside so
        // QCE engages as soon as the fuelling ramp tops out. The exponent is
        // a scenario-calibration knob, not a published number.
        let fgw_needed = imp.qce_fgw_threshold * power_ratio.powf(0.65);
        let qce_by_density = self.f_greenwald >= fgw_needed;
        let qce_starved = self.impurity_fraction > imp.qce_impurity_ceiling;
        let in_qce_window = (qce_by_seeding || qce_by_density)
            && prog.delta >= imp.delta_grassy_min
            && !qce_starved;

        self.elm_suppressed = self.in_hmode && in_qce_window;
        let elm_regime: u8 = if !self.in_hmode {
            0 // No ELMs outside H-mode
        } else if in_qce_window {
            0 // Suppressed → QCE
        } else if self.impurity_fraction >= imp.impurity_type2_threshold
            && self.q95 >= imp.q95_grassy_range.0
            && self.q95 <= imp.q95_grassy_range.1
            && prog.delta >= imp.delta_grassy_min
        {
            2 // Type II (grassy) — requires impurity + specific q95 window + shaping
        } else {
            1 // Type I (standard large ELMs)
        };

        if elm_regime > 0 {
            self.elm_timer += dt;
            let power_excess = (net_heating / self.p_lh_threshold - 1.0).max(0.0);

            // Impurity degradation factor: reduces Type I frequency as impurity
            // approaches the Type II transition threshold (pedestal cooling effect)
            let impurity_degradation = if self.impurity_fraction > imp.impurity_type1_onset {
                let frac = ((self.impurity_fraction - imp.impurity_type1_onset)
                    / (imp.impurity_type2_threshold - imp.impurity_type1_onset))
                    .clamp(0.0, 1.0);
                1.0 - 0.7 * frac // frequency drops to 30% before Type II transition
            } else {
                1.0
            };

            // Pre-compute jittered period for the next ELM cycle if needed
            if self.elm_next_period <= 0.0 {
                // Machine-size scaling: ELM frequency ∝ 1/τ_E because the pedestal
                // pressure gradient rebuilds on the energy confinement timescale.
                // Normalized to DIII-D reference (τ_E ≈ 0.1s):
                //   DIII-D: factor=1.0, freq=5–25 Hz (correct)
                //   ITER:   factor≈0.04, freq≈0.2–1.0 Hz (matches 1–3 Hz expected)
                //   JET:    factor≈0.15, freq≈0.8–4 Hz (reasonable)
                let tau_e_scale = (0.1 / self.tau_e.max(0.01)).min(1.0);
                let (mean_freq, jitter_frac) = if elm_regime == 1 {
                    // Type I: 5–25 Hz (at DIII-D scale), ±15% timing jitter
                    // Impurity seeding degrades pedestal → lengthens inter-ELM period
                    ((5.0 + 20.0 * power_excess.min(1.0)) * impurity_degradation * tau_e_scale, 0.15)
                } else {
                    // Type II: 80–200 Hz (at DIII-D scale), ±50% timing jitter
                    ((80.0 + 120.0 * power_excess.min(1.0)) * tau_e_scale, 0.5)
                };
                let mean_period = 1.0 / mean_freq;
                let rng_val = self.next_rng(); // 0..1
                let jitter = 1.0 + (rng_val - 0.5) * 2.0 * jitter_frac;
                self.elm_next_period = (mean_period * jitter).max(0.002);
            }

            if self.elm_timer > self.elm_next_period {
                self.elm_timer = 0.0;
                self.elm_next_period = 0.0; // recompute with fresh jitter next cycle

                self.elm_active = true;
                let rng_amp = self.next_rng(); // 0..1 for amplitude jitter

                if elm_regime == 1 {
                    // Type I: large crash, 10 ms cooldown for distinct display spikes
                    self.elm_type = 1;
                    self.elm_cooldown = 0.010;
                    let elm_fraction = (0.05 + 0.08 * power_excess.min(1.0))
                        * (0.97 + 0.06 * rng_amp); // ±3% amplitude variation — uniform ELM crashes
                    self.elm_energy_loss = elm_fraction * self.w_th;
                    self.elm_ped_crash_frac = elm_fraction * 1.5; // pedestal crash > global
                    self.w_th *= 1.0 - elm_fraction;
                    // ELM particle loss: ΔN/N is ~15% of ΔW/W for Type I.
                    // Real ELM particle losses are small vs total inventory;
                    // fueling easily compensates so ne_bar trends monotonically.
                    self.ne_bar *= 1.0 - elm_fraction * 0.15;
                } else {
                    // Type II: small crash, 2 ms cooldown for grassy appearance
                    self.elm_type = 2;
                    self.elm_cooldown = 0.002;
                    let elm_fraction = (0.005 + 0.01 * power_excess.min(1.0))
                        * (0.6 + 0.8 * rng_amp); // wider amplitude variation
                    self.elm_energy_loss = elm_fraction * self.w_th;
                    self.elm_ped_crash_frac = elm_fraction * 1.2; // pedestal crash > global
                    self.w_th *= 1.0 - elm_fraction;
                    // ELM particle loss (smaller for Type II)
                    self.ne_bar *= 1.0 - elm_fraction * 0.10;
                }
            }
        } else if self.elm_suppressed {
            // QCE regime: continuous small transport replaces ELM crashes
            let qce_loss_rate = 0.005; // fraction per tau_E equivalent
            let qce_loss = qce_loss_rate * self.w_th * dt / self.tau_e.max(0.01);
            self.w_th -= qce_loss;
            self.w_th = self.w_th.max(0.0);
        }

        // ── Derive temperatures from stored energy ──
        // W [MJ] = 3 * ne [10²⁰ m⁻³] * Te [keV] * V [m³] * 1.602e-2
        //   (factor = 10²⁰ * 1.602e-16 J/keV * 1e-6 MJ/J = 1.602e-2)
        // Assume Ti ≈ Te, ni ≈ ne
        let ne_vol = self.ne_bar * 0.85; // volume average < line average
        let te_avg_from_w = if ne_vol > 0.01 {
            self.w_th / (3.0 * ne_vol * volume * 1.602e-2)
        } else {
            0.01
        };
        // Central Te with peaking factor ~2.0.
        // This is consistent with the tanh-pedestal profile shape where
        // Te_ped/Te0 ~ 0.35-0.45 and the volume-averaged Te is roughly
        // Te0 / 2.0. Using a value consistent with the profile shapes
        // ensures that Te(0) in the trace panel matches the profiles.
        self.te0 = (te_avg_from_w * 2.0).max(0.01);

        // ── Beta values ──
        // <p> = 2 * ne [10²⁰ m⁻³] * Te [keV] * 1.602e4  (Pa)
        //   (factor = 10²⁰ * 1.602e-16 J/keV = 1.602e4 Pa per keV·10²⁰m⁻³)
        let p_avg = 2.0 * ne_vol * te_avg_from_w * 1.602e4; // Pa
        let mu0 = 4.0 * std::f64::consts::PI * 1e-7;
        let b_pressure = bt * bt / (2.0 * mu0);
        self.beta_t = (p_avg / b_pressure * 100.0).max(0.0); // percent
        // β_N = beta_t * a * Bt / Ip. During rampdown, Ip drops faster
        // than W_th decays, causing a 1/Ip divergence. To prevent this:
        // 1. Fade β_N as Ip drops below 80% of peak (rampdown detection)
        // 2. Zero β_N below 10% of peak (near-zero Ip)
        // 3. Cap at the peak achieved during flat-top
        let ip_threshold = if self.ip_peak > 0.5 { self.ip_peak * 0.10 } else { 0.05 };
        let raw_beta_n = if ip > ip_threshold {
            self.beta_t * a * bt / ip  // %·m·T/MA
        } else {
            0.0
        };
        // Fade β_N during rampdown: suppress the 1/Ip divergence smoothly
        let ip_fade = if self.ip_peak > 0.5 {
            ((ip / self.ip_peak - 0.10) / 0.70).clamp(0.0, 1.0)
        } else {
            1.0
        };
        let clamped = (raw_beta_n * ip_fade).min(4.0);
        // Rate limiter: max +0.01 per 5ms step = +2/s (slow enough to prevent spikes)
        let max_rise = self.beta_n + 0.01;
        let new_beta_n = clamped.min(max_rise).max(0.0);
        // Track peak only during flat-top (Ip near peak)
        if new_beta_n > self.beta_n_peak && ip > self.ip_peak * 0.90 {
            self.beta_n_peak = new_beta_n;
        }
        // Cap at peak to prevent rampdown overshoot
        self.beta_n = new_beta_n.min(self.beta_n_peak);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::devices;

    #[test]
    fn test_initial_state() {
        let t = TransportModel::default();
        assert_eq!(t.w_th, 0.0);
        assert!(!t.in_hmode);
    }

    #[test]
    fn test_ohmic_rampup() {
        let device = devices::diiid();
        let mut transport = TransportModel::default();

        // Ramp current with no external heating
        let prog = ProgramValues {
            ip: 1.0,
            bt: 2.0,
            ne_target: 0.3,
            p_nbi: 0.0,
            p_ech: 0.0,
            p_ich: 0.0,
            kappa: 1.75,
            delta: 0.35,
            d2_puff: 0.0,
            neon_puff: 0.0,
        };

        // Run for 100ms
        for _ in 0..100 {
            transport.step(0.001, &device, &prog, 1.5);
        }

        // Should have some stored energy from ohmic heating
        assert!(transport.w_th > 0.0, "Should have stored energy");
        assert!(transport.p_ohmic > 0.0, "Should have ohmic heating");
        assert!(transport.te0 > 0.1, "Should have heated up");
        assert!(transport.q95 > 2.0, "q95 should be reasonable");
    }

    #[test]
    fn test_hmode_transition() {
        let device = devices::diiid();
        let mut transport = TransportModel::default();

        // High power scenario
        let prog = ProgramValues {
            ip: 1.5,
            bt: 2.0,
            ne_target: 0.5,
            p_nbi: 5.0,
            p_ech: 0.0,
            p_ich: 0.0,
            kappa: 1.75,
            delta: 0.35,
            d2_puff: 0.0,
            neon_puff: 0.0,
        };

        // Run for 2 seconds
        for _ in 0..2000 {
            transport.step(0.001, &device, &prog, 1.5);
        }

        // With 5 MW NBI on DIII-D at 1.5 MA, should transition to H-mode
        assert!(
            transport.in_hmode,
            "Should be in H-mode with 5MW NBI. P_input={:.2}, P_LH={:.2}",
            transport.p_input,
            transport.p_lh_threshold
        );
    }

    #[test]
    fn test_iter_parameters() {
        let device = devices::iter();
        let mut transport = TransportModel::default();

        let prog = ProgramValues {
            ip: 15.0,
            bt: 5.3,
            ne_target: 1.0,
            p_nbi: 33.0,
            p_ech: 20.0,
            p_ich: 0.0,
            kappa: 1.7,
            delta: 0.33,
            d2_puff: 0.0,
            neon_puff: 0.0,
        };

        // Run to quasi-steady-state
        for _ in 0..10000 {
            transport.step(0.001, &device, &prog, 1.7);
        }

        // ITER should achieve ~350 MJ stored energy at full parameters
        // Our simple model won't be exact, but should be order-of-magnitude
        assert!(transport.w_th > 10.0, "ITER should have significant stored energy: {}", transport.w_th);
        assert!(transport.tau_e > 1.0, "ITER τ_E should be > 1s: {}", transport.tau_e);
    }

    #[test]
    fn test_greenwald_fraction() {
        let device = devices::diiid();
        let mut transport = TransportModel::default();

        let prog = ProgramValues {
            ip: 1.0,
            bt: 2.0,
            ne_target: 0.8,
            p_nbi: 3.0,
            kappa: 1.75,
            delta: 0.35,
            ..Default::default()
        };

        for _ in 0..1000 {
            transport.step(0.001, &device, &prog, 1.5);
        }

        // Greenwald density for 1 MA on DIII-D ≈ 0.71 × 10²⁰ m⁻³
        // At ne_target = 0.8, fGW should be > 1
        assert!(transport.f_greenwald > 0.0);
    }

    #[test]
    fn test_alpha_heating_iter() {
        // Verify the alpha heating formula produces correct power levels for
        // ITER-class DT plasmas by pre-loading the transport state to
        // fusion-relevant conditions, then stepping once to compute p_alpha.
        let mut device = devices::iter();
        device.mass_number = 2.5; // DT fuel required for alpha heating
        let mut transport = TransportModel::default();

        // Pre-load state: ITER H-mode flat-top conditions
        // (Te0 ~15 keV, ne ~1.0 × 10²⁰ m⁻³, ~200 MJ stored energy)
        transport.te0 = 15.0;
        transport.ne_bar = 1.0;
        transport.w_th = 200.0;
        transport.in_hmode = true;
        transport.h_factor = 1.0;

        let prog = ProgramValues {
            ip: 15.0,
            bt: 5.3,
            ne_target: 1.0,
            p_nbi: 33.0,
            p_ech: 20.0,
            p_ich: 0.0,
            kappa: 1.7,
            delta: 0.33,
            d2_puff: 0.0,
            neon_puff: 0.0,
        };

        // Single step to compute alpha power at these conditions
        transport.step(0.001, &device, &prog, 1.7);

        // At Te0=15 keV, ne=1×10²⁰, ITER DT should produce substantial alpha power.
        // Expected: Ti_eff ≈ 9.75 keV → <σv> ≈ 6e-23 m³/s → P_alpha ≈ 20-80 MW
        assert!(
            transport.p_alpha > 10.0,
            "ITER DT at Te0=15 keV should produce >10 MW alpha, got {:.2} MW",
            transport.p_alpha,
        );
        assert!(
            transport.p_alpha < 500.0,
            "Alpha power should be below 500 MW cap, got {:.2} MW",
            transport.p_alpha,
        );
    }

    #[test]
    fn test_no_alpha_heating_dd() {
        // DIII-D with DD fuel (mass_number=2.0) should have zero alpha heating.
        let device = devices::diiid();
        let mut transport = TransportModel::default();

        let prog = ProgramValues {
            ip: 1.5,
            bt: 2.1,
            ne_target: 0.6,
            p_nbi: 5.0,
            p_ech: 0.0,
            p_ich: 0.0,
            kappa: 1.75,
            delta: 0.35,
            d2_puff: 0.0,
            neon_puff: 0.0,
        };

        // Run for a few seconds
        for _ in 0..5000 {
            transport.step(0.001, &device, &prog, 1.5);
        }

        // DD fuel (mass_number=2.0) should NOT produce alpha heating
        assert!(
            transport.p_alpha < 0.001,
            "DIII-D DD should have negligible alpha heating, got {:.4} MW",
            transport.p_alpha,
        );
    }
}
