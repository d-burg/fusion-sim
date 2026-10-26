//! Ohmic current drive: the plasma as the secondary of the central-solenoid
//! transformer.
//!
//! The plasma current obeys the single-turn circuit equation
//!
//!   L_p dI_p/dt + R_p (I_p − I_ni) = V_loop,
//!
//! with the plasma self-inductance L_p = μ₀R₀(Λ_ext + l_i/2), where
//! Λ_ext = ln(8R₀/(a√κ)) − 2 is the external inductance of a shaped torus
//! and l_i/2 the internal part; R_p the one-turn resistance of the current
//! channel (profile-integrated Spitzer conductivity with the trapped-particle
//! correction); I_ni the non-inductive (bootstrap plus beam- and EC-driven)
//! current, which the loop voltage does not have to supply; and V_loop the
//! surface loop voltage the poloidal-field system applies.
//!
//! A plasma-current controller stands in for the machine's PCS: feed-forward
//! of the resistive and inductive demand plus a PI correction on the error
//! against the programd waveform, clamped to the supply's loop-voltage
//! limit. Everything the solenoid applies is charged to its flux swing,
//! ∫V_loop dt, and when the swing is used up the solenoid can no longer push:
//! V_loop is held at or below zero and the current decays on the
//! (L_p − L_v)/R time, L_v being the vertical-field coils' share, until the
//! programd ramp-down brings the voltage negative and the flux is
//! recovered. That is what ends an inductive flat-top on a real machine.
//!
//! The volt-second bookkeeping follows the usual decomposition (Ejima et al.
//! 1982): the swing feeds the inductive flux L_p I_p and the resistive flux
//! ∫R_p I_p dt, the latter dominated during ramp-up by the cold, small
//! early plasma and during flat-top by the sub-volt steady loop voltage.

use crate::devices::Device;

/// μ₀ (H/m)
pub const MU0: f64 = 4.0e-7 * std::f64::consts::PI;

/// Spitzer parallel resistivity coefficient: η = ETA_SPITZER·Z_eff/T_keV^1.5
/// (Ω·m), i.e. 1.65e-9·lnΛ with lnΛ ≈ 17. Shared with the transport model's
/// own estimate so the two agree where both are used.
pub const ETA_SPITZER: f64 = 2.8e-8;

/// Temperature floor (keV) for the resistance of the driven current channel.
/// The transport model reports a 10 eV plasma until the current reaches
/// 50 kA, but the current channel burns through to ~100 eV within
/// milliseconds of breakdown; below this floor the start-up resistance would
/// exceed what any supply could drive against and the pulse would never
/// leave breakdown.
pub const TE_FLOOR_DRIVE: f64 = 0.1;

/// Temperature floor (keV) when reporting the loop voltage of a quenched
/// plasma: tens of eV, where the resistive spike of a current quench lives.
pub const TE_FLOOR_QUENCH: f64 = 0.01;

/// External normalized inductance Λ_ext = ln(8R₀/(a√κ)) − 2 of a shaped
/// torus (the large-aspect-ratio result with the elongated cross-section's
/// effective radius a√κ).
pub fn lambda_ext(device: &Device) -> f64 {
    (8.0 * device.r0 / (device.a * device.kappa.sqrt())).ln() - 2.0
}

/// Plasma self-inductance L_p = μ₀R₀(Λ_ext + l_i/2) in henry, with
/// Λ_ext = ln(8R₀/(a√κ)) − 2 at the present elongation `kappa` (the round
/// start-up plasma carries ~20 % more external inductance than the shaped
/// flat-top one).
pub fn plasma_inductance(device: &Device, kappa: f64, li: f64) -> f64 {
    let k = kappa.max(1.0);
    MU0 * device.r0 * ((8.0 * device.r0 / (device.a * k.sqrt())).ln() - 2.0 + 0.5 * li)
}

/// Effective trapped fraction of a circular flux surface at inverse aspect
/// ratio ε: f_t ≈ 1 − (1−ε)²/(√(1−ε²)(1+1.46√ε)) (Hirshman, Sigmar &
/// Clarke 1976, as printed in Hirshman, Hawryluk & Birge, PPPL-1326 eq. 8).
pub fn trapped_fraction(eps: f64) -> f64 {
    let e = eps.clamp(0.0, 0.95);
    1.0 - (1.0 - e).powi(2) / ((1.0 - e * e).sqrt() * (1.0 + 1.46 * e.sqrt()))
}

/// Electron collisionality ν*_e = 6.921e-18 q R n_e Z lnΛ /(ε^1.5 T_e²)
/// (Sauter et al. 1999 eq. 18b; n_e in m⁻³, T_e in eV).
pub fn nu_star_e(q: f64, r0: f64, ne_m3: f64, z: f64, ln_lambda: f64, eps: f64, te_ev: f64) -> f64 {
    6.921e-18 * q * r0 * ne_m3 * z * ln_lambda / (eps.max(1e-3).powf(1.5) * te_ev * te_ev)
}

/// Neoclassical reduction of the parallel conductivity at arbitrary
/// collisionality (Sauter, Angioni & Lin-Liu 1999, eqs. 13a–13b, as
/// implemented in OMFIT's nclass_conductivity and pyrokinetics' Sauter1999;
/// Redl et al. 2021 refit the coefficients slightly, not used here):
///   σ_neo/σ_Spitzer = 1 − (1 + 0.36/Z) X + (0.59/Z) X² − (0.23/Z) X³,
///   X = f_t / (1 + (0.55 − 0.1 f_t) √ν* + 0.45 (1 − f_t) ν* / Z^1.5).
/// In the collisionless limit this is the familiar trapped-particle
/// reduction (~0.2 at ε = 0.33); in the collisional start-up plasma it
/// returns toward 1, which is why a cold ramp-up does not pay the full
/// banana-regime penalty.
pub fn neoclassical_factor(f_t: f64, nu_star: f64, z: f64) -> f64 {
    let z = z.max(1.0);
    let x = f_t / (1.0 + (0.55 - 0.1 * f_t) * nu_star.sqrt() + 0.45 * (1.0 - f_t) * nu_star / z.powf(1.5));
    (1.0 - (1.0 + 0.36 / z) * x + 0.59 / z * x * x - 0.23 / z * x * x * x).clamp(0.05, 1.0)
}

/// Spitzer parallel resistivity (Ω·m) with the Z dependence of Sauter
/// eq. 18a: η = Z N_Z lnΛ /(1.9012e4 T_e^1.5), N_Z = 0.58 + 0.74/(0.76 + Z),
/// T_e in eV. At Z = 1, lnΛ = 17 this is [`ETA_SPITZER`]/T_keV^1.5.
pub fn eta_spitzer(te_ev: f64, z: f64, ln_lambda: f64) -> f64 {
    let z = z.max(1.0);
    let n_z = 0.58 + 0.74 / (0.76 + z);
    z * n_z * ln_lambda / (1.9012e4 * te_ev.powf(1.5))
}

/// One-turn resistance R_p (Ω) of the current channel: 2πR₀ over the
/// poloidal-section conductance ∫σ dA, with σ(ρ) the neoclassical
/// conductivity on the temperature and density profiles `te(ρ)` (keV) and
/// `ne(ρ)` (10²⁰ m⁻³), a parabolic q(ρ) = 1 + (q95 − 1)ρ², and the
/// Coulomb logarithm lnΛ_e = 31.3 − ln(√n_e/T_e) (Sauter eq. 18d).
/// `te_floor` guards the cold limits (see [`TE_FLOOR_DRIVE`] and
/// [`TE_FLOOR_QUENCH`]).
pub fn plasma_resistance(
    device: &Device,
    te: impl Fn(f64) -> f64,
    ne: impl Fn(f64) -> f64,
    q95: f64,
    z_eff: f64,
    te_floor: f64,
) -> f64 {
    let n = 50;
    let drho = 1.0 / n as f64;
    let z = z_eff.max(1.0);
    let area = std::f64::consts::PI * device.a * device.a * device.kappa_areal;
    let mut conductance = 0.0;
    for k in 0..n {
        let rho = (k as f64 + 0.5) * drho;
        let te_ev = te(rho).max(te_floor) * 1e3;
        let ne_m3 = (ne(rho).max(0.01)) * 1e20;
        let ln_lambda = (31.3 - (ne_m3.sqrt() / te_ev).ln()).clamp(5.0, 25.0);
        let eps = rho * device.a / device.r0;
        let q = 1.0 + (q95.max(1.0) - 1.0) * rho * rho;
        let nu = nu_star_e(q, device.r0, ne_m3, z, ln_lambda, eps, te_ev);
        let f_nc = neoclassical_factor(trapped_fraction(eps), nu, z);
        // dA = 2ρ dρ · (πa²κ_a)
        conductance += f_nc / eta_spitzer(te_ev, z, ln_lambda) * 2.0 * rho * drho * area;
    }
    2.0 * std::f64::consts::PI * device.r0 / conductance.max(1e-12)
}

/// Poloidal flux the equilibrium vertical field threads through the plasma
/// ring (Wb), which the vertical-field coils supply and the solenoid does
/// not have to: ψ_v ≈ B_v πR₀² with the Shafranov vertical field
/// B_v = μ₀I_p/(4πR₀)[ln(8R₀/a) + β_p + l_i/2 − 3/2] (Wesson, as restated in
/// the PROCESS physics paper). It is the standard reason the solenoid's
/// swing can be much smaller than L_p I_p: on ITER at 15 MA (β_p 0.7,
/// l_i 0.85) B_v ≈ 0.74 T and ψ_v ≈ 84 Vs against ~110 Vs of external
/// inductive flux.
pub fn vertical_field_flux(device: &Device, ip_ma: f64, beta_p: f64, li: f64) -> f64 {
    if ip_ma <= 0.0 {
        return 0.0;
    }
    let bracket = (8.0 * device.r0 / device.a).ln() + beta_p + 0.5 * li - 1.5;
    let b_v = MU0 * ip_ma * 1e6 / (4.0 * std::f64::consts::PI * device.r0) * bracket.max(0.0);
    b_v * std::f64::consts::PI * device.r0 * device.r0
}

/// Closed-loop time constant of the current controller (s): the PI loop
/// pulls a tracking error in over this time when the supply is not
/// saturated.
const TAU_CONTROL: f64 = 0.05;
/// Integral reset time of the current controller (s).
const TAU_INTEGRAL: f64 = 0.5;

/// State of the Ohmic drive circuit.
#[derive(Debug, Clone)]
pub struct OhmicCircuit {
    /// Plasma current (MA)
    pub ip: f64,
    /// Surface loop voltage applied by the poloidal-field system (V)
    pub v_loop: f64,
    /// Loop-voltage integral ∫V_loop dt (Wb): the total poloidal flux the
    /// coil set has put through the plasma. Recovers in ramp-down.
    pub flux_loop: f64,
    /// Solenoid flux swing used so far (Wb): the loop integral less the part
    /// the vertical-field coils carry (see [`vertical_field_flux`]).
    pub flux_consumed: f64,
    /// Flux swing available (Wb)
    pub flux_budget: f64,
    /// Loop-voltage limit of the supply (V)
    pub v_max: f64,
    /// One-turn plasma resistance used in the last step (Ω)
    pub r_plasma: f64,
    /// Plasma self-inductance used in the last step (H)
    pub l_plasma: f64,
    /// Non-inductive current used in the last step (MA)
    pub i_ni: f64,
    /// The supply hit its voltage limit (or the exhausted-flux clamp) in the
    /// last step, so the current is no longer tracking its program.
    pub saturated: bool,
    /// The flux swing is used up: the solenoid cannot drive positive volts.
    pub exhausted: bool,
    /// PI integrator state (V)
    integral: f64,
}

impl OhmicCircuit {
    pub fn new(flux_budget: f64, v_max: f64) -> Self {
        OhmicCircuit {
            ip: 0.0,
            v_loop: 0.0,
            flux_loop: 0.0,
            flux_consumed: 0.0,
            flux_budget,
            v_max,
            r_plasma: 0.0,
            l_plasma: 0.0,
            i_ni: 0.0,
            saturated: false,
            exhausted: false,
            integral: 0.0,
        }
    }

    pub fn reset(&mut self) {
        let budget = self.flux_budget;
        let v_max = self.v_max;
        *self = OhmicCircuit::new(budget, v_max);
    }

    /// Advance the circuit by `dt` with the controller tracking `ip_prog`
    /// (MA, with programd slope `dip_prog_dt` MA/s), given the plasma
    /// inductance `l` (H), resistance `r` (Ω), non-inductive current
    /// `i_ni` (MA) and the vertical-field flux `psi_v` (Wb) the equilibrium
    /// coils supply at the present current.
    pub fn step(&mut self, dt: f64, ip_prog: f64, dip_prog_dt: f64, l: f64, r: f64, i_ni: f64, psi_v: f64) {
        // The inductance of the previous step: with l_i evolving, the circuit
        // conserves d(L I)/dt, so a change in L moves flux at fixed current.
        let l_old = if self.l_plasma > 0.0 { self.l_plasma } else { l };
        self.l_plasma = l;
        self.r_plasma = r;
        self.i_ni = i_ni;
        let i_old = self.ip * 1e6; // A

        // Controller: feed-forward of what the circuit needs to follow the
        // program (resistive drop, programd dI/dt, and the I dL/dt of a
        // changing current profile), plus PI action on the tracking error.
        // Gains scale with L_p so the closed-loop time constant is the same
        // on every machine.
        let err = (ip_prog - self.ip) * 1e6; // A
        let kp = l / TAU_CONTROL; // V/A
        let ki = kp / TAU_INTEGRAL; // V/(A·s)
        let v_ff = r * (self.ip - i_ni) * 1e6 + l * dip_prog_dt * 1e6 + (l - l_old) * i_old / dt;
        let v_cmd = v_ff + kp * err + self.integral;

        // Supply limit: the loop-voltage rating.
        let mut v = v_cmd.clamp(-self.v_max, self.v_max);

        // Circuit equation, backward Euler so a cold (fast L/R) plasma is
        // stable at the simulation step:
        //   (L_new + R dt) I_new = L_old I_old + dt (V + R I_ni)
        let solve = |v: f64| (l_old * i_old + dt * (v + r * i_ni * 1e6)) / (l + r * dt);
        let mut i_new = solve(v);

        // Flux limit: once the swing is used up the solenoid holds its flux,
        // and the only loop voltage left is what the vertical-field coils
        // induce as they follow the current, V = L_v dI/dt with L_v = ψ_v/I_p:
        //   (L_new − L_v + R dt) I_new = (L_old − L_v) I_old + dt R I_ni.
        // The current then decays on the (L_p − L_v)/R time, faster than the
        // plain L/R time, which is the known penalty of an exhausted
        // solenoid. The exhausted state latches until the program asks for
        // a steeper fall than the held solenoid gives (a ramp-down), which
        // recovers flux; while held, the solenoid flux is pinned at the
        // budget by construction, so the vertical-field share's drift with
        // β_p and l_i can neither free up room nor fire the supply again.
        let l_v = if i_old > 1e3 { (psi_v / i_old).clamp(0.0, 0.8 * l) } else { 0.0 };
        let i_held = ((l_old - l_v) * i_old + dt * r * i_ni * 1e6) / (l - l_v + r * dt);
        let v_held = l_v * (i_held - i_old) / dt;
        // `room` is the flux the solenoid can still push this step.
        let room = self.flux_budget + psi_v - self.flux_loop;
        let at_limit = room <= 0.0 || self.exhausted;
        self.exhausted = at_limit && v_cmd >= v_held;
        if self.exhausted {
            v = v_held;
            i_new = i_held;
            // Pin: the solenoid flux stays at the budget, the loop integral
            // carries only the vertical-field share ψ_v ≈ L_v I.
            self.flux_loop = self.flux_budget + l_v * i_new;
        } else {
            if !at_limit && v * dt > room {
                // Land exactly on the budget rather than overshooting it by a step.
                v = room / dt;
                i_new = solve(v);
            }
            self.flux_loop = (self.flux_loop + v * dt).max(0.0);
        }
        self.saturated = (v - v_cmd).abs() > 1e-9;
        // Anti-windup: integrate only while the output is free, or while the
        // error is pulling the command back inside the limits.
        if !self.saturated || err * (v_cmd - v) < 0.0 {
            self.integral = (self.integral + ki * err * dt).clamp(-self.v_max, self.v_max);
        }

        self.ip = (i_new * 1e-6).max(0.0);
        self.v_loop = v;
        self.flux_consumed = (self.flux_loop - psi_v).max(0.0);
    }

    /// A disruption owns the current: take the quench model's value and
    /// report the resistive loop voltage of the cold plasma. Nothing is
    /// charged to the solenoid, which is not what drives a quench.
    pub fn override_current(&mut self, ip: f64, r_cold: f64) {
        self.ip = ip.max(0.0);
        self.r_plasma = r_cold;
        self.v_loop = r_cold * self.ip * 1e6;
        self.saturated = false;
        self.integral = 0.0;
    }

    /// Fraction of the flux swing used (0 = none, 1 = exhausted).
    pub fn flux_fraction(&self) -> f64 {
        if self.flux_budget > 0.0 {
            self.flux_consumed / self.flux_budget
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::devices;

    #[test]
    fn inductance_matches_hand_values() {
        // DIII-D: Λ_ext = ln(8·1.67/(0.56·√1.7)) − 2 ≈ 0.91, L_p ≈ μ₀·1.67·(0.91 + 0.5·1.0)
        let d = devices::diiid();
        let l = plasma_inductance(&d, d.kappa, 1.0);
        assert!((lambda_ext(&d) - 0.91).abs() < 0.02, "Λ_ext {}", lambda_ext(&d));
        assert!((l - 2.96e-6).abs() < 0.1e-6, "L_p {l}");
        // Round start-up plasma: ~20 % more external inductance.
        let round = plasma_inductance(&d, 1.0, 1.0);
        assert!(round > 1.1 * l && round < 1.3 * l, "round L_p {round} vs shaped {l}");
        // ITER: ~10 µH at l_i = 0.85
        let i = devices::iter();
        let li = plasma_inductance(&i, i.kappa, 0.85);
        assert!(li > 9.5e-6 && li < 11.5e-6, "ITER L_p {li}");
    }

    #[test]
    fn spitzer_matches_the_transport_coefficient_at_z1() {
        // η(1 keV, Z = 1, lnΛ = 17) = 2.8e-8 Ω·m, the coefficient the
        // transport model's own estimate uses.
        let eta = eta_spitzer(1000.0, 1.0, 17.0);
        assert!((eta / ETA_SPITZER - 1.0).abs() < 0.02, "η {eta}");
        // Z dependence is weaker than linear: Z_eff 2 → ×1.70 (2·N_2/N_1
        // with N_Z = 0.58 + 0.74/(0.76 + Z)), not ×2.
        let ratio = eta_spitzer(1000.0, 2.0, 17.0) / eta;
        assert!((ratio - 1.70).abs() < 0.02, "Z = 2 ratio {ratio}");
    }

    #[test]
    fn neoclassical_factor_bridges_banana_and_collisional_regimes() {
        let f_t = trapped_fraction(0.33);
        assert!(f_t > 0.6 && f_t < 0.8, "f_t(0.33) = {f_t}");
        assert!((trapped_fraction(0.0)).abs() < 1e-12);
        // Collisionless: the familiar ~0.2 at the DIII-D edge, ~0.4 mid-radius.
        let edge = neoclassical_factor(f_t, 0.0, 1.0);
        assert!(edge > 0.15 && edge < 0.3, "banana edge {edge}");
        let mid = neoclassical_factor(trapped_fraction(0.17), 0.0, 1.0);
        assert!(mid > 0.3 && mid < 0.5, "banana mid {mid}");
        // Collisional (ν* = 10): most of the reduction is gone.
        let cold = neoclassical_factor(f_t, 10.0, 1.0);
        assert!(cold > 0.6 && cold < 0.9, "collisional {cold}");
        // Monotonic in ν*.
        assert!(neoclassical_factor(f_t, 1.0, 1.0) > edge && neoclassical_factor(f_t, 1.0, 1.0) < cold);
    }

    #[test]
    fn resistance_falls_with_temperature_and_rises_with_zeff() {
        let d = devices::diiid();
        let ne = |_: f64| 0.5;
        let cold = plasma_resistance(&d, |_| 0.5, ne, 4.0, 1.5, TE_FLOOR_DRIVE);
        let hot = plasma_resistance(&d, |_| 2.0, ne, 4.0, 1.5, TE_FLOOR_DRIVE);
        let dirty = plasma_resistance(&d, |_| 2.0, ne, 4.0, 3.0, TE_FLOOR_DRIVE);
        // T^-1.5 Spitzer scaling, softened at 0.5 keV by the collisionality
        // easing the trapped-particle penalty: between 5× and 8×.
        assert!(cold / hot > 5.0 && cold / hot < 8.0, "T scaling: {}", cold / hot);
        assert!(dirty / hot > 1.5 && dirty / hot < 2.0, "Z scaling: {}", dirty / hot);
        // Flat 2 keV, 0.5e20, Z_eff 1.5 on DIII-D: Spitzer alone gives
        // R ≈ 8.7e-8 Ω (η = 1.4e-8 Ω·m, 2πR₀/(πa²κ)); the trapped-particle
        // correction at ν* ~ 0.1–0.5 roughly doubles it.
        assert!(hot > 1.4e-7 && hot < 2.6e-7, "R_p {hot}");
        // The cold quench plasma (10 eV) is collisional: no neoclassical
        // penalty, resistance ≈ Spitzer.
        let quench = plasma_resistance(&d, |_| 0.01, ne, 4.0, 1.5, TE_FLOOR_QUENCH);
        let spitzer_quench = eta_spitzer(10.0, 1.5, 10.0) * 2.0 * std::f64::consts::PI * d.r0
            / (std::f64::consts::PI * d.a * d.a * d.kappa_areal);
        assert!((quench / spitzer_quench - 1.0).abs() < 0.3, "quench {quench} vs Spitzer {spitzer_quench}");
    }

    #[test]
    fn vertical_field_carries_most_of_the_external_flux() {
        // ITER at 15 MA, β_p 0.7, l_i 0.85: bracket = ln(28.2) + 0.7 + 0.425
        // − 1.5 = 2.97, B_v = 1e-7·15e6/6·2.97 = 0.74 T, ψ_v = B_v·π·36 = 84 Vs,
        // against L_ext·I_p ≈ 110 Vs.
        let d = devices::iter();
        let psi_v = vertical_field_flux(&d, 15.0, 0.7, 0.85);
        let l_ext_ip = MU0 * d.r0 * lambda_ext(&d) * 15e6;
        assert!((psi_v - 84.0).abs() < 2.0, "ψ_v {psi_v}");
        assert!(psi_v < l_ext_ip, "ψ_v {psi_v} must stay below L_ext I_p {l_ext_ip}");
        assert_eq!(vertical_field_flux(&d, 0.0, 0.7, 0.85), 0.0);
    }

    #[test]
    fn controller_tracks_a_ramp_and_charges_the_flux() {
        let d = devices::diiid();
        let l = plasma_inductance(&d, d.kappa, 1.0);
        let r = 2.0e-7;
        let mut c = OhmicCircuit::new(100.0, 20.0);
        let dt = 0.005;
        let mut t = 0.0;
        while t < 2.0 {
            let ip_prog = f64::min(t, 1.0); // 1 MA/s to 1 MA
            let slope = if t < 1.0 { 1.0 } else { 0.0 };
            c.step(dt, ip_prog, slope, l, r, 0.0, 0.0);
            t += dt;
        }
        assert!((c.ip - 1.0).abs() < 0.01, "flat-top Ip {}", c.ip);
        assert!(!c.saturated);
        // Flat-top voltage is the resistive drop; the ramp needed L·dI/dt ≈ 3 V.
        assert!((c.v_loop - r * 1e6).abs() < 0.02, "V_loop {}", c.v_loop);
        // Flux: inductive L·I plus the resistive integral.
        let expected = l * 1e6 + r * 1e6 * (0.5 + 1.0);
        assert!((c.flux_consumed - expected).abs() < 0.05 * expected, "Ψ {} vs {}", c.flux_consumed, expected);
    }

    #[test]
    fn saturation_slows_the_ramp_and_exhaustion_stops_the_drive() {
        let d = devices::diiid();
        let l = plasma_inductance(&d, d.kappa, 1.0);
        let r = 2.0e-7;
        // 2 V cannot ramp at 10 MA/s through 3 µH.
        let mut c = OhmicCircuit::new(100.0, 2.0);
        for _ in 0..40 {
            c.step(0.005, 2.0, 10.0, l, r, 0.0, 0.0);
        }
        assert!(c.saturated);
        assert!(c.ip < 0.2 * 2.0, "Ip {} should lag far behind 2 MA", c.ip);
        assert!((c.v_loop - 2.0).abs() < 1e-9);

        // A budget the inductive flux alone exceeds: once used up, V ≤ 0 and
        // the current decays on L/R.
        let mut c = OhmicCircuit::new(1.0, 20.0);
        let mut t = 0.0;
        while t < 1.0 {
            c.step(0.005, 1.0, 0.0, l, r, 0.0, 0.0);
            t += 0.005;
        }
        assert!(c.exhausted);
        assert!(c.v_loop <= 0.0);
        assert!(c.ip < 1.0 / l * 1e-6 * 1.001, "Ip bounded by Ψ/L: {}", c.ip);
        assert!((c.flux_consumed - 1.0).abs() < 1e-6);

        // With a vertical-field share the held solenoid leaves V = L_v dI/dt
        // < 0, the consumed flux stays pinned at the budget, and the decay
        // is faster than L/R.
        let l_v = 0.5 * l;
        let mut held = OhmicCircuit::new(2.0, 20.0);
        let mut free = OhmicCircuit::new(2.0, 20.0);
        held.ip = 1.0;
        free.ip = 1.0;
        held.flux_loop = 2.0 + l_v * 1e6; // consumed = loop − ψ_v = budget
        free.flux_loop = 2.0;
        let r_fast = 1.0e-6; // L/R ≈ 3 s
        for _ in 0..200 {
            held.step(0.005, 1.0, 0.0, l, r_fast, 0.0, l_v * held.ip * 1e6);
            free.step(0.005, 1.0, 0.0, l, r_fast, 0.0, 0.0);
        }
        assert!(held.exhausted && free.exhausted);
        assert!(held.v_loop < 0.0, "held V {}", held.v_loop);
        // Pinned by construction up to one step's L_v·ΔI (≈ 0.005 Wb here:
        // the current falls 3.3 kA per step through L_v = 1.5 µH).
        assert!((held.flux_consumed - 2.0).abs() < 0.01, "pinned Ψ {}", held.flux_consumed);
        assert!(held.ip < free.ip, "held {} should decay faster than free {}", held.ip, free.ip);
        let tau_eff = (l - l_v) / r_fast;
        let expect = (-1.0_f64 / tau_eff).exp();
        assert!((held.ip - expect).abs() < 0.02, "held {} vs exp(-t/τ_eff) {}", held.ip, expect);
    }

    #[test]
    fn exhausted_solenoid_stays_held_through_vertical_field_drift() {
        // The vertical-field share drifts with β_p and l_i while the plasma
        // sits exhausted. That must never read as fresh room: no positive
        // volts until the program itself asks for a ramp-down.
        let d = devices::diiid();
        let l = plasma_inductance(&d, d.kappa, 1.0);
        let r = 5.0e-7;
        let mut c = OhmicCircuit::new(5.0, 10.0);
        c.ip = 1.2;
        c.flux_loop = 5.0 + 1.5; // consumed = loop − ψ_v(1.5) = budget
        let mut positive = 0;
        for k in 0..2000 {
            // ψ_v wanders ±10 % about L_v·I with a slow wobble.
            let l_v = 1.25e-6 * (1.0 + 0.1 * (k as f64 / 150.0).sin());
            c.step(0.005, 1.2, 0.0, l, r, 0.0, l_v * c.ip * 1e6);
            assert!(c.exhausted, "step {k}: un-latched with Ip {}", c.ip);
            if c.v_loop > 1e-9 {
                positive += 1;
            }
        }
        assert_eq!(positive, 0, "positive loop voltage while exhausted");
        assert!(c.ip < 0.5, "the held current should have decayed: {}", c.ip);
        // A ramp-down command releases the latch and recovers flux.
        for _ in 0..200 {
            c.step(0.005, 0.0, -2.0, l, r, 0.0, 1.25e-6 * c.ip * 1e6);
        }
        assert!(!c.exhausted);
        assert!(c.flux_consumed < 5.0);
    }

    #[test]
    fn falling_internal_inductance_releases_flux() {
        // d(L I)/dt: with the current held on its program, a drop in l_i
        // (L_p falls) must show up as a negative loop voltage, i.e. flux
        // handed back, equal to I·ΔL.
        let d = devices::diiid();
        let r = 0.0;
        // A generous supply so the whole I·ΔL can be handed back in one step.
        let mut c = OhmicCircuit::new(100.0, 100.0);
        c.ip = 1.2;
        c.flux_loop = 10.0;
        c.l_plasma = plasma_inductance(&d, d.kappa, 1.2);
        let l_lo = plasma_inductance(&d, d.kappa, 0.9);
        let before = c.flux_loop;
        // One step at the lower inductance, then settle at it.
        for _ in 0..400 {
            c.step(0.005, 1.2, 0.0, l_lo, r, 0.0, 0.0);
        }
        let released = before - c.flux_loop;
        let expect = 1.2e6 * (plasma_inductance(&d, d.kappa, 1.2) - l_lo);
        assert!((c.ip - 1.2).abs() < 1e-3, "Ip {}", c.ip);
        assert!((released - expect).abs() < 0.05 * expect, "released {released} Wb vs I·ΔL {expect}");
    }

    #[test]
    fn non_inductive_current_reduces_the_loop_voltage() {
        let d = devices::iter();
        let l = plasma_inductance(&d, d.kappa, 0.85);
        let r = 3.0e-9;
        let mut full = OhmicCircuit::new(1000.0, 20.0);
        let mut half = OhmicCircuit::new(1000.0, 20.0);
        full.ip = 15.0;
        half.ip = 15.0;
        for _ in 0..400 {
            full.step(0.005, 15.0, 0.0, l, r, 0.0, 0.0);
            half.step(0.005, 15.0, 0.0, l, r, 7.5, 0.0);
        }
        assert!((full.v_loop - r * 15e6).abs() < 0.002, "{}", full.v_loop);
        assert!((half.v_loop - 0.5 * full.v_loop).abs() < 0.002, "{} vs {}", half.v_loop, full.v_loop);
    }
}
