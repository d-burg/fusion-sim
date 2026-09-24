//! Headless probe: does a magnetic-configuration override actually change the
//! solved equilibrium?  Runs the DIII-D standard pulse under each override and
//! reports the X-points and where the wall-clipped separatrix legs land at
//! flat-top.
//!
//!   cargo run --release --example config_probe
use tok_sym_core::contour;
use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation};

fn main() {
    for cfg in ["LowerSingleNull", "DoubleNull", "UpperSingleNull"] {
        let device = devices::all_devices()
            .into_iter()
            .find(|d| d.id == "diiid")
            .unwrap();
        let wall = device.wall_outline.clone();
        let mut program = PulseProgram::standard_hmode(&device);
        program.config_override = Some(cfg.to_string());
        let duration = program.duration;
        let mut sim = Simulation::new(device, program);
        sim.start();
        let dt = 0.002;
        let mut snap = sim.step(dt);
        while snap.time < 0.5 * duration {
            snap = sim.step(dt);
        }
        let eq = sim.equilibrium();
        let (lo, hi) = eq.x_points_physical();
        // Same extraction the live snapshot uses: wall-extended bounds, then
        // clipped at first wall impact.
        let (mut r_lo, mut r_hi, mut z_lo, mut z_hi) = eq.grid_bounds();
        for &(r, z) in &wall {
            r_lo = r_lo.min(r - 0.05);
            r_hi = r_hi.max(r + 0.05);
            z_lo = z_lo.min(z - 0.05);
            z_hi = z_hi.max(z + 0.05);
        }
        let mut sep = contour::extract_separatrix(eq, 201, 201, Some((r_lo, r_hi, z_lo, z_hi)));
        contour::clip_separatrix_to_wall(&mut sep, &wall, 0.003);
        let zmin = sep.points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        let zmax = sep.points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
        let below = sep.points.iter().filter(|p| p.1 < -1.05).count();
        let above = sep.points.iter().filter(|p| p.1 > 1.05).count();
        println!(
            "{cfg:16} snapshot cfg={:<15} x_lower={:?} x_upper={:?} clipped sep z in [{zmin:+.3},{zmax:+.3}]  leg pts below/above: {below}/{above}",
            snap.magnetic_config,
            lo.map(|p| (fmt(p.0), fmt(p.1))),
            hi.map(|p| (fmt(p.0), fmt(p.1))),
        );
        println!(
            "{:16} snapshot xpoint=({:.3},{:+.3}) xpoint_upper=({:.3},{:+.3})",
            "",
            snap.xpoint_r, snap.xpoint_z, snap.xpoint_upper_r, snap.xpoint_upper_z
        );
    }
}

fn fmt(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}
