//! Run a standard pulse headless and report the LIVE equilibrium's a_param
//! and physical strike points at flat-top — the site renders exactly this
//! equilibrium, so this is the ground truth the offline fit harness (fixed
//! a_param = -0.05) approximates.
//!
//!   cargo run --release --example live_strikes -- <device-id>

use tok_sym_core::contour;
use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation};

type Pt = (f64, f64);

fn strikes(sepx: &contour::Contour, wall: &[Pt], z0: f64, z_abs_min: f64) -> Vec<Pt> {
    const JUMP: f64 = 0.15;
    let mut clipped = sepx.clone();
    contour::clip_separatrix_to_wall(&mut clipped, wall, 0.005);
    let pts = &clipped.points;
    if pts.len() < 2 {
        return Vec::new();
    }
    let mut ends: Vec<Pt> = Vec::new();
    let mut start = 0usize;
    for i in 1..pts.len() {
        if (pts[i].0 - pts[i - 1].0).hypot(pts[i].1 - pts[i - 1].1) > JUMP {
            ends.push(pts[start]);
            ends.push(pts[i - 1]);
            start = i;
        }
    }
    ends.push(pts[start]);
    ends.push(pts[pts.len() - 1]);
    ends.into_iter()
        .filter(|e| (e.1 - z0).abs() >= z_abs_min)
        .collect()
}

fn main() {
    let id = std::env::args().nth(1).unwrap_or_else(|| "centaur".into());
    let device = devices::all_devices()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap_or_else(|| panic!("unknown device {id}"));
    let wall = device.wall_outline.clone();
    let z0 = device.z0;

    let program = PulseProgram::standard_hmode(&device);
    let duration = program.duration;
    let mut sim = Simulation::new(device, program);
    sim.start();

    let dt = 0.002;
    let n_steps = (duration / dt) as usize + 10;
    let mut reported = 0;
    for step in 0..n_steps {
        let snap = sim.step(dt);
        if step % 50 == 0 && snap.time < 1.2 {
            println!(
                "  t={:5.2}s ip={:5.2} delta={:+.3} kappa={:.3} status={:?}",
                snap.time, snap.ip, sim.equilibrium().shape.delta,
                sim.equilibrium().shape.kappa, snap.status
            );
        }
        // Sample a few flat-top instants.
        if step % 2000 == 0 && snap.time > 0.3 * duration && snap.time < 0.8 * duration {
            let eq = sim.equilibrium();
            let (mut r_lo, mut r_hi, mut z_lo, mut z_hi) = eq.grid_bounds();
            for &(r, z) in &wall {
                r_lo = r_lo.min(r - 0.05);
                r_hi = r_hi.max(r + 0.05);
                z_lo = z_lo.min(z - 0.05);
                z_hi = z_hi.max(z + 0.05);
            }
            let sepx =
                contour::extract_separatrix(eq, 401, 401, Some((r_lo, r_hi, z_lo, z_hi)));
            let hits = strikes(&sepx, &wall, z0, 1.0);
            let hs: Vec<String> = hits
                .iter()
                .map(|h| format!("({:.3},{:+.3})", h.0, h.1))
                .collect();
            println!(
                "t={:6.2}s  A={:+.3}  kappa={:.3} delta={:+.3}  strikes: {}",
                snap.time,
                eq.a_param,
                eq.shape.kappa,
                eq.shape.delta,
                hs.join(" ")
            );
            reported += 1;
        }
        if reported >= 6 {
            break;
        }
        if matches!(
            snap.status,
            tok_sym_core::simulation::SimulationStatus::Disrupted
                | tok_sym_core::simulation::SimulationStatus::Complete
        ) {
            println!("pulse ended at t={:.2}s with {:?}", snap.time, snap.status);
            break;
        }
    }
}
