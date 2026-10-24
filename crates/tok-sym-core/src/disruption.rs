//! Disruption risk model.
//!
//! Calculates disruption probability based on proximity to operational limits
//! (Greenwald density limit, Troyon beta limit, kink q limit, radiation collapse).
//! Includes a stochastic trigger mechanism and a multi-phase disruption sequence.

use serde::{Deserialize, Serialize};

/// Current phase of a disruption event.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum DisruptionPhase {
    /// Growing MHD precursor oscillations
    Precursor {
        /// Time remaining in precursor phase (s)
        remaining: f64,
        /// Amplitude of locked mode signal (a.u.)
        amplitude: f64,
    },
    /// Rapid loss of thermal energy. The current profile flattens over this
    /// phase; with poloidal flux conserved on this timescale the total
    /// current rises, which is the Ip spike seen at every disruption.
    ThermalQuench {
        remaining: f64,
        /// Total duration of the thermal quench (s)
        total: f64,
        /// Ip at thermal-quench onset (MA)
        ip_start: f64,
        /// Fractional Ip overshoot at the end of the quench (0.03-0.15)
        spike_frac: f64,
        /// Internal inductance before and after profile flattening
        li_before: f64,
        li_after: f64,
    },
    /// Plasma current decay (resistive L/R decay of the cold plasma)
    CurrentQuench {
        remaining: f64,
        /// Ip at the start of the CQ, i.e. the top of the spike (MA)
        ip_start: f64,
        /// Total duration of CQ phase (s)
        total_duration: f64,
        /// Flattened internal inductance held through the quench
        li_flat: f64,
    },
    /// Disruption complete, plasma terminated
    Complete,
}

/// What started the disruption: the hazard term that dominated at the
/// trigger, or wall contact. Named so the control room can say why.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisruptionCause {
    None,
    DensityLimit,
    BetaLimit,
    KinkLimit,
    RadiativeCollapse,
    LockedMode,
    WallContact,
}

impl DisruptionCause {
    /// Snake-case name for snapshots and logs.
    pub fn name(self) -> &'static str {
        match self {
            DisruptionCause::None => "",
            DisruptionCause::DensityLimit => "density_limit",
            DisruptionCause::BetaLimit => "beta_limit",
            DisruptionCause::KinkLimit => "kink_limit",
            DisruptionCause::RadiativeCollapse => "radiative_collapse",
            DisruptionCause::LockedMode => "locked_mode",
            DisruptionCause::WallContact => "wall_contact",
        }
    }
}

/// Disruption risk model state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisruptionModel {
    /// Total disruption risk (0-1 per second)
    pub risk: f64,
    /// Individual risk factors
    pub risk_greenwald: f64,
    pub risk_beta: f64,
    pub risk_q95: f64,
    pub risk_radiation: f64,
    pub risk_locked_mode: f64,
    /// Whether a disruption has been triggered
    pub disrupted: bool,
    /// Current phase of the disruption
    pub phase: Option<DisruptionPhase>,
    /// What triggered it (None until a disruption starts)
    pub cause: DisruptionCause,
    /// RNG state (simple xorshift for reproducibility in WASM)
    rng_state: u64,
}

impl Default for DisruptionModel {
    fn default() -> Self {
        DisruptionModel {
            risk: 0.0,
            risk_greenwald: 0.0,
            risk_beta: 0.0,
            risk_q95: 0.0,
            risk_radiation: 0.0,
            risk_locked_mode: 0.0,
            disrupted: false,
            phase: None,
            cause: DisruptionCause::None,
            rng_state: 0xDEAD_BEEF_CAFE_BABE,
        }
    }
}

/// Smooth sigmoid function centered at `center` with width `width`.
fn sigmoid(x: f64, center: f64, width: f64) -> f64 {
    1.0 / (1.0 + (-(x - center) / width).exp())
}

impl DisruptionModel {
    /// Seed the random number generator.
    ///
    /// The seed is passed through a splitmix64 finaliser before it becomes
    /// the xorshift state. Raw small seeds (1, 7, 1000...) make xorshift64
    /// emit values of order 1e-10 for its first few draws, which fall
    /// below the per-step trigger probability and start a disruption in
    /// the first 0.2 s of every pulse regardless of the hazard.
    pub fn seed(&mut self, seed: u64) {
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        self.rng_state = if z == 0 { 1 } else { z };
    }

    /// Generate a random f64 in [0, 1) using xorshift64.
    fn rand(&mut self) -> f64 {
        let mut x = self.rng_state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng_state = x;
        // Map to [0, 1)
        (x as f64) / (u64::MAX as f64)
    }

    /// Update disruption risk based on current plasma parameters.
    ///
    /// # Arguments
    /// * `f_greenwald` - Greenwald fraction (ne_bar / n_GW)
    /// * `beta_n` - Normalized beta
    /// * `q95` - Safety factor at 95% flux
    /// * `p_rad_frac` - Radiation fraction (P_rad / P_input)
    /// * `ip` - Plasma current (MA), used for locked mode risk
    pub fn update_risk(
        &mut self,
        f_greenwald: f64,
        beta_n: f64,
        q95: f64,
        p_rad_frac: f64,
        _ip: f64,
    ) {
        // Greenwald density limit: the empirical limit is at fGW = 1.0.
        // Risk rises steeply as the plasma approaches the limit.
        self.risk_greenwald = sigmoid(f_greenwald, 1.0, 0.08);

        // Troyon beta limit: βN_limit ≈ 2.8 (no-wall limit)
        let beta_n_limit = 2.8;
        self.risk_beta = sigmoid(beta_n / beta_n_limit, 0.85, 0.06);

        // q95 kink limit: q95 < 2 is very dangerous
        // Sigmoid is sharp so risk is negligible for q95 > 2.5
        self.risk_q95 = sigmoid(2.2 / q95, 0.90, 0.05);

        // Radiation collapse: when Prad/Pinput approaches 1
        self.risk_radiation = sigmoid(p_rad_frac, 0.80, 0.08);

        // Locked mode: base random rate increased near other limits
        // Base rate kept very low so safe pulses almost never disrupt.
        // Near operational limits the amplification factors dominate.
        let base_locked = 0.0005; // 0.05% per second base rate
        self.risk_locked_mode =
            base_locked * (1.0 + 5.0 * self.risk_greenwald + 3.0 * self.risk_beta + 2.0 * self.risk_q95);
        self.risk_locked_mode = self.risk_locked_mode.min(1.0);

        // Combined risk (probability per second of disruption)
        self.risk = 1.0
            - (1.0 - self.risk_greenwald.powi(3))  // Cube to make it sharper
            * (1.0 - self.risk_beta.powi(3))
            * (1.0 - self.risk_q95.powi(3))
            * (1.0 - self.risk_radiation.powi(3))
            * (1.0 - self.risk_locked_mode);

        // No artificial floor. Every contribution above has a named cause
        // (density limit, beta limit, kink limit, radiative collapse, locked
        // mode); the locked-mode term carries the small baseline rate. A
        // constant 0.5 %/s floor used to be added here, which gave a 100 s
        // ITER pulse a ~37 % chance of disrupting for no reason.
        self.risk = self.risk.clamp(0.0, 1.0);
    }

    /// Short name of the current disruption phase, for snapshots and logs.
    pub fn phase_name(&self) -> &'static str {
        match self.phase {
            None => "",
            Some(DisruptionPhase::Precursor { .. }) => "precursor",
            Some(DisruptionPhase::ThermalQuench { .. }) => "thermal_quench",
            Some(DisruptionPhase::CurrentQuench { .. }) => "current_quench",
            Some(DisruptionPhase::Complete) => "complete",
        }
    }

    /// The hazard term contributing most to the combined rate right now,
    /// weighted exactly as `update_risk` combines them (the limit terms
    /// enter cubed, the locked-mode baseline linearly).
    pub fn dominant_cause(&self) -> DisruptionCause {
        let terms = [
            (self.risk_greenwald.powi(3), DisruptionCause::DensityLimit),
            (self.risk_beta.powi(3), DisruptionCause::BetaLimit),
            (self.risk_q95.powi(3), DisruptionCause::KinkLimit),
            (self.risk_radiation.powi(3), DisruptionCause::RadiativeCollapse),
            (self.risk_locked_mode, DisruptionCause::LockedMode),
        ];
        let mut best = (0.0, DisruptionCause::LockedMode);
        for &(w, c) in &terms {
            if w > best.0 {
                best = (w, c);
            }
        }
        best.1
    }

    /// Check if a disruption should be triggered this timestep.
    /// Returns true if a new disruption starts.
    pub fn check_trigger(&mut self, dt: f64) -> bool {
        if self.disrupted {
            return false;
        }

        // Probability of disruption in this timestep
        let prob = 1.0 - (-self.risk * dt).exp();

        if self.rand() < prob {
            self.disrupted = true;
            self.cause = self.dominant_cause();
            // Start with precursor phase
            let precursor_duration = 0.05 + 0.05 * self.rand(); // 50-100ms
            self.phase = Some(DisruptionPhase::Precursor {
                remaining: precursor_duration,
                amplitude: 0.01,
            });
            true
        } else {
            false
        }
    }

    /// Advance the disruption sequence by one timestep.
    ///
    /// `ip` and `li` are the current plasma current (MA) and internal
    /// inductance; `lambda_ext` = ln(8R/(a sqrt(kappa))) - 2 is the external
    /// part of the normalised plasma inductance. Returns the Ip, li and Te
    /// the disruption imposes this step.
    pub fn advance(&mut self, dt: f64, ip: f64, li: f64, lambda_ext: f64) -> DisruptionEffects {
        if !self.disrupted {
            return DisruptionEffects::none();
        }

        match self.phase {
            Some(DisruptionPhase::Precursor {
                remaining,
                amplitude,
            }) => {
                let new_remaining = remaining - dt;
                if new_remaining <= 0.0 {
                    // Transition to thermal quench. Size the Ip spike now, from
                    // flux conservation across the profile flattening:
                    //   L_p Ip = const,  L_p ∝ lambda_ext + li/2
                    //   ΔIp/Ip = Δ(li/2) / (lambda_ext + li/2)
                    // The flattening is partial (li drops ~30 %, floored at
                    // 0.5), which puts the overshoot in the observed 5-15 %
                    // band for DIII-D- and ITER-like parameters.
                    let total = 0.001 + 0.002 * self.rand(); // 1-3 ms
                    let li_before = li.max(0.3);
                    let li_after = (0.7 * li_before).max(0.5).min(li_before);
                    let spike_frac = (0.5 * (li_before - li_after)
                        / (lambda_ext.max(0.2) + 0.5 * li_before))
                        .clamp(0.03, 0.15);
                    self.phase = Some(DisruptionPhase::ThermalQuench {
                        remaining: total,
                        total,
                        ip_start: ip,
                        spike_frac,
                        li_before,
                        li_after,
                    });
                    DisruptionEffects {
                        ip: None,
                        li: None,
                        te_multiplier: 0.5, // Start dropping
                        locked_mode_amplitude: amplitude * 10.0,
                        is_thermal_quench: false,
                        is_current_quench: false,
                    }
                } else {
                    // Growing oscillation
                    let growth_rate = 20.0; // e-folding time ~50ms
                    let new_amplitude = amplitude * (growth_rate * dt).exp();
                    self.phase = Some(DisruptionPhase::Precursor {
                        remaining: new_remaining,
                        amplitude: new_amplitude.min(10.0),
                    });
                    DisruptionEffects {
                        ip: None,
                        li: None,
                        te_multiplier: 1.0 - 0.1 * new_amplitude.min(1.0),
                        locked_mode_amplitude: new_amplitude,
                        is_thermal_quench: false,
                        is_current_quench: false,
                    }
                }
            }
            Some(DisruptionPhase::ThermalQuench {
                remaining,
                total,
                ip_start,
                spike_frac,
                li_before,
                li_after,
            }) => {
                let new_remaining = remaining - dt;
                if new_remaining <= 0.0 {
                    // Transition to current quench from the top of the spike.
                    let cq_duration = 0.005 + 0.045 * self.rand(); // 5-50ms
                    let ip_peak = ip_start * (1.0 + spike_frac);
                    self.phase = Some(DisruptionPhase::CurrentQuench {
                        remaining: cq_duration,
                        ip_start: ip_peak,
                        total_duration: cq_duration,
                        li_flat: li_after,
                    });
                    DisruptionEffects {
                        ip: Some(ip_peak),
                        li: Some(li_after),
                        te_multiplier: 0.01, // Te collapses to ~10-50 eV
                        locked_mode_amplitude: 5.0,
                        is_thermal_quench: true,
                        is_current_quench: false,
                    }
                } else {
                    self.phase = Some(DisruptionPhase::ThermalQuench {
                        remaining: new_remaining,
                        total,
                        ip_start,
                        spike_frac,
                        li_before,
                        li_after,
                    });
                    // Profile flattening and the inductive Ip rise both follow
                    // a quarter-sine over the quench; Te collapses linearly.
                    let progress = (1.0 - new_remaining / total).clamp(0.0, 1.0);
                    let shape = (std::f64::consts::FRAC_PI_2 * progress).sin();
                    let frac = new_remaining / total;
                    DisruptionEffects {
                        ip: Some(ip_start * (1.0 + spike_frac * shape)),
                        li: Some(li_before + (li_after - li_before) * shape),
                        te_multiplier: 0.01 + 0.99 * frac,
                        locked_mode_amplitude: 5.0,
                        is_thermal_quench: true,
                        is_current_quench: false,
                    }
                }
            }
            Some(DisruptionPhase::CurrentQuench {
                remaining,
                ip_start,
                total_duration,
                li_flat,
            }) => {
                let new_remaining = remaining - dt;
                if new_remaining <= 0.0 {
                    self.phase = Some(DisruptionPhase::Complete);
                    DisruptionEffects {
                        ip: Some(0.0),
                        li: Some(li_flat),
                        te_multiplier: 0.01,
                        locked_mode_amplitude: 0.0,
                        is_thermal_quench: false,
                        is_current_quench: true,
                    }
                } else {
                    self.phase = Some(DisruptionPhase::CurrentQuench {
                        remaining: new_remaining,
                        ip_start,
                        total_duration,
                        li_flat,
                    });
                    // Exponential L/R decay of the cold, resistive plasma from
                    // the top of the spike, time constant one third of the
                    // quench duration. Evaluated at the elapsed quench time and
                    // applied to the onset current, so it is exact for any dt.
                    let tau = (total_duration / 3.0).max(1e-6);
                    let elapsed = total_duration - new_remaining;
                    DisruptionEffects {
                        ip: Some((ip_start * (-elapsed / tau).exp()).max(0.0)),
                        li: Some(li_flat),
                        te_multiplier: 0.01,
                        locked_mode_amplitude: 1.0,
                        is_thermal_quench: false,
                        is_current_quench: true,
                    }
                }
            }
            Some(DisruptionPhase::Complete) | None => DisruptionEffects {
                ip: Some(0.0),
                li: None,
                te_multiplier: 0.01,
                locked_mode_amplitude: 0.0,
                is_thermal_quench: false,
                is_current_quench: false,
            },
        }
    }

    /// Force an immediate disruption (e.g., due to wall contact).
    /// Uses a very short precursor since wall contact is sudden.
    pub fn force_disruption(&mut self) {
        if self.disrupted {
            return;
        }
        self.disrupted = true;
        self.cause = DisruptionCause::WallContact;
        self.risk = 1.0;
        self.phase = Some(DisruptionPhase::Precursor {
            remaining: 0.005, // 5ms — very fast for wall contact
            amplitude: 1.0,   // Immediate large locked mode
        });
    }

    /// Reset the disruption model for a new pulse.
    pub fn reset(&mut self) {
        self.risk = 0.0;
        self.risk_greenwald = 0.0;
        self.risk_beta = 0.0;
        self.risk_q95 = 0.0;
        self.risk_radiation = 0.0;
        self.risk_locked_mode = 0.0;
        self.disrupted = false;
        self.phase = None;
        self.cause = DisruptionCause::None;
    }
}

/// Effects of disruption on plasma parameters.
#[derive(Debug, Clone)]
pub struct DisruptionEffects {
    /// Plasma current to impose (MA), if the disruption controls Ip this
    /// step. `None` during the precursor and thermal quench, when Ip still
    /// follows the programme. Absolute rather than a per-step multiplier:
    /// the simulation re-seeds Ip from the programme every step, so a
    /// multiplier could never accumulate into a decay.
    pub ip: Option<f64>,
    /// Internal inductance to impose, if the quench controls the current
    /// profile this step (flattening through the thermal quench).
    pub li: Option<f64>,
    /// Multiply electron temperature by this factor
    pub te_multiplier: f64,
    /// Locked mode detector amplitude (a.u.)
    pub locked_mode_amplitude: f64,
    /// Whether currently in thermal quench
    pub is_thermal_quench: bool,
    /// Whether currently in current quench
    pub is_current_quench: bool,
}

impl DisruptionEffects {
    fn none() -> Self {
        DisruptionEffects {
            ip: None,
            li: None,
            te_multiplier: 1.0,
            locked_mode_amplitude: 0.0,
            is_thermal_quench: false,
            is_current_quench: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_low_risk_at_safe_params() {
        let mut model = DisruptionModel::default();
        model.update_risk(0.3, 1.0, 4.0, 0.2, 1.0);
        assert!(model.risk < 0.05, "Risk should be low at safe parameters: {}", model.risk);
    }

    #[test]
    fn test_high_risk_at_limits() {
        let mut model = DisruptionModel::default();
        // High Greenwald fraction + high beta
        model.update_risk(0.95, 2.5, 2.1, 0.9, 2.0);
        assert!(model.risk > 0.3, "Risk should be high near limits: {}", model.risk);
    }

    #[test]
    fn test_disruption_sequence() {
        let mut model = DisruptionModel::default();
        model.disrupted = true;
        model.phase = Some(DisruptionPhase::Precursor {
            remaining: 0.001,
            amplitude: 1.0,
        });

        // Advance through precursor
        let effects = model.advance(0.002, 1.0, 1.0, 0.9);
        assert!(effects.te_multiplier < 1.0);

        // Should now be in thermal quench
        assert!(matches!(
            model.phase,
            Some(DisruptionPhase::ThermalQuench { .. })
        ));

        // Advance through thermal quench
        for _ in 0..10 {
            let effects = model.advance(0.001, 1.0, 1.0, 0.9);
            assert!(effects.te_multiplier < 0.5);
        }

        // Should eventually reach current quench or complete
        let mut reached_cq = false;
        for _ in 0..100 {
            model.advance(0.001, 1.0, 1.0, 0.9);
            if matches!(model.phase, Some(DisruptionPhase::CurrentQuench { .. }))
                || matches!(model.phase, Some(DisruptionPhase::Complete))
            {
                reached_cq = true;
                break;
            }
        }
        assert!(reached_cq, "Should progress through disruption phases");
    }

    #[test]
    fn test_no_hazard_floor_at_safe_params() {
        // Only the named locked-mode baseline (0.05 %/s, amplified near
        // limits) remains; there is no constant floor.
        let mut model = DisruptionModel::default();
        model.update_risk(0.3, 1.0, 4.0, 0.2, 1.0);
        assert!(model.risk < 0.002, "No floor expected, got {}", model.risk);
        assert!(model.risk > 0.0, "Locked-mode baseline should remain");
    }

    #[test]
    fn test_current_quench_decays_with_coarse_steps() {
        // A 30 ms current quench stepped at the simulation's 5 ms must show
        // the 5 % spike and then a decay that accumulates to near zero,
        // even though dt is coarse relative to the quench.
        let mut model = DisruptionModel::default();
        model.disrupted = true;
        model.phase = Some(DisruptionPhase::CurrentQuench {
            remaining: 0.030,
            ip_start: 1.0,
            total_duration: 0.030,
            li_flat: 0.6,
        });
        let mut ips = Vec::new();
        for _ in 0..6 {
            let e = model.advance(0.005, 1.0, 1.0, 0.9);
            ips.push(e.ip.expect("CQ must impose Ip"));
        }
        // t = 5,10,15,20,25,30 ms; tau = 10 ms, so exp(-0.5) ... exp(-2.5).
        assert!(ips.iter().all(|&i| i <= 1.0 && i >= 0.0), "{:?}", ips);
        for w in ips.windows(2) {
            assert!(w[1] < w[0], "Ip must decrease monotonically: {:?}", ips);
        }
        assert!((ips[0] - (-0.5f64).exp()).abs() < 1e-9, "exact decay expected, got {:?}", ips);
        assert!(ips[4] < 0.12, "Decay must accumulate, got {:?}", ips);
        assert_eq!(ips[5], 0.0, "CQ end must terminate the current");
        assert!(matches!(model.phase, Some(DisruptionPhase::Complete)));
    }

    #[test]
    fn test_thermal_quench_ip_spike_from_flux_conservation() {
        // DIII-D-like: li 1.2, lambda_ext = ln(8*1.67/(0.56*sqrt(1.7))) - 2 ~ 0.9.
        // Partial flattening 1.2 -> 0.84 gives dIp/Ip = 0.18/1.5 = 0.12.
        let mut model = DisruptionModel::default();
        model.seed(12345);
        model.disrupted = true;
        model.phase = Some(DisruptionPhase::Precursor { remaining: 0.0005, amplitude: 1.0 });
        let _ = model.advance(0.001, 1.0, 1.2, 0.9);
        let (spike, li_after) = match model.phase {
            Some(DisruptionPhase::ThermalQuench { spike_frac, li_after, .. }) => (spike_frac, li_after),
            other => panic!("expected thermal quench, got {other:?}"),
        };
        assert!((spike - 0.12).abs() < 0.01, "spike fraction {spike}");
        assert!((li_after - 0.84).abs() < 1e-9, "li_after {li_after}");

        // Fine steps through the quench: Ip rises monotonically to the peak,
        // li falls to li_after, then the CQ decays monotonically to zero.
        let mut ip_max: f64 = 0.0;
        let mut last_ip = 1.0;
        let mut in_cq = false;
        let mut last_li = 1.2;
        for _ in 0..2000 {
            let e = model.advance(0.00025, 1.0, 1.2, 0.9);
            let ip = e.ip.expect("quench imposes Ip");
            if let Some(li) = e.li { assert!(li <= last_li + 1e-12); last_li = li; }
            // The step that moves TQ -> CQ returns the top of the spike, so the
            // monotone-decay check starts from the step after it.
            if in_cq { assert!(ip <= last_ip + 1e-12, "CQ must not rise"); }
            else { assert!(ip >= last_ip - 1e-12, "TQ must not fall"); }
            if matches!(model.phase, Some(DisruptionPhase::CurrentQuench { .. })) { in_cq = true; }
            ip_max = ip_max.max(ip);
            last_ip = ip;
            if matches!(model.phase, Some(DisruptionPhase::Complete)) { break; }
        }
        assert!((ip_max - 1.12).abs() < 0.01, "peak Ip {ip_max}");
        assert_eq!(last_ip, 0.0);
        assert!((last_li - 0.84).abs() < 1e-9);
    }

    #[test]
    fn test_small_seeds_do_not_fire_the_trigger() {
        // With a 0.05 %/s hazard the per-5ms trigger probability is 2.5e-6.
        // Raw small seeds used to produce first draws below that.
        for seed in [1u64, 7, 42, 1000, 1001] {
            let mut model = DisruptionModel::default();
            model.seed(seed);
            model.risk = 0.0005;
            for _ in 0..2000 {
                assert!(!model.check_trigger(0.005), "seed {seed} fired at a 0.05 %/s hazard");
            }
        }
    }

    #[test]
    fn test_no_disruption_at_zero_risk() {
        let mut model = DisruptionModel::default();
        model.risk = 0.0;

        let mut triggered = false;
        for _ in 0..10000 {
            if model.check_trigger(0.001) {
                triggered = true;
                break;
            }
        }
        assert!(!triggered, "Should never trigger at zero risk");
    }

    #[test]
    fn test_sigmoid() {
        assert!((sigmoid(0.0, 0.0, 0.1) - 0.5).abs() < 0.01);
        assert!(sigmoid(1.0, 0.0, 0.1) > 0.99);
        assert!(sigmoid(-1.0, 0.0, 0.1) < 0.01);
    }

    #[test]
    fn test_trigger_names_the_dominant_term() {
        // Density well past the Greenwald limit, everything else benign:
        // a trigger must be attributed to the density limit.
        let mut model = DisruptionModel::default();
        model.seed(3);
        model.update_risk(1.15, 1.0, 4.0, 0.2, 1.0);
        // sigmoid(1.15; 1.0, 0.08)^3 = 0.65: a 65 %/s hazard.
        assert!(model.risk > 0.5, "risk {} should be dominated by the density term", model.risk);
        assert_eq!(model.dominant_cause(), DisruptionCause::DensityLimit);
        assert_eq!(model.cause, DisruptionCause::None);
        // A 100 s step at 65 %/s fires with probability 1 - e^-65.
        assert!(model.check_trigger(100.0));
        assert_eq!(model.cause, DisruptionCause::DensityLimit);
        assert_eq!(model.cause.name(), "density_limit");

        // Beta past the no-wall limit instead.
        let mut model = DisruptionModel::default();
        model.update_risk(0.5, 3.2, 4.0, 0.2, 1.0);
        assert_eq!(model.dominant_cause(), DisruptionCause::BetaLimit);

        // Kink: q95 under 2.
        let mut model = DisruptionModel::default();
        model.update_risk(0.5, 1.0, 1.8, 0.2, 1.0);
        assert_eq!(model.dominant_cause(), DisruptionCause::KinkLimit);

        // Radiative collapse.
        let mut model = DisruptionModel::default();
        model.update_risk(0.5, 1.0, 4.0, 0.98, 1.0);
        assert_eq!(model.dominant_cause(), DisruptionCause::RadiativeCollapse);

        // Nothing near a limit: only the locked-mode baseline is left.
        let mut model = DisruptionModel::default();
        model.update_risk(0.5, 1.0, 4.0, 0.2, 1.0);
        assert_eq!(model.dominant_cause(), DisruptionCause::LockedMode);
    }

    #[test]
    fn test_wall_contact_is_named_and_reset_clears_it() {
        let mut model = DisruptionModel::default();
        model.force_disruption();
        assert!(model.disrupted);
        assert_eq!(model.cause, DisruptionCause::WallContact);
        model.reset();
        assert_eq!(model.cause, DisruptionCause::None);
        assert_eq!(model.cause.name(), "");
    }
}
