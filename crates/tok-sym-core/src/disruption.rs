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
    /// Rapid loss of thermal energy
    ThermalQuench {
        remaining: f64,
    },
    /// Plasma current decay
    CurrentQuench {
        remaining: f64,
        /// Initial Ip at start of CQ (MA)
        ip_start: f64,
        /// Total duration of CQ phase (s) — used to compute elapsed time for Ip spike
        total_duration: f64,
    },
    /// Disruption complete, plasma terminated
    Complete,
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
    pub fn seed(&mut self, seed: u64) {
        self.rng_state = seed;
        if self.rng_state == 0 {
            self.rng_state = 1;
        }
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
        // Base rate kept very low so safe discharges almost never disrupt.
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

        self.risk = self.risk.clamp(0.0, 1.0);
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
    /// Returns modifications to plasma parameters (Ip multiplier, Te multiplier).
    pub fn advance(&mut self, dt: f64, ip: f64) -> DisruptionEffects {
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
                    // Transition to thermal quench
                    self.phase = Some(DisruptionPhase::ThermalQuench {
                        remaining: 0.001 + 0.001 * self.rand(), // 1-2ms
                    });
                    DisruptionEffects {
                        ip_multiplier: 1.0,
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
                        ip_multiplier: 1.0,
                        te_multiplier: 1.0 - 0.1 * new_amplitude.min(1.0),
                        locked_mode_amplitude: new_amplitude,
                        is_thermal_quench: false,
                        is_current_quench: false,
                    }
                }
            }
            Some(DisruptionPhase::ThermalQuench { remaining }) => {
                let new_remaining = remaining - dt;
                if new_remaining <= 0.0 {
                    // Transition to current quench
                    let cq_duration = 0.005 + 0.045 * self.rand(); // 5-50ms
                    self.phase = Some(DisruptionPhase::CurrentQuench {
                        remaining: cq_duration,
                        ip_start: ip,
                        total_duration: cq_duration,
                    });
                    DisruptionEffects {
                        ip_multiplier: 1.0,
                        te_multiplier: 0.01, // Te collapses to ~10-50 eV
                        locked_mode_amplitude: 5.0,
                        is_thermal_quench: true,
                        is_current_quench: false,
                    }
                } else {
                    self.phase = Some(DisruptionPhase::ThermalQuench {
                        remaining: new_remaining,
                    });
                    // Exponential Te collapse
                    let frac = new_remaining / 0.002;
                    DisruptionEffects {
                        ip_multiplier: 1.0,
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
            }) => {
                let new_remaining = remaining - dt;
                if new_remaining <= 0.0 {
                    self.phase = Some(DisruptionPhase::Complete);
                    DisruptionEffects {
                        ip_multiplier: 0.0,
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
                    });

                    // Transient Ip spike (current quench overshoot) followed by
                    // exponential L/R decay.  In real disruptions the sudden loss
                    // of thermal energy increases plasma resistivity, causing a
                    // brief inductive Ip overshoot before the L/R decay dominates.
                    let spike_dur = 0.002_f64.min(total_duration * 0.3); // 2ms spike
                    let elapsed = total_duration - remaining;
                    let new_elapsed = elapsed + dt;

                    // Envelope: sine-shaped 5% spike then exponential decay
                    let envelope = |t: f64| -> f64 {
                        if t < spike_dur {
                            1.0 + 0.05 * (std::f64::consts::PI * t / spike_dur).sin()
                        } else {
                            let tau = (total_duration - spike_dur).max(1e-6) / 3.0;
                            (-(t - spike_dur) / tau).exp()
                        }
                    };

                    let ip_mult = (envelope(new_elapsed)
                        / envelope(elapsed).max(1e-10))
                        .clamp(0.0, 1.5);

                    DisruptionEffects {
                        ip_multiplier: ip_mult,
                        te_multiplier: 0.01,
                        locked_mode_amplitude: 1.0,
                        is_thermal_quench: false,
                        is_current_quench: true,
                    }
                }
            }
            Some(DisruptionPhase::Complete) | None => DisruptionEffects {
                ip_multiplier: 0.0,
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
        self.risk = 1.0;
        self.phase = Some(DisruptionPhase::Precursor {
            remaining: 0.005, // 5ms — very fast for wall contact
            amplitude: 1.0,   // Immediate large locked mode
        });
    }

    /// Reset the disruption model for a new discharge.
    pub fn reset(&mut self) {
        self.risk = 0.0;
        self.risk_greenwald = 0.0;
        self.risk_beta = 0.0;
        self.risk_q95 = 0.0;
        self.risk_radiation = 0.0;
        self.risk_locked_mode = 0.0;
        self.disrupted = false;
        self.phase = None;
    }
}

/// Effects of disruption on plasma parameters.
#[derive(Debug, Clone)]
pub struct DisruptionEffects {
    /// Multiply plasma current by this factor
    pub ip_multiplier: f64,
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
            ip_multiplier: 1.0,
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
        let effects = model.advance(0.002, 1.0);
        assert!(effects.te_multiplier < 1.0);

        // Should now be in thermal quench
        assert!(matches!(
            model.phase,
            Some(DisruptionPhase::ThermalQuench { .. })
        ));

        // Advance through thermal quench
        for _ in 0..10 {
            let effects = model.advance(0.001, 1.0);
            assert!(effects.te_multiplier < 0.5);
        }

        // Should eventually reach current quench or complete
        let mut reached_cq = false;
        for _ in 0..100 {
            model.advance(0.001, 1.0);
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
}
