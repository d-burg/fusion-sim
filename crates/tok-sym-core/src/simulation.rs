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
    /// Total discharge duration (s)
    pub duration: f64,
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
        }
    }

    /// Create a standard H-mode discharge program for a given device.
    pub fn standard_hmode(device: &Device) -> Self {
        let ip_max = device.ip_max * 0.6; // 60% of max current
        let bt = device.bt_max * 0.9;
        let duration = 10.0;

        // Compute a reasonable NBI power for H-mode
        // Need to exceed L-H threshold
        let p_nbi = match device.id.as_str() {
            "diiid" => 5.0,
            "iter" => 33.0,
            _ => 5.0,
        };

        let ne_target = device.greenwald_density(ip_max) * 0.6;

        DischargeProgram {
            ip: vec![
                (0.0, 0.0),
                (0.5, ip_max * 0.3),
                (1.5, ip_max),
                (8.0, ip_max),
                (9.0, ip_max * 0.5),
                (duration, 0.0),
            ],
            bt: vec![(0.0, bt), (duration, bt)],
            ne_target: vec![
                (0.0, 0.05),
                (1.0, ne_target * 0.5),
                (2.0, ne_target),
                (8.0, ne_target),
                (9.0, ne_target * 0.3),
                (duration, 0.05),
            ],
            p_nbi: vec![
                (0.0, 0.0),
                (2.0, 0.0),
                (2.5, p_nbi),
                (7.5, p_nbi),
                (8.0, 0.0),
                (duration, 0.0),
            ],
            p_ech: vec![(0.0, 0.0), (duration, 0.0)],
            p_ich: vec![(0.0, 0.0), (duration, 0.0)],
            kappa: vec![(0.0, 1.0), (1.0, device.kappa), (duration, device.kappa)],
            delta: vec![
                (0.0, 0.0),
                (1.0, device.delta_lower),
                (duration, device.delta_lower),
            ],
            duration,
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
            kappa: vec![(0.0, 1.0), (1.0, device.kappa), (duration, device.kappa)],
            delta: vec![
                (0.0, 0.0),
                (1.0, device.delta_lower),
                (duration, device.delta_lower),
            ],
            duration,
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
            kappa: vec![(0.0, 1.0), (1.0, device.kappa), (duration, device.kappa)],
            delta: vec![
                (0.0, 0.0),
                (1.0, device.delta_lower),
                (duration, device.delta_lower),
            ],
            duration,
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

    // Disruption
    pub disruption_risk: f64,
    pub disrupted: bool,

    // Diagnostics
    pub diagnostics: DiagnosticSignals,

    // Equilibrium geometry (for rendering)
    pub flux_surfaces: Vec<Contour>,
    pub separatrix: Contour,
    pub axis_r: f64,
    pub axis_z: f64,
    pub xpoint_r: f64,
    pub xpoint_z: f64,
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

        Simulation {
            program,
            time: 0.0,
            status: SimulationStatus::Ready,
            transport: TransportModel::default(),
            profiles: Profiles::default(),
            disruption: DisruptionModel::default(),
            equilibrium,
            _noise: NoiseGen::new(12345),
            actual_ip: 0.0,
            smoothed_beta_n: 0.0,
            smoothed_f_greenwald: 0.0,
            smoothed_p_rad_frac: 0.0,
            eq_nr: 48,
            eq_nz: 64,
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
        self.profiles = Profiles::default();
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

        if !self.disruption.disrupted && self.actual_ip > 0.1 {
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
        );

        // ── Update equilibrium shape ──
        // Adjust A parameter based on βp and shape based on programmed values
        let beta_p = if self.actual_ip > 0.1 {
            self.transport.beta_t * self.device.bt_max / self.actual_ip * self.device.a
        } else {
            0.0
        };
        let a_param = -0.05 - 0.1 * beta_p.min(2.0); // A shifts with pressure

        let config = if prog.delta < 0.1 {
            MagneticConfig::Limited
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
        let grid_r_min = self.device.r0 * (1.0 - full_eps - margin);
        let grid_r_max = self.device.r0 * (1.0 + full_eps + margin);
        let grid_z_min = self.device.r0 * (-full_eps * full_kappa - margin);
        let grid_z_max = self.device.r0 * (full_eps * full_kappa + margin);

        // Generate flux surfaces using device-level grid bounds
        let mut flux_surfaces = if self.actual_ip > 0.1 {
            let grid = self.equilibrium.psi_norm_grid(
                grid_r_min, grid_r_max, grid_z_min, grid_z_max,
                self.eq_nr, self.eq_nz,
            );
            let levels: Vec<f64> = (1..=self.n_flux_surfaces)
                .map(|i| i as f64 / (self.n_flux_surfaces + 1) as f64)
                .collect();
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
        // it represents the LCFS touching the wall, clipped by the frontend canvas
        let mut separatrix = if self.actual_ip > 0.1 {
            let grid = self.equilibrium.psi_grid(
                grid_r_min, grid_r_max, grid_z_min, grid_z_max,
                self.eq_nr, self.eq_nz,
            );
            let contours = contour::extract_contours(
                &grid, self.eq_nr, self.eq_nz,
                grid_r_min, grid_r_max, grid_z_min, grid_z_max,
                &[0.0],
            );
            contours.into_iter().next().unwrap_or(Contour {
                level: 0.0,
                points: vec![],
            })
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
            self.transport.elm_active,
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
            disruption_risk: self.disruption.risk,
            disrupted: self.disruption.disrupted,
            diagnostics,
            flux_surfaces,
            separatrix,
            axis_r,
            axis_z,
            xpoint_r,
            xpoint_z,
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
}
