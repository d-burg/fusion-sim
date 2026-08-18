//! Fit a device's equilibrium-only shaping knobs so the SOLVED last closed
//! flux surface matches a reference GEQDSK equilibrium.
//!
//! This is a better-anchored objective than hugging the limiter: a real
//! reconstructed equilibrium already clears its own wall, so matching it gets
//! the wall behaviour for free while being tied to something physical rather
//! than to a wall standoff we would otherwise be inventing.
//!
//! The objective is the RMS distance from each GEQDSK boundary point to our
//! solved boundary polyline, minimised over
//! (a_scale, kappa_scale, r0_shift, squareness, delta_upper offset).
//!
//! GEQDSK files are read but never written, copied, or embedded — pass the
//! path on the command line:
//!
//!   cargo run --release --example fit_to_geqdsk -- <device-id> <file.geqdsk>
//!
//! Only equilibrium-only knobs are searched, so nothing here moves the
//! physics audit (Greenwald density, volume and the transport scalings all
//! keep the published a/R0/kappa_areal).

use tok_sym_core::contour;
use tok_sym_core::devices::{self, Device};
use tok_sym_core::equilibrium::{CerfonEquilibrium, ShapeParams};

type Pt = (f64, f64);

/// Weight on strike-point imbalance about the fishtail apex, relative to
/// boundary RMS (both in metres). Deliberately small: the shape match is the
/// objective, and this only discriminates between candidates that already
/// land one strike per fin.
const W_BALANCE: f64 = 0.15;

/// Weight on the outer strike's distance from the far end of the outer
/// target ("deeper is better"). Small for the same reason as W_BALANCE.
/// Halved from 0.10 once the user asked to trade some outer depth for a
/// fuller outboard shoulder (larger delta pulls both strikes inboard).
const W_DEPTH: f64 = 0.05;

/// Weight on the soft strike preference (DIII-D): penalties are in metres of
/// excess spread / missing outboard shift, traded against boundary RMS.
const W_SOFT: f64 = 0.10;

/// Parse the boundary (RBBBS/ZBBBS) out of a GEQDSK file.
///
/// The format is a fixed header followed by a free-form stream of Fortran
/// reals: fpol, pres, ffprim, pprime (nw each), psirz (nw*nh), qpsi (nw),
/// then `nbbbs limitr` and the boundary and limiter point pairs.
fn read_geqdsk_boundary(path: &str) -> (Vec<Pt>, Vec<Pt>) {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let mut lines = text.lines();
    let header = lines.next().expect("empty geqdsk");

    // nw, nh are the last two integers on the header line.
    let ints: Vec<i64> = header
        .split_whitespace()
        .filter_map(|t| t.parse::<i64>().ok())
        .collect();
    let (nw, nh) = (
        ints[ints.len() - 2] as usize,
        ints[ints.len() - 1] as usize,
    );

    let body: String = lines.collect::<Vec<_>>().join(" ");
    let nums = tokenize_reals(&body);

    // Skip the four 5-value header rows, the four nw-length profiles, the
    // nw*nh psi grid and qpsi; nbbbs/limitr follow.
    let mut i = 20 + 4 * nw + nw * nh + nw;

    let nbbbs = nums[i] as usize;
    let limitr = nums[i + 1] as usize;
    i += 2;

    let pair = |v: &[f64]| -> Vec<Pt> { v.chunks(2).map(|c| (c[0], c[1])).collect() };
    let bnd = pair(&nums[i..i + 2 * nbbbs]);
    i += 2 * nbbbs;
    let lim = if limitr > 0 && i + 2 * limitr <= nums.len() {
        pair(&nums[i..i + 2 * limitr])
    } else {
        Vec::new()
    };
    (bnd, lim)
}

/// Split a Fortran real stream into f64s, tolerating `1.0-100` style
/// exponents (missing `E`) and `D` exponents.
fn tokenize_reals(s: &str) -> Vec<f64> {
    let b: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;

    while i < b.len() {
        // Find the start of a number.
        if !(b[i].is_ascii_digit() || b[i] == '.' || b[i] == '+' || b[i] == '-') {
            i += 1;
            continue;
        }
        let start = i;
        if b[i] == '+' || b[i] == '-' {
            i += 1;
        }
        let mant_start = i;
        while i < b.len() && (b[i].is_ascii_digit() || b[i] == '.') {
            i += 1;
        }
        if i == mant_start {
            // A lone sign; not a number.
            i = start + 1;
            continue;
        }
        // Optional exponent, either explicit (E+01 / D+01) or Fortran's
        // space-saving form where the marker is dropped (1.234-100).
        let mut tok: String = b[start..i].iter().collect();
        if i < b.len() && matches!(b[i], 'E' | 'e' | 'D' | 'd') {
            let save = i;
            i += 1;
            if i < b.len() && (b[i] == '+' || b[i] == '-') {
                i += 1;
            }
            let ds = i;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
            if i > ds {
                tok.push('E');
                tok.push_str(&b[save + 1..i].iter().collect::<String>());
            } else {
                i = save; // not actually an exponent
            }
        } else if i < b.len() && (b[i] == '+' || b[i] == '-') {
            let save = i;
            i += 1;
            let ds = i;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
            if i > ds {
                tok.push('E');
                tok.push_str(&b[save..i].iter().collect::<String>());
            } else {
                i = save;
            }
        }
        if let Ok(v) = tok.parse::<f64>() {
            out.push(v);
        }
    }
    out
}

fn dist_point_to_segments(p: Pt, segs: &[(Pt, Pt)]) -> f64 {
    let mut best = f64::MAX;
    for &(a, b) in segs {
        let (x0, y0) = a;
        let (x1, y1) = b;
        let (dx, dy) = (x1 - x0, y1 - y0);
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 {
            (((p.0 - x0) * dx + (p.1 - y0) * dy) / l2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        best = best.min(((p.0 - x0 - t * dx).powi(2) + (p.1 - y0 - t * dy).powi(2)).sqrt());
    }
    best
}

/// Shape metrics of a closed boundary.
/// Union of the vessel bounding box and the equilibrium grid box.
fn wall_bounds(wall: &[Pt], grid: (f64, f64, f64, f64)) -> (f64, f64, f64, f64) {
    let (mut r0, mut r1, mut z0, mut z1) = grid;
    for &(r, z) in wall {
        r0 = r0.min(r - 0.05);
        r1 = r1.max(r + 0.05);
        z0 = z0.min(z - 0.05);
        z1 = z1.max(z + 0.05);
    }
    (r0, r1, z0, z1)
}

/// The divertor "fishtail", described by its actual target faces.
///
/// A healthy diverted shape lands one strike on the inboard fin and one on
/// the outboard fin. An R-midline split is not good enough to test this: a
/// leg can cross the inboard fin twice (once per face) with the crossings
/// straddling the midline in R, which reads as "balanced" while physically
/// both legs are in the same fin. So strikes are classified by distance to
/// the named faces instead, in (R, |Z - z0|) so DN devices share one set.
struct Divertor {
    /// |Z| below which crossings are main-chamber, not divertor.
    z_abs_min: f64,
    /// Faces of the inboard fin the inner strike must land on.
    inner_faces: Vec<(Pt, Pt)>,
    /// Faces of the outboard fin the outer strike must land on.
    outer_faces: Vec<(Pt, Pt)>,
    /// Fishtail centre: strikes should sit at similar distances from it.
    apex: Option<Pt>,
    /// "Deeper is better" anchor for the outer strike — the far end of the
    /// outer target. Smaller distance to it = deeper into the leg.
    outer_anchor: Option<Pt>,
    /// Inner strikes must satisfy R <= this, if set. Guards against a strike
    /// at the slot MOUTH being counted as "in the inner fin": at the mouth
    /// the inner face and the outer target meet, so nearest-face
    /// classification there is meaningless and the leg is really riding the
    /// channel entrance. 1.44 for SPARC = at least 20 mm down the slot, the
    /// same criterion fit_sparc_shape.rs used.
    inner_r_max: Option<f64>,
    /// Outer strikes must satisfy R >= this, if set — the mirror of
    /// `inner_r_max`, guarding against an "outer" strike riding the shared
    /// corner between the two legs.
    outer_r_min: Option<f64>,
    /// Baffle faces no strike may approach within `BAFFLE_CLEAR` of. Stops
    /// the depth term from pushing the outer strike into the back corner —
    /// same 35 mm guard the original fit_sparc_shape.rs acceptance used.
    avoid_faces: Vec<(Pt, Pt)>,
    /// Soft objective on the raw strike set, in metres of penalty, for
    /// devices with no crisp two-fin geometry (DIII-D). Applied INSTEAD of
    /// the face classification when set.
    soft_score: Option<fn(&[Pt]) -> f64>,
    /// Only count strikes below the midplane (LSN devices, where spurious
    /// upper ψ=0 branches would otherwise pollute the strike set).
    lower_only: bool,
}

/// Minimum clearance between any strike and an `avoid_faces` segment (m).
const BAFFLE_CLEAR: f64 = 0.035;

fn divertor_for(id: &str) -> Option<Divertor> {
    match id {
        // DIII-D has no true divertor legs — an open lower region with a
        // shallow baffle — so there is no two-fin classification to enforce.
        // Instead a SOFT preference (user call, 2026-08-17): narrow the
        // strike spread and shift both strikes slightly outboard, without
        // any hard rejection, so the shape-only optimum stays reachable as
        // a fallback checkpoint.
        "diiid" => Some(Divertor {
            z_abs_min: 1.00,
            inner_faces: vec![],
            outer_faces: vec![],
            apex: None,
            outer_anchor: None,
            inner_r_max: None,
            outer_r_min: None,
            avoid_faces: vec![],
            soft_score: Some(diiid_soft),
            lower_only: true,
        }),
        // SPARC: published slot faces, from fit_sparc_shape.rs. Inner wedge
        // faces, and the outboard channel's roof diagonal as the outer
        // target; deeper = toward the diagonal's outer end.
        "sparc" => Some(Divertor {
            z_abs_min: 1.05,
            inner_faces: vec![
                ((1.4656, 1.1786), (1.2850, 1.2332)),
                ((1.2913, 1.2205), (1.4597, 1.1002)),
            ],
            outer_faces: vec![
                ((1.8193, 1.5992), (1.7462, 1.5152)),
                ((1.7462, 1.5152), (1.4795, 1.1781)),
            ],
            apex: None,
            outer_anchor: Some((1.8193, 1.5992)),
            inner_r_max: Some(1.44),
            outer_r_min: None,
            avoid_faces: vec![
                ((1.8500, 1.4157), (1.8492, 1.5903)), // outer vertical face
                ((1.8492, 1.5903), (1.8193, 1.5992)), // top-back segment
            ],
            soft_score: None,
            lower_only: false,
        }),
        // CENTAUR: the fishtail is TWO notches separated by the peak at
        // (2.463, 1.375) — not the single V this spec first modelled. The
        // inboard leg is the deep V (2.178 -> apex 2.283,1.560 -> peak), the
        // outer leg is the shallower notch beyond the peak
        // (peak -> 2.700,1.420 floor -> 2.674,1.238 back wall). The outer
        // strike must cross the peak into that second notch.
        "centaur" => Some(Divertor {
            z_abs_min: 1.20,
            inner_faces: vec![
                ((2.178, 1.293), (2.283, 1.560)),
                ((2.283, 1.560), (2.463, 1.375)),
            ],
            outer_faces: vec![
                ((2.463, 1.375), (2.700, 1.420)),
                ((2.674, 1.238), (2.700, 1.420)),
            ],
            apex: Some((2.463, 1.375)),
            outer_anchor: None,
            inner_r_max: Some(2.44),
            outer_r_min: Some(2.48),
            avoid_faces: vec![],
            soft_score: None,
            lower_only: false,
        }),
        _ => None,
    }
}

/// DIII-D soft strike preference: narrow spread, slightly outboard.
///
/// The shape-only fit lands the inner strike on the inboard column at
/// R = 1.01 and the outer at R = 1.31 on the floor — a 300 mm spread with a
/// mean of 1.16. Preferred: spread within 150 mm and mean at or beyond 1.28,
/// which pulls the inner strike off the column onto the floor and nudges
/// both toward the baffle. Penalties are in metres and go to zero once the
/// preference is met, so candidates that satisfy it compete on RMS alone.
fn diiid_soft(strikes: &[Pt]) -> f64 {
    if strikes.len() < 2 {
        // Both legs must actually terminate on the wall — a single strike
        // means a leg escaped the divertor region, which a spread of zero
        // would otherwise spuriously reward.
        return 0.5;
    }
    let r_min = strikes.iter().fold(f64::MAX, |m, h| m.min(h.0));
    let r_max = strikes.iter().fold(f64::MIN, |m, h| m.max(h.0));
    let mean = strikes.iter().map(|h| h.0).sum::<f64>() / strikes.len() as f64;
    // Relaxed after a first pass: demanding spread <= 150 mm and mean
    // R >= 1.28 zeroed the penalty only at kappa_scale 1.25 with a badly
    // distorted lower plasma (boundary max deviation 242 mm). These targets
    // are reachable without leaving the GEQDSK shape.
    (r_max - r_min - 0.20).max(0.0) + (1.22 - mean).max(0.0)
}

/// Clip to first impact and return the chain-end strike points as
/// (R, |Z - z0|), divertor region only.
fn collect_strikes(device: &Device, div: &Divertor, sep: &contour::Contour) -> Vec<Pt> {
    const JUMP: f64 = 0.15;
    let mut clipped = sep.clone();
    contour::clip_separatrix_to_wall(&mut clipped, &device.wall_outline, 0.005);
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
        .filter(|e| !(div.lower_only && e.1 > device.z0))
        .map(|e| (e.0, (e.1 - device.z0).abs()))
        .filter(|h| h.1 >= div.z_abs_min)
        .collect()
}

/// PHYSICAL strike points, classified by target face.
/// Returns None unless both fins take at least one strike.
///
/// Raw wall crossings of the ψ = 0 contour are NOT strikes: past its first
/// impact the contour tunnels on through wall metal, and a leg that lands in
/// one fin re-crosses the other fin's face on the far side — which is how an
/// earlier version of this check accepted shapes whose legs both land in one
/// fin. Strikes here come from `collect_strikes`, which clips to first
/// impact (the renderer's own logic) and takes the clipped chain ends.
fn strike_assess(div: &Divertor, strikes: &[Pt]) -> Option<(Vec<Pt>, Vec<Pt>)> {
    /// A strike counts as "on" a face within this distance (grid resolution
    /// plus the wall-crossing interpolation).
    const TOL: f64 = 0.06;
    let (mut inb, mut outb) = (Vec::new(), Vec::new());
    for &hit in strikes {
        if !div.avoid_faces.is_empty()
            && dist_point_to_segments(hit, &div.avoid_faces) < BAFFLE_CLEAR
        {
            // A leg terminating on baffle structure is disqualifying.
            return None;
        }
        let d_in = dist_point_to_segments(hit, &div.inner_faces);
        let d_out = dist_point_to_segments(hit, &div.outer_faces);
        if d_in.min(d_out) > TOL {
            // A divertor-region strike that misses every target face is a
            // mislanded leg, not something to ignore.
            return None;
        }
        if d_in < d_out {
            if div.inner_r_max.map(|rm| hit.0 > rm).unwrap_or(false) {
                // Inner-classified strike at the shared corner between the
                // legs: really riding the mouth/peak, so the candidate fails.
                return None;
            }
            inb.push(hit);
        } else {
            if div.outer_r_min.map(|rm| hit.0 < rm).unwrap_or(false) {
                return None;
            }
            outb.push(hit);
        }
    }
    if inb.is_empty() || outb.is_empty() {
        None
    } else {
        Some((inb, outb))
    }
}

fn metrics(pts: &[Pt]) -> (f64, f64, f64, f64, f64) {
    let r_in = pts.iter().fold(f64::MAX, |m, p| m.min(p.0));
    let r_out = pts.iter().fold(f64::MIN, |m, p| m.max(p.0));
    let top = pts.iter().fold(pts[0], |m, p| if p.1 > m.1 { *p } else { m });
    let bot = pts.iter().fold(pts[0], |m, p| if p.1 < m.1 { *p } else { m });
    let a = 0.5 * (r_out - r_in);
    let r_geo = 0.5 * (r_out + r_in);
    (
        r_geo,
        a,
        0.5 * (top.1 - bot.1) / a,
        (r_geo - top.0) / a,
        (r_geo - bot.0) / a,
    )
}

/// Our solved separatrix, as a list of continuous segments.
///
/// This must be the psi = 0 surface, not a psi_N = 0.995 proxy: the GEQDSK
/// boundary is the separatrix, and comparing it against a surface sitting a
/// little inside ours makes the fit inflate the plasma to cover the offset.
/// Flux surfaces bunch near the separatrix in a diverted equilibrium, so that
/// bias is much larger than 0.5% of the minor radius.
///
/// Marching squares returns the chains concatenated with jumps between them
/// (a double null splits into two branches, plus the legs), so the jump
/// segments are dropped rather than treated as boundary.
fn our_separatrix_segments(
    device: &Device,
    shape: &ShapeParams,
    r0: f64,
) -> Option<(Vec<(Pt, Pt)>, contour::Contour)> {
    const JUMP: f64 = 0.15;
    let eq = CerfonEquilibrium::solve(shape, r0, device.z0)?;
    // Extract over the whole vessel, not `grid_bounds()`: that box stops
    // ~0.15 R0 outside the plasma, which on DIII-D ends at Z = -1.19 while
    // the divertor floor is at -1.36 — the legs would be cut off before they
    // ever reach a target, making strike points undetectable.
    let bounds = wall_bounds(&device.wall_outline, eq.grid_bounds());
    let sep = contour::extract_separatrix(&eq, 401, 401, Some(bounds));
    if sep.points.len() < 40 {
        return None;
    }
    let segs: Vec<(Pt, Pt)> = sep
        .points
        .windows(2)
        .filter(|w| (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1) <= JUMP)
        .map(|w| (w[0], w[1]))
        .collect();
    if segs.len() < 40 {
        return None;
    }
    Some((segs, sep))
}

fn main() {
    let mut args = std::env::args().skip(1);
    let id = args.next().expect("usage: fit_to_geqdsk <device-id> <file.geqdsk>");
    let path = args.next().expect("usage: fit_to_geqdsk <device-id> <file.geqdsk>");

    let device = devices::all_devices()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap_or_else(|| panic!("unknown device id {id}"));

    let (bnd, _lim) = read_geqdsk_boundary(&path);
    let (gr0, ga, gkap, gdu, gdl) = metrics(&bnd);
    println!("reference: {path}");
    println!(
        "  GEQDSK  R0={:.3}  a={:.3}  kappa={:.3}  d_up={:+.3}  d_low={:+.3}",
        gr0, ga, gkap, gdu, gdl
    );
    println!(
        "  device   R0={:.3}  a={:.3}  kappa={:.3}  d_up={:+.3}  d_low={:+.3}",
        device.r0, device.a, device.kappa, device.delta_upper, device.delta_lower
    );

    let eps0 = device.a / device.r0;
    let divertor = divertor_for(&device.id);
    if divertor.is_none() {
        eprintln!("NOTE: no divertor midline defined for {id} — the strike \
                   straddle constraint is inactive.");
    }
    let mut best: Option<(f64, [f64; 7], String)> = None;

    // Split-squareness refit round: delta is PINNED to the user-adopted
    // baselines (SPARC 0.590 by decision, CENTAUR its fitted pair) and the
    // a/kappa/shift grids are windows around the adopted fits, so the extra
    // squareness_out dimension stays tractable. Other devices keep the broad
    // delta search.
    let delta_opts: Vec<(f64, f64)> = match device.id.as_str() {
        "sparc" => vec![(0.590, 0.590)],
        "centaur" => vec![(-0.550, -0.540)],
        _ => {
            let mut v = Vec::new();
            for du in [device.delta_upper, gdu, 0.5 * (device.delta_upper + gdu)] {
                for dl in [device.delta_lower, gdl, 0.5 * (device.delta_lower + gdl)] {
                    v.push((du, dl));
                }
            }
            v
        }
    };
    const SQ_GRID: [f64; 13] = [
        -0.9, -0.75, -0.6, -0.45, -0.3, -0.15, 0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9,
    ];

    println!(
        "\n{:>6} {:>6} {:>7} {:>6} {:>6} {:>7} {:>7} | {:>8} {:>8}",
        "a_scl", "k_scl", "r0_sh", "sq_in", "sq_out", "d_up", "d_low", "RMS", "max"
    );

    for &a_scale in &[0.92, 0.94, 0.96, 0.98, 1.00] {
        for &k_scale in &[0.96, 1.00, 1.02, 1.05, 1.08, 1.10] {
            for &r0_shift in &[-0.03, 0.0, 0.03, 0.06] {
                for &sq in &SQ_GRID {
                    for &sq_out in &SQ_GRID {
                    for &(du, dl) in &delta_opts {
                        let shape = ShapeParams {
                            epsilon: eps0 * a_scale,
                            kappa: device.kappa * k_scale,
                            delta: dl,
                            delta_upper: Some(du),
                            a_param: -0.05,
                            config: device.config,
                            x_point_alpha: Some(dl.asin()),
                            squareness: sq,
                            squareness_out: sq_out,
                        };
                        let Some((ours, sep)) =
                            our_separatrix_segments(&device, &shape, device.r0 + r0_shift)
                        else {
                            continue;
                        };

                        let mut sum2 = 0.0;
                        let mut max = 0.0f64;
                        for &p in &bnd {
                            let d = dist_point_to_segments(p, &ours);
                            sum2 += d * d;
                            max = max.max(d);
                        }
                        let rms = (sum2 / bnd.len() as f64).sqrt();

                        // Strike points must land one per fin — candidates
                        // whose legs both hit the same fin are rejected
                        // outright, since no amount of shape agreement makes
                        // a single-target load acceptable. Among survivors,
                        // small terms prefer apex balance (CENTAUR) and a
                        // deeper outer strike (SPARC).
                        let hyp = |p: Pt, q: Pt| (p.0 - q.0).hypot(p.1 - q.1);
                        let (imbalance, depth, soft_pen, n_in, n_out) = match &divertor {
                            Some(div) => {
                                let strikes = collect_strikes(&device, div, &sep);
                                if let Some(soft) = div.soft_score {
                                    // Soft path (DIII-D): no hard rejection,
                                    // just a preference penalty in metres.
                                    (0.0, 0.0, soft(&strikes), strikes.len(), 0)
                                } else {
                                    let Some((inb, outb)) =
                                        strike_assess(div, &strikes)
                                    else {
                                        continue;
                                    };
                                    let nearest = |v: &[Pt], q: Pt| {
                                        v.iter()
                                            .map(|&h| hyp(h, q))
                                            .fold(f64::MAX, f64::min)
                                    };
                                    let imb = div
                                        .apex
                                        .map(|ap| {
                                            (nearest(&inb, ap) - nearest(&outb, ap)).abs()
                                        })
                                        .unwrap_or(0.0);
                                    let dep = div
                                        .outer_anchor
                                        .map(|an| nearest(&outb, an))
                                        .unwrap_or(0.0);
                                    (imb, dep, 0.0, inb.len(), outb.len())
                                }
                            }
                            None => (0.0, 0.0, 0.0, 0, 0),
                        };

                        // Shape match dominates; balance, depth and the soft
                        // preference only discriminate between acceptable
                        // strike topologies.
                        let score = rms
                            + W_BALANCE * imbalance
                            + W_DEPTH * depth
                            + W_SOFT * soft_pen;

                        if best.as_ref().map(|(b, _, _)| score < *b).unwrap_or(true) {
                            let row = format!(
                                "{:6.2} {:6.2} {:+7.2} {:+6.2} {:+6.2} {:+7.2} {:+7.2} | \
                                 {:7.1}mm {:7.1}mm | {:2}/{:2} bal {:5.0}mm dep {:5.0}mm \
                                 soft {:5.0}mm",
                                a_scale, k_scale, r0_shift, sq, sq_out, du, dl,
                                rms * 1000.0, max * 1000.0, n_in, n_out,
                                imbalance * 1000.0, depth * 1000.0, soft_pen * 1000.0
                            );
                            println!("{row}");
                            best = Some((
                                score,
                                [a_scale, k_scale, r0_shift, sq, sq_out, du, dl],
                                row,
                            ));
                        }
                    }
                    }
                }
            }
        }
    }

    if let Some((score, p, row)) = best {
        // `score` is RMS + W_BALANCE * imbalance, not RMS alone; the row
        // carries the two separately.
        println!("\nBEST (score {:.1} mm): {row}", score * 1000.0);

        // Print the winner's physical strike points so the classification can
        // be verified against the plot rather than trusted.
        if let Some(div) = &divertor {
            let shape = ShapeParams {
                epsilon: eps0 * p[0],
                kappa: device.kappa * p[1],
                delta: p[6],
                delta_upper: Some(p[5]),
                a_param: -0.05,
                config: device.config,
                x_point_alpha: Some(p[6].asin()),
                squareness: p[3],
                squareness_out: p[4],
            };
            if let Some((_, sep)) =
                our_separatrix_segments(&device, &shape, device.r0 + p[2])
            {
                let strikes = collect_strikes(&device, div, &sep);
                if div.soft_score.is_some() {
                    let show = strikes
                        .iter()
                        .map(|h| format!("({:.3}, {:.3})", h.0, h.1))
                        .collect::<Vec<_>>()
                        .join(" ");
                    println!("  strikes (R, |Z|): {show}");
                } else if let Some((inb, outb)) = strike_assess(div, &strikes) {
                    let show = |v: &[Pt]| {
                        v.iter()
                            .map(|h| format!("({:.3}, {:.3})", h.0, h.1))
                            .collect::<Vec<_>>()
                            .join(" ")
                    };
                    println!("  inner-fin strikes (R, |Z|): {}", show(&inb));
                    println!("  outer-fin strikes (R, |Z|): {}", show(&outb));
                }
            }
        }
        println!(
            "\n    equilibrium_a_scale: {:.2},\n    equilibrium_r0_shift: {:.2},\n    \
             equilibrium_kappa_scale: {:.3},\n    equilibrium_squareness: {:.2},\n    \
             equilibrium_squareness_out: {:.2},\n    delta_upper: {:.3},",
            p[0], p[2], p[1], p[3], p[4], p[5]
        );
    } else {
        println!("\nNo candidate solved.");
    }
}
