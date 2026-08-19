//! Strike-point dwell probe for the SPARC 1 Hz sweep.
//!
//! Runs the live SPARC QCE pulse to mid flat-top, then samples one full
//! sweep period, extracting the upper inner/outer strike points from the
//! snapshot separatrix (already wall-clipped) and mapping them to an arc
//! coordinate along the divertor target faces. Prints per-sample positions
//! and a dwell histogram, so the sweep waveform can be shaped for uniform
//! time-per-target-segment.
//!
//! Run with: `cargo run --release --example sweep_dwell`

use tok_sym_core::devices;
use tok_sym_core::simulation::{PulseProgram, Simulation};

type Pt = (f64, f64);

fn inside(poly: &[Pt], r: f64, z: f64) -> bool {
    let mut c = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        if ((yi > z) != (yj > z)) && r < (xj - xi) * (z - yi) / (yj - yi) + xi {
            c = !c;
        }
        j = i;
    }
    c
}

/// Outer target polyline: channel entrance → outermost extent of the roof
/// diagonal. Arc coordinate 0 at the entrance, increasing outboard/deeper.
const OUTER_ARC: [Pt; 3] = [(1.4795, 1.1781), (1.7462, 1.5152), (1.8193, 1.5992)];
/// Inner slot: entrance → back of the slot (upper face).
const INNER_ARC: [Pt; 2] = [(1.4656, 1.1786), (1.2850, 1.2332)];

/// Arc-length position of the projection of `p` onto the polyline, in mm.
fn arc_pos(polyline: &[Pt], p: Pt) -> f64 {
    let mut best = (f64::MAX, 0.0);
    let mut acc = 0.0;
    for w in polyline.windows(2) {
        let (a, b) = (w[0], w[1]);
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let l = (dx * dx + dy * dy).sqrt();
        let t = if l > 0.0 {
            (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / (l * l)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let d = ((p.0 - a.0 - t * dx).powi(2) + (p.1 - a.1 - t * dy).powi(2)).sqrt();
        if d < best.0 {
            best = (d, acc + t * l);
        }
        acc += l;
    }
    best.1 * 1000.0
}

fn main() {
    let device = devices::sparc();
    let wall: Vec<Pt> = device.wall_outline.clone();
    let prog = PulseProgram::standard_hmode(&device);
    let duration = prog.duration;
    let mut sim = Simulation::new(device.clone(), prog);
    sim.start();
    let dt: f64 = std::env::var("DT").ok().and_then(|v| v.parse().ok()).unwrap_or(0.002);
    let t0: f64 = std::env::var("T0").ok().and_then(|v| v.parse().ok()).unwrap_or(12.0);
    let t1: f64 = std::env::var("T1").ok().and_then(|v| v.parse().ok()).unwrap_or(t0 + 1.0);

    let mut t = 0.0;
    while t < t0 {
        t = sim.step(dt).time;
    }

    println!("  t      u     | outer hit          arc_mm | inner hit          arc_mm");
    let mut outer_samples: Vec<(f64, f64)> = Vec::new(); // (u, arc_mm)
    let mut inner_samples: Vec<(f64, f64)> = Vec::new();
    let mut outer_hist = [0u32; 20]; // 25 mm bins along OUTER_ARC
    let mut inner_hist = [0u32; 20];
    let mut n_print = 0usize;
    while t < t1.min(duration) {
        let s = sim.step(dt);
        t = s.time;
        let (xr, xz) = (s.xpoint_upper_r, s.xpoint_upper_z);
        if xr <= 0.0 {
            continue;
        }
        // Must mirror the waveform in Simulation::step
        let frac = (device.strike_sweep_hz * t).fract();
        let v = 1.0 - (2.0 * frac - 1.0).abs();
        let u = v * v * v;

        // Wall crossings among upper-half separatrix segments
        let mut outer_hit: Option<Pt> = None;
        let mut inner_hit: Option<Pt> = None;
        for w in s.separatrix.points.windows(2) {
            let (r0, z0) = w[0];
            let (r1, z1) = w[1];
            if z0 > xz - 0.02 && z1 > xz - 0.02 {
                let seg_jump = ((r1 - r0).powi(2) + (z1 - z0).powi(2)).sqrt();
                if seg_jump > 0.10 {
                    continue; // clip cut-gap, not a real segment
                }
                let in0 = inside(&wall, r0, z0);
                let in1 = inside(&wall, r1, z1);
                if in0 != in1 {
                    let hit = ((r0 + r1) / 2.0, (z0 + z1) / 2.0);
                    if hit.0 < xr {
                        inner_hit = Some(hit);
                    } else {
                        outer_hit = Some(hit);
                    }
                }
            }
        }

        if let Some(h) = outer_hit {
            let a = arc_pos(&OUTER_ARC, h);
            outer_samples.push((u, a));
            let bin = ((a / 25.0) as usize).min(19);
            outer_hist[bin] += 1;
            if let Some(hi) = inner_hit {
                let ai = arc_pos(&INNER_ARC, hi);
                inner_samples.push((u, ai));
                inner_hist[((ai / 25.0) as usize).min(19)] += 1;
                if n_print % 25 == 0 {
                    println!(
                        "{:6.3}  {:.3} | ({:.4},{:.4})  {:6.1} | ({:.4},{:.4})  {:6.1}",
                        t, u, h.0, h.1, a, hi.0, hi.1, ai
                    );
                }
                n_print += 1;
            }
        }
    }

    let tot_o: u32 = outer_hist.iter().sum();
    let tot_i: u32 = inner_hist.iter().sum();
    println!("\nOuter dwell histogram (25 mm bins along entrance→back, {} samples):", tot_o);
    for (i, &c) in outer_hist.iter().enumerate() {
        if c > 0 {
            println!(
                "  {:4}-{:4} mm: {:5.1}%  {}",
                i * 25,
                (i + 1) * 25,
                100.0 * c as f64 / tot_o as f64,
                "#".repeat((60 * c / tot_o.max(1)) as usize)
            );
        }
    }
    println!("\nInner dwell histogram (25 mm bins along entrance→back, {} samples):", tot_i);
    for (i, &c) in inner_hist.iter().enumerate() {
        if c > 0 {
            println!(
                "  {:4}-{:4} mm: {:5.1}%  {}",
                i * 25,
                (i + 1) * 25,
                100.0 * c as f64 / tot_i as f64,
                "#".repeat((60 * c / tot_i.max(1)) as usize)
            );
        }
    }

    // u → arc mapping (median arc per u decile) for waveform design
    println!("\nOuter u→arc mapping (u deciles):");
    for d in 0..10 {
        let lo = d as f64 / 10.0;
        let hi = lo + 0.1;
        let mut v: Vec<f64> = outer_samples
            .iter()
            .filter(|(u, _)| *u >= lo && *u < hi)
            .map(|(_, a)| *a)
            .collect();
        if v.is_empty() {
            continue;
        }
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("  u {:.1}-{:.1}: arc {:6.1} mm (n={})", lo, hi, v[v.len() / 2], v.len());
    }
    println!("\nInner u→arc mapping (u deciles):");
    for d in 0..10 {
        let lo = d as f64 / 10.0;
        let hi = lo + 0.1;
        let mut v: Vec<f64> = inner_samples
            .iter()
            .filter(|(u, _)| *u >= lo && *u < hi)
            .map(|(_, a)| *a)
            .collect();
        if v.is_empty() {
            continue;
        }
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("  u {:.1}-{:.1}: arc {:6.1} mm (n={})", lo, hi, v[v.len() / 2], v.len());
    }
}
