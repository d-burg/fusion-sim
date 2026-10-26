//! Scan of the Ohmic drive through every preset on every device.
//!   cargo run -p tok-sym-core --example drive_scan [device] [preset] [duration_scale]
use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation, SimulationStatus};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let only_dev = args.get(1).cloned();
    let only_preset = args.get(2).cloned();
    let scale: f64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1.0);
    for dev_id in ["diiid", "jet", "iter", "centaur"] {
        if let Some(d) = &only_dev { if d != dev_id { continue; } }
        for preset in ["hmode", "lmode", "density_limit"] {
            if let Some(p) = &only_preset { if p != preset { continue; } }
            let device = devices::get_device(dev_id).unwrap();
            let mut prog = match preset {
                "hmode" => PulseProgram::standard_hmode(&device),
                "lmode" => PulseProgram::lmode(&device),
                _ => PulseProgram::density_limit(&device),
            };
            if (scale - 1.0).abs() > 1e-9 {
                let k = scale;
                for wf in [&mut prog.ip, &mut prog.bt, &mut prog.ne_target, &mut prog.p_nbi, &mut prog.p_ech, &mut prog.p_ich, &mut prog.kappa, &mut prog.delta, &mut prog.d2_puff, &mut prog.neon_puff, &mut prog.n2_puff, &mut prog.argon_puff] {
                    for p in wf.iter_mut() { p.0 *= k; }
                }
                prog.duration *= k;
            }
            if let Some(ar) = std::env::var("ARGON").ok().and_then(|v| v.parse::<f64>().ok()) {
                prog.argon_puff = vec![(0.0, 0.0), (2.5, 0.0), (3.0, ar), (prog.duration, ar)];
            }
            let budget = device.flux_swing_vs;
            let mut sim = Simulation::new(device, prog);
            if let Some(seed) = std::env::var("SEED").ok().and_then(|v| v.parse().ok()) { sim.seed_disruption(seed); } else { sim.seed_disruption(7); }
            sim.start();
            let dt: f64 = std::env::var("DT").ok().and_then(|v| v.parse().ok()).unwrap_or(0.005);
            println!("=== {dev_id} {preset} (budget {budget:.1} Vs, duration {:.1} s)", sim.program.duration);
            println!("{:>7} {:>7} {:>7} {:>7} {:>7} {:>7} {:>6} {:>6} {:>6} {:>6} {:>6} {:>5}",
                "t", "Ip_prog", "Ip", "Vloop", "Psi", "%", "P_oh", "Te0", "Ibs", "Icd", "li", "flags");
            let mut next_print = 0.0;
            let mut max_err = 0.0f64;
            let mut max_v = 0.0f64;
            let mut flat_v = Vec::new();
            let mut max_poh = 0.0f64;
            let mut peak_flux = 0.0f64;
            let ip_peak = sim.program.ip.iter().map(|p| p.1).fold(0.0, f64::max);
            let wall = std::time::Instant::now();
            loop {
                let s = sim.step(dt);
                if std::env::var("TRACE").is_ok() && (s.time * 1000.0).round() as i64 % 100 == 0 {
                    eprintln!("t={:.3} ip={:.4} v={:.3} te0={:.4} ne={:.4} w={:.4} psi={:.3} ph={:?} wall={:.1}s", s.time, s.ip, s.v_loop, s.te0, s.ne_bar, s.w_th, s.flux_consumed, s.disruption_phase, wall.elapsed().as_secs_f64());
                }
                if s.time >= next_print {
                    println!("{:7.2} {:7.3} {:7.3} {:7.2} {:7.1} {:6.0}% {:6.2} {:6.2} {:6.2} {:6.2} {:6.2} {}{}{}",
                        s.time, s.prog_ip, s.ip, s.v_loop, s.flux_consumed, 100.0 * s.flux_consumed / s.flux_budget,
                        s.p_ohmic, s.te0, s.i_bootstrap, s.i_cd, s.li,
                        if s.oh_saturated { "S" } else { "" }, if s.flux_exhausted { "X" } else { "" },
                        if s.disrupted { "D" } else { "" });
                    next_print += (sim.program.duration / 20.0).max(0.25);
                }
                if !s.disrupted {
                    max_v = max_v.max(s.v_loop.abs());
                    max_poh = max_poh.max(s.p_ohmic);
                    peak_flux = peak_flux.max(s.flux_consumed);
                    if s.prog_ip >= 0.98 * ip_peak {
                        max_err = max_err.max((s.ip - s.prog_ip).abs() / ip_peak);
                        flat_v.push(s.v_loop);
                    }
                }
                if s.status == SimulationStatus::Complete || s.status == SimulationStatus::Disrupted {
                    println!("end: {:?} at {:.2} s", s.status, s.time);
                    break;
                }
            }
            let flat_mean = if flat_v.is_empty() { f64::NAN } else { flat_v.iter().sum::<f64>() / flat_v.len() as f64 };
            println!("summary: max |Ip-Ip_prog|/peak in flat-top {:.1} %, flat-top <V_loop> {:.3} V, max |V| {:.1} V, peak flux {:.1} Vs = {:.0} % of budget, max P_oh {:.2} MW\n",
                100.0 * max_err, flat_mean, max_v, peak_flux, 100.0 * peak_flux / budget, max_poh);
        }
    }
}
