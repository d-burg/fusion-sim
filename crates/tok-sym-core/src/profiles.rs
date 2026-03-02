//! Parameterized plasma profiles for temperature and density.
//!
//! Uses simple analytic profile shapes that can represent both L-mode
//! and H-mode (with pedestal) configurations.

use serde::{Deserialize, Serialize};

/// Plasma profile state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profiles {
    /// Central electron temperature (keV)
    pub te0: f64,
    /// Pedestal electron temperature (keV)
    pub te_ped: f64,
    /// Central electron density (10²⁰ m⁻³)
    pub ne0: f64,
    /// Pedestal electron density (10²⁰ m⁻³)
    pub ne_ped: f64,
    /// Temperature profile peaking exponent
    pub alpha_t: f64,
    /// Density profile peaking exponent
    pub alpha_n: f64,
    /// Pedestal location in normalized radius (0-1)
    pub rho_ped: f64,
    /// Whether in H-mode (pedestal active)
    pub h_mode: bool,
}

impl Default for Profiles {
    fn default() -> Self {
        Profiles {
            te0: 2.0,
            te_ped: 0.5,
            ne0: 0.5,
            ne_ped: 0.3,
            alpha_t: 1.5,
            alpha_n: 1.0,
            rho_ped: 0.92,
            h_mode: false,
        }
    }
}

impl Profiles {
    /// Electron temperature at normalized radius rho (0=axis, 1=edge).
    pub fn te(&self, rho: f64) -> f64 {
        let rho = rho.clamp(0.0, 1.0);

        if self.h_mode && rho > self.rho_ped {
            // Linear drop through pedestal to ~100 eV at edge
            let edge_te = 0.05; // 50 eV at LCFS
            let frac = (rho - self.rho_ped) / (1.0 - self.rho_ped);
            self.te_ped * (1.0 - frac) + edge_te * frac
        } else if self.h_mode {
            // Core profile: parabolic from te0 to te_ped
            let rho_norm = rho / self.rho_ped;
            self.te_ped + (self.te0 - self.te_ped) * (1.0 - rho_norm.powi(2)).powf(self.alpha_t)
        } else {
            // L-mode: simple parabolic from te0 to edge
            let edge_te = 0.05;
            edge_te + (self.te0 - edge_te) * (1.0 - rho.powi(2)).powf(self.alpha_t)
        }
    }

    /// Electron density at normalized radius rho (10²⁰ m⁻³).
    pub fn ne(&self, rho: f64) -> f64 {
        let rho = rho.clamp(0.0, 1.0);

        if self.h_mode && rho > self.rho_ped {
            let edge_ne = 0.05;
            let frac = (rho - self.rho_ped) / (1.0 - self.rho_ped);
            self.ne_ped * (1.0 - frac) + edge_ne * frac
        } else if self.h_mode {
            let rho_norm = rho / self.rho_ped;
            self.ne_ped + (self.ne0 - self.ne_ped) * (1.0 - rho_norm.powi(2)).powf(self.alpha_n)
        } else {
            let edge_ne = 0.05;
            edge_ne + (self.ne0 - edge_ne) * (1.0 - rho.powi(2)).powf(self.alpha_n)
        }
    }

    /// Line-averaged electron density (10²⁰ m⁻³).
    /// Simple numerical integration across the midplane.
    pub fn ne_line_avg(&self) -> f64 {
        let n = 50;
        let mut sum = 0.0;
        for i in 0..n {
            let rho = (i as f64 + 0.5) / n as f64;
            sum += self.ne(rho);
        }
        sum / n as f64
    }

    /// Volume-averaged electron temperature (keV).
    pub fn te_vol_avg(&self) -> f64 {
        let n = 50;
        let mut sum = 0.0;
        let mut vol = 0.0;
        for i in 0..n {
            let rho = (i as f64 + 0.5) / n as f64;
            // Volume element ∝ rho for circular cross-section
            let dv = 2.0 * rho;
            sum += self.te(rho) * dv;
            vol += dv;
        }
        sum / vol
    }

    /// Volume-averaged electron density (10²⁰ m⁻³).
    pub fn ne_vol_avg(&self) -> f64 {
        let n = 50;
        let mut sum = 0.0;
        let mut vol = 0.0;
        for i in 0..n {
            let rho = (i as f64 + 0.5) / n as f64;
            let dv = 2.0 * rho;
            sum += self.ne(rho) * dv;
            vol += dv;
        }
        sum / vol
    }

    /// Volume-averaged pressure (keV * 10²⁰ m⁻³ = 1.602 kPa).
    pub fn pressure_vol_avg(&self) -> f64 {
        let n = 50;
        let mut sum = 0.0;
        let mut vol = 0.0;
        for i in 0..n {
            let rho = (i as f64 + 0.5) / n as f64;
            let dv = 2.0 * rho;
            // Total pressure ≈ ne*(Te + Ti), assume Ti ≈ Te
            sum += self.ne(rho) * self.te(rho) * 2.0 * dv;
            vol += dv;
        }
        sum / vol
    }

    /// Update profiles from 0D state variables.
    pub fn update_from_0d(&mut self, te0: f64, ne0: f64, h_mode: bool) {
        self.te0 = te0.max(0.01);
        self.ne0 = ne0.max(0.01);
        self.h_mode = h_mode;

        if h_mode {
            // Pedestal is typically ~30-50% of central value
            self.te_ped = (0.4 * te0).max(0.3);
            self.ne_ped = (0.7 * ne0).max(0.1);
        } else {
            self.te_ped = 0.0;
            self.ne_ped = 0.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lmode_profiles() {
        let p = Profiles::default();
        assert!((p.te(0.0) - p.te0).abs() < 1e-10);
        assert!(p.te(0.5) < p.te0);
        assert!(p.te(1.0) < 0.1);
    }

    #[test]
    fn test_hmode_pedestal() {
        let mut p = Profiles::default();
        p.h_mode = true;
        p.te0 = 5.0;
        p.te_ped = 2.0;
        p.ne0 = 1.0;
        p.ne_ped = 0.8;

        // Core should be above pedestal
        assert!(p.te(0.0) > p.te_ped);
        // Just inside pedestal should be near pedestal value
        assert!((p.te(p.rho_ped - 0.01) - p.te_ped).abs() < 0.5);
        // Edge should be very low
        assert!(p.te(1.0) < 0.1);
    }

    #[test]
    fn test_averages() {
        let p = Profiles {
            te0: 5.0,
            ne0: 1.0,
            h_mode: false,
            ..Default::default()
        };
        let te_avg = p.te_vol_avg();
        assert!(te_avg > 0.0 && te_avg < p.te0);
        let ne_avg = p.ne_vol_avg();
        assert!(ne_avg > 0.0 && ne_avg < p.ne0);
    }
}
