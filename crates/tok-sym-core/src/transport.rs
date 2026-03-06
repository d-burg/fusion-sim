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
    /// L-H transition power threshold (MW)
    pub p_lh_threshold: f64,
    /// H-mode confinement enhancement factor
    pub h_factor: f64,
    /// Toroidal beta (%)
    pub beta_t: f64,
    /// Normalized beta
    pub beta_n: f64,
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
            p_lh_threshold: 1.0,
            h_factor: 0.5,
            beta_t: 0.0,
            beta_n: 0.0,
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
        let kappa = prog.kappa;
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
        // Cylindrical safety factor with shape correction
        self.q95 = 5.0 * a * a * bt * (1.0 + kappa * kappa) / (2.0 * r0 * ip);
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
        let cross_section = std::f64::consts::PI * a * a * kappa;
        let resistance = eta * loop_length / cross_section; // Ω
        self.p_ohmic = resistance * (ip * 1e6).powi(2) * 1e-6; // MW
        self.p_ohmic = self.p_ohmic.min(5.0); // Cap for numerical stability

        // ── Total input power ──
        self.p_input = self.p_ohmic + prog.p_nbi + prog.p_ech + prog.p_ich;

        // ── Radiation ──
        // Bremsstrahlung: P_brem ≈ 5.35e-37 * ne² * Zeff * Te^0.5 * V  (SI units)
        let ne_m3 = self.ne_bar * 1e20; // convert to m⁻³
        let p_brem = 5.35e-37 * ne_m3 * ne_m3 * z_eff * te_avg.sqrt() * volume * 1e-6; // MW
        // Line radiation (simplified: proportional to ne² at low Te)
        let p_line = p_brem * 0.3 * (z_eff - 1.0).max(0.0);
        // Impurity radiation — effective 0D Lz coefficient.
        // Physical Lz(Ne) peaks at ~5e-31 W·m³ near 0.5 keV, but in real tokamaks
        // neon concentrates in the edge/SOL, not the core volume. For our volume-
        // averaged model, we use ~50x lower effective Lz so that realistic seeding
        // rates (0.3–0.7 × 10²⁰/s) produce a few MW of radiation, not hundreds.
        // (Future: Lz becomes species-dependent for argon, krypton, nitrogen, etc.)
        let lz_impurity = 1.0e-32 * (1.0 + 0.5 * (te_avg - 1.0).abs()).max(0.5);
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
        self.p_rad = p_brem + p_line + p_impurity;
        self.p_rad = self.p_rad.max(0.0);

        // ── L-H transition threshold ──
        // Martin 2008 scaling: P_LH = 0.0488 * ne20^0.717 * Bt^0.803 * S^0.941
        self.p_lh_threshold =
            0.0488 * self.ne_bar.powf(0.717) * bt.powf(0.803) * surface.powf(0.941);

        // ── H-mode logic ──
        let net_heating = self.p_input - self.p_rad;
        if !self.in_hmode {
            // L → H transition
            if net_heating > self.p_lh_threshold && self.q95 > 2.5 && ip > 0.3 {
                self.in_hmode = true;
                self.h_factor = 1.0;
                self.elm_timer = 0.0;
            }
        } else {
            // H → L back-transition
            if net_heating < 0.8 * self.p_lh_threshold || self.q95 < 2.0 {
                self.in_hmode = false;
                self.h_factor = 0.5;
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
            * kappa.powf(0.78)
            * mass.powf(0.19);

        // Confinement mode multiplier: L-mode = 0.5 (IPB98 is H-mode reference), H-mode = 1.0
        self.tau_e *= self.h_factor;
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

        // Decrement display cooldown — keeps elm_active true for a few timesteps
        // so the animation frame loop reliably captures the ELM event.
        if self.elm_cooldown > 0.0 {
            self.elm_cooldown -= dt;
            self.elm_active = self.elm_cooldown > 0.0;
        } else {
            self.elm_active = false;
        }
        self.elm_energy_loss = 0.0;
        self.elm_ped_crash_frac = 0.0;
        self.elm_type = 0;

        // Determine ELM regime based on impurity level, q95, and shaping
        let imp = &device.impurity_elm;
        self.elm_suppressed = self.in_hmode
            && self.impurity_fraction >= imp.impurity_qce_threshold
            && prog.delta >= imp.delta_grassy_min;
        let elm_regime: u8 = if !self.in_hmode {
            0 // No ELMs outside H-mode
        } else if self.impurity_fraction >= imp.impurity_qce_threshold
            && prog.delta >= imp.delta_grassy_min
        {
            0 // Suppressed → QCE (requires sufficient impurity + strong shaping)
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
                let (mean_freq, jitter_frac) = if elm_regime == 1 {
                    // Type I: 5–25 Hz, ±30% timing jitter
                    // Impurity seeding degrades pedestal → lengthens inter-ELM period
                    ((5.0 + 20.0 * power_excess.min(1.0)) * impurity_degradation, 0.3)
                } else {
                    // Type II: 80–200 Hz, ±50% timing jitter
                    (80.0 + 120.0 * power_excess.min(1.0), 0.5)
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
                        * (0.8 + 0.4 * rng_amp); // ±20% amplitude variation
                    self.elm_energy_loss = elm_fraction * self.w_th;
                    self.elm_ped_crash_frac = elm_fraction * 2.5; // amplified for pedestal
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
                    self.elm_ped_crash_frac = elm_fraction * 2.0; // amplified for pedestal
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
        // Central Te with peaking factor ~2
        self.te0 = (te_avg_from_w * 2.0).max(0.01);

        // ── Beta values ──
        // <p> = 2 * ne [10²⁰ m⁻³] * Te [keV] * 1.602e4  (Pa)
        //   (factor = 10²⁰ * 1.602e-16 J/keV = 1.602e4 Pa per keV·10²⁰m⁻³)
        let p_avg = 2.0 * ne_vol * te_avg_from_w * 1.602e4; // Pa
        let mu0 = 4.0 * std::f64::consts::PI * 1e-7;
        let b_pressure = bt * bt / (2.0 * mu0);
        self.beta_t = (p_avg / b_pressure * 100.0).max(0.0); // percent
        self.beta_n = if ip > 0.05 {
            // Clamp to Troyon no-wall limit to prevent nonphysical spikes during rampdown
            (self.beta_t * a * bt / ip).min(4.0) // %·m·T/MA
        } else {
            0.0
        };
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
}
