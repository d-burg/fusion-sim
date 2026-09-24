//! Headless probe for a disrupting standard pulse: prints the risk trajectory
//! leading into the disruption so a stochastic risk trigger can be told apart
//! from a forced wall-contact disruption (risk stays negligible, or the pulse
//! is in ramp-down where the risk trigger is suppressed).
//!
//!   cargo run --release --example jet_probe -- [device-id] [seed|scan] [t_target]
//!
//! With `scan`, tries successive large seeds until a pulse survives past
//! `t_target` (default: the whole pulse) and prints the seed that did.
use std::collections::VecDeque;

use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation, SimulationStatus};

fn run(id: &str, seed: Option<u64>, verbose: bool) -> (f64, SimulationStatus) {
    let device = devices::all_devices()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap_or_else(|| panic!("unknown device {id}"));
    let program = PulseProgram::standard_hmode(&device);
    let duration = program.duration;
    let mut sim = Simulation::new(device, program);
    if let Some(s) = seed {
        sim.seed_disruption(s);
    }
    sim.start();

    let dt = 0.002;
    let mut recent: VecDeque<String> = VecDeque::new();
    let n_steps = (duration / dt) as usize + 10;
    let mut last_t = 0.0;
    for step in 0..n_steps {
        let snap = sim.step(dt);
        last_t = snap.time;
        if verbose && step % 25 == 0 {
            recent.push_back(format!(
                "t={:7.3} ip={:6.2} risk={:.4}/s f_gw={:.2} beta_n={:.2} prad/pin={:.2} cfg={} limited={}",
                snap.time,
                snap.ip,
                snap.disruption_risk,
                snap.f_greenwald,
                snap.beta_n,
                if snap.p_loss > 0.0 { snap.p_rad / snap.p_loss } else { 0.0 },
                snap.magnetic_config,
                snap.is_limited
            ));
            if recent.len() > 24 {
                recent.pop_front();
            }
        }
        if snap.disrupted || snap.status == SimulationStatus::Disrupted {
            if verbose {
                println!("DISRUPTED at t={:.3}s  (snapshot.disrupted flag first seen)", snap.time);
                for l in &recent {
                    println!("  {l}");
                }
            }
            return (snap.time, SimulationStatus::Disrupted);
        }
        if snap.status == SimulationStatus::Complete {
            if verbose {
                println!("completed cleanly at t={:.2}s", snap.time);
            }
            return (snap.time, SimulationStatus::Complete);
        }
    }
    (last_t, SimulationStatus::Complete)
}

fn main() {
    let id = std::env::args().nth(1).unwrap_or_else(|| "jet".into());
    let seed_arg = std::env::args().nth(2);
    let t_target: Option<f64> = std::env::args().nth(3).map(|s| s.parse().expect("bad t_target"));

    match seed_arg.as_deref() {
        Some("scan") => {
            // Large, well-mixed seeds: the xorshift state needs non-trivial bits
            // or its first draws are tiny and trip the risk check at breakdown.
            for k in 1..=40u64 {
                let seed = 0x9E37_79B9_7F4A_7C15u64.wrapping_mul(k) | 1;
                let (t, status) = run(&id, Some(seed), false);
                let ok = match t_target {
                    Some(tt) => t >= tt,
                    None => status == SimulationStatus::Complete,
                };
                println!("seed {seed:>20}  ended t={t:7.2}s {status:?}{}", if ok { "  <-- OK" } else { "" });
                if ok {
                    return;
                }
            }
            println!("no surviving seed found in 40 tries");
        }
        Some(s) => {
            run(&id, Some(s.parse().expect("bad seed")), true);
        }
        None => {
            run(&id, None, true);
        }
    }
}
