//! Offline fit of the SPARC DN separatrix to the published first wall.
//!
//! This is the SPARC_SCOPING.md §15 harness: for candidate equilibrium
//! parameters it solves the Cerfon–Freidberg equilibrium, extracts the
//! separatrix with the SAME contour path the simulator renders, and scores
//!   • bulk containment + minimum wall clearance,
//!   • whether each divertor leg crosses the wall *down the channel*
//!     (on a target face) rather than at the channel entrance.
//!
//! Run with: `cargo run --release --example fit_sparc_shape`

use tok_sym_core::contour;
use tok_sym_core::devices::{self, MagneticConfig};
use tok_sym_core::equilibrium::{CerfonEquilibrium, ShapeParams};

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
        let d = ((r - x0 - t * dx).powi(2) + (z - y0 - t * dy).powi(2)).sqrt();
        best = best.min(d);
        j = i;
    }
    best
}

fn dist_to_seg(p: Pt, a: Pt, b: Pt) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    ((p.0 - a.0 - t * dx).powi(2) + (p.1 - a.1 - t * dy).powi(2)).sqrt()
}

/// Upper-half target faces of the SPARC divertor (from the published wall).
///
/// Revised target definition (user review): the outer strike must land on the
/// ROOF DIAGONAL — the inboard side of the outboard channel — near its
/// outermost extent, and must NOT impinge on the outer vertical face or the
/// top-back segment, which are baffle structure.
const OUTER_TARGET: [(Pt, Pt); 2] = [
    ((1.8193, 1.5992), (1.7462, 1.5152)), // outer end of the roof diagonal
    ((1.7462, 1.5152), (1.4795, 1.1781)), // rest of the diagonal
];
const OUTER_BAFFLE: [(Pt, Pt); 2] = [
    ((1.8500, 1.4157), (1.8492, 1.5903)), // outer vertical face
    ((1.8492, 1.5903), (1.8193, 1.5992)), // top-back segment
];
/// Inner slot faces (the thin inboard wedge).
const INNER_FACES: [(Pt, Pt); 2] = [
    ((1.4656, 1.1786), (1.2850, 1.2332)), // slot upper face
    ((1.2913, 1.2205), (1.4597, 1.1002)), // slot lower face
];

struct Score {
    n_out: usize,
    min_clear_mm: f64,
    x_pt: Pt,
    inner_hit: Option<Pt>,
    inner_depth_mm: f64, // how far past the slot entrance (R=1.46) it lands
    outer_hit: Option<Pt>,
    outer_depth_mm: f64, // how far past the channel entrance (Z=1.217) it lands
}

fn evaluate(wall: &[Pt], shape: &ShapeParams, r0: f64) -> Option<Score> {
    let eq = CerfonEquilibrium::solve(shape, r0, 0.0)?;
    let (xr, xz) = {
        // upper X-point, physical
        let eps = shape.epsilon;
        (
            (1.0 - 1.01 * eps * shape.delta) * r0,
            1.01 * eps * shape.kappa * r0,
        )
    };
    // Same grid the simulator uses for rendering, extended over the wall
    let (mut r0g, mut r1g, mut z0g, mut z1g) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for &(r, z) in wall {
        r0g = r0g.min(r - 0.02);
        r1g = r1g.max(r + 0.02);
        z0g = z0g.min(z - 0.02);
        z1g = z1g.max(z + 0.02);
    }
    let sep = contour::extract_separatrix(&eq, 96, 144, Some((r0g, r1g, z0g, z1g)));
    if sep.points.len() < 40 {
        return None;
    }

    let mut n_out = 0usize;
    let mut min_clear = f64::MAX;
    // Wall crossings of the upper-leg polyline segments
    let mut inner_hit: Option<Pt> = None;
    let mut outer_hit: Option<Pt> = None;

    let pts = &sep.points;
    for w in pts.windows(2) {
        let (r0p, z0p) = w[0];
        let (r1p, z1p) = w[1];
        // Bulk metrics: below the X-point band, inside the wall bounding box
        if z0p.abs() < xz - 0.05 && r0p > 1.25 && r0p < 2.45 {
            if !inside(wall, r0p, z0p) {
                n_out += 1;
            } else {
                min_clear = min_clear.min(dist_to_poly(wall, r0p, z0p));
            }
        }
        // Leg crossings: upper region only, adjacent points straddling the wall
        if z0p > xz - 0.02 && z1p > xz - 0.02 {
            let in0 = inside(wall, r0p, z0p);
            let in1 = inside(wall, r1p, z1p);
            if in0 != in1 {
                // approximate crossing at midpoint (contour segments are short)
                let hit = ((r0p + r1p) / 2.0, (z0p + z1p) / 2.0);
                if hit.0 < xr {
                    if inner_hit.is_none() || hit.0 < inner_hit.unwrap().0 {
                        inner_hit = Some(hit);
                    }
                } else if outer_hit.is_none() || hit.1 > outer_hit.unwrap().1 {
                    outer_hit = Some(hit);
                }
            }
        }
    }

    // Depth into the channels, and require landing near a target face
    let inner_depth = inner_hit
        .filter(|h| INNER_FACES.iter().any(|(a, b)| dist_to_seg(*h, *a, *b) < 0.03))
        .map(|h| (1.46 - h.0) * 1000.0)
        .unwrap_or(-1.0);
    // Outer landing: distance to the roof-diagonal target (must be small) and
    // to the baffle faces (must NOT be small). Depth = distance from the
    // diagonal's outermost point (1.8193, 1.5992), smaller = deeper.
    let outer_depth = outer_hit
        .filter(|h| OUTER_TARGET.iter().any(|(a, b)| dist_to_seg(*h, *a, *b) < 0.025))
        .filter(|h| OUTER_BAFFLE.iter().all(|(a, b)| dist_to_seg(*h, *a, *b) > 0.035))
        .map(|h| {
            let d = ((h.0 - 1.8193f64).powi(2) + (h.1 - 1.5992f64).powi(2)).sqrt();
            (0.25 - d) * 1000.0 // larger = closer to the outermost extent
        })
        .unwrap_or(-1.0);

    Some(Score {
        n_out,
        min_clear_mm: if min_clear == f64::MAX { -1.0 } else { min_clear * 1000.0 },
        x_pt: (xr, xz),
        inner_hit,
        inner_depth_mm: inner_depth,
        outer_hit,
        outer_depth_mm: outer_depth,
    })
}

fn main() {
    let d = devices::sparc();
    let wall: Vec<Pt> = d.wall_outline.clone();
    let eps0 = d.a / d.r0;

    println!("shift  ks     sq    alph  | out  clear |  X-point        | inner hit → depth | outer hit → depth");
    let mut best: Option<(f64, String)> = None;

    for &shift in &[-0.05] {
        for &ks in &[1.103, 1.104, 1.105] {
            for &sq in &[0.100, 0.102, 0.104, 0.106] {
                for &amp in &[0.03] {
                    let asc = 1.0;
                    let delta = 0.54;
                    let shape = ShapeParams {
                        epsilon: eps0 * 0.92,
                        kappa: d.kappa * ks,
                        delta,
                        a_param: -0.05,
                        config: MagneticConfig::DoubleNull,
                        x_point_alpha: Some((delta as f64).asin() * asc),
                        squareness: sq,
                    };
                    let Some(s) = evaluate(&wall, &shape, d.r0 + shift) else {
                        continue;
                    };
                    // Both sweep extremes must stay contained; approximate the
                    // swept phase with delta − 0.04
                    // Sweep excursions to HIGHER delta: X-point moves inboard,
                    // walking the strike inboard along the roof diagonal, away
                    // from the vertical-face baffle.
                    let shape_swept = ShapeParams {
                        delta: delta + amp,
                        x_point_alpha: Some(((delta + amp) as f64).asin() * asc),
                        ..shape
                    };
                    let swept = evaluate(&wall, &shape_swept, d.r0 + shift);
                    let (swept_ok, swept_info) = swept
                        .map(|sw| (
                            sw.n_out == 0
                                && sw.min_clear_mm > 8.0
                                && sw.outer_depth_mm > 0.0
                                && sw.inner_depth_mm > 0.0,
                            format!(
                                "swept: clear {:>3.0} in {:>4.0} outHit {} d{:>4.0}",
                                sw.min_clear_mm,
                                sw.inner_depth_mm,
                                sw.outer_hit.map(|h| format!("({:.3},{:.3})", h.0, h.1)).unwrap_or("miss".into()),
                                sw.outer_depth_mm
                            ),
                        ))
                        .unwrap_or((false, "swept: solve fail".into()));

                    let ok = s.n_out == 0
                        && s.min_clear_mm > 8.0
                        && s.inner_depth_mm > 20.0
                        && s.outer_depth_mm > 20.0
                        && swept_ok;
                    let fitness = if ok {
                        s.min_clear_mm.min(40.0) + s.inner_depth_mm.min(120.0) * 0.5
                            + s.outer_depth_mm.min(200.0) * 0.5
                    } else {
                        -1.0
                    };
                    let row = format!(
                        "{:+.3}  {:.3} {:.2}  a{:.2} | {:3}  {:5.0}mm | ({:.3},{:.3}) | {} → {:4.0}mm | {} → {:4.0}mm {} | {}",
                        shift, ks, sq, amp, s.n_out, s.min_clear_mm,
                        s.x_pt.0, s.x_pt.1,
                        s.inner_hit.map(|h| format!("({:.3},{:.3})", h.0, h.1)).unwrap_or("   miss   ".into()),
                        s.inner_depth_mm,
                        s.outer_hit.map(|h| format!("({:.3},{:.3})", h.0, h.1)).unwrap_or("   miss   ".into()),
                        s.outer_depth_mm,
                        if ok { "OK" } else { "" },
                        swept_info,
                    );
                    if fitness > 0.0 && best.as_ref().map(|(f, _)| fitness > *f).unwrap_or(true) {
                        best = Some((fitness, row.clone()));
                    }
                    println!("{row}");
                }
            }
        }
    }
    println!("\nBEST: {}", best.map(|(_, r)| r).unwrap_or("none met all criteria".into()));
}
