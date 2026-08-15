//! Development harness for the SPARC QCE scenario.
//!
//! Runs the SPARC presets end to end and prints the regime history, so the QCE
//! entry sequence and the flat-top performance can be checked without waiting
//! on the full test suite.
//!
//! Run with: `cargo run --release --example sparc_check`
//!
//! Env knobs: `DT=0.004` for a faster/coarser sweep, `TRACE=1` for a
//! per-step dump of the power balance, `NESCAN=0.0,0.05,0.1` to sweep the
//! neon seeding rate.

use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation};

fn run(name: &str, device: &devices::Device, prog: PulseProgram) {
    let duration = prog.duration;
    let mut sim = Simulation::new(device.clone(), prog);
    sim.start();
    let dt: f64 = std::env::var("DT").ok().and_then(|v| v.parse().ok()).unwrap_or(0.002);

    let mut n_type1 = 0;
    let mut n_type2 = 0;
    let mut t_first_hmode = f64::NAN;
    let mut t_first_qce = f64::NAN;
    let mut peak_q = 0.0f64;
    let mut peak_pfus = 0.0f64;
    let mut sum_q = 0.0;
    let mut sum_pfus = 0.0;
    let mut sum_taue = 0.0;
    let mut sum_te0 = 0.0;
    let mut sum_fgw = 0.0;
    let mut sum_betan = 0.0;
    let mut sum_imp = 0.0;
    let mut n_flat = 0;

    // Average over the middle of the flat-top
    let (t_avg0, t_avg1) = (duration * 0.47, duration * 0.58);

    let mut last: Option<tok_sym_core::simulation::SimulationSnapshot> = None;
    let mut t = 0.0;
    let max_steps = (duration / dt) as usize + 100;
    let mut steps = 0usize;
    let mut halted = "";
    while t < duration {
        steps += 1;
        if steps > max_steps {
            halted = " (TIME STOPPED ADVANCING — sim halted)";
            break;
        }
        let s = sim.step(dt);
        t = s.time;
        let snap_time = s.time;
        let _ = snap_time;
        if s.disrupted && halted.is_empty() {
            halted = " (DISRUPTED)";
        }

        if s.in_hmode && t_first_hmode.is_nan() {
            t_first_hmode = t;
        }
        if s.elm_suppressed && s.in_hmode && t_first_qce.is_nan() {
            t_first_qce = t;
        }
        if s.elm_active {
            match s.elm_type {
                1 => n_type1 += 1,
                2 => n_type2 += 1,
                _ => {}
            }
        }
        // P_fus from the 0D alpha power: alphas carry 3.5/17.6 of the DT yield.
        let p_fus = s.p_alpha * (17.6 / 3.5);
        let p_ext = (s.p_input - s.p_alpha).max(0.01);
        let q = p_fus / p_ext;
        peak_q = peak_q.max(q);
        peak_pfus = peak_pfus.max(p_fus);

        if t >= t_avg0 && t <= t_avg1 {
            sum_q += q;
            sum_pfus += p_fus;
            sum_taue += s.tau_e;
            sum_te0 += s.te0;
            sum_fgw += s.f_greenwald;
            sum_betan += s.beta_n;
            sum_imp += s.impurity_fraction;
            n_flat += 1;
        }
        // Trace the approach to a disruption
        if std::env::var("TRACE").is_ok() && steps % 250 == 0 && !s.disrupted {
            println!(
                "    t={:5.2} risk={:.2} fGW={:.2} betaN={:.2} Pin={:5.1} Prad={:5.1} Palpha={:5.1} f_imp={:.4} Te0={:5.1} Teped={:.2} hmode={} qce={}",
                s.time, s.disruption_risk, s.f_greenwald, s.beta_n, s.p_input, s.p_rad,
                s.p_alpha, s.impurity_fraction, s.te0, s.te_ped, s.in_hmode, s.elm_suppressed
            );
        }
        last = Some(s);
    }
    if let Some(s) = &last {
        println!(
            "  [halt state] t={:.3}s status={:?} disrupted={} risk={:.2} ip={:.2} ne={:.2} fGW={:.2} betaN={:.2} li={:.2} limited={} cfg={}",
            s.time, s.status, s.disrupted, s.disruption_risk, s.ip, s.ne_bar,
            s.f_greenwald, s.beta_n, s.li, s.is_limited, s.magnetic_config
        );
    }

    let n = n_flat.max(1) as f64;
    println!("\n=== {name} ==={halted}");
    println!(
        "  flat-top means:  Q={:.2}  P_fus={:.1} MW  tau_E={:.3} s  Te0={:.1} keV",
        sum_q / n,
        sum_pfus / n,
        sum_taue / n,
        sum_te0 / n
    );
    println!(
        "                   f_GW={:.3}  beta_N={:.2}  f_imp={:.5}",
        sum_fgw / n,
        sum_betan / n,
        sum_imp / n
    );
    println!("  peaks:           Q={:.2}  P_fus={:.1} MW", peak_q, peak_pfus);
    println!(
        "  regime:          L-H at t={:.2}s, QCE at t={:.2}s  |  Type-I crashes={}  Type-II={}",
        t_first_hmode, t_first_qce, n_type1, n_type2
    );
}

fn main() {
    let d = devices::sparc();
    println!(
        "SPARC: R0={} a={} B0={} Ip={} kappa_sep={} kappa_a={} V={} m3  n_GW={:.2}e20",
        d.r0,
        d.a,
        d.bt_max,
        d.ip_max,
        d.kappa,
        d.kappa_areal,
        d.volume,
        d.greenwald_density(d.ip_max)
    );

    if let Ok(scan) = std::env::var("NESCAN") {
        for lev in scan.split(',') {
            let lev: f64 = lev.parse().unwrap();
            let mut p = PulseProgram::standard_hmode(&d);
            let base = p.neon_puff.iter().map(|x| x.1).fold(0.0, f64::max);
            for pt in p.neon_puff.iter_mut() {
                if pt.1 > 0.0 { pt.1 = lev; }
            }
            let _ = base;
            run(&format!("SPARC QCE  neon={lev}"), &d, p);
        }
        return;
    }
    run("SPARC QCE (default preset)", &d, PulseProgram::standard_hmode(&d));
    run("SPARC L-mode", &d, PulseProgram::lmode(&d));

    // Push out of the QCE window with extra ICRF — should return to Type-I ELMs.
    let mut hot = PulseProgram::standard_hmode(&d);
    for p in hot.p_ich.iter_mut() {
        if p.1 > 0.0 {
            p.1 = 25.0;
        }
    }
    run("SPARC + 25 MW ICRF (expect Type-I ELMs)", &d, hot);

    // Over-seed: heavy neon should starve the SOL and cost QCE access.
    let mut seeded = PulseProgram::standard_hmode(&d);
    for p in seeded.neon_puff.iter_mut() {
        if p.1 > 0.0 {
            p.1 = 6.0;
        }
    }
    run("SPARC + heavy Ne seeding (expect QCE lost)", &d, seeded);
}
