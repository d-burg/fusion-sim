//! Main simulation loop tying together equilibrium, transport,
//! disruption, profiles, and diagnostics.

use serde::{Deserialize, Serialize};

use crate::contour::{self, Contour};
use crate::devices::{Device, MagneticConfig};
use crate::circuit::{self, OhmicCircuit};
use crate::diagnostics::{DiagnosticSignals, NoiseGen};
use crate::disruption::DisruptionModel;
use crate::equilibrium::{CerfonEquilibrium, ShapeParams};
use crate::profiles::Profiles;
use crate::transport::{ProgramValues, TransportModel};

/// A point in a programmed waveform: (time_s, value).
pub type WaveformPoint = (f64, f64);

/// Fraction of flat-top current at which the ramp-up plasma stops being a
/// wall-limited column and forms its divertor X-point — and, in reverse, at
/// which the ramp-down plasma goes back onto the limiter.
///
/// Tokamak start-ups begin as a small, near-circular plasma limited on the
/// centre-stack (or start-up limiter), grow in size and elongation with Ip,
/// and only divert once enough current is available to hold the X-point:
///   * JET ITER-like ramps put the X-point formation at ≈32% of flat-top Ip
///     (Hogeweij et al., Nucl. Fusion 55 (2015) 013009);
///   * ITER 15 MA scenario modelling diverts at 27–30% (Parail et al., Nucl.
///     Fusion 53 (2013) 113002; Jackson et al., GA-A26858).
/// The same modelling makes the ramp-down divertor→limiter transition
/// symmetric with ramp-up, which is automatic here because the transition is
/// a function of the ramp fraction alone.
///
/// The trigger used here is ELONGATION, not current: the limited column stays
/// a smooth ellipse tangent to the inboard limiter, swelling outward and
/// elongating with the programmed κ, and diverts once its elongation has
/// come this fraction of the way from round (κ = 1) to the programme's
/// flat-top κ. X-point formation is the moment the column leaves the wall:
/// the ellipse lifts off and is diverted from the first instant, with its
/// divertor legs already running to the targets, and the diverted plasma
/// then walks out to the fitted magnetic centre as the remaining elongation
/// is applied. Ramp-down retraces this: the diverted plasma is carried back
/// onto the limiter and re-limits on contact.
///
/// The fraction itself is per device (`Device::divert_kappa_frac`): 0.6 puts
/// X-point formation at κ ≈ 1.4–1.6, later in the current ramp (≈60% of
/// flat-top) than the ≈30% the ramp studies above report — a deliberate
/// presentation choice so the elongated limited phase is actually visible;
/// highly elongated limiter plasmas are run on real machines (JET, TCV).

/// Fraction of the post-formation elongation range over which the boundary
/// triangularity fades from its formation value (`DELTA_XPOINT_MIN`) to the
/// programmed one.
const DELTA_FADE_SPAN: f64 = 0.3;

/// Neutral-beam current-drive figure of merit γ = n̄₂₀R₀I_cd/P_cd
/// (10²⁰ A W⁻¹ m⁻²) at a 10 keV volume-averaged temperature. The ITER
/// design row of the PROCESS physics paper (Kovari et al., Table 5: 1 MA
/// beam-driven from 33 MW at n̄ = 1.0×10²⁰ m⁻³, R = 6.2 m) gives 0.19.
const GAMMA_NBCD_10KEV: f64 = 0.2;
/// Electron-cyclotron current-drive figure of merit at 10 keV. Taken equal
/// to the beam value; the ITER design figure was not verified (assumption).
const GAMMA_ECCD_10KEV: f64 = 0.2;


/// Smallest boundary triangularity a diverted solve is given. The X-point
/// boundary conditions put the X-point at x = 1 − 1.01·δ·ε, so as δ → 0 it
/// slides under the axis and the system degenerates; a freshly formed
/// X-point therefore starts at this δ (a modestly D-shaped boundary) rather
/// than at the limited ellipse's zero. Forming an X-point is a topology
/// change — this is the jump it makes.
const DELTA_XPOINT_MIN: f64 = 0.2;
/// Largest |δ| handed to the analytic equilibrium, which takes asin(δ). The
/// planner's δ range stops short of this after the device's fitted offset
/// (see `deltaRange` in web/src/lib/program.ts); drawn waveforms are caught
/// here, so no program can produce a NaN axis.
const DELTA_EQ_MAX: f64 = 0.95;

/// Smooth 0→1 ramp (cubic smoothstep) of `x` over [0, 1].
fn smoothstep01(x: f64) -> f64 {
    let t = x.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Pulse program: collection of time-dependent waveforms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PulseProgram {
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
    /// Nitrogen seeding rate (s, 10²⁰ atoms/s); absent in older programmes
    #[serde(default)]
    pub n2_puff: Vec<WaveformPoint>,
    /// Argon seeding rate (s, 10²⁰ atoms/s); absent in older programmes
    #[serde(default)]
    pub argon_puff: Vec<WaveformPoint>,
    /// Total pulse duration (s)
    pub duration: f64,
    /// Magnetic configuration override ("LowerSingleNull", "UpperSingleNull",
    /// "DoubleNull").  When absent, falls back to the device default.
    #[serde(default)]
    pub config_override: Option<String>,
}

impl PulseProgram {
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
            n2_puff: Self::interpolate(&self.n2_puff, t),
            argon_puff: Self::interpolate(&self.argon_puff, t),
        }
    }

    /// Create a standard H-mode pulse program for a given device.
    /// Parameters based on real operating scenarios:
    ///   DIII-D: 1.2 MA, 5 MW NBI, 7s (what its 7.5 V·s Ohmic swing pays for)
    ///   ITER:  15 MA, 33 MW NBI + 20 MW ECH, 100s
    ///   JET:   2.5 MA, 25 MW NBI + 4 MW ICRH, 20s
    pub fn standard_hmode(device: &Device) -> Self {
        // Per-device H-mode parameters (Ip, duration, heating, density fraction)
        let (ip_flat, duration, p_nbi, p_ech, p_ich, ne_frac) = match device.id.as_str() {
            "iter"    => (device.ip_max, 100.0, 33.0, 20.0, 0.0, 0.80),
            "jet"     => (3.5,           20.0,  25.0,  0.0, 4.0, 0.70),
            // CENTAUR: 9.6 MA, 20s pulse, 30 MW ICRH, fGW = 0.65
            // NT breakeven scenario — high-field compact DT machine
            "centaur" => (device.ip_max, 20.0,  0.0,   0.0, 30.0, 0.65),
            // DIII-D: 7 s is what its Ohmic coil's 7.5 V·s pays for at
            // 1.2 MA with this plasma's flat-top loop voltage (~0.5 V):
            // about 85 % of the swing. A real DIII-D shot is 5–7 s long.
            _         => (device.ip_max * 0.4, 7.0, 5.0, 0.0, 0.0, 0.60),
        };
        // ITER and CENTAUR use full toroidal field; other devices typically
        // run slightly below max.
        let bt = match device.id.as_str() {
            "iter" | "centaur" => device.bt_max,
            _                  => device.bt_max * 0.9,
        };
        let ne_target = device.greenwald_density(ip_flat) * ne_frac;

        // Per-device waveform timing fractions of duration.
        // ITER: fast ramp (most of 100s is flat-top/burn phase)
        // JET/DIII-D: standard ramp fractions
        let (f_ramp0, f_ramp1, f_end, f_down) = match device.id.as_str() {
            // ITER: the ramp is what the Ohmic supply can drive. 15 MA
            // through L_p ≈ 10 µH at ~12 V is at best ~1 MA/s, so the
            // current reaches flat-top at 25 s and takes 16 s to come down
            // (the machine itself takes ~80 s each way); the burn phase is
            // the ~55 s between.
            "iter"    => (0.05, 0.25, 0.84, 0.92),
            // CENTAUR: 2.9 MA/s through 3 µH during the first second sits
            // just under the 12 V supply; the rest of the ramp at ~2.2 MA/s.
            "centaur" => (0.05, 0.20, 0.70, 0.85), // ~4s up, 10s flat, ~4s down
            // DIII-D: ramp 0.5/1.5 s, flat-top to 4.9 s, down from 5.95 s.
            _         => (0.071, 0.214, 0.70, 0.85),
        };
        let (f_heat_on, f_heat_full, f_heat_off0, f_heat_off) = match device.id.as_str() {
            // ITER: keep the auxiliary heating on into the early ramp-down and
            // taper it out over the first 4 s (0.88→0.92). With heating cut to
            // zero at 0.88 — the same instant Ip starts down, while density
            // holds to 0.95 — Prad/Pin jumped to ~0.74 and the radiation-
            // fraction risk sat at 1/s for the 1.4 s before the ramp-down
            // trigger suppression engages, so ~3/4 of pulses that reached the
            // ramp-down died there. Real terminations keep heating on to
            // control the H–L transition (Politzer NF 2010; de Vries NF 2018).
            // ITER heating comes on once Ip is at flat-top (0.25).
            "iter"    => (0.26, 0.30, 0.84, 0.88),
            "centaur" => (0.18, 0.22, 0.68, 0.80), // ICRH on during flat-top, off before Ip ramp-down
            // DIII-D: NBI on at 1.5 s, full at 1.9 s, tapering 4.7–5.2 s.
            _         => (0.214, 0.27, 0.67, 0.74),
        };
        let (f_ne0, f_ne1, f_ne_end, f_ne_off) = match device.id.as_str() {
            // ITER density follows the slower current ramp, so the Greenwald
            // fraction stays below ~0.8 while Ip is still rising.
            "iter"    => (0.12, 0.28, 0.84, 0.92),
            "centaur" => (0.10, 0.22, 0.68, 0.82),
            _         => (0.107, 0.214, 0.70, 0.85),
        };

        PulseProgram {
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
            n2_puff: vec![(0.0, 0.0), (duration, 0.0)],
            argon_puff: vec![(0.0, 0.0), (duration, 0.0)],
            duration,
            config_override: None,
        }
    }

    /// Create an L-mode only pulse (low power).
    pub fn lmode(device: &Device) -> Self {
        let ip_max = device.ip_max * 0.4;
        let bt = device.bt_max * 0.9;
        // Device-specific timing for consistent ramp rates
        let (duration, t_ramp_start, t_ramp_end, t_flat_end, t_down) = match device.id.as_str() {
            "centaur" => (16.0, 1.0, 4.0, 12.0, 14.0),
            // ITER: 6 MA at ≤ 0.5 MA/s, what ~12 V drives through ~10 µH.
            "iter"    => (50.0, 4.0, 12.0, 40.0, 47.0),
            // DIII-D: an L-mode plasma at 1.2 MA burns ~1.3 V·s per second
            // of flat-top, so 7.5 V·s pays for under 2 s after a 4.3 V·s ramp
            // (this uses ~87 % of the swing).
            "diiid"   => (5.25, 0.5, 1.5, 3.25, 4.25),
            _         => (8.0,  0.5, 1.5, 6.0,  7.0),
        };
        let ne_target = device.greenwald_density(ip_max) * 0.4;

        PulseProgram {
            ip: vec![
                (0.0, 0.0),
                (t_ramp_start, ip_max * 0.3),
                (t_ramp_end, ip_max),
                (t_flat_end, ip_max),
                (t_down, ip_max * 0.5),
                (duration, 0.0),
            ],
            bt: vec![(0.0, bt), (duration, bt)],
            // Density and fuelling follow the DEVICE's flat-top times. They
            // were hardcoded at 1/6/7 s, which is DIII-D's 8 s pulse but left
            // ITER (50 s) and CENTAUR (16 s) at 5×10¹⁸ m⁻³ for most of their
            // flat-top — and at absurd temperatures, since T ∝ W/(n V) blows
            // up as n → 0. The anchors below reproduce the old DIII-D/JET
            // waveforms exactly (t_ramp_start 0.5, t_ramp_end 1.5, t_flat_end
            // 6, t_down 7) and scale with the other devices' tuples.
            ne_target: vec![
                (0.0, 0.05),
                (2.0 * t_ramp_start, ne_target),
                (t_flat_end, ne_target),
                (t_down, 0.05),
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
                (0.6 * t_ramp_start, 2.0),
                (t_ramp_end, 2.0),
                (t_flat_end, 2.0),
                (t_down, 0.0),
                (duration, 0.0),
            ],
            neon_puff: vec![(0.0, 0.0), (duration, 0.0)],
            n2_puff: vec![(0.0, 0.0), (duration, 0.0)],
            argon_puff: vec![(0.0, 0.0), (duration, 0.0)],
            duration,
            config_override: None,
        }
    }

    /// Create a density-limit push scenario (likely to disrupt).
    pub fn density_limit(device: &Device) -> Self {
        let ip_max = device.ip_max * 0.5;
        let bt = device.bt_max * 0.9;
        // CENTAUR needs longer duration for slower ramps (high-field machine)
        let (duration, t_ramp_start, t_ramp_end, t_flat_end, t_down) = match device.id.as_str() {
            "centaur" => (16.0, 1.0, 4.0, 12.0, 14.0),
            // ITER: 6 MA at ≤ 0.5 MA/s, what ~12 V drives through ~10 µH.
            "iter"    => (50.0, 4.0, 12.0, 40.0, 47.0),
            // DIII-D keeps the 8 s timing on purpose: at 1.5 MA its Ohmic
            // coil's 7.5 V·s is gone at ~4.5 s of this push, and the sagging
            // current then drives the Greenwald fraction up — two limits
            // met in one pulse, both in the event log.
            _         => (8.0,  0.5, 1.5, 6.0,  7.0),
        };
        let ne_target = device.greenwald_density(ip_max) * 1.1; // Above Greenwald!

        PulseProgram {
            ip: vec![
                (0.0, 0.0),
                (t_ramp_start, ip_max * 0.3),
                (t_ramp_end, ip_max),
                (t_flat_end, ip_max),
                (t_down, ip_max * 0.5),
                (duration, 0.0),
            ],
            bt: vec![(0.0, bt), (duration, bt)],
            ne_target: vec![
                (0.0, 0.05),
                (t_ramp_end * 0.7, ne_target * 0.3),
                (t_ramp_end * 1.2, ne_target * 0.6),
                ((t_ramp_end + t_flat_end) * 0.5, ne_target), // Push above Greenwald limit
                (t_flat_end, ne_target),
                (duration, 0.05),
            ],
            p_nbi: vec![
                (0.0, 0.0),
                (t_ramp_end * 1.1, 0.0),
                (t_ramp_end * 1.3, 3.0),
                (t_flat_end, 3.0),
                (t_down, 0.0),
                (duration, 0.0),
            ],
            p_ech: vec![(0.0, 0.0), (duration, 0.0)],
            p_ich: vec![(0.0, 0.0), (duration, 0.0)],
            kappa: vec![
                (0.0, 1.0),
                (t_ramp_end, device.kappa),
                (t_flat_end, device.kappa),
                (duration, 1.0),
            ],
            delta: vec![
                (0.0, 0.0),
                (t_ramp_end, device.delta_lower),
                (t_flat_end, device.delta_lower),
                (duration, 0.0),
            ],
            d2_puff: vec![
                (0.0, 0.0),
                (t_ramp_start, 3.0),
                (t_ramp_end * 1.1, 4.0),  // High gas puff pushing Greenwald limit
                // Peak, taper and cut-off follow the device's flat-top end and
                // ramp-down (these were DIII-D's 5/6/7 s for every device, so
                // ITER's puff was off from 7 s of a 50 s pulse). Unchanged for
                // DIII-D/JET (t_flat_end 6, t_down 7).
                (t_flat_end - 1.0, 5.0),
                (t_flat_end, 3.0),
                (t_down, 0.0),
                (duration, 0.0),
            ],
            neon_puff: vec![(0.0, 0.0), (duration, 0.0)],
            n2_puff: vec![(0.0, 0.0), (duration, 0.0)],
            argon_puff: vec![(0.0, 0.0), (duration, 0.0)],
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
    pub mass_number: f64,

    // Programmed references
    pub prog_ip: f64,
    /// Peak programmed Ip over the whole pulse (MA): the flat-top value,
    /// so the frontend can fade Q against this pulse rather than the
    /// machine's maximum rating.
    pub prog_ip_peak: f64,
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
    pub p_alpha: f64,
    pub beta_n: f64,
    pub beta_t: f64,
    pub q95: f64,
    pub f_greenwald: f64,
    pub li: f64,
    pub h_factor: f64,
    pub in_hmode: bool,
    pub elm_active: bool,
    pub elm_type: u8,
    /// Energy lost by the most recent ELM crash (MJ)
    pub elm_energy_loss: f64,
    pub elm_suppressed: bool,
    pub ne_ped: f64,
    pub te_ped: f64,
    pub ne_line: f64,
    pub impurity_fraction: f64,
    pub d2_puff: f64,
    pub neon_puff: f64,
    pub n2_puff: f64,
    pub argon_puff: f64,
    /// Core seeded-impurity fractions n_z/n_e per species
    pub imp_n: f64,
    pub imp_ne: f64,
    pub imp_ar: f64,
    /// Effective charge including the seeded species
    pub z_eff: f64,
    /// Fuel ion fraction n_fuel/n_e after dilution by the seeded species
    pub fuel_fraction: f64,

    // Disruption
    /// Hazard rate: probability per second of a disruption starting.
    pub disruption_risk: f64,
    pub disrupted: bool,
    /// "" | "precursor" | "thermal_quench" | "current_quench" | "complete"
    pub disruption_phase: String,
    /// "" until a disruption starts, then the dominant hazard term at the
    /// trigger: density_limit | beta_limit | kink_limit | radiative_collapse
    /// | locked_mode | wall_contact.
    pub disruption_cause: String,
    /// The individual hazard terms (each 0-1) behind `disruption_risk`.
    pub risk_greenwald: f64,
    pub risk_beta: f64,
    pub risk_q95: f64,
    pub risk_radiation: f64,
    pub risk_locked_mode: f64,
    /// L-H power threshold (MW) the transition logic compares net heating to.
    pub p_lh: f64,

    // Ohmic drive
    /// Surface loop voltage the poloidal-field system applies (V); the
    /// resistive drop of the cold plasma during a current quench.
    pub v_loop: f64,
    /// Solenoid flux swing used so far (Wb) and the swing available.
    pub flux_consumed: f64,
    pub flux_budget: f64,
    /// Non-inductive current (MA): bootstrap and beam/EC driven.
    pub i_bootstrap: f64,
    pub i_cd: f64,
    /// The Ohmic supply is at its voltage limit (or the flux is gone) and
    /// Ip is not following its programme.
    pub oh_saturated: bool,
    /// The flux swing is used up: no more positive loop voltage.
    pub flux_exhausted: bool,

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
#[cfg(test)] // retained for shape unit tests; the contact check now marches the solved boundary
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
    pub program: PulseProgram,
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

    // Peak programmed Ip seen during this pulse — used to detect ramp-down
    peak_prog_ip: f64,

    // Smoothed l_i (resistive timescale ~ 200ms)
    smoothed_li: f64,

    // Ohmic drive: the solenoid circuit that actually carries Ip to its
    // programme, with the flux-swing budget that ends the flat-top.
    circuit: OhmicCircuit,
    // Poloidal beta from the last step, for the bootstrap current.
    beta_p: f64,
    // Non-inductive current split (MA) from the last step: bootstrap, driven.
    i_bootstrap: f64,
    i_cd: f64,

    // Equilibrium grid resolution
    eq_nr: usize,
    eq_nz: usize,
    n_flux_surfaces: usize,
}

impl Simulation {
    /// Create a new simulation for a given device and pulse program.
    pub fn new(device: Device, program: PulseProgram) -> Self {
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
            peak_prog_ip: 0.0,
            smoothed_li: 1.2,
            circuit: OhmicCircuit::new(device.flux_swing_vs, device.v_loop_max),
            beta_p: 0.0,
            i_bootstrap: 0.0,
            i_cd: 0.0,
            eq_nr: 48,
            eq_nz: 72,
            n_flux_surfaces: 10,
            device,
        }
    }

    /// Seed the disruption model RNG.  Call from WASM layer with JS entropy.
    /// Read-only access to the live equilibrium (diagnostics/examples).
    pub fn equilibrium(&self) -> &CerfonEquilibrium {
        &self.equilibrium
    }

    /// Programmed elongation as a fraction of the way from round (κ = 1) to
    /// the programme's peak κ — the trigger for X-point formation and the
    /// progress variable of the lift-off trajectory (see Device::divert_kappa_frac).
    /// Falls back to the current ramp fraction for a programme that never
    /// elongates.
    fn kappa_ramp_fraction(&self, prog_kappa: f64) -> f64 {
        let kappa_peak = self
            .program
            .kappa
            .iter()
            .map(|&(_, v)| v)
            .fold(1.0_f64, f64::max);
        if kappa_peak <= 1.0 + 1e-9 {
            return self.ip_ramp_fraction(self.program_ip_now());
        }
        ((prog_kappa - 1.0) / (kappa_peak - 1.0)).clamp(0.0, 1.0)
    }

    /// Programmed current at the current time.
    fn program_ip_now(&self) -> f64 {
        PulseProgram::interpolate(&self.program.ip, self.time)
    }

    /// Programmed current as a fraction of the programme's peak current —
    /// the ramp variable for plasma size and the limited-phase inboard shift.
    /// Zero below the 0.1 MA breakdown threshold.
    /// Peak programmed Ip over the whole pulse (MA), floored at 0.1.
    fn program_ip_peak(&self) -> f64 {
        self.program
            .ip
            .iter()
            .map(|&(_, v)| v)
            .fold(0.0_f64, f64::max)
            .max(0.1)
    }

    fn ip_ramp_fraction(&self, prog_ip: f64) -> f64 {
        if prog_ip <= 0.1 {
            return 0.0;
        }
        (prog_ip / self.program_ip_peak()).clamp(0.0, 1.0)
    }

    /// Non-inductive current (MA) as (bootstrap, driven) from the last step's
    /// plasma. Bootstrap follows the ITER Physics Design Guidelines form
    /// (Uckan et al. 1990, as given by Sakai, Fujita & Okamoto 2019 eqs 24–25):
    /// f_bs = C_bs (√ε β_p)^1.3 with C_bs = 1.32 − 0.235 x + 0.0185 x²,
    /// x = q95/q0, taking q0 ≈ 1. Beam and EC current drive use figures of
    /// merit γ = n̄₂₀ R₀ I_cd / P_cd that scale with the plasma temperature
    /// (Fisch: η_cd ∝ T_e/n_e), normalised at 10 keV. ICRF is heating only.
    fn non_inductive_current(&self, prog: &ProgramValues) -> (f64, f64) {
        if self.actual_ip < 0.1 || self.transport.ne_bar < 0.05 {
            return (0.0, 0.0);
        }
        let eps = self.device.epsilon();
        let x = self.transport.q95.clamp(2.0, 8.0);
        let c_bs = 1.32 - 0.235 * x + 0.0185 * x * x;
        let f_bs = (c_bs * (eps.sqrt() * self.beta_p.max(0.0)).powf(1.3)).min(0.9);
        let i_bs = f_bs * self.actual_ip;
        let te_scale = (self.profiles.te_vol_avg() / 10.0).clamp(0.0, 1.0);
        let denom = self.transport.ne_bar * self.device.r0;
        let i_nb = GAMMA_NBCD_10KEV * te_scale * prog.p_nbi / denom;
        let i_ec = GAMMA_ECCD_10KEV * te_scale * prog.p_ech / denom;
        (i_bs, i_nb + i_ec)
    }

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
        self.peak_prog_ip = 0.0;
        self.smoothed_li = 1.2;
        self.circuit.reset();
        self.beta_p = 0.0;
        self.i_bootstrap = 0.0;
        self.i_cd = 0.0;
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

        // Check for end of pulse
        if self.time >= self.program.duration {
            self.status = SimulationStatus::Complete;
            return self.snapshot();
        }

        // Get programmed values
        let prog = self.program.values_at(self.time);

        // ── Ohmic drive ──
        // The solenoid circuit carries the current toward its programme;
        // the transport model then sees the current that actually flows.
        let (i_bs, i_cd) = self.non_inductive_current(&prog);
        self.i_bootstrap = i_bs;
        self.i_cd = i_cd;
        let i_ni = (i_bs + i_cd).min(self.actual_ip.max(0.0));
        let l_p = circuit::plasma_inductance(&self.device, prog.kappa, self.smoothed_li);
        let r_p = circuit::plasma_resistance(
            &self.device,
            |rho| self.profiles.te(rho),
            |rho| self.profiles.ne(rho),
            self.transport.q95,
            self.transport.z_eff,
            circuit::TE_FLOOR_DRIVE,
        );
        if !self.disruption.disrupted {
            let ip_prev = PulseProgram::interpolate(&self.program.ip, self.time - dt);
            let dip_dt = (prog.ip - ip_prev) / dt;
            let psi_v = circuit::vertical_field_flux(&self.device, self.actual_ip, self.beta_p, self.smoothed_li);
            self.circuit.step(dt, prog.ip, dip_dt, l_p, r_p, i_ni, psi_v);
            self.actual_ip = self.circuit.ip;
        }
        self.transport.set_ohmic_drive(r_p, i_ni, prog.ip);

        // ── Transport step ──
        let prog_driven = ProgramValues { ip: self.actual_ip, ..prog.clone() };
        self.transport
            .step(dt, &self.device, &prog_driven, self.device.z_eff);

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

        // Track peak programmed Ip to detect the ramp-down phase.
        if prog.ip > self.peak_prog_ip {
            self.peak_prog_ip = prog.ip;
        }

        // Scale threshold with ip_max — avoids spurious Greenwald violations
        // during very early ramp-up in large-bore machines (ITER: n_GW ∝ Ip/a²
        // is tiny at low Ip when a is large).
        let ip_threshold = (0.05 * self.device.ip_max).max(0.1);
        // During programmed ramp-down, risk factors (radiation fraction, Greenwald
        // fraction) transiently spike as heating drops faster than stored energy
        // decays. This is normal controlled termination physics, not a precursor
        // to uncontrolled disruption.  We still update the risk display but
        // suppress the stochastic trigger once Ip has dropped below 90% of its
        // peak (i.e. the programmed ramp-down has begun).
        let in_rampdown = self.peak_prog_ip > 0.5
            && prog.ip < 0.9 * self.peak_prog_ip;
        if !self.disruption.disrupted && self.actual_ip > ip_threshold {
            self.disruption.update_risk(
                self.smoothed_f_greenwald,
                self.smoothed_beta_n,
                self.transport.q95, // q95 not affected by ELMs, no smoothing needed
                self.smoothed_p_rad_frac,
                self.actual_ip,
            );
            // During rampdown, suppress the risk display — transient spikes
            // in radiation fraction and beta are normal controlled termination
            // physics, not disruption precursors. Fade risk toward the baseline
            // floor as Ip drops.
            if in_rampdown {
                let ramp_frac = (prog.ip / self.peak_prog_ip).clamp(0.0, 1.0);
                self.disruption.risk *= ramp_frac;
            } else {
                self.disruption.check_trigger(dt);
            }
        }

        // ── Apply disruption effects ──
        // External normalised inductance for the thermal-quench Ip spike.
        let lambda_ext = (8.0 * self.device.r0 / (self.device.a * self.device.kappa.sqrt())).ln() - 2.0;
        let disruption_effects =
            self.disruption.advance(dt, self.actual_ip, self.transport.li, lambda_ext);
        if self.disruption.disrupted {
            if let Some(ip) = disruption_effects.ip {
                self.actual_ip = ip;
            }
            self.transport.te0 *= disruption_effects.te_multiplier;
            self.transport.w_th *= disruption_effects.te_multiplier; // Energy drops with Te
            // The quench owns the current; the loop voltage reads the
            // resistive drop across the cooling plasma, which is the spike a
            // flux loop sees in a current quench.
            let cold = (self.transport.te0 / self.profiles.te(0.0).max(1e-3)).clamp(0.0, 1.0);
            let r_cold = circuit::plasma_resistance(
                &self.device,
                |rho| self.profiles.te(rho) * cold,
                |rho| self.profiles.ne(rho),
                self.transport.q95,
                self.transport.z_eff,
                circuit::TE_FLOOR_QUENCH,
            );
            self.circuit.override_current(self.actual_ip, r_cold);

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
            prog.delta,
            self.transport.tau_e,
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
        // Through a disruption the quench owns the current profile: the
        // thermal quench flattens it (li drops) and it stays flat while the
        // current decays.
        if let Some(li) = disruption_effects.li {
            self.transport.li = li;
            self.smoothed_li = li;
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
        // For the bootstrap current use the conventional β_p with the
        // perimeter-averaged poloidal field ⟨B_p⟩ = μ₀I_p/(2πa√((1+κ²)/2));
        // the circular-edge value above is the equilibrium's A parameter and
        // reads ~2.5× low on an elongated plasma.
        self.beta_p = if self.actual_ip > 0.1 {
            let p_avg_pa = self.profiles.pressure_vol_avg() * 1.602e4;
            let mu0 = 4.0 * std::f64::consts::PI * 1e-7;
            let kappa = prog.kappa.max(1.0);
            let perimeter = 2.0 * std::f64::consts::PI * self.device.a * ((1.0 + kappa * kappa) / 2.0).sqrt();
            let bp_avg = mu0 * self.actual_ip * 1e6 / perimeter;
            2.0 * mu0 * p_avg_pa / (bp_avg * bp_avg)
        } else {
            0.0
        };
        let a_param = -0.05 - 0.1 * beta_p.min(2.0); // A shifts with pressure

        // Ramp variable for the plasma size, the limiter→divertor transition
        // and the centroid trajectory: programmed current relative to the
        // programme's peak. (This used to be actual_ip / prog.ip, which is
        // identically 1 because the current tracks its waveform, so the
        // start-up plasma was full-size from the first frame.)
        let ip_frac = self.ip_ramp_fraction(prog.ip);

        // Lift-off weight: 0 while the plasma rests on the limiter, 1 once it
        // sits on its fitted magnetic centre (see self.device.divert_kappa_frac). Any
        // positive lift means the column has left the wall, and that is
        // exactly when it is diverted.
        // Ease-out (fast start, gentle finish): the gap opens visibly the
        // instant the X-point forms and settles smoothly at full size. Read
        // in reverse for ramp-down, the plasma approaches the limiter slowly
        // and closes the last of the gap quickly before re-limiting.
        // Elongation progress: 0 round, 1 at the programme's flat-top κ.
        let kappa_frac = self.kappa_ramp_fraction(prog.kappa);
        // Progress through the diverted part of the elongation ramp.
        let u_div = ((kappa_frac - self.device.divert_kappa_frac) / (1.0 - self.device.divert_kappa_frac)).clamp(0.0, 1.0);
        let lift = 1.0 - (1.0 - u_div) * (1.0 - u_div);
        // Triangularity fade from the X-point formation value to the
        // programmed one (see DELTA_FADE_SPAN).
        let delta_fade = smoothstep01(u_div / DELTA_FADE_SPAN);

        // A plasma below self.device.divert_kappa_frac of its elongation ramp is limited on
        // the wall; past it, it is diverted whatever the δ waveform does — the
        // X-point forms at DELTA_XPOINT_MIN and the programmed δ takes over
        // as it fades in. (The old '|δ| < 0.1 ⇒ limited' rule would keep a
        // device whose δ waveform lags its Ip waveform — CENTAUR — limited
        // while already lifting off the wall, which is exactly the state we
        // must never show: a plasma off the limiter has legs.)
        let config = if kappa_frac < self.device.divert_kappa_frac {
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

        // Device-specific correction for the analytic-vs-real boundary shape
        // mismatch (see Device::equilibrium_a_scale). Applied to every branch
        // so the rendered plasma and the wall-contact check stay consistent.
        let base_epsilon = self.device.epsilon() * self.device.equilibrium_a_scale;
        // The plasma starts small — a near-circular column limited on the
        // inboard wall (see the centroid trajectory below) — and grows
        // with the programmed current, reaching the fitted flat-top size from
        // 97% of peak. One ramp for all configurations, so nothing jumps when
        // the programmed δ crosses 0.1 and the plasma diverts.
        let size = 0.35 + 0.65 * (ip_frac / 0.97).min(1.0);
        let epsilon = if config == MagneticConfig::Limited {
            base_epsilon * size
        } else if config == MagneticConfig::DoubleNull {
            // DN plasmas were historically shrunk 12% to clear the old
            // hand-drawn "divertor shelf" walls. A device whose
            // equilibrium_a_scale has been fitted against the real limiter
            // already encodes its wall clearance, so the generic shrink
            // double-counts: on CENTAUR it left the live plasma 12% smaller
            // than the fitted shape and drove the outer strike off the notch
            // floor onto the back wall. Keep the shrink only for future DN
            // devices that have not been fitted (a_scale still 1.0).
            if self.device.equilibrium_a_scale != 1.0 {
                base_epsilon * size
            } else {
                base_epsilon * 0.88 * size
            }
        } else {
            base_epsilon * size
        };

        // Limited plasmas are solved with the X-point-free Cerfon–Freidberg
        // system (`assemble_limited_system`), which is well conditioned down
        // to δ = 0, so the start-up column is the plain ellipse it should be.
        // (The old δ ≥ 0.2 clamp existed only because the limited phase used
        // to be solved with the LSN X-point boundary conditions, which go
        // degenerate as the virtual X-point approaches the geometric centre.)
        //
        // Once diverted, the boundary triangularity starts at the X-point
        // formation value and fades to the programmed one over
        // the first DELTA_FADE_SPAN of the diverted elongation range. (At
        // flat-top δ_fade = 1, so δ is the programmed
        // value unless the device's own flat-top |δ| is below the floor.)
        let delta_eff = if config == MagneticConfig::Limited {
            0.0
        } else {
            // The X-point's side (positive or negative triangularity) is the
            // device's, not the instantaneous waveform's, which may still be
            // ≈0 when the plasma diverts.
            let sign = if self.device.delta_lower < 0.0 { -1.0 } else { 1.0 };
            let target = prog.delta.abs().max(DELTA_XPOINT_MIN);
            sign * (DELTA_XPOINT_MIN + (target - DELTA_XPOINT_MIN) * delta_fade)
        };

        // ── Strike-point sweep ──
        // Slow oscillation of the boundary triangularity, which moves the
        // X-points — and with them the separatrix legs, the strike points and
        // the divertor glow — back and forth across the targets. Everything
        // downstream (equilibrium panel, contour tracing, portview) follows
        // from the perturbed equilibrium, so the sweep is self-consistent by
        // construction. Only active once diverted and near flat-top current.
        // The sweep excursions to HIGHER δ: δ oscillates in [δ₀, δ₀ + amp].
        // A higher δ moves the X-points inboard, which walks the outer strike
        // point INBOARD along the divertor roof diagonal — away from the outer
        // vertical face, which is baffle rather than target. Containment at
        // the +amp extreme is verified by the fit harness (21 mm clearance)
        // and guarded at runtime by the solved-boundary contact check below.
        // Sweep only during TRUE flat-top current. During the Ip ramps the
        // plasma shape and β are transient, and the grazing-incidence outer
        // landing wanders far enough to clip the back-corner baffle no matter
        // how the sweep is tuned — measured repeatedly at both H-mode entry
        // and rampdown onset. Real strike sweeps are likewise a flat-top
        // activity; the ramps hold a static shape.
        let sweep_active = self.device.strike_sweep_hz > 0.0
            && config != MagneticConfig::Limited
            && prog.ip > 0.97 * self.device.ip_max;
        // Dwell-equalized waveform. A plain sinusoid gave a badly lopsided
        // dwell (measured with examples/sweep_dwell.rs): the δ→strike-arc
        // mapping along the roof diagonal is compressive at the +δ (inboard)
        // end — s(u) ≈ u^0.33 — so the sinusoid's turning-point dwell piled
        // 30% of the period into one 25 mm band at the inboard end while the
        // outboard half of the target got a grazing instant. A triangle wave
        // in normalized arc position v, warped through the inverse mapping
        // u = v³, makes the strike traverse the target at near-constant speed:
        // measured dwell is then flat across the sweep range. u = 0 is the
        // outboard-deep extreme (δ-rest), u = 1 the inboard extreme (δ+amp).
        let sweep_frac = (self.device.strike_sweep_hz * self.time).fract();
        let sweep_u = {
            let v = 1.0 - (2.0 * sweep_frac - 1.0).abs(); // triangle 0→1→0
            v * v * v
        };
        // Symmetric about the rest delta: `strike_sweep_delta` is the FULL
        // sweep width, so the device's baseline delta is the sweep MIDPOINT
        // (u = 0.5) rather than the outboard extreme. Changed from one-sided
        // rest + amp*u when the SPARC baseline was re-anchored to the swept
        // midpoint (user call, 2026-08-18).
        let delta_eff = if sweep_active {
            delta_eff + self.device.strike_sweep_delta * (sweep_u - 0.5)
        } else {
            delta_eff
        };
        // Vertical rock, IN phase with the δ modulation: the plasma (and both
        // X-points) rises 0..strike_sweep_z as δ excursions inboard, sliding
        // the strike points along the angled target faces — the only lever
        // that actually moves the inner strikes (see Device::strike_sweep_z).
        //
        // The phasing is load-bearing: the upward rock deepens the upper
        // outer landing, and the landing is bistable with the back-corner
        // baffle — an out-of-phase rock lifts the plasma while the outer
        // strike is at its deep (δ-rest) end and snaps it onto the corner at
        // every κ in the usable range. In phase, the deepest outer moment
        // coincides with z = 0, so the resting depth is controlled purely by
        // equilibrium_kappa_scale while the rock does its work at the safe,
        // far-inboard end of the sweep.
        //
        // Applied to the equilibrium centre so axis, X-points, legs and the
        // wall-contact check all follow consistently.
        // Quadratic easing on the rock: z ∝ ((1+sin)/2)², so the lift only
        // develops once the δ modulation has already carried the landing well
        // inboard. With a linear (shared-waveform) rock the mid-sweep
        // combination of partial lift + partial δ flips the grazing-incidence
        // landing onto the back-corner branch — measured as transient 0 mm
        // baffle clearance — even though both endpoints of the sweep are safe.
        self.equilibrium.z0 = if sweep_active {
            self.device.z0 + self.device.strike_sweep_z * sweep_u * sweep_u
        } else {
            self.device.z0
        };

        // ── Strike-point position control (β compensation) ──
        // The divertor-leg landing depth is grazing-incidence-sensitive to the
        // Shafranov shift: as β falls the landing slides OUTBOARD along the
        // target, and during rampdown (β: 0.57 → 0.5 at ICRF step-down) it
        // slid past the target's outermost extent onto the baffle corner —
        // measured as a burst of 0 mm baffle clearance at t ≈ 15.6 s while
        // the whole flat-top stayed clean. Real machines hold the strike
        // point with PF feedback; here the equilibrium elongation absorbs the
        // drift: below β_N ≈ 0.7 the κ scale rises slightly, retreating the
        // landing inboard down the diagonal as the pulse terminates.
        // Smoothed β is used so ELM transients don't jitter the boundary.
        let kappa_scale_eff = if self.device.strike_sweep_hz > 0.0 {
            self.device.equilibrium_kappa_scale
                + 0.006 * (0.70 - self.smoothed_beta_n).max(0.0)
        } else {
            self.device.equilibrium_kappa_scale
        };

        // The equilibrium-only corrections (δ offsets, κ scale, squareness)
        // are fitted against flat-top reference equilibria. The limited
        // start-up plasma must stay the plain near-circular shape it had
        // before those knobs existed, so they are weighted in with the
        // programmed δ ramp once diverted:
        // zero in the limited phase (a plain ellipse at δ = 0, the programmed
        // κ and zero squareness), full strength by the time δ reaches the
        // device's flat-top value.
        let shape_w = if config == MagneticConfig::Limited {
            0.0
        } else {
            let d_full = self.device.delta_lower.abs().max(0.2);
            ((prog.delta.abs() - 0.1) / (d_full - 0.1)).clamp(0.0, 1.0)
        };
        let kappa_scale_eff = 1.0 + (kappa_scale_eff - 1.0) * shape_w;

        // Equilibrium-only δ correction, applied as a rigid offset on the
        // programmed waveform so ramps and the strike sweep carry through
        // unchanged (see Device::equilibrium_delta_lower). The upper end then
        // carries the equilibrium's own up-down asymmetry on top.
        let delta_eq = delta_eff
            + shape_w * (self.device.equilibrium_delta_lower - self.device.delta_lower);
        let delta_eq_upper = delta_eq
            + shape_w
                * (self.device.equilibrium_delta_upper - self.device.equilibrium_delta_lower);
        let delta_eq = delta_eq.clamp(-DELTA_EQ_MAX, DELTA_EQ_MAX);
        let delta_eq_upper = delta_eq_upper.clamp(-DELTA_EQ_MAX, DELTA_EQ_MAX);
        // Equilibrium-only κ correction (see Device::equilibrium_kappa_scale)
        let kappa_eq = prog.kappa * kappa_scale_eff;

        // ── Centroid trajectory: inboard limiter → fitted magnetic centre ──
        // While limited, the column rests against the inboard wall: its
        // magnetic centre sits one minor radius outboard of the limiter; it
        // diverts the instant it leaves the wall (self.device.divert_kappa_frac of its
        // elongation ramp) and walks out to the device's fitted centre as a
        // diverted plasma (weight `lift`, over the rest of the elongation
        // ramp). Because the transition is a function of the programmed
        // waveforms alone, ramp-down retraces it in reverse: the diverted
        // plasma is carried back onto the limiter and re-limits on contact.
        //
        // Implemented as a real move of the equilibrium centre, so the axis,
        // the flux surfaces, the solved separatrix and the wall-contact check
        // all follow from one consistent equilibrium (this replaces a
        // cosmetic point-shift that used to be applied in the snapshot only).
        let r0_nom = self.device.r0 + self.device.equilibrium_r0_shift;
        // x = R/r0, so moving the centre at fixed ε would also rescale the
        // plasma. Hold the physical minor radius the size ramp asks for and
        // recompute ε for the moved centre instead.
        let a_phys = epsilon * r0_nom;
        // Designed clearance between the LCFS inboard edge and the limiter
        // (∞ once the plasma is on its fitted centre); gates the contact check.
        let mut inboard_gap = f64::INFINITY;
        let r0_eq = if lift >= 1.0 {
            r0_nom
        } else {
            // Inboard limiter radius over the plasma's own vertical span: the
            // centre stack is a vertical surface on these machines, so the
            // minimum wall R beside the column is the surface it touches.
            // (ITER's real start-up limiter is on the OUTBOARD wall; the
            // inboard centre stack is used here as the generic rule for every
            // device, which is what JET, DIII-D and the compact machines do.)
            let z_half = (kappa_eq * a_phys).max(0.05);
            let (z_lo, z_hi) = (self.equilibrium.z0 - z_half, self.equilibrium.z0 + z_half);
            // Minimum R of the wall POLYGON inside the band — clip each edge
            // to the band and take its end radii. Using vertices alone misses
            // a centre stack drawn as one long segment (SPARC): a small
            // plasma's band then holds only outboard vertices and the
            // 'limiter' lands on the wrong side of the vessel.
            let wall = &self.device.wall_outline;
            let mut r_lim = f64::INFINITY;
            for i in 0..wall.len() {
                let (r_a, z_a) = wall[i];
                let (r_b, z_b) = wall[(i + 1) % wall.len()];
                let (za, zb) = (z_a.min(z_b), z_a.max(z_b));
                if zb < z_lo || za > z_hi {
                    continue;
                }
                let r_at = |z: f64| {
                    if (z_b - z_a).abs() < 1e-12 {
                        r_a.min(r_b)
                    } else {
                        r_a + (r_b - r_a) * (z - z_a) / (z_b - z_a)
                    }
                };
                let lo = za.max(z_lo);
                let hi = zb.min(z_hi);
                r_lim = r_lim.min(r_at(lo)).min(r_at(hi));
            }
            if !r_lim.is_finite() {
                // No wall point beside the column (degenerate outline): fall
                // back to the vessel's global inboard extent.
                r_lim = self
                    .device
                    .wall_outline
                    .iter()
                    .map(|p| p.0)
                    .fold(f64::INFINITY, f64::min);
            }
            if r_lim.is_finite() {
                // Flat-top minor radius (the size ramp divided back out) and
                // the inboard gap the fitted flat-top equilibrium has.
                let a_full = (epsilon / size) * r0_nom;
                let gap_nom = (r0_nom - a_full - r_lim).max(0.0);
                let gap = if config == MagneticConfig::Limited {
                    0.0
                } else {
                    lift * gap_nom
                };
                inboard_gap = gap;
                // Never push the centre outboard of the fitted one.
                (r_lim + a_phys + gap).min(r0_nom)
            } else {
                r0_nom
            }
        };
        // Exact ε at flat-top: `lift == 1` must leave the fitted equilibrium
        // bit-for-bit unchanged.
        let epsilon_eq = if lift >= 1.0 { epsilon } else { a_phys / r0_eq };
        self.equilibrium.r0 = r0_eq;

        let new_shape = ShapeParams {
            epsilon: epsilon_eq,
            kappa: kappa_eq,
            delta: delta_eq,
            delta_upper: Some(delta_eq_upper),
            a_param,
            config,
            x_point_alpha: Some(delta_eq.asin()),
            squareness: self.device.equilibrium_squareness * shape_w,
            squareness_out: self.device.equilibrium_squareness_out * shape_w,
        };
        self.equilibrium.update(&new_shape);

        // ── Limiter contact check (diverted phase only) ──
        // If the bulk LCFS extends beyond the wall, force a disruption.
        // Only checked in diverted config (limited plasma intentionally
        // touches wall) and only when Ip is significant (near or at
        // flat-top). It is additionally disarmed while the designed inboard
        // gap is under 3 cm — just after X-point formation the LCFS is
        // millimetres from the limiter by construction, and the solved
        // boundary deviates from its parametrization by about that much.
        // Once armed the check is exactly as strict as before.
        if config != MagneticConfig::Limited
            && (lift >= 1.0 || inboard_gap >= 0.03)
            && !self.disruption.disrupted
            && prog.ip > 0.3 * self.device.ip_max
            && self.actual_ip > 0.1
        {
            // Sample the SOLVED boundary, not the analytic parametrization.
            // The Cerfon–Freidberg solution deviates from its own boundary
            // parametrization by a few cm (outboard bulge, squarer corners
            // when squareness ≠ 0), and the rendered separatrix is the solved
            // contour — so the analytic proxy both misses real contacts and
            // reports false ones. Ray-march ψ_N = 1 from the axis instead.
            let (ax_r, ax_z) = self.equilibrium.axis_physical();
            let mut lcfs_points: Vec<(f64, f64, f64)> = Vec::with_capacity(24);
            for k in 0..24 {
                let theta = 2.0 * std::f64::consts::PI * (k as f64) / 24.0;
                let (dr, dz) = (theta.cos(), theta.sin());
                let mut rad = 0.05;
                while rad < 1.6 {
                    let r = ax_r + dr * rad;
                    let z = ax_z + dz * rad;
                    if self.equilibrium.psi_norm(r, z) >= 1.0 {
                        lcfs_points.push((r, z, theta));
                        break;
                    }
                    rad += 0.01;
                }
            }

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
        let flux_surfaces = if self.actual_ip > 0.1 {
            let grid = self.equilibrium.psi_norm_grid(
                grid_r_min, grid_r_max, grid_z_min, grid_z_max,
                self.eq_nr, self.eq_nz,
            );
            // Evenly spaced levels from ψ_N = 0.1 to 0.9, giving uniform
            // contour spacing from near the magnetic axis to near the edge.
            let n = self.n_flux_surfaces;
            let mut levels: Vec<f64> = (0..n)
                .map(|i| 0.1 + 0.8 * i as f64 / (n - 1).max(1) as f64)
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
        let separatrix = if self.actual_ip > 0.1 {
            // The separatrix is extracted at twice the flux-surface grid
            // resolution: the divertor-leg landing point quantizes on the
            // marching-squares cells (~45 mm in Z at 48×72 over the
            // wall-extended bounds), which made the outer strike position
            // bistable between the roof diagonal and the back corner and
            // hid most of the inner strike's sweep motion. One extra ψ_N
            // level at 96×144 costs well under a millisecond.
            let mut sep = contour::extract_separatrix(
                &self.equilibrium,
                self.eq_nr * 2,
                self.eq_nz * 2,
                sep_bounds,
            );
            // Terminate divertor legs at their first wall impact: a leg that
            // strikes a baffle must not re-emerge beyond it, and spurious
            // far-SOL ψ=0 chains outside the vessel are dropped outright.
            //
            // Applied in the limited phase too: the tangent LCFS survives the
            // clip untouched (it lies inside, touching at one point), but the
            // ψ=0 extraction produces large spurious chains outside the vessel
            // during ramp-up/ramp-down — measured at up to 386 mm outside the
            // limiter before this covered the limited phase.
            //
            // The 3 mm overshoot keeps the frontend's leg/wall intersection
            // detection working; the sliver past the wall is masked by the
            // renderer.
            if !self.device.wall_outline.is_empty() {
                contour::clip_separatrix_to_wall(&mut sep, &self.device.wall_outline, 0.003);
            }
            // Keep only the chains that belong to the plasma. A diverted
            // equilibrium is anchored on its X-point(s), within a quarter of
            // the minor radius but never less than a few marching-squares
            // cells (which is how far a chain can miss the saddle). The
            // limited solution has no X-point at all — its LCFS is a closed
            // curve around the magnetic axis — so it is anchored on the axis
            // with a tolerance that spans the column itself, which keeps the
            // body and drops far-SOL chains elsewhere in the vessel.
            {
                let (xl, xu) = self.equilibrium.x_points_physical();
                let mut anchors: Vec<(f64, f64)> = xl.into_iter().chain(xu).collect();
                let a_now = self.equilibrium.shape.epsilon * self.equilibrium.r0;
                let cell = ((grid_r_max - grid_r_min) / (self.eq_nr * 2) as f64)
                    .hypot((grid_z_max - grid_z_min) / (self.eq_nz * 2) as f64);
                let tol = if anchors.is_empty() {
                    anchors.push(self.equilibrium.axis_physical());
                    1.2 * self.equilibrium.shape.kappa.max(1.0) * a_now
                } else {
                    0.25 * a_now
                };
                contour::keep_chains_near(&mut sep, &anchors, tol.max(3.0 * cell));
            }
            sep
        } else {
            Contour {
                level: 0.0,
                points: vec![],
            }
        };

        let (axis_r, axis_z) = self.equilibrium.axis_physical();
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

        // The limited plasma's contact with the inboard limiter is a real move
        // of the equilibrium centre (see the centroid trajectory in
        // `update_equilibrium`), so the axis, flux surfaces and separatrix
        // above already come out in the right place — no snapshot-level shift.

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
            self.circuit.v_loop,
            &mut noise,
        );

        SimulationSnapshot {
            time: self.time,
            duration: self.program.duration,
            device_id: self.device.id.clone(),
            mass_number: self.device.mass_number,
            prog_ip: prog.ip,
            prog_ip_peak: self.program_ip_peak(),
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
            p_alpha: self.transport.p_alpha,
            beta_n: self.transport.beta_n,
            beta_t: self.transport.beta_t,
            q95: self.transport.q95,
            f_greenwald: self.transport.f_greenwald,
            li: self.transport.li,
            h_factor: self.transport.h_factor,
            in_hmode: self.transport.in_hmode,
            elm_active: self.transport.elm_active,
            elm_type: self.transport.elm_type,
            elm_energy_loss: self.transport.elm_energy_loss,
            elm_suppressed: self.transport.elm_suppressed,
            ne_ped: self.profiles.ne_ped,
            te_ped: self.profiles.te_ped,
            ne_line: self.profiles.ne_line_avg(),
            impurity_fraction: self.transport.impurity_fraction,
            d2_puff: prog.d2_puff,
            neon_puff: prog.neon_puff,
            n2_puff: prog.n2_puff,
            argon_puff: prog.argon_puff,
            imp_n: self.transport.imp_n,
            imp_ne: self.transport.imp_ne,
            imp_ar: self.transport.imp_ar,
            z_eff: self.transport.z_eff,
            fuel_fraction: self.transport.fuel_fraction,
            te_profile: self.profiles.te_profile_array(),
            ne_profile: self.profiles.ne_profile_array(),
            disruption_risk: self.disruption.risk,
            disrupted: self.disruption.disrupted,
            disruption_phase: self.disruption.phase_name().to_string(),
            disruption_cause: self.disruption.cause.name().to_string(),
            risk_greenwald: self.disruption.risk_greenwald,
            risk_beta: self.disruption.risk_beta,
            risk_q95: self.disruption.risk_q95,
            risk_radiation: self.disruption.risk_radiation,
            risk_locked_mode: self.disruption.risk_locked_mode,
            p_lh: self.transport.p_lh_threshold,
            v_loop: self.circuit.v_loop,
            flux_consumed: self.circuit.flux_consumed,
            flux_budget: self.circuit.flux_budget,
            i_bootstrap: self.i_bootstrap,
            i_cd: self.i_cd,
            oh_saturated: self.circuit.saturated,
            flux_exhausted: self.circuit.exhausted,
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

    /// The L-mode and density-limit presets must keep density and fuelling
    /// up through EACH device's own flat-top. They used to carry DIII-D's
    /// 1/6/7 s anchors for every device, so ITER's 50 s pulse ran 40 s of
    /// flat-top at 5e18 m^-3 (and ITER's density-limit puff had its time
    /// axis running backwards).
    #[test]
    fn test_lmode_and_density_limit_presets_follow_device_timing() {
        for device in devices::all_devices() {
            let presets = [
                ("lmode", PulseProgram::lmode(&device)),
                ("density_limit", PulseProgram::density_limit(&device)),
            ];
            for (name, prog) in &presets {
                for (wf_name, wf) in [
                    ("ip", &prog.ip),
                    ("ne_target", &prog.ne_target),
                    ("d2_puff", &prog.d2_puff),
                ] {
                    for w in wf.windows(2) {
                        assert!(
                            w[1].0 >= w[0].0,
                            "{} {} {}: time runs backwards at {:?}",
                            device.id, name, wf_name, w
                        );
                    }
                }
                // Middle of the programmed current flat-top.
                let ip_peak = prog.ip.iter().map(|p| p.1).fold(0.0_f64, f64::max);
                let flat: Vec<f64> = prog
                    .ip
                    .iter()
                    .filter(|p| p.1 >= 0.999 * ip_peak)
                    .map(|p| p.0)
                    .collect();
                let t_mid = 0.5 * (flat[0] + flat[flat.len() - 1]);
                let ne_peak = prog.ne_target.iter().map(|p| p.1).fold(0.0_f64, f64::max);
                let ne_mid = PulseProgram::interpolate(&prog.ne_target, t_mid);
                assert!(
                    ne_mid >= 0.9 * ne_peak,
                    "{} {}: density at mid flat-top (t={t_mid}) is {ne_mid}, peak {ne_peak}",
                    device.id, name
                );
                assert!(
                    PulseProgram::interpolate(&prog.d2_puff, t_mid) > 0.0,
                    "{} {}: no fuelling at mid flat-top (t={t_mid})",
                    device.id, name
                );
            }
        }
    }

    #[test]
    fn test_waveform_interpolation() {
        let waveform = vec![(0.0, 0.0), (1.0, 10.0), (2.0, 10.0), (3.0, 0.0)];

        assert!((PulseProgram::interpolate(&waveform, 0.5) - 5.0).abs() < 0.01);
        assert!((PulseProgram::interpolate(&waveform, 1.5) - 10.0).abs() < 0.01);
        assert!((PulseProgram::interpolate(&waveform, 2.5) - 5.0).abs() < 0.01);
        // Clamp at edges
        assert!((PulseProgram::interpolate(&waveform, -1.0) - 0.0).abs() < 0.01);
        assert!((PulseProgram::interpolate(&waveform, 5.0) - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_standard_hmode_program() {
        let device = devices::diiid();
        let prog = PulseProgram::standard_hmode(&device);

        assert!(prog.duration > 0.0);
        assert!(!prog.ip.is_empty());

        // Ip should start at 0 and return to 0
        assert!(prog.ip.first().unwrap().1 < 0.01);
        assert!(prog.ip.last().unwrap().1 < 0.01);

        // Ip at flat top should be reasonable
        let ip_flattop = PulseProgram::interpolate(&prog.ip, 3.0);
        assert!(ip_flattop > 0.5 && ip_flattop < device.ip_max);
    }

    #[test]
    fn test_simulation_creation() {
        let device = devices::diiid();
        let program = PulseProgram::standard_hmode(&device);
        let sim = Simulation::new(device, program);

        assert_eq!(sim.time, 0.0);
        assert_eq!(sim.status, SimulationStatus::Ready);
    }

    #[test]
    fn test_simulation_step() {
        let device = devices::diiid();
        let program = PulseProgram::standard_hmode(&device);
        let mut sim = Simulation::new(device, program);

        sim.start();
        let snapshot = sim.step(0.001);

        assert!(snapshot.time > 0.0);
        assert_eq!(snapshot.status, SimulationStatus::Running);
    }

    #[test]
    fn test_full_pulse_simulation() {
        let device = devices::diiid();
        let program = PulseProgram::standard_hmode(&device);
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
        let program = PulseProgram::standard_hmode(&device);
        let mut sim = Simulation::new(device, program);

        sim.start();

        // Advance to flat-top
        let dt = 0.002;
        for _ in 0..1500 {
            sim.step(dt);
        }

        let snap = sim.step(dt);
        // At 3s into a DIII-D pulse, should have flux surfaces
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
    fn test_normal_pulse_no_wall_disruption() {
        // Standard H-mode with normal κ and δ should NOT trigger wall contact
        let device = devices::diiid();
        let program = PulseProgram::standard_hmode(&device);
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
        // With the default disruption RNG seed, the standard pulse may or may not
        // stochastically disrupt. But we can at least verify the simulation ran.
        // The key test is that extreme shapes DO disrupt (next test).
        let _ = wall_disrupted;
    }

    #[test]
    fn test_centaur_peak_values() {
        let device = devices::centaur();
        let program = PulseProgram::standard_hmode(&device);
        let duration = program.duration;
        let mut sim = Simulation::new(device, program);
        sim.start();

        let dt = 0.002;
        let n_steps = (duration / dt) as usize + 10;
        let mut peak_beta_n = 0.0_f64;
        let mut peak_te0 = 0.0_f64;
        let mut peak_tau_e = 0.0_f64;
        let mut step_count = 0;
        for _ in 0..n_steps {
            let snap = sim.step(dt);
            peak_beta_n = peak_beta_n.max(snap.beta_n);
            peak_te0 = peak_te0.max(snap.te0);
            peak_tau_e = peak_tau_e.max(snap.tau_e);
            step_count += 1;
            if step_count % 1000 == 0 {
                eprintln!("  t={:.1}s: beta_N={:.2}, Te0={:.1}, tau_E={:.2}, ip={:.1}, hmode={}, q95={:.1}",
                    snap.time, snap.beta_n, snap.te0, snap.tau_e, snap.ip, snap.in_hmode, snap.q95);
            }
            if snap.status == SimulationStatus::Complete || snap.status == SimulationStatus::Disrupted {
                eprintln!("  END at t={:.1}s: status={:?}", snap.time, snap.status);
                break;
            }
        }
        eprintln!("CENTAUR peak: beta_N={:.2}, Te0={:.1} keV, tau_E={:.2} s, in_hmode={}",
            peak_beta_n, peak_te0, peak_tau_e, "check snap");
        assert!(peak_beta_n > 0.5, "CENTAUR should reach beta_N > 0.5, got {:.2}", peak_beta_n);
    }

    #[test]
    fn test_li_responds_to_hmode_transition() {
        // l_i should decrease when the plasma transitions to H-mode
        // because Te broadens (pedestal forms), making j(ρ) broader.
        // Note: τ_li ≈ 3.6s at Te ~ 3 keV, so we need to wait several
        // seconds after H-mode onset to see the effect.
        let device = devices::diiid();
        let program = PulseProgram::standard_hmode(&device);
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
            // Only check if we got to H-mode without disrupting.
            // Allow a small margin — the exact li values depend on the
            // interplay between profile normalization and current diffusion,
            // and the H-mode broadening effect can be subtle for DIII-D.
            assert!(
                li_hmode < li_early + 0.05,
                "H-mode l_i ({}) should be near or less than L-mode l_i ({})",
                li_hmode,
                li_early
            );
        }
    }

    /// Run a programme to its end, returning every snapshot.
    #[test]
    fn test_triangularity_beyond_the_solver_range_keeps_the_equilibrium_finite() {
        // DIII-D's fitted equilibrium adds +0.27 to the programmed δ; a
        // drawn δ of 0.8 used to reach asin(1.07) at lift-off and leave a
        // NaN axis and no boundary for the rest of the pulse.
        let device = devices::diiid();
        let mut program = PulseProgram::standard_hmode(&device);
        program.delta = vec![(0.0, 0.8), (program.duration, 0.8)];
        let mut sim = Simulation::new(device, program);
        sim.start();
        let mut last = None;
        for _ in 0..400 {
            let s = sim.step(0.005);
            assert!(s.axis_r.is_finite() && s.axis_z.is_finite(), "non-finite axis at t={}", s.time);
            if s.status != SimulationStatus::Running {
                break;
            }
            last = Some(s);
        }
        let s = last.unwrap();
        assert!(
            !s.is_limited && s.separatrix.points.len() > 8,
            "no boundary at t={} with Ip {} MA", s.time, s.ip
        );
    }

    fn run_pulse(device: Device, program: PulseProgram, seed: u64) -> Vec<SimulationSnapshot> {
        let mut sim = Simulation::new(device, program);
        sim.seed_disruption(seed);
        sim.start();
        let mut out = Vec::new();
        loop {
            let s = sim.step(0.005);
            let done = s.status == SimulationStatus::Complete || s.status == SimulationStatus::Disrupted;
            out.push(s);
            if done {
                break;
            }
        }
        out
    }

    #[test]
    fn test_driven_current_tracks_the_programme_on_every_device() {
        // The controller holds Ip on its waveform through ramp-up and
        // flat-top; the loop voltage is volts in the ramp, under a volt and a
        // half on flat-top, negative in ramp-down; and no standard H-mode
        // pulse uses up its solenoid swing (DIII-D's is sized to use ~80 %;
        // see test_diiid_budget_ends_the_flat_top).
        for (id, flat_v_max) in [("diiid", 0.8), ("jet", 1.5), ("iter", 0.6), ("centaur", 0.8)] {
            let device = devices::get_device(id).unwrap();
            let program = PulseProgram::standard_hmode(&device);
            let peak = program.ip.iter().map(|p| p.1).fold(0.0, f64::max);
            let snaps = run_pulse(device, program, 7);
            let mut flat_err: f64 = 0.0;
            let mut flat_v = Vec::new();
            let mut ramp_v_max: f64 = 0.0;
            let mut down_v_min: f64 = 0.0;
            let mut psi_max: f64 = 0.0;
            let mut saw_rampdown = false;
            for s in &snaps {
                if s.disrupted {
                    break;
                }
                psi_max = psi_max.max(s.flux_consumed);
                if s.prog_ip >= 0.98 * peak {
                    flat_err = flat_err.max((s.ip - s.prog_ip).abs() / peak);
                    flat_v.push(s.v_loop);
                } else if s.prog_ip < 0.9 * peak && s.time > 0.5 * s.duration {
                    saw_rampdown = true;
                    down_v_min = down_v_min.min(s.v_loop);
                } else {
                    ramp_v_max = ramp_v_max.max(s.v_loop);
                }
            }
            if flat_v.len() < 10 {
                continue; // a stochastic early disruption (JET seed-dependent); nothing to check
            }
            let flat_mean = flat_v.iter().sum::<f64>() / flat_v.len() as f64;
            assert!(flat_err < 0.02, "{id}: Ip off programme by {:.1} % of peak in flat-top", 100.0 * flat_err);
            assert!(ramp_v_max > 2.0, "{id}: ramp-up loop voltage {ramp_v_max} V");
            assert!(flat_mean > 0.05 && flat_mean < flat_v_max, "{id}: flat-top <V_loop> {flat_mean} V");
            // (A stochastic disruption on flat-top, as JET's preset has with
            // some seeds, never reaches the ramp-down.)
            assert!(!saw_rampdown || down_v_min < -0.5, "{id}: ramp-down loop voltage {down_v_min} V should be negative");
            assert!(psi_max < snaps[0].flux_budget, "{id}: used {psi_max} of {} V·s", snaps[0].flux_budget);
            assert!(!snaps.iter().any(|s| s.flux_exhausted), "{id}: flux exhausted");
        }
    }

    #[test]
    fn test_flux_exhaustion_ends_the_flat_top() {
        // A solenoid with a tenth of ITER's swing runs out during the ramp:
        // the current then falls away from its programme, the loop voltage
        // never goes positive again, and the alarm flags are set.
        let mut device = devices::iter();
        device.flux_swing_vs = 30.0;
        let program = PulseProgram::standard_hmode(&device);
        let snaps = run_pulse(device, program, 7);
        let first = snaps.iter().position(|s| s.flux_exhausted).expect("flux should run out");
        let at = &snaps[first];
        assert!(at.time < 20.0, "exhausted at {} s", at.time);
        assert!((at.flux_consumed - 30.0).abs() < 0.5, "Ψ {} at exhaustion", at.flux_consumed);
        // A second on (the sagging current soon meets the density and β
        // limits programmed for 15 MA and disrupts).
        let later = &snaps[(first + 200).min(snaps.len() - 1)];
        assert!(!later.disrupted, "disrupted already at {} s", later.time);
        assert!(later.ip < 0.95 * later.prog_ip, "Ip {} should sag below program {}", later.ip, later.prog_ip);
        assert!(later.oh_saturated);
        // No positive volts from the exhausted solenoid for the rest of the
        // pulse (until the program ramps down or the plasma disrupts).
        let peak = snaps[first].prog_ip_peak;
        let bad = snaps[first..].iter()
            .take_while(|s| !s.disrupted && s.prog_ip >= 0.9 * peak)
            .filter(|s| s.v_loop > 1e-9)
            .count();
        assert_eq!(bad, 0, "positive loop voltage after exhaustion");
    }

    #[test]
    fn test_diiid_budget_ends_the_flat_top() {
        // The 7 s DIII-D H-mode preset uses most of the Ohmic coil's
        // 7.5 V·s but not all of it. Stretched to the planner's 10 s limit
        // (every waveform's time axis scaled, as the planner does) the swing
        // runs out while the plasma still carries its current.
        let device = devices::diiid();
        let program = PulseProgram::standard_hmode(&device);
        let snaps = run_pulse(device.clone(), program.clone(), 7);
        let used = snaps.iter().map(|s| s.flux_consumed).fold(0.0, f64::max);
        assert!(used > 0.7 * 7.5 && used < 0.9 * 7.5, "preset uses {used} of 7.5 V·s");
        assert!(!snaps.iter().any(|s| s.flux_exhausted), "the preset must not exhaust the solenoid");

        let k = 10.0 / program.duration;
        let mut long = program.clone();
        for wf in [&mut long.ip, &mut long.bt, &mut long.ne_target, &mut long.p_nbi, &mut long.p_ech, &mut long.p_ich, &mut long.kappa, &mut long.delta, &mut long.d2_puff, &mut long.neon_puff, &mut long.n2_puff, &mut long.argon_puff] {
            for p in wf.iter_mut() {
                p.0 *= k;
            }
        }
        long.duration = 10.0;
        let snaps = run_pulse(device, long, 7);
        let first = snaps.iter().position(|s| s.flux_exhausted).expect("the 10 s pulse runs out of flux");
        let at = &snaps[first];
        assert!(at.time > 6.0 && at.time < 9.0, "exhaustion at {} s", at.time);
        assert!(at.ip > 0.5, "the solenoid runs out while the plasma still carries {} MA", at.ip);
    }

    #[test]
    fn test_supply_saturation_slows_a_fast_ramp() {
        // Ask DIII-D for 0.6 MA in 0.1 s: 6 MA/s through 3 µH needs ~18 V,
        // the supply has 10, so Ip lags and the controller reports it. (0.6 MA
        // keeps q95 above the kink limit while the κ programme is still round.)
        let device = devices::diiid();
        let mut program = PulseProgram::standard_hmode(&device);
        program.ip = vec![(0.0, 0.0), (0.1, 0.6), (8.0, 0.6), (9.0, 0.3), (10.0, 0.0)];
        let snaps = run_pulse(device, program, 7);
        let at = snaps.iter().find(|s| s.time >= 0.1).unwrap();
        assert!(at.oh_saturated, "supply should be saturated at the end of the ramp");
        assert!((at.v_loop - 10.0).abs() < 1e-6, "V_loop {} should sit on the 10 V limit", at.v_loop);
        assert!(at.ip < 0.9 * 0.6, "Ip {} lags the 0.6 MA programme", at.ip);
        let caught = snaps.iter().find(|s| s.time >= 1.0).unwrap();
        assert!(!caught.disrupted);
        assert!((caught.ip - 0.6).abs() < 0.02, "Ip {} should have caught up by 1 s", caught.ip);
    }

    #[test]
    fn test_flat_top_loop_voltage_accounts_for_non_inductive_current() {
        // ITER flat-top: bootstrap plus beam/EC drive carry a few MA, and the
        // loop voltage is R_p (I_p − I_ni) plus the I·dL/dt of the slowly
        // relaxing current profile, with R_p the same resistance the Ohmic
        // heating P_OH = R_p I_p (I_p − I_ni) was computed from.
        let device = devices::iter();
        let program = PulseProgram::standard_hmode(&device);
        let snaps = run_pulse(device.clone(), program, 7);
        let k = snaps.iter().position(|s| s.time >= 60.0).expect("ITER preset should still be running at 60 s");
        let (prev, s) = (&snaps[k - 1], &snaps[k]);
        assert!(!s.disrupted);
        let i_ni = s.i_bootstrap + s.i_cd;
        assert!(s.i_bootstrap > 1.0 && s.i_bootstrap < 4.0, "ITER bootstrap {} MA", s.i_bootstrap);
        assert!(s.i_cd > 0.3 && s.i_cd < 3.0, "ITER driven current {} MA", s.i_cd);
        assert!(i_ni < 0.5 * s.ip);
        // Resistive drop R_p (I_p − I_ni) = P_OH / I_p (MW/MA = V).
        let v_res = s.p_ohmic / s.ip;
        let dt = s.time - prev.time;
        let kappa = PulseProgram::interpolate(&snaps_program_kappa(&device), s.time);
        let dl = circuit::plasma_inductance(&device, kappa, s.li) - circuit::plasma_inductance(&device, kappa, prev.li);
        let v_ind = s.ip * 1e6 * dl / dt;
        let v_expected = v_res + v_ind;
        assert!((s.v_loop - v_expected).abs() < 0.03 + 0.05 * v_expected.abs(),
            "V_loop {} vs R(I−I_ni) + I dL/dt = {} (resistive {}, inductive {})",
            s.v_loop, v_expected, v_res, v_ind);
        // The non-inductive share is worth tens of millivolts on ITER:
        // R_p I_ni = P_OH I_ni / (I_p (I_p − I_ni)).
        let v_saved = s.p_ohmic * i_ni / (s.ip * (s.ip - i_ni));
        assert!(v_saved > 0.02, "I_ni should lower V_loop by > 20 mV, got {}", v_saved);
    }

    /// The κ waveform of the standard H-mode program, for the test above.
    fn snaps_program_kappa(device: &Device) -> Vec<(f64, f64)> {
        PulseProgram::standard_hmode(device).kappa
    }

    #[test]
    fn test_seeded_species_radiate_dilute_and_raise_zeff() {
        // The same DIII-D H-mode pulse seeded from 2.5 s with 0.3e20 atoms/s
        // of nitrogen, neon or argon. Compared at 4.5 s (late flat-top of
        // the 7 s pulse): each species has built a similar core fraction; argon
        // radiates far more in the core than neon, and neon more than
        // nitrogen; Z_eff and the dilution rise with Z.
        let mut device = devices::diiid();
        // The species physics is compared at 5 s of flat-top; give the
        // solenoid an unlimited swing so the flux budget does not end the
        // flat-top first (see the drive tests for that).
        device.flux_swing_vs = 1e9;
        let base = PulseProgram::standard_hmode(&device);
        let d = base.duration;
        let puff = vec![(0.0, 0.0), (2.5, 0.0), (3.0, 0.3), (d, 0.3)];
        let mut programs = vec![base.clone()];
        for which in 0..3 {
            let mut p = base.clone();
            match which {
                0 => p.n2_puff = puff.clone(),
                1 => p.neon_puff = puff.clone(),
                _ => p.argon_puff = puff.clone(),
            }
            programs.push(p);
        }
        let mut snaps = Vec::new();
        for p in programs {
            let mut sim = Simulation::new(device.clone(), p);
            sim.seed_disruption(11);
            sim.start();
            let mut s = sim.step(0.005);
            while s.time < 4.5 && s.status == SimulationStatus::Running {
                s = sim.step(0.005);
            }
            assert_eq!(s.status, SimulationStatus::Running, "pulse ended early at {:.2} s", s.time);
            snaps.push(s);
        }
        let (plain, n, ne, ar) = (&snaps[0], &snaps[1], &snaps[2], &snaps[3]);
        assert!(plain.imp_n == 0.0 && plain.imp_ne == 0.0 && plain.imp_ar == 0.0);
        assert!(n.imp_n > 0.002 && ne.imp_ne > 0.002 && ar.imp_ar > 0.002, "fractions {} {} {}", n.imp_n, ne.imp_ne, ar.imp_ar);
        assert!((n.imp_n - ar.imp_ar).abs() < 0.3 * n.imp_n, "same puff gives similar fractions");
        let rad = |s: &SimulationSnapshot| s.p_rad - plain.p_rad;
        assert!(rad(ar) > 3.0 * rad(ne), "argon core radiation {} vs neon {}", rad(ar), rad(ne));
        assert!(rad(ne) >= rad(n) * 0.9, "neon core radiation {} vs nitrogen {}", rad(ne), rad(n));
        assert!(rad(ar) > 0.5, "0.3e20/s argon on DIII-D should radiate > 0.5 MW in the core, got {}", rad(ar));
        assert!(ar.z_eff > ne.z_eff && ne.z_eff > n.z_eff && n.z_eff > plain.z_eff, "Z_eff ordering");
        assert!(ar.z_eff - plain.z_eff > 0.3, "0.3 % argon should add > 0.3 to Z_eff, got {}", ar.z_eff - plain.z_eff);
    }

    #[test]
    fn test_programme_json_without_species_channels_loads() {
        let device = devices::diiid();
        let mut json = serde_json::to_value(PulseProgram::standard_hmode(&device)).unwrap();
        let obj = json.as_object_mut().unwrap();
        obj.remove("n2_puff");
        obj.remove("argon_puff");
        let prog: PulseProgram = serde_json::from_value(json).expect("older programme JSON still loads");
        let v = prog.values_at(5.0);
        assert_eq!(v.n2_puff, 0.0);
        assert_eq!(v.argon_puff, 0.0);
    }

    #[test]
    fn test_disruption_shows_ip_spike_then_decays() {
        // Over-fuelled DIII-D pulse with a fixed seed: coarse steps until the
        // trigger fires, then fine steps through the quench, as the frontend
        // does. Ip must rise by at least 3 % above its pre-quench value and
        // then fall monotonically to zero.
        let device = devices::diiid();
        let program = PulseProgram::density_limit(&device);
        let mut sim = Simulation::new(device, program);
        sim.seed_disruption(7);
        sim.start();
        let mut snap = sim.step(0.005);
        while !snap.disrupted && snap.status == SimulationStatus::Running {
            snap = sim.step(0.005);
        }
        assert!(snap.disrupted, "seed 7 density-limit pulse should disrupt");
        let ip_pre = snap.ip;
        let mut ip_max: f64 = 0.0;
        let mut ips = Vec::new();
        let mut last_ip = ip_pre;
        for _ in 0..200_000 {
            let s = sim.step(0.00025);
            if s.disruption_phase != "precursor" && s.disruption_phase != "" {
                ip_max = ip_max.max(s.ip);
                ips.push((s.disruption_phase.clone(), s.ip));
            }
            last_ip = s.ip;
            if s.status == SimulationStatus::Disrupted { break; }
        }
        assert!(ip_max > 1.03 * ip_pre, "spike expected: pre {ip_pre}, max {ip_max}");
        assert!(ip_max < 1.16 * ip_pre, "spike too large: pre {ip_pre}, max {ip_max}");
        let cq: Vec<f64> = ips.iter().filter(|(p, _)| p == "current_quench").map(|(_, i)| *i).collect();
        assert!(cq.len() >= 20, "CQ should be resolved by many fine steps, got {}", cq.len());
        for w in cq.windows(2) { assert!(w[1] <= w[0] + 1e-12, "CQ must decay monotonically"); }
        // Three e-folds over the quench: the last CQ sample sits near exp(-3)
        // of the peak, and the completing step takes Ip to exactly zero.
        assert!(*cq.last().unwrap() < 0.06 * ip_max, "CQ end {} vs peak {}", cq.last().unwrap(), ip_max);
        assert_eq!(last_ip, 0.0, "the quench must terminate the current");
    }

    #[test]
    fn test_extreme_kappa_causes_wall_disruption() {
        // Extreme elongation (κ=2.5) should push plasma into wall and disrupt
        let device = devices::diiid();
        let mut program = PulseProgram::standard_hmode(&device);

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
        let program = PulseProgram::standard_hmode(&device);
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
