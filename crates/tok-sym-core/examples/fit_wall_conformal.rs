//! Fit a device's equilibrium-only shaping knobs so the SOLVED last closed
//! flux surface hugs the first wall.
//!
//! Objective (per the tuning paradigm): the LCFS should follow the limiter
//! contour — a uniform gap all the way round — and sit as close to it as
//! possible, while the divertor legs still strike inside the divertor rather
//! than on main-chamber wall.
//!
//! Concretely, over the bulk boundary (between the X-points):
//!
//!     J = mean(gap) + W_SPREAD · stdev(gap)
//!
//! minimised subject to hard constraints:
//!   • no boundary point outside the wall,
//!   • min(gap) ≥ the device's clearance floor,
//!   • every leg that reaches the wall strikes inside the divertor region.
//!
//! `mean(gap)` pulls the boundary out toward the wall; `stdev(gap)` is the
//! conformality term — it is what stops the fit from buying a small mean by
//! pressing one sector against the wall while another sags far inside.
//!
//! Only equilibrium-only knobs are searched (a_scale, kappa_scale, r0_shift,
//! squareness). Greenwald density, volume, surface area and every transport
//! scaling use the published a/R0/kappa_areal and are untouched, so nothing
//! here moves the physics audit.
//!
//! Run with: `cargo run --release --example fit_wall_conformal -- <device-id>`

use tok_sym_core::contour;
use tok_sym_core::devices::{self, Device};
use tok_sym_core::equilibrium::{CerfonEquilibrium, ShapeParams};

type Pt = (f64, f64);

/// Weight on the gap spread relative to the mean gap. 1.0 would treat a 1 mm
/// increase in spread as exactly as bad as 1 mm of extra mean gap; 2.0 leans
/// toward conformality, which is the stated priority ("nearly match the
/// limiter shape" first, "as close as possible" second).
const W_SPREAD: f64 = 2.0;

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

fn dist_to_poly(poly: &[Pt], r: f64, z: f64) -> f64 {
    let mut best = f64::MAX;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (x0, y0) = poly[j];
        let (x1, y1) = poly[i];
        let (dx, dy) = (x1 - x0, y1 - y0);
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 {
            (((r - x0) * dx + (z - y0) * dy) / l2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        best = best.min(((r - x0 - t * dx).powi(2) + (z - y0 - t * dy).powi(2)).sqrt());
        j = i;
    }
    best
}

/// Per-device fit configuration.
struct FitSpec {
    /// Hard floor on the minimum bulk gap (mm). Below this the candidate is
    /// rejected outright — it is not a soft penalty.
    clearance_floor_mm: f64,
    /// Is a wall crossing at this point an acceptable strike location, i.e.
    /// is it inside the divertor rather than on main-chamber wall?
    strike_ok: fn(Pt) -> bool,
    /// Whether the device's wall model actually has a divertor to strike.
    /// When false the strike constraint is skipped and the fit is reported
    /// as conformal-only (see the ITER note in the accompanying report).
    has_divertor: bool,
}

/// CENTAUR: the published limiter has a V-slot divertor pocket at each end,
/// bounded by the faces (2.178, ±1.293)–(2.283, ±1.560)–(2.463, ±1.375).
/// The main chamber turns over at |Z| ≈ 1.20, so the slot is the only place
/// a leg should terminate.
fn centaur_strike_ok(p: Pt) -> bool {
    let z = p.1.abs();
    z > 1.28 && (2.15..2.50).contains(&p.0)
}

/// SPARC: the published slot faces — inner wedge and the outboard channel's
/// roof diagonal. Mirrors the target definition in `fit_sparc_shape.rs`.
fn sparc_strike_ok(p: Pt) -> bool {
    let z = p.1.abs();
    let inner = p.0 < 1.52 && (1.05..1.30).contains(&z);
    let outer = p.0 >= 1.52 && (1.10..1.62).contains(&z);
    inner || outer
}

/// ITER: lower single null. The published limiter carries the divertor
/// cassette below Z ≈ -3.3 — inner vertical target near R = 4.1–4.6, dome
/// across R = 4.6–5.2, outer vertical target near R = 5.2–5.7. A leg landing
/// on the dome is not an acceptable strike.
fn iter_strike_ok(p: Pt) -> bool {
    if p.1 > -3.3 {
        return false;
    }
    (4.10..4.60).contains(&p.0) || (5.20..5.70).contains(&p.0)
}

fn spec_for(id: &str) -> FitSpec {
    match id {
        "centaur" => FitSpec {
            clearance_floor_mm: 15.0,
            strike_ok: centaur_strike_ok,
            has_divertor: true,
        },
        "sparc" => FitSpec {
            clearance_floor_mm: 8.0,
            strike_ok: sparc_strike_ok,
            has_divertor: true,
        },
        "iter" => FitSpec {
            clearance_floor_mm: 20.0,
            strike_ok: iter_strike_ok,
            has_divertor: true,
        },
        _ => FitSpec {
            clearance_floor_mm: 15.0,
            strike_ok: |_| true,
            has_divertor: false,
        },
    }
}

struct Score {
    mean_gap_mm: f64,
    std_gap_mm: f64,
    min_gap_mm: f64,
    max_gap_mm: f64,
    n_outside: usize,
    n_strikes: usize,
    n_bad_strikes: usize,
    objective: f64,
}

fn evaluate(
    device: &Device,
    wall: &[Pt],
    spec: &FitSpec,
    shape: &ShapeParams,
    r0: f64,
) -> Option<Score> {
    let eq = CerfonEquilibrium::solve(shape, r0, device.z0)?;

    // Extraction grid covering the whole vessel, so legs are captured too.
    let (mut r_lo, mut r_hi, mut z_lo, mut z_hi) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for &(r, z) in wall {
        r_lo = r_lo.min(r - 0.05);
        r_hi = r_hi.max(r + 0.05);
        z_lo = z_lo.min(z - 0.05);
        z_hi = z_hi.max(z + 0.05);
    }
    let sep = contour::extract_separatrix(&eq, 220, 320, Some((r_lo, r_hi, z_lo, z_hi)));
    if sep.points.len() < 60 {
        return None;
    }

    // X-point height splits "bulk boundary" from "divertor legs".
    let z_xpt = device.z0 + r0 * 1.01 * shape.epsilon * shape.kappa;
    let bulk_cut = (z_xpt - device.z0).abs() * 0.95;

    let mut gaps: Vec<f64> = Vec::new();
    let mut n_outside = 0usize;
    let mut n_strikes = 0usize;
    let mut n_bad_strikes = 0usize;

    for w in sep.points.windows(2) {
        let (r0p, z0p) = w[0];
        let (r1p, z1p) = w[1];
        let in_bulk = (z0p - device.z0).abs() < bulk_cut;

        if in_bulk {
            if inside(wall, r0p, z0p) {
                gaps.push(dist_to_poly(wall, r0p, z0p) * 1000.0);
            } else {
                n_outside += 1;
            }
        } else if spec.has_divertor {
            // Leg region: look for wall crossings and check where they land.
            let a_in = inside(wall, r0p, z0p);
            let b_in = inside(wall, r1p, z1p);
            if a_in != b_in {
                let hit = ((r0p + r1p) / 2.0, (z0p + z1p) / 2.0);
                n_strikes += 1;
                if !(spec.strike_ok)(hit) {
                    n_bad_strikes += 1;
                }
            }
        }
    }

    if gaps.len() < 20 {
        return None;
    }
    let mean = gaps.iter().sum::<f64>() / gaps.len() as f64;
    let var = gaps.iter().map(|g| (g - mean).powi(2)).sum::<f64>() / gaps.len() as f64;
    let std = var.sqrt();
    let min = gaps.iter().cloned().fold(f64::MAX, f64::min);
    let max = gaps.iter().cloned().fold(f64::MIN, f64::max);

    Some(Score {
        mean_gap_mm: mean,
        std_gap_mm: std,
        min_gap_mm: min,
        max_gap_mm: max,
        n_outside,
        n_strikes,
        n_bad_strikes,
        objective: mean + W_SPREAD * std,
    })
}

fn main() {
    let id = std::env::args().nth(1).unwrap_or_else(|| "centaur".into());
    let device = devices::all_devices()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap_or_else(|| panic!("unknown device id {id}"));
    let spec = spec_for(&device.id);
    // `wall_outline` is now the published limiter the front end renders.
    let wall = device.wall_outline.clone();

    let eps0 = device.a / device.r0;
    let delta = device.delta_lower;

    if !spec.has_divertor {
        eprintln!(
            "NOTE: {} has no divertor in its wall model — the strike-point \
             constraint is inactive and this fit is conformal-only.",
            device.name
        );
    }

    println!(
        "{} — floor {:.0} mm, objective = mean + {:.1}*stdev of the bulk gap",
        device.name, spec.clearance_floor_mm, W_SPREAD
    );
    println!(
        "{:>7} {:>7} {:>7} {:>7} | {:>7} {:>7} {:>7} {:>7} | {:>6} {:>6} | {:>8}",
        "a_scl", "k_scl", "r0_sh", "sq", "mean", "stdev", "min", "max", "strk", "bad", "J"
    );

    let mut best: Option<(f64, String, [f64; 4])> = None;

    for &a_scale in &[0.86, 0.90, 0.94, 0.98, 1.02, 1.06, 1.10, 1.14] {
        for &k_scale in &[0.95, 1.00, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30] {
            for &r0_shift in &[-0.08, -0.04, 0.0, 0.04, 0.08] {
                for &sq in &[-0.30, -0.20, -0.10, 0.0, 0.10, 0.20] {
                    let shape = ShapeParams {
                        epsilon: eps0 * a_scale,
                        kappa: device.kappa * k_scale,
                        delta,
                        delta_upper: None,
                        a_param: -0.05,
                        config: device.config,
                        x_point_alpha: Some(delta.asin()),
                        squareness: sq,
                        squareness_out: sq,
                    };
                    let Some(s) = evaluate(&device, &wall, &spec, &shape, device.r0 + r0_shift)
                    else {
                        continue;
                    };

                    let feasible = s.n_outside == 0
                        && s.min_gap_mm >= spec.clearance_floor_mm
                        && (!spec.has_divertor || (s.n_strikes > 0 && s.n_bad_strikes == 0));
                    if !feasible {
                        continue;
                    }

                    let row = format!(
                        "{:7.2} {:7.2} {:+7.2} {:+7.2} | {:7.1} {:7.1} {:7.1} {:7.1} | \
                         {:6} {:6} | {:8.1}",
                        a_scale, k_scale, r0_shift, sq,
                        s.mean_gap_mm, s.std_gap_mm, s.min_gap_mm, s.max_gap_mm,
                        s.n_strikes, s.n_bad_strikes, s.objective
                    );
                    println!("{row}");
                    if best.as_ref().map(|(j, _, _)| s.objective < *j).unwrap_or(true) {
                        best = Some((s.objective, row, [a_scale, k_scale, r0_shift, sq]));
                    }
                }
            }
        }
    }

    match best {
        Some((j, row, p)) => {
            println!("\nBEST (J = {j:.1}): {row}");
            println!(
                "\n    equilibrium_a_scale: {:.2},\n    equilibrium_r0_shift: {:.2},\n    \
                 equilibrium_kappa_scale: {:.2},\n    equilibrium_squareness: {:.2},",
                p[0], p[2], p[1], p[3]
            );
        }
        None => println!("\nNo candidate satisfied the constraints."),
    }
}
