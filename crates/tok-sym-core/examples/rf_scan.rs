//! Scan the SPARC flat-top ICRF step-down level for steady-state Q.
//!
//! The two-level ICRF scheme backs off from 24 MW once the alphas are
//! established; this probes what the steady flat-top Q actually is at each
//! candidate second-level power, so the level is chosen deliberately rather
//! than inherited from a transient-contaminated average.
//!
//! Run with: `cargo run --release --example rf_scan`

use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation};

fn main() {
    let device = devices::sparc();
    let dt: f64 = std::env::var("DT").ok().and_then(|v| v.parse().ok()).unwrap_or(0.004);

    println!("RF2    | mean Q  P_fus   Te0    fGW   betaN | QCE at   dropouts");
    for &rf2 in &[13.0f64, 15.0, 17.0, 19.0, 21.0] {
        let mut prog = PulseProgram::standard_hmode(&device);
        let duration = prog.duration;
        // Replace the second-level ICRF power (all points at 17.0)
        for p in prog.p_ich.iter_mut() {
            if (p.1 - 17.0).abs() < 1e-9 {
                p.1 = rf2;
            }
        }
        let mut sim = Simulation::new(device.clone(), prog);
        sim.start();

        let (t0, t1) = (duration * 0.47, duration * 0.58);
        let (mut sq, mut spf, mut ste, mut sfgw, mut sbn, mut n) = (0.0, 0.0, 0.0, 0.0, 0.0, 0u32);
        let mut t_qce = f64::NAN;
        let mut dropouts = 0u32;
        let mut was_qce = false;
        let mut t = 0.0;
        let mut disrupted = false;
        while t < duration {
            let s = sim.step(dt);
            if s.time <= t {
                break; // halted
            }
            t = s.time;
            if s.disrupted {
                disrupted = true;
                break;
            }
            let qce = s.in_hmode && s.elm_suppressed;
            if qce && t_qce.is_nan() {
                t_qce = t;
            }
            if was_qce && !qce && t < duration * 0.60 {
                dropouts += 1;
            }
            was_qce = qce;
            if t >= t0 && t <= t1 {
                let p_fus = s.p_alpha * (17.6 / 3.5);
                let p_ext = (s.p_input - s.p_alpha).max(0.01);
                sq += p_fus / p_ext;
                spf += p_fus;
                ste += s.te_profile[0];
                sfgw += s.f_greenwald;
                sbn += s.beta_n;
                n += 1;
            }
        }
        if n == 0 {
            println!("{:4.1} MW| {}", rf2, if disrupted { "DISRUPTED" } else { "no data" });
            continue;
        }
        let nf = n as f64;
        println!(
            "{:4.1} MW| {:5.2}  {:5.1}  {:5.1}  {:5.3}  {:4.2} | {:5.2}s  {:2}{}",
            rf2, sq / nf, spf / nf, ste / nf, sfgw / nf, sbn / nf, t_qce, dropouts,
            if disrupted { "  DISRUPTED" } else { "" }
        );
    }
}
