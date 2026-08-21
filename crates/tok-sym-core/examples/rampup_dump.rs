//! Dump the live separatrix at a set of ramp-up instants as JSON, for plotting
//! how the equilibrium evolves from breakdown to flat-top exactly as the
//! frontend sees it (same snapshot fields the equilibrium panel draws).
//!
//!   cargo run --release --example rampup_dump -- <device-id> <t1,t2,...> > out.json
use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation};

fn main() {
    let id = std::env::args().nth(1).unwrap_or_else(|| "diiid".into());
    let times: Vec<f64> = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "0.05,0.15,0.25,0.4,0.6,0.9,1.3,2.0".into())
        .split(',')
        .map(|s| s.trim().parse().expect("bad time"))
        .collect();
    let device = devices::all_devices()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap_or_else(|| panic!("unknown device {id}"));
    let wall = device.wall_outline.clone();
    let program = PulseProgram::standard_hmode(&device);
    let mut sim = Simulation::new(device, program);
    sim.start();

    let dt = 0.002;
    let mut frames = Vec::new();
    let mut next = 0;
    let mut t = 0.0;
    while next < times.len() {
        let snap = sim.step(dt);
        t += dt;
        if t + 1e-9 >= times[next] {
            let eq = sim.equilibrium();
            frames.push(serde_json::json!({
                "t": snap.time,
                "ip": snap.ip,
                "limited": snap.is_limited,
                "config": snap.magnetic_config,
                "axis": [snap.axis_r, snap.axis_z],
                "xpoint": [snap.xpoint_r, snap.xpoint_z],
                "r0": eq.r0,
                "shape": {
                    "epsilon": eq.shape.epsilon,
                    "kappa": eq.shape.kappa,
                    "delta": eq.shape.delta,
                    "delta_upper": eq.shape.delta_upper,
                    "squareness": eq.shape.squareness,
                },
                "separatrix": snap.separatrix.points,
            }));
            next += 1;
        }
    }
    let out = serde_json::json!({ "device": id, "wall": wall, "frames": frames });
    println!("{}", serde_json::to_string(&out).unwrap());
}
