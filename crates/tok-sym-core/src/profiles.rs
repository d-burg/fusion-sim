//! Parameterized plasma profiles for temperature and density.
//!
//! H-mode uses an OMFIT-derived tanh-pedestal parameterization (Hmode_profiles)
//! with smooth pedestal evolution. L-mode retains a simple parabolic model.

use serde::{Deserialize, Serialize};

/// Number of radial points in profile arrays (ρ = 0.00, 0.02, ..., 1.00).
pub const PROFILE_NPTS: usize = 51;

/// OMFIT-style tanh-pedestal profile parameters.
///
/// Parameterizes a profile shape with a steep tanh pedestal and independently
/// shaped core region, as used in OMFIT's `Hmode_profiles` module.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileParams {
    /// Separatrix (edge) value
    pub edge: f64,
    /// Pedestal top value
    pub ped: f64,
    /// Core (axis) value
    pub core: f64,
    /// Core inner exponent (controls peaking shape)
    pub expin: f64,
    /// Core outer exponent (controls shoulder shape)
    pub expout: f64,
    /// Pedestal width in ρ
    pub widthp: f64,
    /// Pedestal half-height location in ρ
    pub xphalf: f64,
}

/// Plasma profile state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profiles {
    /// H-mode Te profile parameters (tanh-pedestal)
    pub te_params: ProfileParams,
    /// H-mode ne profile parameters (tanh-pedestal)
    pub ne_params: ProfileParams,
    /// Whether in H-mode (pedestal active)
    pub h_mode: bool,
    /// Previous timestep's h_mode flag, for detecting L↔H transitions
    prev_h_mode: bool,
    /// Pedestal electron temperature (keV) — derived from te_params for 0D coupling
    pub te_ped: f64,
    /// Pedestal electron density (10²⁰ m⁻³) — derived from ne_params for 0D coupling
    pub ne_ped: f64,
    /// L-mode temperature peaking exponent
    pub alpha_t: f64,
    /// L-mode density peaking exponent
    pub alpha_n: f64,
    /// Core Te for L-mode (keV)
    te0_lmode: f64,
    /// Core ne for L-mode (10²⁰ m⁻³)
    ne0_lmode: f64,
    /// Smoothed core Te for ELM resilience (keV)
    te0_core_smooth: f64,
    /// Smoothed core ne for ELM resilience (10²⁰ m⁻³)
    ne0_core_smooth: f64,
    /// L↔H blend factor: 0.0 = fully L-mode shape, 1.0 = fully H-mode shape.
    /// Ramps smoothly during transitions to avoid profile discontinuities.
    pub blend: f64,
}

/// Evaluate tanh-pedestal profile at normalized radius ρ.
///
/// Direct port of OMFIT `Hmode_profiles` parameterization:
///   - tanh pedestal region centered at `xphalf` with half-width `widthp/2`
///   - core peaking above the tanh baseline via `(1 - (ρ/ρ_ped)^expin)^expout`
///
/// All parameters (xphalf, widthp, etc.) are defined in ρ space.
fn tanh_profile(rho: f64, p: &ProfileParams) -> f64 {
    let w_e1 = 0.5 * p.widthp;
    let xphalf = p.xphalf;
    let xped = xphalf - w_e1;

    // Normalization constant for the tanh
    let pconst = 1.0 - ((1.0 - xphalf) / w_e1).tanh();
    let a_t = 2.0 * (p.ped - p.edge) / (1.0 + 1.0_f64.tanh() - pconst);

    // Value of the tanh function at the axis (baseline for core peaking)
    let coretanh = 0.5 * a_t * (1.0 - (-xphalf / w_e1).tanh() - pconst) + p.edge;

    // Tanh pedestal shape
    let val = 0.5 * a_t * (1.0 - ((rho - xphalf) / w_e1).tanh() - pconst) + p.edge;

    // Core peaking above the tanh baseline
    let xtoped = rho / xped.max(0.01);
    if xtoped.powf(p.expin) < 1.0 {
        val + (p.core - coretanh) * (1.0 - xtoped.powf(p.expin)).powf(p.expout)
    } else {
        val
    }
}

/// Default DIII-D H-mode Te profile parameters (keV, ρ grid).
pub fn diiid_te_params() -> ProfileParams {
    ProfileParams {
        edge: 0.07,   // 70 eV
        ped: 0.83,    // 830 eV
        core: 2.5,    // 2.5 keV
        expin: 1.6,
        expout: 1.5,
        widthp: 0.048,
        xphalf: 0.975,
    }
}

/// Default DIII-D H-mode ne profile parameters (10²⁰ m⁻³, ρ grid).
pub fn diiid_ne_params() -> ProfileParams {
    ProfileParams {
        edge: 0.09,   // 9.0e18 m⁻³
        ped: 0.30,    // 3.0e19 m⁻³
        core: 0.55,   // 5.5e19 m⁻³
        expin: 1.5,
        expout: 1.5,
        widthp: 0.06,
        xphalf: 0.975,
    }
}

/// Default ITER H-mode Te profile parameters (keV, ρ grid).
///
/// Scaled from DIII-D: higher temperatures, slightly wider pedestal.
/// ITER baseline H-mode: Te_core ~ 25 keV, Te_ped ~ 4-5 keV.
pub fn iter_te_params() -> ProfileParams {
    ProfileParams {
        edge: 0.10,   // 100 eV (higher SOL Te)
        ped: 4.5,     // ~4.5 keV pedestal
        core: 25.0,   // ~25 keV on axis
        expin: 1.6,
        expout: 1.5,
        widthp: 0.04, // slightly narrower pedestal in ρ
        xphalf: 0.96,
    }
}

/// Default ITER H-mode ne profile parameters (10²⁰ m⁻³, ρ grid).
///
/// ITER baseline: ne_core ~ 1.0e20, ne_ped ~ 0.7-0.8e20 (high density).
pub fn iter_ne_params() -> ProfileParams {
    ProfileParams {
        edge: 0.15,   // 1.5e19 m⁻³
        ped: 0.75,    // 7.5e19 m⁻³
        core: 1.05,   // 1.05e20 m⁻³
        expin: 1.5,
        expout: 1.5,
        widthp: 0.05,
        xphalf: 0.96,
    }
}

/// Default SPARC Te profile parameters (keV, ρ grid).
///
/// Read off the public TRANSP profiles for the Primary Reference Discharge
/// (`PrimaryReferenceDischarge/5 - transp_*.txt` in `cfs-energy/SPARCPublic`):
///   ρ=0.00 → 22.8 keV, ρ=0.50 → 10.3, ρ=0.90 → 4.6, ρ=0.95 → 4.1,
///   ρ=0.99 → 0.36, ρ=1.00 → 0.27.
/// The pedestal foot sits near ρ ≈ 0.96 and is narrow (Δρ ≈ 0.04), consistent
/// with the high pedestal pressure EPED predicts for SPARC.
///
/// Note these are the *full* Type-I ELMy pedestal values from the PRD. In the
/// QCE regime the pedestal is degraded (see Device::qce_confinement_factor);
/// that reduction is applied through the transport model, not baked in here.
pub fn sparc_te_params() -> ProfileParams {
    ProfileParams {
        edge: 0.27,  // 270 eV at the separatrix
        ped: 4.1,    // ~4.1 keV pedestal top
        core: 22.8,  // ~22.8 keV on axis
        expin: 1.6,
        expout: 1.5,
        widthp: 0.04,
        xphalf: 0.965,
    }
}

/// Default SPARC ne profile parameters (10²⁰ m⁻³, ρ grid).
///
/// Same source: ne(0) = 4.17×10²⁰, ne(0.95) = 2.79×10²⁰, ne(sep) = 0.84×10²⁰.
/// The profile is markedly flatter than the temperature (peaking ≈ 1.2).
pub fn sparc_ne_params() -> ProfileParams {
    ProfileParams {
        edge: 0.84, // 8.4e19 m⁻³ — high separatrix density, as QCE requires
        ped: 2.80,  // 2.8e20 m⁻³
        core: 4.17, // 4.17e20 m⁻³
        expin: 1.5,
        expout: 1.5,
        widthp: 0.045,
        xphalf: 0.965,
    }
}

impl Profiles {
    /// Create profiles with device-specific defaults.
    pub fn for_device(device_id: &str) -> Self {
        let (te, ne) = match device_id {
            "iter" => (iter_te_params(), iter_ne_params()),
            "sparc" => (sparc_te_params(), sparc_ne_params()),
            _ => (diiid_te_params(), diiid_ne_params()), // DIII-D is the fallback
        };
        Profiles {
            te_ped: te.ped,
            ne_ped: ne.ped,
            te_params: te,
            ne_params: ne,
            h_mode: false,
            prev_h_mode: false,
            alpha_t: 1.5,
            alpha_n: 1.0,
            te0_lmode: 2.0,
            ne0_lmode: 0.5,
            te0_core_smooth: 2.0,
            ne0_core_smooth: 0.5,
            blend: 0.0,
        }
    }
}

impl Default for Profiles {
    /// Default is DIII-D profiles (backward compatible).
    fn default() -> Self {
        Profiles::for_device("diiid")
    }
}

impl Profiles {
    /// Electron temperature at normalized radius ρ (0=axis, 1=edge), in keV.
    pub fn te(&self, rho: f64) -> f64 {
        let rho = rho.clamp(0.0, 1.0);
        let lmode = {
            let edge_te = 0.05;
            // Clamp core ≥ edge to prevent hollow profiles during ramp-up/down
            // (when transport te0 drops below edge temperature)
            let core = self.te0_lmode.max(edge_te);
            edge_te + (core - edge_te) * (1.0 - rho.powi(2)).powf(self.alpha_t)
        };
        let hmode = tanh_profile(rho, &self.te_params);
        (lmode * (1.0 - self.blend) + hmode * self.blend).max(0.01)
    }

    /// Electron density at normalized radius ρ (10²⁰ m⁻³).
    pub fn ne(&self, rho: f64) -> f64 {
        let rho = rho.clamp(0.0, 1.0);
        let lmode = {
            let edge_ne = 0.05;
            let core = self.ne0_lmode.max(edge_ne);
            edge_ne + (core - edge_ne) * (1.0 - rho.powi(2)).powf(self.alpha_n)
        };
        let hmode = tanh_profile(rho, &self.ne_params);
        (lmode * (1.0 - self.blend) + hmode * self.blend).max(0.001)
    }

    /// Te profile as a fixed-size array for snapshot serialization.
    pub fn te_profile_array(&self) -> Vec<f64> {
        (0..PROFILE_NPTS)
            .map(|i| {
                let rho = i as f64 / (PROFILE_NPTS - 1) as f64;
                self.te(rho)
            })
            .collect()
    }

    /// ne profile as a fixed-size array for snapshot serialization.
    pub fn ne_profile_array(&self) -> Vec<f64> {
        (0..PROFILE_NPTS)
            .map(|i| {
                let rho = i as f64 / (PROFILE_NPTS - 1) as f64;
                self.ne(rho)
            })
            .collect()
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
            sum += self.ne(rho) * self.te(rho) * 2.0 * dv;
            vol += dv;
        }
        sum / vol
    }

    // Profile energy normalization was removed. The 0D transport model
    // and profile parameterization use different approximations, leading
    // to ~20-30% stored energy mismatch (W_profiles vs W_0D). This is an
    // acceptable limitation of the 0D approach. Attempts to force energy
    // consistency by rescaling Te_core caused the profile Te(0) to diverge
    // from the trace Te0, and produced unphysical Te swells during L-H
    // and H-L transitions. The profile shapes are now set purely by the
    // 0D-derived Te0/ne0 and the pedestal scaling, giving consistent
    // values between the trace panel and profile panel.

    /// Compute internal inductance l_i from Te profile shape.
    ///
    /// Uses Spitzer conductivity: j(ρ) ∝ Te(ρ)^{3/2}, then integrates to get
    /// enclosed current I(ρ) and poloidal field B_pol(ρ) ∝ I(ρ)/ρ.
    /// l_i = ⟨B_pol²⟩ / B_pol(a)² measures current profile peaking.
    pub fn compute_li(&self) -> f64 {
        let n = 50;
        let drho = 1.0 / n as f64;

        // Step 1: Build enclosed current profile I(ρ) by integrating j ∝ Te^1.5
        let mut i_enclosed = vec![0.0_f64; n + 1]; // I(ρ) at cell edges
        for k in 0..n {
            let rho = (k as f64 + 0.5) * drho; // midpoint
            let j = self.te(rho).max(0.01).powf(1.5); // j ∝ Te^1.5
            let d_current = j * 2.0 * rho * drho; // j · 2πρ dρ (2π cancels)
            i_enclosed[k + 1] = i_enclosed[k] + d_current;
        }

        let i_total = i_enclosed[n];
        if i_total < 1e-12 {
            return 1.0; // fallback
        }

        // Step 2: Compute <B_pol²> volume average
        // B_pol(ρ) ∝ I(ρ)/ρ, so B_pol² ∝ I(ρ)²/ρ²
        let mut bp2_sum = 0.0;
        let mut vol_sum = 0.0;
        for k in 0..n {
            let rho = (k as f64 + 0.5) * drho;
            let i_mid = 0.5 * (i_enclosed[k] + i_enclosed[k + 1]);
            let bp2 = if rho > 0.01 {
                (i_mid / rho).powi(2)
            } else {
                0.0 // on-axis: B_pol → 0
            };
            let dv = 2.0 * rho * drho;
            bp2_sum += bp2 * dv;
            vol_sum += dv;
        }

        let bp2_avg = bp2_sum / vol_sum;
        let bp2_edge = (i_total / 1.0).powi(2); // B_pol(ρ=1) ∝ I_total / 1

        let li_raw = bp2_avg / bp2_edge;
        li_raw.clamp(0.4, 2.0)
    }

    /// Update profiles from 0D state variables.
    ///
    /// In H-mode, scales the tanh-pedestal parameters to match the 0D transport
    /// solution, with 200ms smoothing on pedestal evolution to prevent jitter.
    /// Core Te/ne are smoothed with 150ms τ to insulate from fast ELM crashes.
    /// In L-mode, updates simple parabolic parameters.
    ///
    /// Transitions are handled smoothly:
    /// - L→H: pedestal starts at edge value and ramps up (200ms τ)
    /// - H→L: pedestal ramps down toward edge (100ms τ) before zeroing
    ///
    /// `elm_ped_crash` is a fractional crash applied directly to the pedestal
    /// when an ELM fires (0.0 = no ELM, >0 = pedestal drops by this fraction).
    pub fn update_from_0d(&mut self, te0: f64, ne0: f64, h_mode: bool, dt: f64, elm_ped_crash: f64, delta: f64, tau_e: f64) {
        let l_to_h = h_mode && !self.prev_h_mode;
        self.h_mode = h_mode;
        self.prev_h_mode = h_mode;

        // ── Blend factor: smooth transition between L-mode and H-mode shapes ──
        let blend_target = if h_mode { 1.0 } else { 0.0 };
        let tau_blend = if h_mode { 0.2 } else { 0.1 }; // 200ms L→H, 100ms H→L
        let alpha_blend = (dt / tau_blend).min(1.0);
        self.blend = (self.blend + (blend_target - self.blend) * alpha_blend).clamp(0.0, 1.0);

        // ── Always update L-mode core values so they stay current for blending ──
        self.te0_lmode = te0.max(0.01);
        self.ne0_lmode = ne0.max(0.01);

        // ── Smooth core tracking (used by both modes) ──
        // Use tau_E as the smoothing constant: core temperature responds on
        // the energy confinement timescale, not the ELM crash timescale.
        // Minimum 100ms to avoid jitter during ramp-up when tau_E is small.
        let tau_core = tau_e.max(0.10);
        let alpha_core = (dt / tau_core).min(1.0);
        self.te0_core_smooth += (te0 - self.te0_core_smooth) * alpha_core;
        self.ne0_core_smooth += (ne0 - self.ne0_core_smooth) * alpha_core;

        if h_mode {
            // On L→H transition: initialize pedestal at edge values so it
            // ramps up smoothly rather than jumping to the default H-mode ped
            if l_to_h {
                self.te_params.ped = self.te_params.edge;
                self.ne_params.ped = self.ne_params.edge;
                self.te0_core_smooth = te0;
                self.ne0_core_smooth = ne0;
            }

            // Scale core to smoothed values (not raw te0/ne0)
            self.te_params.core = self.te0_core_smooth.max(0.1);

            // Pedestal tracks core with realistic ratio, smoothed.
            // Triangularity dependence: higher δ stabilizes peeling-ballooning
            // modes, allowing higher pedestal pressure before ELM crash.
            // Experimentally: Te_ped scales roughly as (1 + α·δ) where α ≈ 0.5-1.
            // At δ=0.0: ped_ratio ≈ 0.30; at δ=0.5: ped_ratio ≈ 0.37;
            // at δ=0.7: ped_ratio ≈ 0.40. Clamped to [0.25, 0.50].
            // For negative δ (NT), pedestal is suppressed since there's no
            // edge transport barrier.
            let delta_eff = delta.max(0.0); // only positive δ boosts pedestal
            let ped_ratio = (0.30 + 0.20 * delta_eff).clamp(0.25, 0.50);
            let target_te_ped = (ped_ratio * te0).max(0.3).min(te0 * 0.6);
            let tau_ped = 0.10; // 100ms pedestal response time
            let alpha = (dt / tau_ped).min(1.0);
            self.te_params.ped += (target_te_ped - self.te_params.ped) * alpha;
            self.te_ped = self.te_params.ped;

            // Density: ne0 from transport is already ne_bar * 1.3 (peaked).
            // Use smoothed ne0 directly as the core value, and scale pedestal
            // relative to ne0 (not ne0*1.3 again, which caused ne_ped > ne_bar).
            // Typical H-mode: ne_ped/ne_bar ~ 0.7-0.85, so ne_ped ~ 0.55 * ne0.
            let ne0_target = self.ne0_core_smooth;
            self.ne_params.core = ne0_target.max(0.05);
            let target_ne_ped = (0.55 * ne0_target).max(0.1);
            self.ne_params.ped += (target_ne_ped - self.ne_params.ped) * alpha;
            self.ne_ped = self.ne_params.ped;

            // ELM pedestal crash: applied instantaneously after smoothing
            if elm_ped_crash > 0.0 {
                self.te_params.ped *= (1.0 - elm_ped_crash).max(0.05);
                self.ne_params.ped *= (1.0 - elm_ped_crash * 0.8).max(0.05); // ne crashes ~80% as much
                self.te_ped = self.te_params.ped;
                self.ne_ped = self.ne_params.ped;
            }
        } else {
            // Not in H-mode — either standard L-mode or NT-edge regime.
            let is_nt = delta < -0.2;

            if is_nt && te0 > 0.5 {
                // NT-edge regime: ideal-ballooning-limited edge produces a small
                // but nonzero pedestal structure. Much smaller than H-mode
                // (no edge transport barrier), but finite temperature gradient
                // is maintained by the ballooning stability boundary.
                // Typically Te_ped_NT ~ 10-20% of Te0.
                let target_te_ped = (0.12 * te0).max(0.2);
                let target_ne_ped = (0.40 * ne0).max(0.05);
                let tau_ped = 0.15;
                let alpha = (dt / tau_ped).min(1.0);

                self.te_params.ped += (target_te_ped - self.te_params.ped) * alpha;
                self.ne_params.ped += (target_ne_ped - self.ne_params.ped) * alpha;
                self.te_params.core = self.te0_core_smooth.max(0.1);
                self.ne_params.core = self.ne0_core_smooth.max(0.05);
                self.te_ped = self.te_params.ped;
                self.ne_ped = self.ne_params.ped;

                // Blend toward H-mode-like profile shape (partial pedestal)
                let nt_blend_target = 0.5; // halfway between L-mode and full H-mode shape
                let alpha_blend = (dt / 0.3).min(1.0);
                self.blend += (nt_blend_target - self.blend) * alpha_blend;
                self.blend = self.blend.clamp(0.0, 1.0);
            } else {
                // Standard L-mode: smooth pedestal ramp-down
                if self.te_params.ped > self.te_params.edge * 1.5 {
                    let tau_down = 0.1;
                    let alpha = (dt / tau_down).min(1.0);
                    self.te_params.ped += (self.te_params.edge - self.te_params.ped) * alpha;
                    self.ne_params.ped += (self.ne_params.edge - self.ne_params.ped) * alpha;
                    self.te_ped = self.te_params.ped;
                    self.ne_ped = self.ne_params.ped;
                } else {
                    self.te_ped = 0.0;
                    self.ne_ped = 0.0;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tanh_profile_basic() {
        let p = diiid_te_params();
        let axis = tanh_profile(0.0, &p);
        let ped = tanh_profile(p.xphalf - 0.5 * p.widthp, &p);
        let edge = tanh_profile(1.0, &p);

        // Core should be near p.core
        assert!(
            (axis - p.core).abs() < 0.5,
            "Axis value {axis} should be near core {}",
            p.core
        );
        // Pedestal top should be near p.ped
        assert!(
            (ped - p.ped).abs() < 0.3,
            "Pedestal value {ped} should be near ped {}",
            p.ped
        );
        // Edge should be near p.edge
        assert!(
            (edge - p.edge).abs() < 0.1,
            "Edge value {edge} should be near edge {}",
            p.edge
        );
        // Monotonically decreasing
        assert!(axis > ped, "Core > pedestal");
        assert!(ped > edge, "Pedestal > edge");
    }

    #[test]
    fn test_lmode_profiles() {
        let p = Profiles::default();
        // L-mode by default
        assert!(!p.h_mode);
        assert!(p.te(0.0) > p.te(0.5));
        assert!(p.te(0.5) > p.te(1.0));
        assert!(p.te(1.0) < 0.1);
    }

    #[test]
    fn test_hmode_profiles() {
        let mut p = Profiles::default();
        p.h_mode = true;
        p.blend = 1.0;

        // Core should be near te_params.core
        let te_core = p.te(0.0);
        assert!(
            (te_core - p.te_params.core).abs() < 0.5,
            "H-mode core Te {te_core} should be near {}",
            p.te_params.core
        );

        // Edge should be very low
        assert!(p.te(1.0) < 0.15);

        // Profile should have a pedestal structure (steep gradient near edge)
        let te_085 = p.te(0.85);
        let te_099 = p.te(0.99);
        let gradient = (te_085 - te_099) / 0.14;
        assert!(gradient > 1.0, "Should have steep pedestal gradient, got {gradient}");
    }

    #[test]
    fn test_update_from_0d_smoothing() {
        let mut p = Profiles::default();

        // Transition to H-mode first (pedestal starts at edge)
        p.update_from_0d(5.0, 0.8, true, 0.005, 0.0, 0.5, 0.13);
        let te_ped_1 = p.te_ped;

        // Large change in core Te — pedestal should be smoothed
        p.update_from_0d(8.0, 0.8, true, 0.005, 0.0, 0.5, 0.13);
        let te_ped_2 = p.te_ped;

        // Pedestal should not jump instantly (smoothed by tau_ped = 0.1s)
        // With dt=5ms, alpha = 0.05, so change should be ~5% of target delta
        let target = (0.35 * 8.0_f64).max(0.3).min(8.0 * 0.6);
        assert!(
            (te_ped_2 - te_ped_1).abs() < (target - te_ped_1).abs() * 0.5,
            "Pedestal should be smoothed, not jump instantly"
        );
    }

    #[test]
    fn test_l_to_h_transition_continuous() {
        let mut p = Profiles::default();
        // Run several L-mode steps to fully ramp down the default pedestal
        for _ in 0..200 {
            p.update_from_0d(3.0, 0.6, false, 0.005, 0.0, 0.5, 0.13);
        }
        assert_eq!(p.te_ped, 0.0);

        // Transition to H-mode — pedestal should start near edge, NOT at default 0.83
        p.update_from_0d(3.0, 0.6, true, 0.005, 0.0, 0.5, 0.13);
        assert!(
            p.te_ped < 0.2,
            "On L→H transition, te_ped={} should start near edge (~0.07), not jump to H-mode default",
            p.te_ped
        );
        assert!(
            p.ne_ped < 0.15,
            "On L→H transition, ne_ped={} should start near edge (~0.09)",
            p.ne_ped
        );

        // After many H-mode steps, pedestal should build up toward target
        for _ in 0..200 {
            p.update_from_0d(3.0, 0.6, true, 0.005, 0.0, 0.5, 0.13);
        }
        assert!(
            p.te_ped > 0.5,
            "After 1s of H-mode, te_ped={} should have built up significantly",
            p.te_ped
        );
    }

    #[test]
    fn test_h_to_l_transition_smooth() {
        let mut p = Profiles::default();
        // Establish H-mode with built-up pedestal
        for _ in 0..200 {
            p.update_from_0d(4.0, 0.7, true, 0.005, 0.0, 0.5, 0.13);
        }
        let te_ped_before = p.te_ped;
        assert!(te_ped_before > 0.5, "Pedestal should be well-established");

        // Transition to L-mode — pedestal should NOT zero instantly
        p.update_from_0d(2.0, 0.5, false, 0.005, 0.0, 0.5, 0.13);
        assert!(
            p.te_ped > te_ped_before * 0.5,
            "On H→L transition, te_ped={} should not drop instantly from {}",
            p.te_ped,
            te_ped_before
        );

        // After many L-mode steps, pedestal should decay toward zero
        for _ in 0..100 {
            p.update_from_0d(2.0, 0.5, false, 0.005, 0.0, 0.5, 0.13);
        }
        assert!(
            p.te_ped == 0.0 || p.te_ped < 0.15,
            "After 500ms of L-mode, te_ped={} should be near zero",
            p.te_ped
        );
    }

    #[test]
    fn test_elm_pedestal_crash() {
        let mut p = Profiles::default();
        // Build up H-mode with established pedestal
        for _ in 0..400 {
            p.update_from_0d(4.0, 0.7, true, 0.005, 0.0, 0.5, 0.13);
        }
        let te_core_before = p.te_params.core;
        let te_ped_before = p.te_params.ped;
        let ne_ped_before = p.ne_params.ped;
        assert!(te_ped_before > 0.5, "Pedestal should be well-established: {te_ped_before}");

        // Apply ELM crash (15% pedestal crash fraction)
        p.update_from_0d(3.6, 0.7, true, 0.001, 0.15, 0.5, 0.13);
        let te_core_after = p.te_params.core;
        let te_ped_after = p.te_params.ped;
        let ne_ped_after = p.ne_params.ped;

        // Core should barely change (smoothed with 150ms tau)
        let core_change_frac = (te_core_after - te_core_before).abs() / te_core_before;
        assert!(
            core_change_frac < 0.05,
            "Core should barely change during ELM: before={te_core_before:.3}, after={te_core_after:.3}, change={core_change_frac:.3}"
        );

        // Pedestal should drop significantly
        let ped_drop_frac = (te_ped_before - te_ped_after) / te_ped_before;
        assert!(
            ped_drop_frac > 0.10,
            "Te pedestal should crash during ELM: before={te_ped_before:.3}, after={te_ped_after:.3}, drop={ped_drop_frac:.3}"
        );

        // ne pedestal should also drop (at 80% of Te crash)
        let ne_ped_drop_frac = (ne_ped_before - ne_ped_after) / ne_ped_before;
        assert!(
            ne_ped_drop_frac > 0.08,
            "ne pedestal should crash during ELM: before={ne_ped_before:.3}, after={ne_ped_after:.3}, drop={ne_ped_drop_frac:.3}"
        );
    }

    #[test]
    fn test_profile_arrays() {
        let mut p = Profiles::default();
        p.h_mode = true;
        p.blend = 1.0;

        let te_arr = p.te_profile_array();
        let ne_arr = p.ne_profile_array();

        assert_eq!(te_arr.len(), PROFILE_NPTS);
        assert_eq!(ne_arr.len(), PROFILE_NPTS);

        // First element should be core, last should be edge
        assert!(te_arr[0] > te_arr[PROFILE_NPTS - 1]);
        assert!(ne_arr[0] > ne_arr[PROFILE_NPTS - 1]);
    }

    #[test]
    fn test_averages_hmode() {
        let mut p = Profiles::default();
        p.h_mode = true;
        p.blend = 1.0;
        p.te_params.core = 5.0;
        p.te_params.ped = 1.5;
        p.ne_params.core = 0.8;
        p.ne_params.ped = 0.4;

        let te_avg = p.te_vol_avg();
        assert!(te_avg > 0.0 && te_avg < p.te_params.core);
        let ne_avg = p.ne_vol_avg();
        assert!(ne_avg > 0.0 && ne_avg < p.ne_params.core);
    }

    #[test]
    fn test_compute_li_lmode() {
        // L-mode: peaked Te profile → higher l_i
        let mut p = Profiles::default();
        p.h_mode = false;
        p.te_params.core = 3.0;
        p.te_params.edge = 0.05;
        let li = p.compute_li();
        assert!(
            li > 0.8 && li < 1.5,
            "L-mode l_i should be 0.8-1.5, got {}",
            li
        );
    }

    #[test]
    fn test_compute_li_hmode() {
        // H-mode: broad Te with pedestal → lower l_i
        let mut p = Profiles::default();
        p.h_mode = true;
        p.blend = 1.0;
        p.te_params.core = 5.0;
        p.te_params.ped = 1.5;
        p.te_params.edge = 0.05;
        let li = p.compute_li();
        // H-mode broader Te → should give lower l_i than L-mode
        assert!(
            li > 0.4 && li < 1.2,
            "H-mode l_i should be 0.4-1.2, got {}",
            li
        );
    }

    #[test]
    fn test_compute_li_hmode_lower_than_lmode() {
        // H-mode (broad Te) should have lower l_i than L-mode (peaked Te)
        let mut lmode = Profiles::default();
        lmode.h_mode = false;
        lmode.te_params.core = 3.0;
        lmode.te_params.edge = 0.05;

        let mut hmode = Profiles::default();
        hmode.h_mode = true;
        hmode.blend = 1.0;
        hmode.te_params.core = 5.0;
        hmode.te_params.ped = 1.5;
        hmode.te_params.edge = 0.05;

        let li_lmode = lmode.compute_li();
        let li_hmode = hmode.compute_li();
        assert!(
            li_lmode > li_hmode,
            "L-mode l_i ({}) should be > H-mode l_i ({})",
            li_lmode,
            li_hmode
        );
    }
}
