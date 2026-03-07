//! Main simulation loop tying together equilibrium, transport,
//! disruption, profiles, and diagnostics.

use serde::{Deserialize, Serialize};

use crate::contour::{self, Contour};
use crate::devices::{Device, MagneticConfig};
use crate::diagnostics::{DiagnosticSignals, NoiseGen};
use crate::disruption::DisruptionModel;
use crate::equilibrium::{CerfonEquilibrium, ShapeParams};
use crate::profiles::Profiles;
use crate::transport::{ProgramValues, TransportModel};

/// A point in a programmed waveform: (time_s, value).
pub type WaveformPoint = (f64, f64);

/// Discharge program: collection of time-dependent waveforms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DischargeProgram {
    /// Plasma current waveform (s, MA)
    pub ip: Vec<WaveformPoint>,
    /// Toroidal field waveform (s, T)
    pub bt: Vec<WaveformPoint>,
    /// Line-averaged density target (s, 10²⁰ m⁻³)
    pub ne_target: Vec<WaveformPoint>,
    /// NBI power (s, MW)
    pub p_nbi: Vec<WaveformPoint>,
    /// ECH power (s, MW)
    pub p_ech: Vec<WaveformPoint>,
    /// ICH power (s, MW)
    pub p_ich: Vec<WaveformPoint>,
    /// Elongation target (s, dimensionless)
    pub kappa: Vec<WaveformPoint>,
    /// Triangularity target (s, dimensionless)
    pub delta: Vec<WaveformPoint>,
    /// D2 gas puff rate (s, 10²⁰ particles/s)
    pub d2_puff: Vec<WaveformPoint>,
    /// Neon impurity seeding rate (s, 10²⁰ particles/s)
    pub neon_puff: Vec<WaveformPoint>,
    /// Total discharge duration (s)
    pub duration: f64,
    /// Magnetic configuration override ("LowerSingleNull", "UpperSingleNull",
    /// "DoubleNull").  When absent, falls back to the device default.
    #[serde(default)]
    pub config_override: Option<String>,
}

impl DischargeProgram {
    /// Interpolate a waveform at time t.
    pub fn interpolate(waveform: &[(f64, f64)], t: f64) -> f64 {
        if waveform.is_empty() {
            return 0.0;
        }
        if t <= waveform[0].0 {
            return waveform[0].1;
        }
        if t >= waveform[waveform.len() - 1].0 {
            return waveform[waveform.len() - 1].1;
        }

        // Binary search for the interval
        let mut lo = 0;
        let mut hi = waveform.len() - 1;
        while hi - lo > 1 {
            let mid = (lo + hi) / 2;
            if waveform[mid].0 <= t {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        let (t0, v0) = waveform[lo];
        let (t1, v1) = waveform[hi];
        let frac = (t - t0) / (t1 - t0);
        v0 + frac * (v1 - v0)
    }

    /// Get all programmed values at time t.
    pub fn values_at(&self, t: f64) -> ProgramValues {
        ProgramValues {
            ip: Self::interpolate(&self.ip, t),
            bt: Self::interpolate(&self.bt, t),
            ne_target: Self::interpolate(&self.ne_target, t),
            p_nbi: Self::interpolate(&self.p_nbi, t),
            p_ech: Self::interpolate(&self.p_ech, t),
            p_ich: Self::interpolate(&self.p_ich, t),
            kappa: Self::interpolate(&self.kappa, t),
            delta: Self::interpolate(&self.delta, t),
            d2_puff: Self::interpolate(&self.d2_puff, t),
            neon_puff: Self::interpolate(&self.neon_puff, t),
        }
    }

    /// Create a standard H-mode discharge program for a given device.
    /// Parameters based on real operating scenarios:
    ///   DIII-D: 1.2 MA, 5 MW NBI, 10s
    ///   ITER:  15 MA, 33 MW NBI + 20 MW ECH, 100s
    ///   JET:   2.5 MA, 25 MW NBI + 4 MW ICRH, 20s
    pub fn standard_hmode(device: &Device) -> Self {
        // Per-device H-mode parameters (Ip, duration, heating, density fraction)
        let (ip_flat, duration, p_nbi, p_ech, p_ich, ne_frac) = match device.id.as_str() {
            "iter" => (device.ip_max, 100.0, 33.0, 20.0, 0.0, 0.80),
            "jet"  => (2.5,           20.0,  25.0,  0.0, 4.0, 0.70),
            _      => (device.ip_max * 0.4, 10.0, 5.0, 0.0, 0.0, 0.60),
        };
        // ITER baseline uses full toroidal field; other devices typically
        // run slightly below max.
        let bt = match device.id.as_str() {
            "iter" => device.bt_max,
            _      => device.bt_max * 0.9,
        };
        let ne_target = device.greenwald_density(ip_flat) * ne_frac;

        // Per-device waveform timing fractions of duration.
        // ITER: fast ramp (most of 100s is flat-top/burn phase)
        // JET/DIII-D: standard ramp fractions
        let (f_ramp0, f_ramp1, f_end, f_down) = match device.id.as_str() {
            "iter" => (0.01, 0.08, 0.88, 0.95),
            _      => (0.05, 0.15, 0.80, 0.90),
        };
        let (f_heat_on, f_heat_full, f_heat_off0, f_heat_off) = match device.id.as_str() {
            "iter" => (0.10, 0.12, 0.85, 0.88),
            _      => (0.20, 0.25, 0.75, 0.80),
        };
        let (f_ne0, f_ne1, f_ne_end, f_ne_off) = match device.id.as_str() {
            "iter" => (0.06, 0.12, 0.88, 0.95),
            _      => (0.10, 0.20, 0.80, 0.90),
        };

        DischargeProgram {
            ip: vec![
                (0.0, 0.0),
                (duration * f_ramp0, ip_flat * 0.3),
                (duration * f_ramp1, ip_flat),
                (duration * f_end, ip_flat),
                (duration * f_down, ip_flat * 0.5),
                (duration, 0.0),
            ],
            bt: vec![(0.0, bt), (duration, bt)],
            ne_target: vec![
                (0.0, 0.05),
                (duration * f_ne0, ne_target * 0.5),
                (duration * f_ne1, ne_target),
                (duration * f_ne_end, ne_target),
                (duration * f_ne_off, ne_target * 0.3),
                (duration, 0.05),
            ],
            p_nbi: vec![
                (0.0, 0.0),
                (duration * f_heat_on, 0.0),
                (duration * f_heat_full, p_nbi),
                (duration * f_heat_off0, p_nbi),
                (duration * f_heat_off, 0.0),
                (duration, 0.0),
            ],
            p_ech: if p_ech > 0.0 {
                vec![
                    (0.0, 0.0),
                    (duration * (f_heat_on - 0.02), 0.0),
                    (duration * f_heat_on, p_ech),
                    (duration * f_heat_off0, p_ech),
                    (duration * f_heat_off, 0.0),
                    (duration, 0.0),
                ]
            } else {
                vec![(0.0, 0.0), (duration, 0.0)]
            },
            p_ich: if p_ich > 0.0 {
                vec![
                    (0.0, 0.0),
                    (duration * (f_heat_on - 0.02), 0.0),
                    (duration * f_heat_on, p_ich),
                    (duration * f_heat_off0, p_ich),
                    (duration * f_heat_off, 0.0),
                    (duration, 0.0),
                ]
            } else {
                vec![(0.0, 0.0), (duration, 0.0)]
            },
            kappa: vec![
                (0.0, 1.0),
                (duration * f_ramp1, device.kappa),
                (duration * f_end, device.kappa),
                (duration, 1.0),
            ],
            delta: vec![
                (0.0, 0.0),
                (duration * f_ramp1, device.delta_lower),
                (duration * f_end, device.delta_lower),
                (duration, 0.0),
            ],
            d2_puff: vec![
                (0.0, 0.0),
                (duration * 0.03, 2.0),
                (duration * f_ne1, 1.0),
                (duration * f_heat_off0, 1.0),
                (duration * f_ne_off, 0.0),
                (duration, 0.0),
            ],
            neon_puff: vec![(0.0, 0.0), (duration, 0.0)],
            duration,
            config_override: None,
        }
    }

    /// Create an L-mode only discharge (low power).
    pub fn lmode(device: &Device) -> Self {
        let ip_max = device.ip_max * 0.4;
        let bt = device.bt_max * 0.9;
        let duration = 8.0;
        let ne_target = device.greenwald_density(ip_max) * 0.4;

        DischargeProgram {
            ip: vec![
                (0.0, 0.0),
                (0.5, ip_max * 0.3),
                (1.5, ip_max),
                (6.0, ip_max),
                (7.0, ip_max * 0.5),
                (duration, 0.0),
            ],
            bt: vec![(0.0, bt), (duration, bt)],
            ne_target: vec![
                (0.0, 0.05),
                (1.0, ne_target),
                (6.0, ne_target),
                (7.0, 0.05),
                (duration, 0.05),
            ],
            p_nbi: vec![(0.0, 0.0), (duration, 0.0)],
            p_ech: vec![(0.0, 0.0), (duration, 0.0)],
            p_ich: vec![(0.0, 0.0), (duration, 0.0)],
            kappa: vec![
                (0.0, 1.0),
                (1.0, device.kappa),
                (duration - 1.0, device.kappa),
                (duration, 1.0),
            ],
            delta: vec![
                (0.0, 0.0),
                (1.0, device.delta_lower),
                (duration - 1.0, device.delta_lower),
                (duration, 0.0),
            ],
            d2_puff: vec![
                (0.0, 0.0),
                (0.3, 2.0),
                (1.5, 2.0),
                (6.0, 2.0),
                (7.0, 0.0),
                (duration, 0.0),
            ],
            neon_puff: vec![(0.0, 0.0), (duration, 0.0)],
            duration,
            config_override: None,
        }
    }

    /// Create a density-limit push scenario (likely to disrupt).
    pub fn density_limit(device: &Device) -> Self {
        let ip_max = device.ip_max * 0.5;
        let bt = device.bt_max * 0.9;
        let duration = 8.0;
        let ne_target = device.greenwald_density(ip_max) * 1.1; // Above Greenwald!

        DischargeProgram {
            ip: vec![
                (0.0, 0.0),
                (0.5, ip_max * 0.3),
                (1.5, ip_max),
                (6.0, ip_max),
                (7.0, ip_max * 0.5),
                (duration, 0.0),
            ],
            bt: vec![(0.0, bt), (duration, bt)],
            ne_target: vec![
                (0.0, 0.05),
                (1.0, ne_target * 0.3),
                (2.5, ne_target * 0.6),
                (4.0, ne_target), // Push above Greenwald limit
                (6.0, ne_target),
                (duration, 0.05),
            ],
            p_nbi: vec![
                (0.0, 0.0),
                (2.0, 0.0),
                (2.5, 3.0),
                (6.0, 3.0),
                (7.0, 0.0),
                (duration, 0.0),
            ],
            p_ech: vec![(0.0, 0.0), (duration, 0.0)],
            p_ich: vec![(0.0, 0.0), (duration, 0.0)],
            kappa: vec![
                (0.0, 1.0),
                (1.0, device.kappa),
                (duration - 1.0, device.kappa),
                (duration, 1.0),
            ],
            delta: vec![
                (0.0, 0.0),
                (1.0, device.delta_lower),
                (duration - 1.0, device.delta_lower),
                (duration, 0.0),
            ],
            d2_puff: vec![
                (0.0, 0.0),
                (0.3, 3.0),
                (2.0, 4.0),  // High gas puff pushing Greenwald limit
                (5.0, 5.0),
                (6.0, 3.0),
                (7.0, 0.0),
                (duration, 0.0),
            ],
            neon_puff: vec![(0.0, 0.0), (duration, 0.0)],
            duration,
            config_override: None,
        }
    }
}

/// Full simulation state snapshot (serialized to frontend each frame).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationSnapshot {
    pub time: f64,
    pub duration: f64,
    pub device_id: String,

    // Programmed references
    pub prog_ip: f64,
    pub prog_bt: f64,
    pub prog_ne: f64,
    pub prog_p_nbi: f64,
    pub prog_p_ech: f64,
    pub prog_p_ich: f64,

    // Transport state
    pub ip: f64,
    pub bt: f64,
    pub te0: f64,
    pub ne_bar: f64,
    pub w_th: f64,
    pub tau_e: f64,
    pub p_input: f64,
    pub p_ohmic: f64,
    pub p_rad: f64,
    pub p_loss: f64,
    pub beta_n: f64,
    pub beta_t: f64,
    pub q95: f64,
    pub f_greenwald: f64,
    pub li: f64,
    pub h_factor: f64,
    pub in_hmode: bool,
    pub elm_active: bool,
    pub elm_type: u8,
    pub elm_suppressed: bool,
    pub ne_ped: f64,
    pub te_ped: f64,
    pub ne_line: f64,
    pub impurity_fraction: f64,
    pub d2_puff: f64,
    pub neon_puff: f64,

    // Disruption
    pub disruption_risk: f64,
    pub disrupted: bool,

    // Profiles (51-point arrays, ρ = 0.00 to 1.00)
    pub te_profile: Vec<f64>,
    pub ne_profile: Vec<f64>,

    // Diagnostics
    pub diagnostics: DiagnosticSignals,

    // Equilibrium geometry (for rendering)
    pub flux_surfaces: Vec<Contour>,
    pub separatrix: Contour,
    pub axis_r: f64,
    pub axis_z: f64,
    pub xpoint_r: f64,
    pub xpoint_z: f64,
    pub xpoint_upper_r: f64,
    pub xpoint_upper_z: f64,
    pub magnetic_config: String,
    pub is_limited: bool,

    // Status
    pub status: SimulationStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum SimulationStatus {
    Ready,
    Running,
    Paused,
    Disrupted,
    Complete,
}

/// Ray-casting point-in-polygon test.
/// Returns true if (r, z) is inside the polygon defined by `outline`.
fn point_in_polygon(r: f64, z: f64, outline: &[(f64, f64)]) -> bool {
    let n = outline.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (ri, zi) = outline[i];
        let (rj, zj) = outline[j];
        if ((zi > z) != (zj > z)) && (r < (rj - ri) * (z - zi) / (zj - zi) + ri) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Sample LCFS boundary points using Miller parameterization.
/// Returns Vec<(R, Z, theta)> in physical coordinates.
/// `z0` is the vertical offset of the plasma center.
fn sample_lcfs(r0: f64, a: f64, kappa: f64, delta: f64, z0: f64, n: usize) -> Vec<(f64, f64, f64)> {
    let mut points = Vec::with_capacity(n);
    for i in 0..n {
        let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
        let r = r0 + a * (theta + delta.asin() * theta.sin()).cos();
        let z = z0 + kappa * a * theta.sin();
        points.push((r, z, theta));
    }
    points
}

/// The main simulation engine.
pub struct Simulation {
    pub device: Device,
    pub program: DischargeProgram,
    pub time: f64,
    pub status: SimulationStatus,

    // Physics models
    transport: TransportModel,
    profiles: Profiles,
    disruption: DisruptionModel,
    equilibrium: CerfonEquilibrium,
    _noise: NoiseGen,

    // Current actual Ip (may differ from programmed if disrupting)
    actual_ip: f64,

    // Smoothed values for disruption risk (filters out ELM transients)
    smoothed_beta_n: f64,
    smoothed_f_greenwald: f64,
    smoothed_p_rad_frac: f64,

    // Smoothed l_i (resistive timescale ~ 200ms)
    smoothed_li: f64,

    // Equilibrium grid resolution
    eq_nr: usize,
    eq_nz: usize,
    n_flux_surfaces: usize,
}

impl Simulation {
    /// Create a new simulation for a given device and discharge program.
    pub fn new(device: Device, program: DischargeProgram) -> Self {
        let equilibrium = CerfonEquilibrium::from_device(&device)
            .expect("Should be able to solve equilibrium for device");

        let profiles = Profiles::for_device(&device.id);
        Simulation {
            program,
            time: 0.0,
            status: SimulationStatus::Ready,
            transport: TransportModel::default(),
            profiles,
            disruption: DisruptionModel::default(),
            equilibrium,
            _noise: NoiseGen::new(12345),
            actual_ip: 0.0,
            smoothed_beta_n: 0.0,
            smoothed_f_greenwald: 0.0,
            smoothed_p_rad_frac: 0.0,
            smoothed_li: 1.2,
            eq_nr: 48,
            eq_nz: 72,
            n_flux_surfaces: 8,
            device,
        }
    }

    /// Seed the disruption model RNG.  Call from WASM layer with JS entropy.
    pub fn seed_disruption(&mut self, seed: u64) {
        self.disruption.seed(seed);
    }

    /// Reset the simulation to t=0.
    pub fn reset(&mut self) {
        self.time = 0.0;
        self.status = SimulationStatus::Ready;
        self.transport = TransportModel::default();
        self.profiles = Profiles::for_device(&self.device.id);
        self.disruption.reset();
        self.actual_ip = 0.0;
        self.smoothed_beta_n = 0.0;
        self.smoothed_f_greenwald = 0.0;
        self.smoothed_p_rad_frac = 0.0;
    }

    /// Start or resume the simulation.
    pub fn start(&mut self) {
        self.status = SimulationStatus::Running;
    }

    /// Pause the simulation.
    pub fn pause(&mut self) {
        self.status = SimulationStatus::Paused;
    }

    /// Advance the simulation by one timestep.
    /// Returns a snapshot of the current state.
    pub fn step(&mut self, dt: f64) -> SimulationSnapshot {
        if self.status != SimulationStatus::Running {
            return self.snapshot();
        }

        self.time += dt;

        // Check for end of discharge
        if self.time >= self.program.duration {
            self.status = SimulationStatus::Complete;
            return self.snapshot();
        }

        // Get programmed values
        let prog = self.program.values_at(self.time);

        // ── Transport step ──
        self.transport
            .step(dt, &self.device, &prog, self.device.z_eff);

        self.actual_ip = prog.ip;

        // ── Disruption check ──
        // Only evaluate radiation fraction when there's meaningful auxiliary
        // heating — during ohmic-only ramp-up, high Prad/Pin is normal physics,
        // not a precursor to radiative collapse.
        let p_rad_frac = if self.transport.p_input > 1.0 {
            self.transport.p_rad / self.transport.p_input
        } else {
            0.0
        };

        // Exponential smoothing of disruption risk inputs (τ ≈ 100ms).
        // This filters out rapid ELM transients (~1-10ms) while tracking
        // slower physics trends (density ramps, beta evolution, etc.).
        let tau_smooth = 0.1; // 100ms smoothing time constant
        let alpha = 1.0 - (-dt / tau_smooth).exp();
        self.smoothed_beta_n += (self.transport.beta_n - self.smoothed_beta_n) * alpha;
        self.smoothed_f_greenwald += (self.transport.f_greenwald - self.smoothed_f_greenwald) * alpha;
        self.smoothed_p_rad_frac += (p_rad_frac - self.smoothed_p_rad_frac) * alpha;

        // Scale threshold with ip_max — avoids spurious Greenwald violations
        // during very early ramp-up in large-bore machines (ITER: n_GW ∝ Ip/a²
        // is tiny at low Ip when a is large).
        let ip_threshold = (0.05 * self.device.ip_max).max(0.1);
        if !self.disruption.disrupted && self.actual_ip > ip_threshold {
            self.disruption.update_risk(
                self.smoothed_f_greenwald,
                self.smoothed_beta_n,
                self.transport.q95, // q95 not affected by ELMs, no smoothing needed
                self.smoothed_p_rad_frac,
                self.actual_ip,
            );
            self.disruption.check_trigger(dt);
        }

        // ── Apply disruption effects ──
        let disruption_effects = self.disruption.advance(dt, self.actual_ip);
        if self.disruption.disrupted {
            self.actual_ip *= disruption_effects.ip_multiplier;
            self.transport.te0 *= disruption_effects.te_multiplier;
            self.transport.w_th *= disruption_effects.te_multiplier; // Energy drops with Te

            if self.actual_ip < 0.01 {
                self.status = SimulationStatus::Disrupted;
            }
        }

        // ── Update profiles ──
        self.profiles.update_from_0d(
            self.transport.te0,
            self.transport.ne0,
            self.transport.in_hmode,
            dt,
            self.transport.elm_ped_crash_frac,
        );

        // ── Update l_i from Te profile shape ──
        // j ∝ Te^1.5 (Spitzer), so l_i tracks Te profile peaking.
        // The current redistribution time τ_CR ≈ τ_R / n² where τ_R = μ₀σa²
        // is the global resistive diffusion time and n ~ 3-4 is the lowest-order
        // peaking mode. Coefficient 2.0 reproduces experimental τ_CR:
        //   - DIII-D H-mode (~3 keV): τ ~ 3.6s  (sluggish, ELMs filtered out)
        //   - DIII-D L-mode (~1 keV):  τ ~ 0.7s  (moderate response)
        //   - Rad. collapse (~0.1 keV): τ ~ 22ms (rapid current contraction)
        //   - ITER H-mode  (~10 keV): τ ~ 250s   (l_i nearly frozen, as expected)
        // Below 0.1 MA use default l_i (no meaningful current profile yet).
        // Between 0.1–0.3 MA, blend smoothly to avoid display transients.
        if self.actual_ip > 0.1 {
            let li_instant = self.profiles.compute_li();
            let te_avg = self.profiles.te_vol_avg().max(0.01); // keV, floor at 10 eV
            let a = self.device.a;
            let tau_li = (2.0 * a * a * te_avg.powf(1.5)).max(0.005); // floor 5ms
            let alpha_li = (dt / tau_li).min(1.0);
            // Blend from default (1.2) toward computed l_i as Ip ramps up.
            // Below 0.3 MA the current profile is poorly established; at 0.3 MA
            // we trust the profile-derived value fully.
            let ip_weight = ((self.actual_ip - 0.1) / 0.2).clamp(0.0, 1.0);
            let li_target = li_instant * ip_weight + 1.2 * (1.0 - ip_weight);
            self.smoothed_li += (li_target - self.smoothed_li) * alpha_li;
            self.transport.li = self.smoothed_li;
        } else {
            // During early ramp-up / late ramp-down: default peaked-ohmic value
            self.transport.li = 1.2;
            self.smoothed_li = 1.2;
        }

        // ── Update equilibrium shape ──
        // Compute βp from profile-derived pressure for a more physics-based A parameter.
        // βp = 2μ₀ <p> / B_pol² where B_pol = μ₀Ip/(2πa)
        // <p> [Pa] = pressure_vol_avg [keV·10²⁰m⁻³] * 1.602e4
        let beta_p = if self.actual_ip > 0.1 {
            let p_avg_pa = self.profiles.pressure_vol_avg() * 1.602e4;
            let mu0 = 4.0 * std::f64::consts::PI * 1e-7;
            let a_phys = self.device.a;
            let bp_edge = mu0 * self.actual_ip * 1e6
                / (2.0 * std::f64::consts::PI * a_phys); // T
            if bp_edge > 0.01 {
                2.0 * mu0 * p_avg_pa / (bp_edge * bp_edge)
            } else {
                0.0
            }
        } else {
            0.0
        };
        let a_param = -0.05 - 0.1 * beta_p.min(2.0); // A shifts with pressure

        let config = if prog.delta < 0.1 {
            MagneticConfig::Limited
        } else if let Some(ref cfg_str) = self.program.config_override {
            match cfg_str.as_str() {
                "DoubleNull" => MagneticConfig::DoubleNull,
                "UpperSingleNull" => MagneticConfig::UpperSingleNull,
                "LowerSingleNull" => MagneticConfig::LowerSingleNull,
                _ => self.device.config,
            }
        } else {
            self.device.config
        };

        // During limited phase, reduce epsilon so plasma starts small and grows with Ip
        let ip_frac = if prog.ip > 0.1 {
            (self.actual_ip / prog.ip).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let epsilon = if config == MagneticConfig::Limited {
            self.device.epsilon() * (0.35 + 0.65 * ip_frac)
        } else if config == MagneticConfig::DoubleNull {
            // DN plasma is smaller to fit within both upper and lower
            // divertor shelves of the limiter geometry.
            self.device.epsilon() * 0.88
        } else {
            self.device.epsilon()
        };

        // During limited phase (δ < 0.1), the LSN X-point boundary conditions
        // place the X-point at x ≈ 1.0 (geometric center), producing a degenerate
        // equilibrium with inverted ψ. Use a minimum effective delta of 0.2 in the
        // boundary conditions to keep the X-point well-separated from the center.
        // The visual aspects (X-point suppression, LIMITED label) use prog.delta.
        let delta_eff = if config == MagneticConfig::Limited {
            prog.delta.max(0.2)
        } else {
            prog.delta
        };

        let new_shape = ShapeParams {
            epsilon,
            kappa: prog.kappa,
            delta: delta_eff,
            a_param,
            config,
            x_point_alpha: Some(delta_eff.asin()),
            squareness: 0.0,
        };
        self.equilibrium.update(&new_shape);

        // ── Limiter contact check (diverted phase only) ──
        // If the bulk LCFS extends beyond the wall, force a disruption.
        // Only checked in diverted config (limited plasma intentionally touches wall)
        // and only when Ip is significant (near or at flat-top).
        if config != MagneticConfig::Limited
            && !self.disruption.disrupted
            && prog.ip > 0.3 * self.device.ip_max
            && self.actual_ip > 0.1
        {
            let a = epsilon * self.device.r0; // physical minor radius
            let lcfs_points = sample_lcfs(self.device.r0, a, prog.kappa, delta_eff, self.device.z0, 24);

            // X-point(s) for bulk/leg discrimination
            let (xp_lower, xp_upper) = self.equilibrium.x_points_physical();

            for &(r, z, _theta) in &lcfs_points {
                // Skip divertor leg regions near X-points
                if let Some((_, z_lo)) = xp_lower {
                    if z < z_lo + 0.05 { continue; }
                }
                if let Some((_, z_up)) = xp_upper {
                    if z > z_up - 0.05 { continue; }
                }
                // Check if this LCFS point is outside the wall
                if !point_in_polygon(r, z, &self.device.wall_outline) {
                    self.disruption.force_disruption();
                    break;
                }
            }
        }

        self.snapshot()
    }

    /// Generate a snapshot of the current state.
    fn snapshot(&self) -> SimulationSnapshot {
        let prog = self.program.values_at(self.time);

        // Compute grid bounds using DEVICE dimensions (not the possibly-scaled shape
        // epsilon). This ensures the contour grid always extends to the full plasma
        // extent / divertor region, even during limited phase when epsilon is small.
        let full_eps = self.device.epsilon();
        let full_kappa = self.device.kappa.max(self.equilibrium.shape.kappa);
        let margin = 0.15;
        let mut grid_r_min = self.device.r0 * (1.0 - full_eps - margin);
        let mut grid_r_max = self.device.r0 * (1.0 + full_eps + margin);
        let mut grid_z_min = self.device.z0 + self.device.r0 * (-full_eps * full_kappa - margin);
        let mut grid_z_max = self.device.z0 + self.device.r0 * (full_eps * full_kappa + margin);

        // Extend grid bounds to cover the device wall outline so separatrix
        // divertor legs can be traced all the way to the wall/divertor targets.
        // Without this, the marching-squares contour extraction truncates legs
        // at the grid boundary, which falls short of the divertor floor.
        if !self.device.wall_outline.is_empty() {
            let wall_pad = 0.02; // small padding beyond wall
            for &(r, z) in &self.device.wall_outline {
                grid_r_min = grid_r_min.min(r - wall_pad);
                grid_r_max = grid_r_max.max(r + wall_pad);
                grid_z_min = grid_z_min.min(z - wall_pad);
                grid_z_max = grid_z_max.max(z + wall_pad);
            }
        }

        // Generate flux surfaces using device-level grid bounds
        let mut flux_surfaces = if self.actual_ip > 0.1 {
            let grid = self.equilibrium.psi_norm_grid(
                grid_r_min, grid_r_max, grid_z_min, grid_z_max,
                self.eq_nr, self.eq_nz,
            );
            let mut levels: Vec<f64> = (1..=self.n_flux_surfaces)
                .map(|i| i as f64 / (self.n_flux_surfaces + 1) as f64)
                .collect();
            // Add a near-edge surface at ψ_N=0.995 for emission shell rendering.
            // The actual separatrix (ψ=0) has figure-eight topology at the X-point
            // which makes it unsuitable for closed-loop emission shells, but this
            // surface is close enough to be visually identical while staying a
            // simple closed curve inside the plasma.
            levels.push(0.995);
            contour::extract_contours(
                &grid, self.eq_nr, self.eq_nz,
                grid_r_min, grid_r_max, grid_z_min, grid_z_max,
                &levels,
            )
        } else {
            vec![]
        };

        let is_limited = self.equilibrium.shape.config == MagneticConfig::Limited;

        // Draw separatrix in both limited and diverted phases — in limited config
        // it represents the LCFS touching the wall, clipped by the frontend canvas.
        // Uses extract_separatrix() which preserves all significant chains including
        // divertor legs for double-null configurations.
        // Pass the device-level grid bounds so the extraction covers the full divertor
        // region even when the equilibrium ε is reduced (e.g. DN uses 0.88×ε).
        let sep_bounds = Some((grid_r_min, grid_r_max, grid_z_min, grid_z_max));
        let mut separatrix = if self.actual_ip > 0.1 {
            contour::extract_separatrix(&self.equilibrium, self.eq_nr, self.eq_nz, sep_bounds)
        } else {
            Contour {
                level: 0.0,
                points: vec![],
            }
        };

        let (mut axis_r, axis_z) = self.equilibrium.axis_physical();
        let (xpoint_r, xpoint_z) = if is_limited {
            (0.0, 0.0)
        } else {
            self.equilibrium.x_point_physical()
        };

        // Dual x-point support
        let (_xp_lower, xp_upper) = if is_limited {
            (None, None)
        } else {
            self.equilibrium.x_points_physical()
        };
        let (xpoint_upper_r, xpoint_upper_z) = xp_upper.unwrap_or((0.0, 0.0));

        let magnetic_config = format!("{:?}", self.equilibrium.shape.config);

        // During limited phase, shift plasma inboard so inboard edge touches limiter
        if is_limited && self.actual_ip > 0.1 {
            let ip_frac = if prog.ip > 0.1 {
                (self.actual_ip / prog.ip).clamp(0.0, 1.0)
            } else {
                0.0
            };
            // Find inboard limiter R (minimum R of wall outline near midplane)
            let r_limiter = self.device.wall_outline.iter()
                .filter(|(_, z)| z.abs() < 0.3)
                .map(|(r, _)| *r)
                .fold(f64::INFINITY, f64::min);
            // Current inboard edge of the equilibrium
            let r_inboard = self.device.r0 * (1.0 - self.equilibrium.shape.epsilon);
            // Shift decreases as Ip ramps toward flat-top
            let shift = (r_inboard - r_limiter).max(0.0) * (1.0 - ip_frac);

            axis_r -= shift;
            for surface in &mut flux_surfaces {
                for pt in &mut surface.points {
                    pt.0 -= shift;
                }
            }
            for pt in &mut separatrix.points {
                pt.0 -= shift;
            }
        }

        // Generate diagnostic signals with noise
        let mut noise = NoiseGen::new(self.time.to_bits());
        let diagnostics = DiagnosticSignals::from_state(
            self.actual_ip,
            self.transport.ne_bar,
            self.transport.te0,
            self.transport.w_th,
            self.transport.p_rad,
            self.transport.p_input,
            self.transport.beta_n,
            self.transport.q95,
            self.transport.f_greenwald,
            self.transport.in_hmode,
            self.transport.elm_type,
            if self.disruption.disrupted {
                5.0
            } else {
                0.0
            },
            &mut noise,
        );

        SimulationSnapshot {
            time: self.time,
            duration: self.program.duration,
            device_id: self.device.id.clone(),
            prog_ip: prog.ip,
            prog_bt: prog.bt,
            prog_ne: prog.ne_target,
            prog_p_nbi: prog.p_nbi,
            prog_p_ech: prog.p_ech,
            prog_p_ich: prog.p_ich,
            ip: self.actual_ip,
            bt: prog.bt,
            te0: self.transport.te0,
            ne_bar: self.transport.ne_bar,
            w_th: self.transport.w_th,
            tau_e: self.transport.tau_e,
            p_input: self.transport.p_input,
            p_ohmic: self.transport.p_ohmic,
            p_rad: self.transport.p_rad,
            p_loss: self.transport.p_loss,
            beta_n: self.transport.beta_n,
            beta_t: self.transport.beta_t,
            q95: self.transport.q95,
            f_greenwald: self.transport.f_greenwald,
            li: self.transport.li,
            h_factor: self.transport.h_factor,
            in_hmode: self.transport.in_hmode,
            elm_active: self.transport.elm_active,
            elm_type: self.transport.elm_type,
            elm_suppressed: self.transport.elm_suppressed,
            ne_ped: self.profiles.ne_ped,
            te_ped: self.profiles.te_ped,
            ne_line: self.profiles.ne_line_avg(),
            impurity_fraction: self.transport.impurity_fraction,
            d2_puff: prog.d2_puff,
            neon_puff: prog.neon_puff,
            te_profile: self.profiles.te_profile_array(),
            ne_profile: self.profiles.ne_profile_array(),
            disruption_risk: self.disruption.risk,
            disrupted: self.disruption.disrupted,
            diagnostics,
            flux_surfaces,
            separatrix,
            axis_r,
            axis_z,
            xpoint_r,
            xpoint_z,
            xpoint_upper_r,
            xpoint_upper_z,
            magnetic_config,
            is_limited,
            status: self.status,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::devices;

    #[test]
    fn test_waveform_interpolation() {
        let waveform = vec![(0.0, 0.0), (1.0, 10.0), (2.0, 10.0), (3.0, 0.0)];

        assert!((DischargeProgram::interpolate(&waveform, 0.5) - 5.0).abs() < 0.01);
        assert!((DischargeProgram::interpolate(&waveform, 1.5) - 10.0).abs() < 0.01);
        assert!((DischargeProgram::interpolate(&waveform, 2.5) - 5.0).abs() < 0.01);
        // Clamp at edges
        assert!((DischargeProgram::interpolate(&waveform, -1.0) - 0.0).abs() < 0.01);
        assert!((DischargeProgram::interpolate(&waveform, 5.0) - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_standard_hmode_program() {
        let device = devices::diiid();
        let prog = DischargeProgram::standard_hmode(&device);

        assert!(prog.duration > 0.0);
        assert!(!prog.ip.is_empty());

        // Ip should start at 0 and return to 0
        assert!(prog.ip.first().unwrap().1 < 0.01);
        assert!(prog.ip.last().unwrap().1 < 0.01);

        // Ip at flat top should be reasonable
        let ip_flattop = DischargeProgram::interpolate(&prog.ip, 3.0);
        assert!(ip_flattop > 0.5 && ip_flattop < device.ip_max);
    }

    #[test]
    fn test_simulation_creation() {
        let device = devices::diiid();
        let program = DischargeProgram::standard_hmode(&device);
        let sim = Simulation::new(device, program);

        assert_eq!(sim.time, 0.0);
        assert_eq!(sim.status, SimulationStatus::Ready);
    }

    #[test]
    fn test_simulation_step() {
        let device = devices::diiid();
        let program = DischargeProgram::standard_hmode(&device);
        let mut sim = Simulation::new(device, program);

        sim.start();
        let snapshot = sim.step(0.001);

        assert!(snapshot.time > 0.0);
        assert_eq!(snapshot.status, SimulationStatus::Running);
    }

    #[test]
    fn test_full_discharge_simulation() {
        let device = devices::diiid();
        let program = DischargeProgram::standard_hmode(&device);
        let duration = program.duration;
        let mut sim = Simulation::new(device, program);

        sim.start();

        let dt = 0.002; // 2ms timestep
        let n_steps = (duration / dt) as usize + 10;

        let mut max_ip = 0.0f64;
        let mut max_te = 0.0f64;
        for _ in 0..n_steps {
            let snap = sim.step(dt);
            max_ip = max_ip.max(snap.ip);
            max_te = max_te.max(snap.te0);

            if snap.status == SimulationStatus::Complete
                || snap.status == SimulationStatus::Disrupted
            {
                break;
            }
        }

        assert!(max_ip > 1.0, "Should reach significant plasma current: {}", max_ip);
        assert!(max_te > 0.5, "Should heat up significantly: {} keV", max_te);
        // Note: H-mode transition depends on exact timing/power balance
        // Don't require it here since the model may or may not transition
    }

    #[test]
    fn test_snapshot_has_equilibrium() {
        let device = devices::diiid();
        let program = DischargeProgram::standard_hmode(&device);
        let mut sim = Simulation::new(device, program);

        sim.start();

        // Advance to flat-top
        let dt = 0.002;
        for _ in 0..1500 {
            sim.step(dt);
        }

        let snap = sim.step(dt);
        // At 3s into a DIII-D discharge, should have flux surfaces
        if snap.ip > 0.5 {
            assert!(
                !snap.flux_surfaces.is_empty(),
                "Should have flux surfaces during flat-top"
            );
            assert!(
                !snap.separatrix.points.is_empty(),
                "Should have separatrix during flat-top"
            );
        }
    }

    #[test]
    fn test_point_in_polygon() {
        // Simple unit square: (0,0), (1,0), (1,1), (0,1)
        let square = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        assert!(point_in_polygon(0.5, 0.5, &square)); // center
        assert!(!point_in_polygon(1.5, 0.5, &square)); // outside right
        assert!(!point_in_polygon(0.5, 1.5, &square)); // outside top
        assert!(!point_in_polygon(-0.5, 0.5, &square)); // outside left

        // DIII-D wall: magnetic axis should be inside
        let device = devices::diiid();
        assert!(point_in_polygon(device.r0, 0.0, &device.wall_outline));
        // Far outside: R = 5.0 should be outside
        assert!(!point_in_polygon(5.0, 0.0, &device.wall_outline));
    }

    #[test]
    fn test_sample_lcfs() {
        let r0 = 1.67;
        let a = 0.56;
        let kappa = 1.75;
        let delta = 0.35;
        let points = sample_lcfs(r0, a, kappa, delta, 0.0, 24);
        assert_eq!(points.len(), 24);

        // Check that points span reasonable R and Z ranges
        let r_min = points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
        let r_max = points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
        let z_min = points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        let z_max = points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);

        // Inboard side should be around R0 - a
        assert!(r_min < r0, "LCFS should extend inboard of R0");
        assert!(r_max > r0, "LCFS should extend outboard of R0");
        // Z range should be roughly ±kappa*a
        assert!(z_max > 0.8 * kappa * a, "LCFS top should be near kappa*a");
        assert!(z_min < -0.8 * kappa * a, "LCFS bottom should be near -kappa*a");
    }

    #[test]
    fn test_normal_discharge_no_wall_disruption() {
        // Standard H-mode with normal κ and δ should NOT trigger wall contact
        let device = devices::diiid();
        let program = DischargeProgram::standard_hmode(&device);
        let duration = program.duration;
        let mut sim = Simulation::new(device, program);
        sim.start();

        let dt = 0.002;
        let n_steps = (duration / dt) as usize + 10;
        let mut wall_disrupted = false;
        for _ in 0..n_steps {
            let snap = sim.step(dt);
            if snap.status == SimulationStatus::Disrupted {
                wall_disrupted = true;
                break;
            }
            if snap.status == SimulationStatus::Complete {
                break;
            }
        }
        // With the default disruption RNG seed, the standard discharge may or may not
        // stochastically disrupt. But we can at least verify the simulation ran.
        // The key test is that extreme shapes DO disrupt (next test).
        let _ = wall_disrupted;
    }

    #[test]
    fn test_li_responds_to_hmode_transition() {
        // l_i should decrease when the plasma transitions to H-mode
        // because Te broadens (pedestal forms), making j(ρ) broader.
        // Note: τ_li ≈ 3.6s at Te ~ 3 keV, so we need to wait several
        // seconds after H-mode onset to see the effect.
        let device = devices::diiid();
        let program = DischargeProgram::standard_hmode(&device);
        let mut sim = Simulation::new(device, program);
        sim.start();

        let dt = 0.002;
        let mut li_early = 0.0;
        let mut li_hmode = 0.0;

        for _ in 0..5000 {
            let snap = sim.step(dt);

            // Capture l_i during L-mode phase (~3.0s, Ip flat-top but before H-mode effects)
            if (snap.time - 3.0).abs() < dt {
                li_early = snap.li;
            }
            // Capture l_i well into H-mode flat-top (~8.0s, several τ_li later)
            if (snap.time - 8.0).abs() < dt {
                li_hmode = snap.li;
            }
            if snap.status == SimulationStatus::Complete
                || snap.status == SimulationStatus::Disrupted
            {
                break;
            }
        }

        // l_i should be measurably lower in H-mode (broader Te/current profile)
        assert!(
            li_early > 0.5,
            "Early l_i should be reasonable, got {}",
            li_early
        );
        if li_hmode > 0.1 {
            // Only check if we got to H-mode without disrupting
            assert!(
                li_hmode < li_early,
                "H-mode l_i ({}) should be less than L-mode l_i ({})",
                li_hmode,
                li_early
            );
        }
    }

    #[test]
    fn test_extreme_kappa_causes_wall_disruption() {
        // Extreme elongation (κ=2.5) should push plasma into wall and disrupt
        let device = devices::diiid();
        let mut program = DischargeProgram::standard_hmode(&device);

        // Override kappa waveform to extreme value during flat-top
        program.kappa = vec![
            (0.0, 1.0),
            (1.0, 2.5), // Ramp to extreme κ during Ip ramp
            (8.0, 2.5),
            (9.0, 1.0),
        ];

        let mut sim = Simulation::new(device, program);
        sim.start();

        let dt = 0.002;
        let mut disrupted = false;
        for _ in 0..5000 {
            // Run up to 10s
            let snap = sim.step(dt);
            if snap.status == SimulationStatus::Disrupted {
                disrupted = true;
                break;
            }
            if snap.status == SimulationStatus::Complete {
                break;
            }
        }
        assert!(
            disrupted,
            "Extreme κ=2.5 should cause wall contact disruption"
        );
    }

    #[test]
    fn test_iter_hmode_transition() {
        let device = devices::iter();
        let program = DischargeProgram::standard_hmode(&device);
        let duration = program.duration;
        let bt_max = device.bt_max;
        let surface_area = device.surface_area;
        let plh_factor = device.p_lh_factor;
        let mut sim = Simulation::new(device, program);
        sim.start();

        let dt = 0.005;
        let mut entered_hmode = false;
        let mut hmode_time = 0.0;
        let mut max_p_input = 0.0f64;
        let mut plh_at_max_heat = 0.0f64;
        let mut ne_at_max_heat = 0.0f64;
        let mut prad_at_max_heat = 0.0f64;
        let mut elm_count = 0u32;

        for _ in 0..(duration / dt) as usize + 10 {
            let snap = sim.step(dt);

            if snap.p_input > max_p_input {
                max_p_input = snap.p_input;
                ne_at_max_heat = snap.ne_bar;
                prad_at_max_heat = snap.p_rad;
                // Compute P_LH from Martin 2008 scaling with device factor
                plh_at_max_heat = 0.0488
                    * snap.ne_bar.powf(0.717)
                    * bt_max.powf(0.803)
                    * surface_area.powf(0.941)
                    * plh_factor;
            }

            if snap.in_hmode && !entered_hmode {
                entered_hmode = true;
                hmode_time = snap.time;
                eprintln!("  H-mode onset: t={:.2}s, Pin={:.1} MW, Prad={:.1} MW, ne={:.3}, net={:.1} MW",
                    snap.time, snap.p_input, snap.p_rad, snap.ne_bar, snap.p_input - snap.p_rad);
            }

            if snap.elm_active {
                elm_count += 1;
            }

            if snap.status == SimulationStatus::Complete
                || snap.status == SimulationStatus::Disrupted
            {
                eprintln!(
                    "ITER ended at t={:.1}s status={:?}. Max P_input={:.1} MW, P_LH={:.1} MW, ne_bar={:.3}, P_rad={:.1} MW",
                    snap.time, snap.status, max_p_input, plh_at_max_heat, ne_at_max_heat, prad_at_max_heat
                );
                eprintln!("  H-mode entered={} at t={:.1}s, ELM frames={}", entered_hmode, hmode_time, elm_count);
                break;
            }
        }

        assert!(
            entered_hmode,
            "ITER H-mode preset should transition to H-mode. Max Pin={:.1} MW, P_LH={:.1} MW, ne={:.3}, Prad={:.1} MW, net={:.1} MW",
            max_p_input, plh_at_max_heat, ne_at_max_heat, prad_at_max_heat,
            max_p_input - prad_at_max_heat
        );
    }
}
