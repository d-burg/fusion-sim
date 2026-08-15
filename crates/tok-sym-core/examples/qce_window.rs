//! Print the QCE (elm_suppressed) intervals for the nominal SPARC preset and
//! the held-25-MW variant, to diagnose the extra-power test comparison.
//!
//! Run with: `cargo run --release --example qce_window`

use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation};

fn run(label: &str, hold25: bool) -> f64 {
    let device = devices::sparc();
    let mut prog = PulseProgram::standard_hmode(&device);
    if hold25 {
        for p in prog.p_ich.iter_mut() {
            if p.1 > 0.0 {
                p.1 = 25.0;
            }
        }
    }
    let duration = prog.duration;
    let mut sim = Simulation::new(device, prog);
    sim.start();
    let dt = 0.005;
    let mut t = 0.0;
    let mut qce_time = 0.0;
    let mut hmode_time = 0.0;
    let mut in_int = false;
    let mut int_start = 0.0;
    let mut intervals: Vec<(f64, f64)> = Vec::new();
    for _ in 0..((duration / dt) as usize + 100) {
        let s = sim.step(dt);
        if s.time >= duration || s.disrupted {
            break;
        }
        t = s.time;
        if s.in_hmode {
            hmode_time += dt;
        }
        if s.elm_suppressed {
            qce_time += dt;
            if !in_int {
                in_int = true;
                int_start = t;
            }
        } else if in_int {
            in_int = false;
            intervals.push((int_start, t));
        }
    }
    if in_int {
        intervals.push((int_start, t));
    }
    // Merge tiny gaps for readability
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for iv in intervals {
        if let Some(last) = merged.last_mut() {
            if iv.0 - last.1 < 0.05 {
                last.1 = iv.1;
                continue;
            }
        }
        merged.push(iv);
    }
    println!("{label}: qce_time={qce_time:.2}s hmode_time={hmode_time:.2}s");
    for (a, b) in &merged {
        println!("    QCE {a:.2} → {b:.2}  ({:.2}s)", b - a);
    }
    qce_time
}

fn main() {
    let nom = run("nominal      ", false);
    let ext = run("held 25 MW   ", true);
    println!("\nnominal {nom:.2}s vs extra {ext:.2}s → extra {} nominal", if ext < nom { "<" } else { ">=" });
}
