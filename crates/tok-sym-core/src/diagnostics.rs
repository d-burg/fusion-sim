//! Synthetic diagnostic signal generation.
//!
//! Produces realistic-looking diagnostic traces with noise for the
//! control room display. Each diagnostic mirrors a real measurement
//! system found on tokamaks.

use serde::{Deserialize, Serialize};

/// All synthetic diagnostic signals at a given time.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiagnosticSignals {
    /// Plasma current from Rogowski coil (MA)
    pub ip: f64,
    /// Line-averaged density from interferometer (10²⁰ m⁻³)
    pub ne_bar: f64,
    /// Central electron temperature from ECE (keV)
    pub te0: f64,
    /// Stored energy from diamagnetic loop (MJ)
    pub w_mhd: f64,
    /// Total radiated power from bolometer (MW)
    pub p_rad: f64,
    /// D-alpha emission (a.u.) — spikes during ELMs
    pub d_alpha: f64,
    /// Soft X-ray central chord (a.u.)
    pub soft_xray: f64,
    /// Locked mode detector amplitude (a.u.)
    pub locked_mode: f64,
    /// Neutron rate (for D-T or D-D, a.u.)
    pub neutron_rate: f64,
    /// Total input power (MW)
    pub p_input: f64,
    /// βN (normalized beta)
    pub beta_n: f64,
    /// q95
    pub q95: f64,
    /// Greenwald fraction
    pub f_greenwald: f64,
    /// Loop voltage (V)
    pub v_loop: f64,
}

/// Simple noise generator using xorshift.
pub struct NoiseGen {
    state: u64,
}

impl NoiseGen {
    pub fn new(seed: u64) -> Self {
        NoiseGen {
            state: if seed == 0 { 1 } else { seed },
        }
    }

    /// Uniform random in [0, 1).
    fn uniform(&mut self) -> f64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        (x as f64) / (u64::MAX as f64)
    }

    /// Gaussian noise with mean 0 and given standard deviation.
    /// Uses Box-Muller transform.
    pub fn gaussian(&mut self, sigma: f64) -> f64 {
        let u1 = self.uniform().max(1e-10);
        let u2 = self.uniform();
        sigma * (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }

    /// Add relative noise (percentage of signal).
    pub fn add_noise(&mut self, value: f64, relative_noise: f64) -> f64 {
        value + self.gaussian(value.abs() * relative_noise)
    }
}

impl DiagnosticSignals {
    /// Generate diagnostic signals from the current plasma state.
    pub fn from_state(
        ip: f64,
        ne_bar: f64,
        te0: f64,
        w_th: f64,
        p_rad: f64,
        p_input: f64,
        beta_n: f64,
        q95: f64,
        f_greenwald: f64,
        _in_hmode: bool,
        elm_active: bool,
        locked_mode_amp: f64,
        noise: &mut NoiseGen,
    ) -> Self {
        // Noise levels typical of real diagnostics
        let ip_meas = noise.add_noise(ip, 0.002); // 0.2% noise
        let ne_meas = noise.add_noise(ne_bar, 0.01); // 1% noise
        let te_meas = noise.add_noise(te0, 0.02); // 2% noise
        let w_meas = noise.add_noise(w_th, 0.005); // 0.5% noise
        let p_rad_meas = noise.add_noise(p_rad, 0.05); // 5% noise

        // D-alpha: baseline proportional to edge density, spikes during ELMs
        let d_alpha_base = ne_bar * 0.5 + noise.gaussian(0.02);
        let d_alpha = if elm_active {
            d_alpha_base + 5.0 + noise.gaussian(1.0)
        } else {
            d_alpha_base.max(0.0)
        };

        // Soft X-ray: proportional to ne² * Te^0.5
        let soft_xray = ne_bar * ne_bar * te0.sqrt() * 10.0 + noise.gaussian(0.1);

        // Locked mode
        let locked = locked_mode_amp + noise.gaussian(0.005);

        // Neutron rate: proportional to ne² * Ti² (fusion reactivity ∝ Ti²)
        // Only significant for D-T or high-Ti D-D
        let neutron = ne_bar * ne_bar * te0 * te0 * 0.01 + noise.gaussian(0.001);

        // Loop voltage: V_loop = R * Ip + L * dIp/dt
        // Simplified: in steady state, V_loop ∝ η * Ip ∝ Ip / Te^1.5
        let v_loop = if te0 > 0.05 {
            0.5 * ip / te0.powf(1.5) + noise.gaussian(0.01)
        } else {
            1.0
        };

        DiagnosticSignals {
            ip: ip_meas,
            ne_bar: ne_meas.max(0.0),
            te0: te_meas.max(0.0),
            w_mhd: w_meas.max(0.0),
            p_rad: p_rad_meas.max(0.0),
            d_alpha: d_alpha.max(0.0),
            soft_xray: soft_xray.max(0.0),
            locked_mode: locked.abs(),
            neutron_rate: neutron.max(0.0),
            p_input: noise.add_noise(p_input, 0.01).max(0.0),
            beta_n: noise.add_noise(beta_n, 0.02).max(0.0),
            q95: noise.add_noise(q95, 0.01).max(1.0),
            f_greenwald: f_greenwald, // derived, no noise
            v_loop,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_noise_gen_gaussian() {
        let mut ng = NoiseGen::new(42);
        let mut sum = 0.0;
        let n = 10000;
        for _ in 0..n {
            sum += ng.gaussian(1.0);
        }
        let mean = sum / n as f64;
        // Mean should be near 0
        assert!(mean.abs() < 0.1, "Gaussian mean should be ~0, got {}", mean);
    }

    #[test]
    fn test_diagnostic_signals() {
        let mut noise = NoiseGen::new(42);
        let diag = DiagnosticSignals::from_state(
            1.5, 0.5, 3.0, 1.0, 0.3, 5.0, 1.8, 3.5, 0.6, true, false, 0.0, &mut noise,
        );
        assert!(diag.ip > 0.0);
        assert!(diag.ne_bar > 0.0);
        assert!(diag.te0 > 0.0);
        assert!(diag.d_alpha > 0.0);
    }

    #[test]
    fn test_elm_spike() {
        let mut noise = NoiseGen::new(42);
        let diag_no_elm = DiagnosticSignals::from_state(
            1.5, 0.5, 3.0, 1.0, 0.3, 5.0, 1.8, 3.5, 0.6, true, false, 0.0, &mut noise,
        );
        let diag_elm = DiagnosticSignals::from_state(
            1.5, 0.5, 3.0, 1.0, 0.3, 5.0, 1.8, 3.5, 0.6, true, true, 0.0, &mut noise,
        );
        // D-alpha should spike during ELM
        assert!(
            diag_elm.d_alpha > diag_no_elm.d_alpha * 2.0,
            "D-alpha should spike during ELM"
        );
    }
}
