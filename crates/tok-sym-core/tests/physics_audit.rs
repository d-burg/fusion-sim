//! Physics Audit Test Suite
//!
//! Runs each device through the actual physics engine (transport + profiles +
//! ELMs) with fixed flat-top parameters, then time-averages over a window to
//! get representative steady-state values including ELM-averaged quantities.
//!
//! Run with:
//!   cargo test -p tok-sym-core --test physics_audit -- --ignored --nocapture
//!
//! Or run the master test that produces the complete report:
//!   cargo test -p tok-sym-core --test physics_audit test_audit_all -- --ignored --nocapture

use tok_sym_core::devices::{self, Device};
use tok_sym_core::profiles::Profiles;
use tok_sym_core::transport::{ProgramValues, TransportModel};

// ═══════════════════════════════════════════════════════════════════════════
//  Bosch-Hale DT/DD reactivity (Rust port from fusionPhysics.ts)
// ═══════════════════════════════════════════════════════════════════════════

fn sigmav_bh(t_kev: f64, bg2: f64, mc2: f64, c: [f64; 7]) -> f64 {
    if t_kev < 0.2 {
        return 0.0;
    }
    let t = t_kev.min(100.0);
    let denom = 1.0 + t * (c[2] + t * (c[4] + t * c[6]));
    let numer = t * (c[1] + t * (c[3] + t * c[5]));
    let theta = t / (1.0 - numer / denom);
    let xi = (bg2 / (4.0 * theta)).cbrt();
    let sv = c[0] * theta * (xi / (mc2 * t * t * t)).sqrt() * (-3.0 * xi).exp();
    sv * 1e-6 // cm^3/s -> m^3/s
}

fn sigmav_dt(t_kev: f64) -> f64 {
    sigmav_bh(
        t_kev,
        34.3827_f64.powi(2),
        1124656.0,
        [1.17302e-9, 1.51361e-2, 7.51886e-2, 4.60643e-3, 1.35e-2, -1.0675e-4, 1.366e-5],
    )
}

fn sigmav_dd(t_kev: f64) -> f64 {
    // D(d,n)He3 branch
    let sn = sigmav_bh(
        t_kev,
        31.3970_f64.powi(2),
        937814.0,
        [5.43360e-12, 5.85778e-3, 7.68222e-3, 0.0, -2.964e-6, 0.0, 0.0],
    );
    // D(d,p)T branch
    let sp = sigmav_bh(
        t_kev,
        31.3970_f64.powi(2),
        937814.0,
        [5.65718e-12, 3.41267e-3, 1.99167e-3, 0.0, 1.05060e-5, 0.0, 0.0],
    );
    sn + sp
}

// ═══════════════════════════════════════════════════════════════════════════
//  Time-Averaged Audit Record
// ═══════════════════════════════════════════════════════════════════════════

/// Accumulator for time-averaging plasma quantities over a window.
#[derive(Debug, Clone, Default)]
struct Accumulator {
    n: usize,
    w_th: f64,
    tau_e: f64,
    te0: f64,
    ne0: f64,
    ne_bar: f64,
    p_ohmic: f64,
    p_input: f64,
    p_loss: f64,
    p_rad: f64,
    p_alpha_0d: f64,
    q95: f64,
    beta_t: f64,
    beta_n: f64,
    f_greenwald: f64,
    li: f64,
    h_factor: f64,
    impurity_fraction: f64,
    // Profile quantities
    te_ped: f64,
    ne_ped: f64,
    te_core_prof: f64,
    ne_core_prof: f64,
    te_vol_avg: f64,
    ne_vol_avg: f64,
    pressure_vol_avg: f64,
    // Profile-integrated
    w_th_from_profiles: f64,
    p_fus_from_profiles: f64,
    p_alpha_from_profiles: f64,
    // Mode tracking
    hmode_count: usize,
    elm_suppressed_count: usize,
}

impl Accumulator {
    fn add_sample(
        &mut self,
        transport: &TransportModel,
        profiles: &Profiles,
        device: &Device,
    ) {
        self.n += 1;
        self.w_th += transport.w_th;
        self.tau_e += transport.tau_e;
        self.te0 += transport.te0;
        self.ne0 += transport.ne0;
        self.ne_bar += transport.ne_bar;
        self.p_ohmic += transport.p_ohmic;
        self.p_input += transport.p_input;
        self.p_loss += transport.p_loss;
        self.p_rad += transport.p_rad;
        self.p_alpha_0d += transport.p_alpha;
        self.q95 += transport.q95;
        self.beta_t += transport.beta_t;
        self.beta_n += transport.beta_n;
        self.f_greenwald += transport.f_greenwald;
        self.li += transport.li;
        self.h_factor += transport.h_factor;
        self.impurity_fraction += transport.impurity_fraction;

        self.te_ped += profiles.te_ped;
        self.ne_ped += profiles.ne_ped;
        self.te_core_prof += profiles.te(0.0);
        self.ne_core_prof += profiles.ne(0.0);
        self.te_vol_avg += profiles.te_vol_avg();
        self.ne_vol_avg += profiles.ne_vol_avg();
        self.pressure_vol_avg += profiles.pressure_vol_avg();

        if transport.in_hmode {
            self.hmode_count += 1;
        }
        if transport.elm_suppressed {
            self.elm_suppressed_count += 1;
        }

        // Profile-integrated quantities
        let n_pts = 51;
        let drho = 1.0 / (n_pts - 1) as f64;
        let volume = device.volume;
        let is_dt = device.mass_number > 2.0;
        let f_fuel = (1.0 - transport.impurity_fraction).max(0.5);

        let mut weights = vec![0.0_f64; n_pts];
        let mut w_sum = 0.0;
        for i in 0..n_pts {
            let rho = i as f64 * drho;
            weights[i] = 2.0 * rho * drho;
            w_sum += weights[i];
        }
        if w_sum > 0.0 {
            for w in weights.iter_mut() {
                *w /= w_sum;
            }
        }

        let mut w_prof = 0.0;
        let mut p_fus = 0.0;
        for i in 0..n_pts {
            let ne = profiles.ne(i as f64 * drho);
            let te = profiles.te(i as f64 * drho);
            let dv = volume * weights[i];
            w_prof += 3.0 * ne * te * dv * 1.602e-2;
            if ne > 0.0 && te >= 0.2 && dv > 0.0 {
                let ne_m3 = ne * 1e20;
                if is_dt {
                    let nd = ne_m3 * f_fuel / 2.0;
                    p_fus += nd * nd * sigmav_dt(te) * 17.59 * 1.602e-13 * dv;
                } else {
                    let nd = ne_m3 * f_fuel;
                    p_fus += (nd * nd / 2.0) * sigmav_dd(te) * 3.27 * 1.602e-13 * dv;
                }
            }
        }
        self.w_th_from_profiles += w_prof;
        let p_fus_mw = p_fus * 1e-6;
        self.p_fus_from_profiles += p_fus_mw;
        self.p_alpha_from_profiles += if is_dt {
            p_fus_mw * (3.52 / 17.59)
        } else {
            p_fus_mw * 0.66
        };
    }
}

/// Complete audit of one time-averaged operating point.
#[derive(Debug, Clone)]
struct AuditRecord {
    label: String,
    device_name: String,
    r0: f64,
    a: f64,
    bt: f64,
    ip: f64,
    kappa: f64,
    delta: f64,
    volume: f64,
    mass_number: f64,
    p_nbi: f64,
    p_ech: f64,
    p_ich: f64,
    ne_target: f64,
    d2_puff: f64,
    neon_puff: f64,
    fuel: &'static str,

    // Time-averaged 0D transport
    w_th: f64,
    tau_e: f64,
    h_factor: f64,
    te0: f64,
    ne0: f64,
    ne_bar: f64,
    p_ohmic: f64,
    p_input: f64,
    p_loss: f64,
    p_rad: f64,
    p_alpha_0d: f64,
    q95: f64,
    beta_t: f64,
    beta_n: f64,
    f_greenwald: f64,
    li: f64,
    impurity_fraction: f64,

    // Time-averaged profiles
    te_ped: f64,
    ne_ped: f64,
    te_core_prof: f64,
    ne_core_prof: f64,
    te_vol_avg: f64,
    ne_vol_avg: f64,
    pressure_vol_avg: f64,

    // Time-averaged profile-integrated
    w_th_from_profiles: f64,
    p_fus_from_profiles: f64,
    p_alpha_from_profiles: f64,
    q_plasma: f64,

    // Derived ratios
    h98y2_backcalc: f64,
    te_ped_over_te0: f64,
    ne_ped_over_ne_bar: f64,
    te_peaking: f64,
    ne_peaking: f64,
    radiative_fraction: f64,

    // Mode info
    hmode_fraction: f64,
    elm_suppressed_fraction: f64,

    // Sim info
    ramp_up_time: f64,
    avg_window: f64,
    total_sim_time: f64,
    total_steps: usize,
}

// ═══════════════════════════════════════════════════════════════════════════
//  Run actual physics engine and time-average
// ═══════════════════════════════════════════════════════════════════════════

fn run_and_average(
    device: &Device,
    prog: &ProgramValues,
    label: &str,
    ramp_up_s: f64,
    avg_window_s: f64,
) -> AuditRecord {
    let dt = 0.005; // 5 ms timesteps
    let ramp_steps = (ramp_up_s / dt) as usize;
    let avg_steps = (avg_window_s / dt) as usize;
    let sample_interval = 20; // sample every 100 ms (every 20 steps)

    let mut transport = TransportModel::default();
    let mut profiles = Profiles::for_device(&device.id);

    // Phase 1: ramp up to steady state (discard transients)
    for _ in 0..ramp_steps {
        transport.step(dt, device, prog, device.z_eff);
        profiles.update_from_0d(
            transport.te0,
            transport.ne0,
            transport.in_hmode,
            dt,
            transport.elm_ped_crash_frac,
            prog.delta,
            transport.tau_e,
        );
        transport.li = profiles.compute_li();
    }

    // Phase 2: collect time-averaged data over the averaging window
    let mut acc = Accumulator::default();
    for i in 0..avg_steps {
        transport.step(dt, device, prog, device.z_eff);
        profiles.update_from_0d(
            transport.te0,
            transport.ne0,
            transport.in_hmode,
            dt,
            transport.elm_ped_crash_frac,
            prog.delta,
            transport.tau_e,
        );
        transport.li = profiles.compute_li();

        if i % sample_interval == 0 {
            acc.add_sample(&transport, &profiles, device);
        }
    }

    let n = acc.n.max(1) as f64;
    let total_steps = ramp_steps + avg_steps;

    // Back-calculate H98y2 from averaged quantities
    let te0_avg = acc.te0 / n;
    let ne_bar_avg = acc.ne_bar / n;
    let p_input_avg = acc.p_input / n;
    let tau_e_avg = acc.tau_e / n;

    let ne19 = ne_bar_avg * 10.0;
    let eps = device.a / device.r0;
    let tau_e_ipb98_h1 = 0.0562
        * prog.ip.powf(0.93)
        * prog.bt.powf(0.15)
        * ne19.powf(0.41)
        * p_input_avg.max(0.01).powf(-0.69)
        * device.r0.powf(1.97)
        * eps.powf(0.58)
        * prog.kappa.powf(0.78)
        * device.mass_number.powf(0.19);

    let h98y2_bc = if tau_e_ipb98_h1 > 0.001 {
        tau_e_avg / tau_e_ipb98_h1
    } else {
        0.0
    };

    let te_ped_avg = acc.te_ped / n;
    let ne_ped_avg = acc.ne_ped / n;
    let te_vol = acc.te_vol_avg / n;
    let ne_vol = acc.ne_vol_avg / n;
    let p_fus_avg = acc.p_fus_from_profiles / n;
    let p_alpha_0d_avg = acc.p_alpha_0d / n;
    let p_ext = p_input_avg - p_alpha_0d_avg;

    let fuel = if device.mass_number > 2.0 { "D-T" } else { "D-D" };

    AuditRecord {
        label: label.to_string(),
        device_name: device.name.clone(),
        r0: device.r0,
        a: device.a,
        bt: prog.bt,
        ip: prog.ip,
        kappa: prog.kappa,
        delta: prog.delta,
        volume: device.volume,
        mass_number: device.mass_number,
        p_nbi: prog.p_nbi,
        p_ech: prog.p_ech,
        p_ich: prog.p_ich,
        ne_target: prog.ne_target,
        d2_puff: prog.d2_puff,
        neon_puff: prog.neon_puff,
        fuel,
        w_th: acc.w_th / n,
        tau_e: tau_e_avg,
        h_factor: acc.h_factor / n,
        te0: te0_avg,
        ne0: acc.ne0 / n,
        ne_bar: ne_bar_avg,
        p_ohmic: acc.p_ohmic / n,
        p_input: p_input_avg,
        p_loss: acc.p_loss / n,
        p_rad: acc.p_rad / n,
        p_alpha_0d: p_alpha_0d_avg,
        q95: acc.q95 / n,
        beta_t: acc.beta_t / n,
        beta_n: acc.beta_n / n,
        f_greenwald: acc.f_greenwald / n,
        li: acc.li / n,
        impurity_fraction: acc.impurity_fraction / n,
        te_ped: te_ped_avg,
        ne_ped: ne_ped_avg,
        te_core_prof: acc.te_core_prof / n,
        ne_core_prof: acc.ne_core_prof / n,
        te_vol_avg: te_vol,
        ne_vol_avg: ne_vol,
        pressure_vol_avg: acc.pressure_vol_avg / n,
        w_th_from_profiles: acc.w_th_from_profiles / n,
        p_fus_from_profiles: p_fus_avg,
        p_alpha_from_profiles: acc.p_alpha_from_profiles / n,
        q_plasma: if p_ext > 0.1 { p_fus_avg / p_ext } else { 0.0 },
        h98y2_backcalc: h98y2_bc,
        te_ped_over_te0: if te0_avg > 0.01 { te_ped_avg / te0_avg } else { 0.0 },
        ne_ped_over_ne_bar: if ne_bar_avg > 0.01 { ne_ped_avg / ne_bar_avg } else { 0.0 },
        te_peaking: if te_vol > 0.01 { acc.te_core_prof / n / te_vol } else { 0.0 },
        ne_peaking: if ne_vol > 0.01 { acc.ne_core_prof / n / ne_vol } else { 0.0 },
        radiative_fraction: if p_input_avg > 0.01 { (acc.p_rad / n) / p_input_avg } else { 0.0 },
        hmode_fraction: acc.hmode_count as f64 / n,
        elm_suppressed_fraction: acc.elm_suppressed_count as f64 / n,
        ramp_up_time: ramp_up_s,
        avg_window: avg_window_s,
        total_sim_time: (total_steps as f64) * dt,
        total_steps,
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Formatted Output
// ═══════════════════════════════════════════════════════════════════════════

fn print_audit_table(rec: &AuditRecord) {
    let mode = if rec.hmode_fraction > 0.5 {
        if rec.elm_suppressed_fraction > 0.5 { "H-QCE" } else { "H-mode" }
    } else {
        "L-mode"
    };

    println!("╔══════════════════════════════════════════════════════════════════════════╗");
    println!("║  PHYSICS AUDIT: {:<56}║", rec.label);
    println!("╠══════════════════════════════════════════════════════════════════════════╣");
    println!(
        "║  MACHINE:  R0={:.1}m  a={:.2}m  Bt={:.1}T  Ip={:.1}MA  V={:.0}m³  {:<9}  ║",
        rec.r0, rec.a, rec.bt, rec.ip, rec.volume, rec.fuel
    );
    println!(
        "║  HEATING:  P_NBI={:.1}  P_ECH={:.1}  P_ICH={:.1}  (MW)                         ║",
        rec.p_nbi, rec.p_ech, rec.p_ich
    );
    println!(
        "║  DENSITY:  ne_target={:.3}  D2_puff={:.1}  Ne_puff={:.2}                        ║",
        rec.ne_target, rec.d2_puff, rec.neon_puff
    );
    println!(
        "║  SHAPE:    kappa={:.2}  delta={:.3}                                              ║",
        rec.kappa, rec.delta
    );
    println!(
        "║  SIM:      ramp={:.0}s  avg={:.0}s  total={:.0}s  mode={} ({:.0}% H)             ║",
        rec.ramp_up_time, rec.avg_window, rec.total_sim_time, mode, rec.hmode_fraction * 100.0,
    );
    println!("╠═══════════════════════════════════╤══════════════════════════════════════╣");
    println!("║  0D TRANSPORT (time-averaged)     │  PROFILES (time-averaged)            ║");
    println!(
        "║  W_th    = {:>8.3} MJ             │  Te(0)     = {:>7.2} keV              ║",
        rec.w_th, rec.te_core_prof
    );
    println!(
        "║  tau_E   = {:>8.4} s              │  Te_ped    = {:>7.3} keV              ║",
        rec.tau_e, rec.te_ped
    );
    println!(
        "║  H98y2   = {:>8.3} (back-calc)    │  Te_vol    = {:>7.3} keV              ║",
        rec.h98y2_backcalc, rec.te_vol_avg
    );
    println!(
        "║  h_fac   = {:>8.3}                │  ne(0)     = {:>7.3} 10²⁰             ║",
        rec.h_factor, rec.ne_core_prof
    );
    println!(
        "║  Te0     = {:>8.3} keV            │  ne_ped    = {:>7.3} 10²⁰             ║",
        rec.te0, rec.ne_ped
    );
    println!(
        "║  ne_bar  = {:>8.3} 10²⁰           │  ne_vol    = {:>7.3} 10²⁰             ║",
        rec.ne_bar, rec.ne_vol_avg
    );
    println!(
        "║  ne0     = {:>8.3} 10²⁰           │  p_vol     = {:>7.3} kPa·equiv        ║",
        rec.ne0, rec.pressure_vol_avg
    );
    println!(
        "║  P_input = {:>8.3} MW             │  Te_ped/Te0= {:>7.3}                  ║",
        rec.p_input, rec.te_ped_over_te0
    );
    println!(
        "║  P_rad   = {:>8.3} MW             │  ne_ped/ne = {:>7.3}                  ║",
        rec.p_rad, rec.ne_ped_over_ne_bar
    );
    println!(
        "║  P_loss  = {:>8.3} MW             │  Te_peak   = {:>7.2}                  ║",
        rec.p_loss, rec.te_peaking
    );
    println!(
        "║  P_alpha = {:>8.3} MW (0D)        │  ne_peak   = {:>7.2}                  ║",
        rec.p_alpha_0d, rec.ne_peaking
    );
    println!(
        "║  P_ohmic = {:>8.3} MW             │  rad_frac  = {:>7.3}                  ║",
        rec.p_ohmic, rec.radiative_fraction
    );
    println!(
        "║  q95     = {:>8.3}                │  imp_frac  = {:>7.4}                  ║",
        rec.q95, rec.impurity_fraction
    );
    println!(
        "║  beta_N  = {:>8.3}                │                                      ║",
        rec.beta_n
    );
    println!(
        "║  beta_t  = {:>8.3} %              │  PROFILE INTEGRATION (time-avg)      ║",
        rec.beta_t
    );
    println!(
        "║  f_GW    = {:>8.3}                │  W_th_prof = {:>8.3} MJ              ║",
        rec.f_greenwald, rec.w_th_from_profiles
    );
    println!(
        "║  li      = {:>8.3}                │  P_fus     = {:>8.3} MW              ║",
        rec.li, rec.p_fus_from_profiles
    );
    println!(
        "║                                   │  P_alpha   = {:>8.3} MW (prof)       ║",
        rec.p_alpha_from_profiles
    );
    println!(
        "║                                   │  Q_plasma  = {:>8.3}                 ║",
        rec.q_plasma
    );
    println!("╚═══════════════════════════════════╧══════════════════════════════════════╝");
}

// ═══════════════════════════════════════════════════════════════════════════
//  Consistency Checks
// ═══════════════════════════════════════════════════════════════════════════

struct CheckResult {
    name: String,
    status: CheckStatus,
    detail: String,
}

#[derive(Clone, Copy)]
enum CheckStatus { Pass, Warn, Fail }

struct ReferenceValues {
    te0_range: (f64, f64),
    te_ped_range: (f64, f64),
    tau_e_range: (f64, f64),
    p_fus_range: (f64, f64),
    q_range: (f64, f64),
    w_th_range: (f64, f64),
    beta_n_range: (f64, f64),
}

fn check_consistency(rec: &AuditRecord, refs: Option<&ReferenceValues>) -> Vec<CheckResult> {
    let mut checks = Vec::new();

    // W_th match: 0D vs profile integration
    if rec.w_th > 0.01 {
        let diff = ((rec.w_th - rec.w_th_from_profiles) / rec.w_th).abs();
        checks.push(CheckResult {
            name: "W_th match (0D vs profiles)".into(),
            status: if diff < 0.15 { CheckStatus::Pass } else if diff < 0.30 { CheckStatus::Warn } else { CheckStatus::Fail },
            detail: format!("0D={:.3} MJ, prof={:.3} MJ ({:.0}% diff)", rec.w_th, rec.w_th_from_profiles, diff * 100.0),
        });
    }

    // H-factor vs back-calculated H98y2
    if rec.h_factor > 0.1 && rec.h98y2_backcalc > 0.1 {
        let diff = ((rec.h_factor - rec.h98y2_backcalc) / rec.h_factor).abs();
        checks.push(CheckResult {
            name: "H-factor vs H98y2 back-calc".into(),
            status: if diff < 0.10 { CheckStatus::Pass } else if diff < 0.30 { CheckStatus::Warn } else { CheckStatus::Fail },
            detail: format!("h_fac={:.3}, H98y2_bc={:.3} ({:.0}% diff)", rec.h_factor, rec.h98y2_backcalc, diff * 100.0),
        });
    }

    // P_alpha match: 0D vs profile-integrated
    if rec.p_alpha_0d > 0.1 || rec.p_alpha_from_profiles > 0.1 {
        let max_pa = rec.p_alpha_0d.max(rec.p_alpha_from_profiles).max(0.01);
        let diff = (rec.p_alpha_0d - rec.p_alpha_from_profiles).abs() / max_pa;
        checks.push(CheckResult {
            name: "P_alpha match (0D vs profiles)".into(),
            status: if diff < 0.30 { CheckStatus::Pass } else if diff < 0.50 { CheckStatus::Warn } else { CheckStatus::Fail },
            detail: format!("0D={:.3} MW, prof={:.3} MW ({:.0}% diff)", rec.p_alpha_0d, rec.p_alpha_from_profiles, diff * 100.0),
        });
    }

    // Te_ped / Te0 ratio
    if rec.hmode_fraction > 0.5 && rec.te0 > 0.5 {
        let ratio = rec.te_ped_over_te0;
        checks.push(CheckResult {
            name: "Te_ped/Te0 ratio".into(),
            status: if (0.15..=0.40).contains(&ratio) { CheckStatus::Pass } else if (0.10..=0.50).contains(&ratio) { CheckStatus::Warn } else { CheckStatus::Fail },
            detail: format!("{:.3} (expected 0.15-0.40)", ratio),
        });
    }

    // ne_ped / ne_bar ratio
    if rec.hmode_fraction > 0.5 && rec.ne_bar > 0.05 {
        let ratio = rec.ne_ped_over_ne_bar;
        checks.push(CheckResult {
            name: "ne_ped/ne_bar ratio".into(),
            status: if (0.50..=1.00).contains(&ratio) { CheckStatus::Pass } else if (0.30..=1.20).contains(&ratio) { CheckStatus::Warn } else { CheckStatus::Fail },
            detail: format!("{:.3} (expected 0.5-1.0)", ratio),
        });
    }

    // Radiative fraction
    if rec.p_input > 0.1 {
        checks.push(CheckResult {
            name: "Radiative fraction".into(),
            status: if rec.radiative_fraction < 0.50 { CheckStatus::Pass } else if rec.radiative_fraction < 0.80 { CheckStatus::Warn } else { CheckStatus::Fail },
            detail: format!("{:.1}%", rec.radiative_fraction * 100.0),
        });
    }

    // Reference value comparisons
    if let Some(r) = refs {
        let ref_checks: Vec<(&str, f64, (f64, f64))> = vec![
            ("Te0", rec.te0, r.te0_range),
            ("tau_E", rec.tau_e, r.tau_e_range),
            ("P_fus", rec.p_fus_from_profiles, r.p_fus_range),
            ("Q_plasma", rec.q_plasma, r.q_range),
            ("W_th", rec.w_th, r.w_th_range),
            ("beta_N", rec.beta_n, r.beta_n_range),
        ];
        for (name, val, (lo, hi)) in &ref_checks {
            if *hi < 0.001 { continue; } // skip zero-range refs
            let status = if *val >= *lo && *val <= *hi {
                CheckStatus::Pass
            } else if *val >= lo * 0.5 && *val <= hi * 2.0 {
                CheckStatus::Warn
            } else {
                CheckStatus::Fail
            };
            checks.push(CheckResult {
                name: format!("{} vs reference", name),
                status,
                detail: format!("got {:.3}, expected {:.2}-{:.2}", val, lo, hi),
            });
        }
        // Te_ped separately (only in H-mode)
        if rec.hmode_fraction > 0.5 && r.te_ped_range.1 > 0.01 {
            let status = if rec.te_ped >= r.te_ped_range.0 && rec.te_ped <= r.te_ped_range.1 {
                CheckStatus::Pass
            } else if rec.te_ped >= r.te_ped_range.0 * 0.5 && rec.te_ped <= r.te_ped_range.1 * 2.0 {
                CheckStatus::Warn
            } else {
                CheckStatus::Fail
            };
            checks.push(CheckResult {
                name: "Te_ped vs reference".into(),
                status,
                detail: format!("got {:.3} keV, expected {:.1}-{:.1} keV", rec.te_ped, r.te_ped_range.0, r.te_ped_range.1),
            });
        }
    }

    checks
}

fn print_checks(checks: &[CheckResult]) {
    println!("┌──────────────────────────────────────────────────────────────────────────┐");
    println!("│  CONSISTENCY CHECKS                                                     │");
    println!("├──────────────────────────────────────────────────────────────────────────┤");
    for c in checks {
        let icon = match c.status {
            CheckStatus::Pass => "PASS",
            CheckStatus::Warn => "WARN",
            CheckStatus::Fail => "FAIL",
        };
        println!("│  [{}] {}: {}", icon, c.name, c.detail);
    }
    println!("└──────────────────────────────────────────────────────────────────────────┘");
    println!();
}

fn print_audit(rec: &AuditRecord, refs: Option<&ReferenceValues>) {
    print_audit_table(rec);
    let checks = check_consistency(rec, refs);
    print_checks(&checks);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Compact scan table printer
// ═══════════════════════════════════════════════════════════════════════════

fn print_scan_header(title: &str) {
    println!();
    println!("╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗");
    println!("║  PARAMETER SCAN: {:<108}║", title);
    println!("╠═════════════════╤════════╤════════╤═══════╤═══════╤═══════╤════════╤════════╤════════╤═══════╤════════╤════════╤════════╤════════╣");
    println!("║  Scan Point     │ Te0    │ Te_ped │ ne_bar│ tau_E │ H98y2 │ P_input│ P_rad  │ P_a(0D)│ P_fus │ Q      │ beta_N │ f_GW  │ Mode   ║");
    println!("╠═════════════════╪════════╪════════╪═══════╪═══════╪═══════╪════════╪════════╪════════╪═══════╪════════╪════════╪════════╪════════╣");
}

fn print_scan_row(label: &str, rec: &AuditRecord) {
    let mode = if rec.hmode_fraction < 0.5 {
        "L-mode"
    } else if rec.elm_suppressed_fraction > 0.5 {
        "H-QCE"
    } else {
        "H-mode"
    };
    println!(
        "║  {:<15} │ {:>6.2} │ {:>6.3} │ {:>5.3} │ {:>5.3} │ {:>5.3} │ {:>6.2} │ {:>6.3} │ {:>6.3} │ {:>5.1} │ {:>6.3} │ {:>6.3} │ {:>6.3} │ {:<6} ║",
        label,
        rec.te0, rec.te_ped, rec.ne_bar, rec.tau_e, rec.h98y2_backcalc,
        rec.p_input, rec.p_rad, rec.p_alpha_0d, rec.p_fus_from_profiles,
        rec.q_plasma, rec.beta_n, rec.f_greenwald, mode,
    );
}

fn print_scan_footer() {
    println!("╚═════════════════╧════════╧════════╧═══════╧═══════╧═══════╧════════╧════════╧════════╧═══════╧════════╧════════╧════════╧════════╝");
    println!();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Reference Values
// ═══════════════════════════════════════════════════════════════════════════

fn iter_baseline_refs() -> ReferenceValues {
    ReferenceValues {
        te0_range: (18.0, 30.0),
        te_ped_range: (3.5, 6.0),
        tau_e_range: (3.0, 5.0),
        p_fus_range: (300.0, 600.0),
        q_range: (5.0, 15.0),
        w_th_range: (300.0, 450.0),
        beta_n_range: (1.5, 2.5),
    }
}

fn diiid_hmode_refs() -> ReferenceValues {
    ReferenceValues {
        te0_range: (2.5, 6.0),
        te_ped_range: (0.4, 1.5),
        tau_e_range: (0.05, 0.20),
        p_fus_range: (0.0, 0.001),
        q_range: (0.0, 0.001),
        w_th_range: (0.2, 1.5),
        beta_n_range: (1.0, 3.0),
    }
}

fn jet_dt_hmode_refs() -> ReferenceValues {
    // JET DTE2/DTE3 reference: record ~11 MW sustained, Q ~ 0.33
    ReferenceValues {
        te0_range: (5.0, 12.0),
        te_ped_range: (1.0, 4.0),
        tau_e_range: (0.15, 0.60),
        p_fus_range: (5.0, 20.0),
        q_range: (0.10, 0.50),
        w_th_range: (3.0, 15.0),
        beta_n_range: (1.0, 2.5),
    }
}

fn sparc_qce_refs() -> ReferenceValues {
    // SPARC in the QCE (quasi-continuous exhaust) regime — the simulator's
    // default SPARC scenario, NOT the published Primary Reference Discharge.
    //
    // The PRD (Creely et al. 2020, table 2) is Q = 11, P_fus = 140 MW,
    // tau_E = 0.77 s, Te = 7.3 keV volume-averaged, beta_N = 1.0, at
    // f_GW = 0.37 with 11.1 MW of ICRF. QCE trades pedestal pressure for
    // type-I ELM-free operation and runs at higher density, which raises the
    // L-H sustainment power — so it lands well below the PRD on gain.
    //
    // Hughes et al. (2020) §4.2 bound the trade: even a 2x pedestal reduction
    // still leaves Q > 2. These ranges bracket the self-consistent QCE point.
    ReferenceValues {
        te0_range: (8.0, 16.0),
        te_ped_range: (3.0, 6.0),
        tau_e_range: (0.6, 1.1),
        p_fus_range: (30.0, 90.0),
        q_range: (1.8, 4.5),
        w_th_range: (10.0, 30.0),
        beta_n_range: (0.6, 1.3),
    }
}

fn centaur_nt_refs() -> ReferenceValues {
    // CENTAUR conceptual design: compact high-field NT tokamak
    // R0=2.0m, a=0.72m, Bt=10.9T, Ip=9.6MA, δ=-0.55, DT
    // Designed for Q~2-5 in NT-edge regime (ELM-free, H98y2≈0.82)
    // P_fus target: 50-150 MW with 30 MW ICRH
    ReferenceValues {
        te0_range: (8.0, 20.0),
        te_ped_range: (0.0, 0.1), // No pedestal in NT mode
        tau_e_range: (0.1, 0.5),
        p_fus_range: (30.0, 200.0),
        q_range: (1.0, 6.0),
        w_th_range: (2.0, 20.0),
        beta_n_range: (1.5, 3.5),
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/// Make a device with DT fuel (mass_number = 2.5).
fn make_dt(mut device: Device) -> Device {
    device.mass_number = 2.5;
    device
}

fn make_prog(device: &Device, ip: f64, bt: f64, p_nbi: f64, p_ech: f64, p_ich: f64, ne_frac_gw: f64) -> ProgramValues {
    ProgramValues {
        ip,
        bt,
        ne_target: ne_frac_gw * device.greenwald_density(ip),
        p_nbi,
        p_ech,
        p_ich,
        kappa: device.kappa,
        delta: (device.delta_upper + device.delta_lower) / 2.0,
        d2_puff: 0.0,
        neon_puff: 0.0,
    }
}

// Ramp-up / averaging windows by device scale
const RAMP_SMALL: f64 = 10.0;  // DIII-D: 10s ramp, reaches steady state fast
const AVG_SMALL: f64 = 20.0;   // 20s averaging window (many ELM cycles)
const RAMP_MED: f64 = 20.0;    // JET
const AVG_MED: f64 = 30.0;
const RAMP_LARGE: f64 = 40.0;  // ITER: long tau_E, needs more ramp time
const AVG_LARGE: f64 = 60.0;   // 60s window (many ELM cycles at ~1 Hz)

// ═══════════════════════════════════════════════════════════════════════════
//  Individual Test Cases
// ═══════════════════════════════════════════════════════════════════════════

#[test]
#[ignore]
fn test_audit_diiid_hmode() {
    let device = devices::diiid(); // DD is correct for DIII-D
    let prog = make_prog(&device, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
    let rec = run_and_average(&device, &prog, "DIII-D H-mode (1.2MA, 5MW NBI, DD)", RAMP_SMALL, AVG_SMALL);
    print_audit(&rec, Some(&diiid_hmode_refs()));
}

#[test]
#[ignore]
fn test_audit_jet_dt_hmode() {
    let device = make_dt(devices::jet()); // DT default
    let prog = make_prog(&device, 3.5, 3.45, 25.0, 0.0, 4.0, 0.70);
    let rec = run_and_average(&device, &prog, "JET DT H-mode (3.5MA, 25NBI+4ICH)", RAMP_MED, AVG_MED);
    print_audit(&rec, Some(&jet_dt_hmode_refs()));
}

#[test]
#[ignore]
fn test_audit_iter_baseline() {
    let device = make_dt(devices::iter()); // DT default
    let prog = make_prog(&device, 15.0, 5.3, 33.0, 20.0, 0.0, 0.80);
    let rec = run_and_average(&device, &prog, "ITER Baseline (15MA, 33NBI+20ECH, DT)", RAMP_LARGE, AVG_LARGE);
    print_audit(&rec, Some(&iter_baseline_refs()));
}

#[test]
#[ignore]
fn test_audit_sparc_qce() {
    let device = devices::sparc(); // DT by default (mass_number = 2.5)
    // QCE operating point: full field and current, ICRF stepped back to 17 MW
    // once the alphas carry the burn, f_GW = 0.46.
    let prog = make_prog(&device, 8.7, 12.2, 0.0, 0.0, 17.0, 0.46);
    let rec = run_and_average(&device, &prog, "SPARC QCE (8.7MA, 17MW ICRF, DT)", RAMP_MED, AVG_MED);
    print_audit(&rec, Some(&sparc_qce_refs()));
}

#[test]
#[ignore]
fn test_audit_centaur_nt() {
    let device = devices::centaur(); // Already DT (mass_number=2.5)
    let prog = make_prog(&device, 9.6, 10.9, 0.0, 0.0, 30.0, 0.65);
    let rec = run_and_average(&device, &prog, "CENTAUR NT-edge (9.6MA, 30MW ICH, DT)", RAMP_MED, AVG_MED);
    print_audit(&rec, Some(&centaur_nt_refs()));
}

#[test]
#[ignore]
fn test_audit_iter_half_field() {
    let device = make_dt(devices::iter());
    let prog = make_prog(&device, 7.5, 2.65, 10.0, 5.0, 0.0, 0.60);
    let rec = run_and_average(&device, &prog, "ITER Half-field (7.5MA, 10NBI+5ECH, DT)", RAMP_LARGE, AVG_LARGE);
    print_audit(&rec, None);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Parameter Scans
// ═══════════════════════════════════════════════════════════════════════════

#[test]
#[ignore]
fn test_audit_iter_density_scan() {
    let device = make_dt(devices::iter());
    let fracs = [0.40, 0.60, 0.80, 1.00];
    print_scan_header("ITER Density Scan (DT, Ip=15MA, P=33NBI+20ECH)");
    for &f in &fracs {
        let prog = make_prog(&device, 15.0, 5.3, 33.0, 20.0, 0.0, f);
        let label = format!("f_GW={:.2}", f);
        let rec = run_and_average(&device, &prog, &label, RAMP_LARGE, AVG_LARGE);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

#[test]
#[ignore]
fn test_audit_iter_power_scan() {
    let device = make_dt(devices::iter());
    let powers = [(10.0, 5.0), (20.0, 10.0), (33.0, 20.0), (40.0, 25.0)];
    print_scan_header("ITER Power Scan (DT, Ip=15MA, f_GW=0.80)");
    for &(p_nbi, p_ech) in &powers {
        let prog = make_prog(&device, 15.0, 5.3, p_nbi, p_ech, 0.0, 0.80);
        let label = format!("P={:.0}+{:.0}MW", p_nbi, p_ech);
        let rec = run_and_average(&device, &prog, &label, RAMP_LARGE, AVG_LARGE);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

#[test]
#[ignore]
fn test_audit_diiid_power_scan() {
    let device = devices::diiid();
    let powers = [2.0, 5.0, 8.0, 12.0];
    print_scan_header("DIII-D NBI Power Scan (DD, Ip=1.2MA, f_GW=0.60)");
    for &p in &powers {
        let prog = make_prog(&device, 1.2, 2.1, p, 0.0, 0.0, 0.60);
        let label = format!("P_NBI={:.0}MW", p);
        let rec = run_and_average(&device, &prog, &label, RAMP_SMALL, AVG_SMALL);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

#[test]
#[ignore]
fn test_audit_diiid_neon_scan() {
    let device = devices::diiid();
    let neon_rates = [0.0, 0.1, 0.3, 0.5, 0.7];
    print_scan_header("DIII-D Neon Seeding Scan (DD, Ip=1.2MA, 5MW NBI)");
    for &neon in &neon_rates {
        let mut prog = make_prog(&device, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
        prog.neon_puff = neon;
        let label = format!("Ne={:.1}e20/s", neon);
        let rec = run_and_average(&device, &prog, &label, RAMP_SMALL, AVG_SMALL);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

#[test]
#[ignore]
fn test_audit_iter_neon_scan() {
    let device = make_dt(devices::iter());
    let neon_rates = [0.0, 0.5, 1.0, 2.0, 3.0];
    print_scan_header("ITER Neon Seeding Scan (DT, Ip=15MA, 33NBI+20ECH)");
    for &neon in &neon_rates {
        let mut prog = make_prog(&device, 15.0, 5.3, 33.0, 20.0, 0.0, 0.80);
        prog.neon_puff = neon;
        let label = format!("Ne={:.1}e20/s", neon);
        let rec = run_and_average(&device, &prog, &label, RAMP_LARGE, AVG_LARGE);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

#[test]
#[ignore]
fn test_audit_diiid_d2_puff_scan() {
    let device = devices::diiid();
    let puff_rates = [0.0, 1.0, 3.0, 5.0];
    print_scan_header("DIII-D D2 Puff Scan (DD, Ip=1.2MA, 5MW NBI)");
    for &d2 in &puff_rates {
        let mut prog = make_prog(&device, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
        prog.d2_puff = d2;
        let label = format!("D2={:.0}e20/s", d2);
        let rec = run_and_average(&device, &prog, &label, RAMP_SMALL, AVG_SMALL);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

#[test]
#[ignore]
fn test_audit_diiid_delta_scan() {
    let device = devices::diiid();
    let deltas = [0.20, 0.35, 0.50, 0.65];
    print_scan_header("DIII-D Triangularity Scan (DD, Ip=1.2MA, 5MW NBI)");
    for &d in &deltas {
        let mut prog = make_prog(&device, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
        prog.delta = d;
        let label = format!("delta={:.2}", d);
        let rec = run_and_average(&device, &prog, &label, RAMP_SMALL, AVG_SMALL);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

#[test]
#[ignore]
fn test_audit_diiid_kappa_scan() {
    let device = devices::diiid();
    let kappas = [1.4, 1.7, 2.0, 2.3];
    print_scan_header("DIII-D Elongation Scan (DD, Ip=1.2MA, 5MW NBI)");
    for &k in &kappas {
        let mut prog = make_prog(&device, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
        prog.kappa = k;
        let label = format!("kappa={:.1}", k);
        let rec = run_and_average(&device, &prog, &label, RAMP_SMALL, AVG_SMALL);
        print_scan_row(&label, &rec);
    }
    print_scan_footer();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sensitivity Analysis
// ═══════════════════════════════════════════════════════════════════════════

#[test]
#[ignore]
fn test_audit_sensitivity() {
    println!();
    println!("╔════════════════════════════════════════════════════════════════════════════════════════════════════╗");
    println!("║  SENSITIVITY ANALYSIS: ITER Baseline DT — Effect of Fudge Factor Variations (±20%)              ║");
    println!("╠════════════════════════════════════════════════════════════════════════════════════════════════════╣");

    let device = make_dt(devices::iter());
    let prog = make_prog(&device, 15.0, 5.3, 33.0, 20.0, 0.0, 0.80);
    let baseline = run_and_average(&device, &prog, "baseline", RAMP_LARGE, AVG_LARGE);

    println!("║  Baseline:  Te0={:.2} keV  P_fus={:.1} MW  Q={:.3}  tau_E={:.4} s  P_alpha(0D)={:.2} MW  ║",
        baseline.te0, baseline.p_fus_from_profiles, baseline.q_plasma, baseline.tau_e, baseline.p_alpha_0d);
    println!("║                                                                                                ║");
    println!("║  The following are analytical estimates — the actual fudge factors are hardcoded in the engine.  ║");
    println!("╠──────────────────────┬─────────┬────────────────────────────────────────────────────────────────╣");
    println!("║  Factor              │ Current │ Estimated sensitivity                                         ║");
    println!("╠──────────────────────┼─────────┼────────────────────────────────────────────────────────────────╣");

    let te0 = baseline.te0;
    let p_fus = baseline.p_fus_from_profiles;

    println!("║  Te0 peaking         │  2.00   │ Te0 scales linearly; P_fus ~ Te0^2 at 5-20 keV               ║");
    println!("║                      │         │ -20% → Te0~{:.1}, P_fus~{:.0}MW; +20% → Te0~{:.1}, P_fus~{:.0}MW    ║",
        te0*0.8, p_fus*0.64, te0*1.2, p_fus*1.44);
    println!("║  ne0 peaking (ne_bar)│  1.30   │ P_fus ~ ne^2; ±20% ne → P_fus ×0.64 / ×1.44                 ║");
    println!("║  ne_vol/ne_bar       │  0.85   │ Shifts volume-avg ne; similar effect to ne0 peaking           ║");
    println!("║  f_profile (fusion)  │  0.45   │ Linear multiplier on 0D P_alpha only (not profile P_fus)      ║");
    println!("║                      │         │ P_alpha(0D): {:.2}→{:.2} MW (±20%)                                ║",
        baseline.p_alpha_0d * 0.8, baseline.p_alpha_0d * 1.2);
    println!("║  Ti_eff/Te0          │  0.65   │ Changes ion temp for 0D reactivity; ~quadratic on P_alpha     ║");
    println!("║  DT isotope boost    │  1.35   │ Multiplies tau_E in DT H-mode; Te0 ~ tau_E linearly           ║");
    println!("║                      │         │ Dominates DT vs DD performance gap                            ║");
    println!("║  Te_ped/Te0 scaling  │  0.35   │ Profile shape only — does NOT change 0D Te0 or W_th           ║");
    println!("║                      │         │ But shifts profile-integrated P_fus via pedestal region        ║");
    println!("╚══════════════════════╧═════════╧════════════════════════════════════════════════════════════════╝");
    println!();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Master Test: Run Everything
// ═══════════════════════════════════════════════════════════════════════════

#[test]
#[ignore]
fn test_audit_all() {
    println!("\n{}", "=".repeat(76));
    println!("  FUSION SIMULATOR PHYSICS AUDIT — COMPLETE REPORT");
    println!("  All ITER/JET cases use DT fuel (mass_number=2.5)");
    println!("  DIII-D uses DD fuel (mass_number=2.0)");
    println!("  Time-averaged over ELM cycles");
    println!("{}\n", "=".repeat(76));

    // ── Baseline devices ──
    println!("━━━ BASELINE DEVICE AUDITS ━━━\n");

    let diiid = devices::diiid();
    let prog = make_prog(&diiid, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
    let rec = run_and_average(&diiid, &prog, "DIII-D H-mode (1.2MA, 5MW NBI, DD)", RAMP_SMALL, AVG_SMALL);
    print_audit(&rec, Some(&diiid_hmode_refs()));

    let jet_dt = make_dt(devices::jet());
    let prog = make_prog(&jet_dt, 3.5, 3.45, 25.0, 0.0, 4.0, 0.70);
    let rec = run_and_average(&jet_dt, &prog, "JET DT H-mode (3.5MA, 25NBI+4ICH)", RAMP_MED, AVG_MED);
    print_audit(&rec, Some(&jet_dt_hmode_refs()));

    let iter_dt = make_dt(devices::iter());
    let prog = make_prog(&iter_dt, 15.0, 5.3, 33.0, 20.0, 0.0, 0.80);
    let rec = run_and_average(&iter_dt, &prog, "ITER Baseline DT (15MA, 33NBI+20ECH)", RAMP_LARGE, AVG_LARGE);
    print_audit(&rec, Some(&iter_baseline_refs()));

    let prog = make_prog(&iter_dt, 7.5, 2.65, 10.0, 5.0, 0.0, 0.60);
    let rec = run_and_average(&iter_dt, &prog, "ITER Half-field DT (7.5MA, 10NBI+5ECH)", RAMP_LARGE, AVG_LARGE);
    print_audit(&rec, None);

    let centaur = devices::centaur();
    let prog = make_prog(&centaur, 9.6, 10.9, 0.0, 0.0, 30.0, 0.65);
    let rec = run_and_average(&centaur, &prog, "CENTAUR NT-edge (9.6MA, 30MW ICH, DT)", RAMP_MED, AVG_MED);
    print_audit(&rec, Some(&centaur_nt_refs()));

    // ── Parameter scans ──
    println!("━━━ PARAMETER SCANS ━━━");

    // ITER density scan
    {
        let fracs = [0.40, 0.60, 0.80, 1.00];
        print_scan_header("ITER Density Scan (DT, Ip=15MA, P=33NBI+20ECH)");
        for &f in &fracs {
            let prog = make_prog(&iter_dt, 15.0, 5.3, 33.0, 20.0, 0.0, f);
            let label = format!("f_GW={:.2}", f);
            let rec = run_and_average(&iter_dt, &prog, &label, RAMP_LARGE, AVG_LARGE);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    // ITER power scan
    {
        let powers = [(10.0, 5.0), (20.0, 10.0), (33.0, 20.0), (40.0, 25.0)];
        print_scan_header("ITER Power Scan (DT, Ip=15MA, f_GW=0.80)");
        for &(p_nbi, p_ech) in &powers {
            let prog = make_prog(&iter_dt, 15.0, 5.3, p_nbi, p_ech, 0.0, 0.80);
            let label = format!("P={:.0}+{:.0}MW", p_nbi, p_ech);
            let rec = run_and_average(&iter_dt, &prog, &label, RAMP_LARGE, AVG_LARGE);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    // DIII-D power scan
    {
        let powers = [2.0, 5.0, 8.0, 12.0];
        print_scan_header("DIII-D NBI Power Scan (DD, Ip=1.2MA, f_GW=0.60)");
        for &p in &powers {
            let prog = make_prog(&diiid, 1.2, 2.1, p, 0.0, 0.0, 0.60);
            let label = format!("P_NBI={:.0}MW", p);
            let rec = run_and_average(&diiid, &prog, &label, RAMP_SMALL, AVG_SMALL);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    // DIII-D neon scan
    {
        let neon_rates = [0.0, 0.1, 0.3, 0.5, 0.7];
        print_scan_header("DIII-D Neon Seeding Scan (DD, Ip=1.2MA, 5MW NBI)");
        for &neon in &neon_rates {
            let mut prog = make_prog(&diiid, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
            prog.neon_puff = neon;
            let label = format!("Ne={:.1}e20/s", neon);
            let rec = run_and_average(&diiid, &prog, &label, RAMP_SMALL, AVG_SMALL);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    // ITER neon scan
    {
        let neon_rates = [0.0, 0.5, 1.0, 2.0, 3.0];
        print_scan_header("ITER Neon Seeding Scan (DT, Ip=15MA, 33NBI+20ECH)");
        for &neon in &neon_rates {
            let mut prog = make_prog(&iter_dt, 15.0, 5.3, 33.0, 20.0, 0.0, 0.80);
            prog.neon_puff = neon;
            let label = format!("Ne={:.1}e20/s", neon);
            let rec = run_and_average(&iter_dt, &prog, &label, RAMP_LARGE, AVG_LARGE);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    // DIII-D D2 puff scan
    {
        let puff_rates = [0.0, 1.0, 3.0, 5.0];
        print_scan_header("DIII-D D2 Puff Scan (DD, Ip=1.2MA, 5MW NBI)");
        for &d2 in &puff_rates {
            let mut prog = make_prog(&diiid, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
            prog.d2_puff = d2;
            let label = format!("D2={:.0}e20/s", d2);
            let rec = run_and_average(&diiid, &prog, &label, RAMP_SMALL, AVG_SMALL);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    // DIII-D delta scan
    {
        let deltas = [0.20, 0.35, 0.50, 0.65];
        print_scan_header("DIII-D Triangularity Scan (DD, Ip=1.2MA, 5MW NBI)");
        for &d in &deltas {
            let mut prog = make_prog(&diiid, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
            prog.delta = d;
            let label = format!("delta={:.2}", d);
            let rec = run_and_average(&diiid, &prog, &label, RAMP_SMALL, AVG_SMALL);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    // DIII-D kappa scan
    {
        let kappas = [1.4, 1.7, 2.0, 2.3];
        print_scan_header("DIII-D Elongation Scan (DD, Ip=1.2MA, 5MW NBI)");
        for &k in &kappas {
            let mut prog = make_prog(&diiid, 1.2, 2.1, 5.0, 0.0, 0.0, 0.60);
            prog.kappa = k;
            let label = format!("kappa={:.1}", k);
            let rec = run_and_average(&diiid, &prog, &label, RAMP_SMALL, AVG_SMALL);
            print_scan_row(&label, &rec);
        }
        print_scan_footer();
    }

    println!("\n{}", "=".repeat(76));
    println!("  END OF PHYSICS AUDIT REPORT");
    println!("{}", "=".repeat(76));
}
