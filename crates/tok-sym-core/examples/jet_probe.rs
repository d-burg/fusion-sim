//! Headless probe for a disrupting standard pulse: prints the risk trajectory
//! leading into the disruption so a stochastic risk trigger can be told apart
//! from a forced wall-contact disruption (risk stays negligible).
//!
//!   cargo run --release --example jet_probe -- [device-id]
use std::collections::VecDeque;

use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation, SimulationStatus};

fn main() {
    let id = std::env::args().nth(1).unwrap_or_else(|| "jet".into());
    let device = devices::all_devices()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap_or_else(|| panic!("unknown device {id}"));
    let program = PulseProgram::standard_hmode(&device);
    let duration = program.duration;
    let mut sim = Simulation::new(device, program);
    sim.start();

    let dt = 0.002;
    let mut recent: VecDeque<String> = VecDeque::new();
    let n_steps = (duration / dt) as usize + 10;
    for step in 0..n_steps {
        let snap = sim.step(dt);
        if step % 25 == 0 {
            recent.push_back(format!(
                "t={:6.3} ip={:5.2} risk={:.4}/s f_gw={:.2} beta_n={:.2} prad/pin={:.2} cfg={} limited={}",
                snap.time,
                snap.ip,
                snap.disruption_risk,
                snap.f_greenwald,
                snap.beta_n,
                if snap.p_loss > 0.0 { snap.p_rad / snap.p_loss } else { 0.0 },
                snap.magnetic_config,
                snap.is_limited
            ));
            if recent.len() > 30 {
                recent.pop_front();
            }
        }
        if snap.disrupted || snap.status == SimulationStatus::Disrupted {
            println!("DISRUPTED at t={:.3}s  (snapshot.disrupted flag first seen)", snap.time);
            for l in &recent {
                println!("  {l}");
            }
            return;
        }
        if snap.status == SimulationStatus::Complete {
            println!("completed cleanly at t={:.2}s", snap.time);
            return;
        }
    }
}
