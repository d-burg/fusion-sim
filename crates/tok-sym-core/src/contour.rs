//! Marching squares contour extraction for flux surface visualization.
//!
//! Given a 2D grid of ψ values, extracts contour lines at specified levels.
//! Used to convert the Cerfon-Freidberg ψ(R,Z) grid into drawable flux surfaces.

use serde::{Deserialize, Serialize};

/// A single contour line (list of (R, Z) points in meters).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contour {
    pub level: f64,
    pub points: Vec<(f64, f64)>,
}

/// Extract contour lines from a 2D grid using marching squares.
///
/// # Arguments
/// * `grid` - Row-major grid of values, grid[ir * nz + iz]
/// * `nr`, `nz` - Grid dimensions (R and Z directions)
/// * `r_min`, `r_max`, `z_min`, `z_max` - Physical coordinate bounds
/// * `levels` - Contour levels to extract
///
/// # Returns
/// A vector of `Contour` structs, one per level. Each contour may consist
/// of multiple disconnected segments concatenated together.
pub fn extract_contours(
    grid: &[f64],
    nr: usize,
    nz: usize,
    r_min: f64,
    r_max: f64,
    z_min: f64,
    z_max: f64,
    levels: &[f64],
) -> Vec<Contour> {
    let dr = (r_max - r_min) / (nr - 1) as f64;
    let dz = (z_max - z_min) / (nz - 1) as f64;

    levels
        .iter()
        .map(|&level| {
            let points = march_squares(grid, nr, nz, r_min, z_min, dr, dz, level);
            Contour { level, points }
        })
        .collect()
}

/// Flux-surface contours around a point (the magnetic axis): like
/// [`extract_contours`], but at each level the chain kept is the one that
/// belongs to the core, not simply the longest. Choice, in order: a closed
/// chain that encloses `anchor`; else the closed chain whose vertex mean is
/// nearest `anchor` and within `max_dist` of it; else the longest chain (the
/// old rule). Of several closed chains enclosing the anchor, the smallest
/// (fewest points) is kept, so a same-level ring around the whole plasma
/// can never stand in for the core ring. Near the axis the
/// core ring at a small ψ_N is short, and an open chain at the same level in
/// the private-flux region below the X-point can be longer; the longest-chain
/// rule then drew that chain as the innermost surface during the current
/// ramps (adversarial review of PR #24, 2026-11-07).
pub fn extract_contours_around(
    grid: &[f64],
    nr: usize,
    nz: usize,
    r_min: f64,
    r_max: f64,
    z_min: f64,
    z_max: f64,
    levels: &[f64],
    anchor: (f64, f64),
    max_dist: f64,
) -> Vec<Contour> {
    let dr = (r_max - r_min) / (nr - 1) as f64;
    let dz = (z_max - z_min) / (nz - 1) as f64;
    levels
        .iter()
        .map(|&level| {
            let segments = march_squares_raw(grid, nr, nz, r_min, z_min, dr, dz, level);
            let chains = chain_list(segments);
            let points = pick_core_chain(chains, anchor, max_dist, 1e-6 * (dr * dr + dz * dz));
            Contour { level, points }
        })
        .collect()
}

/// Whether a chain closes on itself (first and last points coincide).
fn is_closed(chain: &[(f64, f64)], tol2: f64) -> bool {
    chain.len() >= 4 && {
        let (a, b) = (chain[0], chain[chain.len() - 1]);
        (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2) <= tol2
    }
}

/// Even-odd point-in-polygon test.
fn encloses(chain: &[(f64, f64)], p: (f64, f64)) -> bool {
    let mut inside = false;
    let n = chain.len();
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = chain[i];
        let (xj, yj) = chain[j];
        if (yi > p.1) != (yj > p.1) && p.0 < (xj - xi) * (p.1 - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// The core chain at one level (see [`extract_contours_around`]).
fn pick_core_chain(chains: Vec<Vec<(f64, f64)>>, anchor: (f64, f64), max_dist: f64, tol2: f64) -> Vec<(f64, f64)> {
    let closed: Vec<&Vec<(f64, f64)>> = chains.iter().filter(|c| is_closed(c, tol2)).collect();
    if let Some(c) = closed.iter().filter(|c| encloses(c, anchor)).min_by_key(|c| c.len()) {
        return (*c).clone();
    }
    let dist_to_anchor = |c: &Vec<(f64, f64)>| {
        let n = (c.len() - 1) as f64; // the closing vertex repeats the first
        let (sr, sz) = c[..c.len() - 1].iter().fold((0.0, 0.0), |a, p| (a.0 + p.0, a.1 + p.1));
        (sr / n - anchor.0).powi(2) + (sz / n - anchor.1).powi(2)
    };
    let near = closed.iter().filter(|c| dist_to_anchor(c) <= max_dist * max_dist);
    if let Some(c) = near.min_by(|a, b| dist_to_anchor(a).partial_cmp(&dist_to_anchor(b)).unwrap_or(std::cmp::Ordering::Equal)) {
        return (*c).clone();
    }
    chains.into_iter().max_by_key(|c| c.len()).unwrap_or_default()
}

/// Generate raw marching squares segments (endpoint pairs) without chaining.
///
/// Returns a flat list of (R, Z) points where consecutive pairs form
/// line segments: [(seg0_start, seg0_end), (seg1_start, seg1_end), ...].
fn march_squares_raw(
    grid: &[f64],
    nr: usize,
    nz: usize,
    r_min: f64,
    z_min: f64,
    dr: f64,
    dz: f64,
    level: f64,
) -> Vec<(f64, f64)> {
    let mut segments: Vec<(f64, f64)> = Vec::new();

    for ir in 0..(nr - 1) {
        for iz in 0..(nz - 1) {
            // Four corners of the cell
            let v00 = grid[ir * nz + iz]; // bottom-left
            let v10 = grid[(ir + 1) * nz + iz]; // bottom-right
            let v11 = grid[(ir + 1) * nz + (iz + 1)]; // top-right
            let v01 = grid[ir * nz + (iz + 1)]; // top-left

            let r0 = r_min + ir as f64 * dr;
            let r1 = r0 + dr;
            let z0 = z_min + iz as f64 * dz;
            let z1 = z0 + dz;

            // Classify corners: 1 if above level, 0 if below
            let case = ((v00 >= level) as u8)
                | (((v10 >= level) as u8) << 1)
                | (((v11 >= level) as u8) << 2)
                | (((v01 >= level) as u8) << 3);

            // Skip trivial cases (all above or all below)
            if case == 0 || case == 15 {
                continue;
            }

            // Interpolation helper
            let interp = |va: f64, vb: f64, pa: f64, pb: f64| -> f64 {
                if (vb - va).abs() < 1e-20 {
                    0.5 * (pa + pb)
                } else {
                    pa + (level - va) / (vb - va) * (pb - pa)
                }
            };

            // Edge midpoints (interpolated)
            // Bottom edge: (r0,z0)-(r1,z0)
            let bot_r = interp(v00, v10, r0, r1);
            let bot_z = z0;
            // Right edge: (r1,z0)-(r1,z1)
            let right_r = r1;
            let right_z = interp(v10, v11, z0, z1);
            // Top edge: (r0,z1)-(r1,z1)
            let top_r = interp(v01, v11, r0, r1);
            let top_z = z1;
            // Left edge: (r0,z0)-(r0,z1)
            let left_r = r0;
            let left_z = interp(v00, v01, z0, z1);

            // Generate line segments based on marching squares case
            match case {
                1 | 14 => {
                    segments.push((bot_r, bot_z));
                    segments.push((left_r, left_z));
                }
                2 | 13 => {
                    segments.push((bot_r, bot_z));
                    segments.push((right_r, right_z));
                }
                3 | 12 => {
                    segments.push((left_r, left_z));
                    segments.push((right_r, right_z));
                }
                4 | 11 => {
                    segments.push((top_r, top_z));
                    segments.push((right_r, right_z));
                }
                5 => {
                    // Ambiguous case — use average to resolve
                    let avg = 0.25 * (v00 + v10 + v11 + v01);
                    if avg >= level {
                        segments.push((bot_r, bot_z));
                        segments.push((right_r, right_z));
                        segments.push((top_r, top_z));
                        segments.push((left_r, left_z));
                    } else {
                        segments.push((bot_r, bot_z));
                        segments.push((left_r, left_z));
                        segments.push((top_r, top_z));
                        segments.push((right_r, right_z));
                    }
                }
                6 | 9 => {
                    segments.push((bot_r, bot_z));
                    segments.push((top_r, top_z));
                }
                7 | 8 => {
                    segments.push((top_r, top_z));
                    segments.push((left_r, left_z));
                }
                10 => {
                    // Ambiguous case
                    let avg = 0.25 * (v00 + v10 + v11 + v01);
                    if avg >= level {
                        segments.push((bot_r, bot_z));
                        segments.push((left_r, left_z));
                        segments.push((top_r, top_z));
                        segments.push((right_r, right_z));
                    } else {
                        segments.push((bot_r, bot_z));
                        segments.push((right_r, right_z));
                        segments.push((top_r, top_z));
                        segments.push((left_r, left_z));
                    }
                }
                _ => {}
            }
        }
    }

    segments
}

/// Extract a single contour at the given level using marching squares.
/// Returns only the longest chain (suitable for flux surfaces).
fn march_squares(
    grid: &[f64],
    nr: usize,
    nz: usize,
    r_min: f64,
    z_min: f64,
    dr: f64,
    dz: f64,
    level: f64,
) -> Vec<(f64, f64)> {
    let segments = march_squares_raw(grid, nr, nz, r_min, z_min, dr, dz, level);
    chain_segments(segments)
}

/// Extract all significant chains at a given level using marching squares.
/// Returns all chains with at least `min_chain_points` points, concatenated.
/// The frontend renderer detects jump discontinuities between chains and
/// starts new sub-paths automatically.
fn march_squares_all_chains(
    grid: &[f64],
    nr: usize,
    nz: usize,
    r_min: f64,
    z_min: f64,
    dr: f64,
    dz: f64,
    level: f64,
    min_chain_points: usize,
) -> Vec<(f64, f64)> {
    let segments = march_squares_raw(grid, nr, nz, r_min, z_min, dr, dz, level);
    chain_all_segments(segments, min_chain_points)
}

/// Chain disconnected line segments into ordered polylines, returning
/// only the **longest chain**.  Marching squares often produces small
/// spurious chains from numerical noise — discarding them prevents
/// angle-sorting artifacts in the renderer.
///
/// Input: pairs of points forming segments [(p0,p1), (p2,p3), ...].
/// Output: ordered points of the single longest connected chain.
fn chain_segments(segments: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    if segments.len() < 2 {
        return segments;
    }
    chain_list(segments).into_iter().fold(Vec::new(), |best, c| if c.len() > best.len() { c } else { best })
}

/// Every chain of a segment list, in discovery order (the chaining of
/// [`chain_segments`], without the selection).
fn chain_list(segments: Vec<(f64, f64)>) -> Vec<Vec<(f64, f64)>> {
    if segments.len() < 2 {
        return Vec::new();
    }

    let n_segs = segments.len() / 2;
    let mut used = vec![false; n_segs];
    let mut all: Vec<Vec<(f64, f64)>> = Vec::new();

    let dist2 = |a: (f64, f64), b: (f64, f64)| -> f64 {
        (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)
    };

    let tolerance = 1e-10;

    // Find all chains
    for start in 0..n_segs {
        if used[start] {
            continue;
        }

        used[start] = true;
        let mut chain = vec![segments[start * 2], segments[start * 2 + 1]];

        // Extend forward
        loop {
            let tail = *chain.last().unwrap();
            let mut found = false;

            for i in 0..n_segs {
                if used[i] {
                    continue;
                }
                let p0 = segments[i * 2];
                let p1 = segments[i * 2 + 1];

                if dist2(tail, p0) < tolerance {
                    chain.push(p1);
                    used[i] = true;
                    found = true;
                    break;
                } else if dist2(tail, p1) < tolerance {
                    chain.push(p0);
                    used[i] = true;
                    found = true;
                    break;
                }
            }

            if !found {
                break;
            }
        }

        all.push(chain);
    }

    all
}

/// Chain disconnected line segments into ordered polylines, returning
/// **all chains** with at least `min_points` points.  Chains are
/// concatenated directly — the renderer's jump-threshold detection
/// handles the discontinuities between them.
///
/// This is needed for double-null separatrix topology where the ψ=0
/// contour forms a figure-8 with divertor legs as separate chains.
fn chain_all_segments(segments: Vec<(f64, f64)>, min_points: usize) -> Vec<(f64, f64)> {
    if segments.len() < 2 {
        return segments;
    }

    let n_segs = segments.len() / 2;
    let mut used = vec![false; n_segs];
    let mut all_chains: Vec<Vec<(f64, f64)>> = Vec::new();

    let dist2 = |a: (f64, f64), b: (f64, f64)| -> f64 {
        (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)
    };

    let tolerance = 1e-10;

    for start in 0..n_segs {
        if used[start] {
            continue;
        }

        used[start] = true;
        let mut chain = vec![segments[start * 2], segments[start * 2 + 1]];

        // Extend forward from tail
        loop {
            let tail = *chain.last().unwrap();
            let mut found = false;

            for i in 0..n_segs {
                if used[i] {
                    continue;
                }
                let p0 = segments[i * 2];
                let p1 = segments[i * 2 + 1];

                if dist2(tail, p0) < tolerance {
                    chain.push(p1);
                    used[i] = true;
                    found = true;
                    break;
                } else if dist2(tail, p1) < tolerance {
                    chain.push(p0);
                    used[i] = true;
                    found = true;
                    break;
                }
            }

            if !found {
                break;
            }
        }

        // Also extend backward from head
        loop {
            let head = chain[0];
            let mut found = false;

            for i in 0..n_segs {
                if used[i] {
                    continue;
                }
                let p0 = segments[i * 2];
                let p1 = segments[i * 2 + 1];

                if dist2(head, p1) < tolerance {
                    chain.insert(0, p0);
                    used[i] = true;
                    found = true;
                    break;
                } else if dist2(head, p0) < tolerance {
                    chain.insert(0, p1);
                    used[i] = true;
                    found = true;
                    break;
                }
            }

            if !found {
                break;
            }
        }

        if chain.len() >= min_points {
            all_chains.push(chain);
        }
    }

    // Sort chains by length (longest first) so the main separatrix is drawn first
    all_chains.sort_by(|a, b| b.len().cmp(&a.len()));

    // Concatenate all chains — the renderer's jump-threshold detection
    // will handle the gaps between chains
    let total: usize = all_chains.iter().map(|c| c.len()).sum();
    let mut result = Vec::with_capacity(total);
    for chain in all_chains {
        result.extend(chain);
    }
    result
}

/// Extract flux surfaces as ordered contour polylines.
///
/// Returns `n_surfaces` contours at evenly spaced normalized ψ values
/// from near the axis (0.1) to the edge (0.9).
pub fn extract_flux_surfaces(
    eq: &crate::equilibrium::CerfonEquilibrium,
    nr: usize,
    nz: usize,
    n_surfaces: usize,
) -> Vec<Contour> {
    let (r_min, r_max, z_min, z_max) = eq.grid_bounds();
    let grid = eq.psi_norm_grid(r_min, r_max, z_min, z_max, nr, nz);

    let levels: Vec<f64> = (1..=n_surfaces)
        .map(|i| i as f64 / (n_surfaces + 1) as f64)
        .collect();

    extract_contours(&grid, nr, nz, r_min, r_max, z_min, z_max, &levels)
}

/// Extract the separatrix (ψ_norm = 1.0, or equivalently ψ = 0).
///
/// Uses all-chains extraction to preserve divertor legs in double-null
/// configurations (where the ψ=0 contour forms a figure-8 topology
/// with separate leg chains extending to the divertor targets).
///
/// If `bounds` is `Some((r_min, r_max, z_min, z_max))`, those bounds are
/// used for the grid instead of `eq.grid_bounds()`.  This is important when
/// the equilibrium shape uses a reduced ε (e.g. DN) but we still want the
/// extraction grid to cover the full device extent (including divertor legs
/// beyond the X-points).
pub fn extract_separatrix(
    eq: &crate::equilibrium::CerfonEquilibrium,
    nr: usize,
    nz: usize,
    bounds: Option<(f64, f64, f64, f64)>,
) -> Contour {
    let (r_min, r_max, z_min, z_max) = bounds.unwrap_or_else(|| eq.grid_bounds());
    let grid = eq.psi_grid(r_min, r_max, z_min, z_max, nr, nz);

    let dr = (r_max - r_min) / (nr - 1) as f64;
    let dz = (z_max - z_min) / (nz - 1) as f64;

    // Use all-chains with min 5 points to include divertor legs
    // while filtering out tiny noise fragments
    let points = march_squares_all_chains(&grid, nr, nz, r_min, z_min, dr, dz, 0.0, 5);
    Contour { level: 0.0, points }
}


/// Clip a separatrix contour to the vessel interior.
///
/// Within each chain (chains are delimited by jump discontinuities, matching
/// the frontend renderer's convention), keep only the LONGEST contiguous run
/// of in-vessel points, terminating each cut end at the exact wall crossing.
///
/// Physics rationale: once a divertor leg strikes the limiter, the field line
/// ends there — it must not be drawn re-emerging beyond a baffle it
/// "tunnelled" through, which is what the raw marching-squares chains do
/// (the ψ = 0 contour continues through wall metal into whatever vessel
/// region lies beyond). Canvas-side masking cannot express "stop at first
/// impact"; this can.
///
/// The crossing endpoint is extended `overshoot` metres past the wall so
/// downstream strike-point detection (which looks for a polyline/wall
/// intersection) still sees a crossing; the sliver beyond the wall is masked
/// by the renderer.
pub fn clip_separatrix_to_wall(
    contour: &mut Contour,
    wall: &[(f64, f64)],
    overshoot: f64,
) {
    if wall.len() < 3 || contour.points.len() < 2 {
        return;
    }
    const JUMP: f64 = 0.15; // chain-break threshold (m), matches renderer

    fn point_in_poly(poly: &[(f64, f64)], r: f64, z: f64) -> bool {
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

    /// Exact intersection of segment a→b with the wall polygon, as the point
    /// on a→b closest to `a` (the in-vessel end), pushed `overshoot` past it.
    fn wall_crossing(
        poly: &[(f64, f64)],
        a: (f64, f64),
        b: (f64, f64),
        overshoot: f64,
    ) -> (f64, f64) {
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let mut best_t = 1.0f64;
        let n = poly.len();
        let mut j = n - 1;
        for i in 0..n {
            let (x0, y0) = poly[j];
            let (x1, y1) = poly[i];
            let (ex, ey) = (x1 - x0, y1 - y0);
            let denom = dx * ey - dy * ex;
            if denom.abs() > 1e-12 {
                let t = ((x0 - a.0) * ey - (y0 - a.1) * ex) / denom;
                let u = ((x0 - a.0) * dy - (y0 - a.1) * dx) / denom;
                if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) && t < best_t {
                    best_t = t;
                }
            }
            j = i;
        }
        let seg_len = (dx * dx + dy * dy).sqrt().max(1e-9);
        let t = (best_t + overshoot / seg_len).min(1.0);
        (a.0 + dx * t, a.1 + dy * t)
    }

    let pts = &contour.points;
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(pts.len());

    // Chain boundaries
    let mut chain_starts = vec![0usize];
    for i in 1..pts.len() {
        let d = ((pts[i].0 - pts[i - 1].0).powi(2) + (pts[i].1 - pts[i - 1].1).powi(2)).sqrt();
        if d > JUMP {
            chain_starts.push(i);
        }
    }
    chain_starts.push(pts.len());

    for w in chain_starts.windows(2) {
        let (c0, c1) = (w[0], w[1]);
        let chain = &pts[c0..c1];
        if chain.len() < 2 {
            continue;
        }
        let inside: Vec<bool> = chain
            .iter()
            .map(|&(r, z)| point_in_poly(wall, r, z))
            .collect();

        // Longest contiguous inside-run
        let (mut best_a, mut best_b) = (0usize, 0usize); // [a, b) half-open
        let mut run_a = None::<usize>;
        for i in 0..=chain.len() {
            let is_in = i < chain.len() && inside[i];
            match (is_in, run_a) {
                (true, None) => run_a = Some(i),
                (false, Some(a)) => {
                    if i - a > best_b - best_a {
                        best_a = a;
                        best_b = i;
                    }
                    run_a = None;
                }
                _ => {}
            }
        }
        if best_b == best_a {
            continue; // chain never enters the vessel — drop it entirely
        }

        // Entry crossing (chain came from outside)
        if best_a > 0 {
            out.push(wall_crossing(wall, chain[best_a], chain[best_a - 1], overshoot));
        }
        out.extend_from_slice(&chain[best_a..best_b]);
        // Exit crossing (the strike point — nothing is kept past it)
        if best_b < chain.len() {
            out.push(wall_crossing(wall, chain[best_b - 1], chain[best_b], overshoot));
        }
    }

    contour.points = out;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_contour() {
        // 3×3 grid with a peak in the center
        let grid = vec![
            0.0, 0.0, 0.0, // row 0
            0.0, 1.0, 0.0, // row 1
            0.0, 0.0, 0.0, // row 2
        ];
        let contours = extract_contours(&grid, 3, 3, 0.0, 2.0, 0.0, 2.0, &[0.5]);
        assert_eq!(contours.len(), 1);
        assert!(
            !contours[0].points.is_empty(),
            "Should find contour at level 0.5"
        );
    }

    #[test]
    fn test_flux_surface_extraction() {
        let device = crate::devices::diiid();
        let eq = crate::equilibrium::CerfonEquilibrium::from_device(&device).unwrap();

        let surfaces = extract_flux_surfaces(&eq, 64, 64, 5);
        assert_eq!(surfaces.len(), 5);

        // Each surface should have some points
        for (i, s) in surfaces.iter().enumerate() {
            assert!(
                !s.points.is_empty(),
                "Flux surface {} should have points",
                i
            );
        }
    }

    #[test]
    fn test_separatrix_extraction() {
        let device = crate::devices::diiid();
        let eq = crate::equilibrium::CerfonEquilibrium::from_device(&device).unwrap();

        let sep = extract_separatrix(&eq, 64, 64, None);
        assert!(
            !sep.points.is_empty(),
            "Separatrix should have points"
        );
    }

    /// Helper: compute extended grid bounds that cover the device wall outline,
    /// matching the logic in simulation.rs snapshot().
    fn device_wall_bounds(
        device: &crate::devices::Device,
        eq: &crate::equilibrium::CerfonEquilibrium,
    ) -> (f64, f64, f64, f64) {
        let full_eps = device.epsilon();
        let full_kappa = device.kappa.max(eq.shape.kappa);
        let margin = 0.15;
        let mut r_min = device.r0 * (1.0 - full_eps - margin);
        let mut r_max = device.r0 * (1.0 + full_eps + margin);
        let mut z_min = device.z0 + device.r0 * (-full_eps * full_kappa - margin);
        let mut z_max = device.z0 + device.r0 * (full_eps * full_kappa + margin);

        let wall_pad = 0.02;
        for &(r, z) in &device.wall_outline {
            r_min = r_min.min(r - wall_pad);
            r_max = r_max.max(r + wall_pad);
            z_min = z_min.min(z - wall_pad);
            z_max = z_max.max(z + wall_pad);
        }
        (r_min, r_max, z_min, z_max)
    }

    /// Verify that separatrix divertor legs extend to near the wall Z-extent
    /// for all three diverted configurations (LSN, USN, DN).
    ///
    /// The grid bounds must cover the device wall outline — without this,
    /// marching-squares truncates the legs at the grid boundary.
    #[test]
    fn test_separatrix_legs_reach_wall() {
        use crate::devices::{self, MagneticConfig};
        use crate::equilibrium::{CerfonEquilibrium, ShapeParams};

        let device = devices::diiid();
        let wall_z_min = device
            .wall_outline
            .iter()
            .map(|&(_, z)| z)
            .fold(f64::INFINITY, f64::min);
        let wall_z_max = device
            .wall_outline
            .iter()
            .map(|&(_, z)| z)
            .fold(f64::NEG_INFINITY, f64::max);

        let configs = [
            ("LSN", MagneticConfig::LowerSingleNull),
            ("USN", MagneticConfig::UpperSingleNull),
            ("DN", MagneticConfig::DoubleNull),
        ];

        for (label, config) in &configs {
            let mut shape = ShapeParams::from_device(&device);
            shape.config = *config;
            // DN uses slightly reduced epsilon (matching simulation.rs behavior)
            if *config == MagneticConfig::DoubleNull {
                shape.epsilon *= 0.88;
            }

            let eq = CerfonEquilibrium::solve(&shape, device.r0, device.z0)
                .unwrap_or_else(|| panic!("{}: equilibrium solve failed", label));

            let bounds = device_wall_bounds(&device, &eq);
            let sep = extract_separatrix(&eq, 96, 108, Some(bounds));

            assert!(
                !sep.points.is_empty(),
                "{}: separatrix should have points",
                label
            );

            let sep_z_min = sep
                .points
                .iter()
                .map(|&(_, z)| z)
                .fold(f64::INFINITY, f64::min);
            let sep_z_max = sep
                .points
                .iter()
                .map(|&(_, z)| z)
                .fold(f64::NEG_INFINITY, f64::max);

            // Get X-point locations to verify legs extend well past them
            let (xpt_lower, xpt_upper) = eq.x_points_physical();

            match config {
                MagneticConfig::LowerSingleNull => {
                    let xpt_z = xpt_lower.unwrap().1;
                    // LSN: lower leg should reach near the wall floor
                    // (Cerfon-Freidberg legs thin out; tolerance of 0.20 m)
                    assert!(
                        sep_z_min <= wall_z_min + 0.20,
                        "{}: lower leg z_min={:.3} should reach near wall floor z={:.3}",
                        label,
                        sep_z_min,
                        wall_z_min
                    );
                    // Leg should extend well below the X-point
                    assert!(
                        sep_z_min < xpt_z - 0.1,
                        "{}: lower leg z_min={:.3} should extend below X-point z={:.3}",
                        label,
                        sep_z_min,
                        xpt_z
                    );
                }
                MagneticConfig::UpperSingleNull => {
                    let xpt_z = xpt_upper.unwrap().1;
                    // USN: upper leg should reach near the wall ceiling
                    // (Cerfon-Freidberg legs thin out; tolerance of 0.20 m)
                    assert!(
                        sep_z_max >= wall_z_max - 0.20,
                        "{}: upper leg z_max={:.3} should reach near wall ceiling z={:.3}",
                        label,
                        sep_z_max,
                        wall_z_max
                    );
                    // Leg should extend well above the X-point
                    assert!(
                        sep_z_max > xpt_z + 0.1,
                        "{}: upper leg z_max={:.3} should extend above X-point z={:.3}",
                        label,
                        sep_z_max,
                        xpt_z
                    );
                }
                MagneticConfig::DoubleNull => {
                    let lower_z = xpt_lower.unwrap().1;
                    let upper_z = xpt_upper.unwrap().1;
                    // DN has reduced epsilon (0.88×), so legs are shorter.
                    // Verify legs extend well past the X-points (at least 0.2 m).
                    assert!(
                        sep_z_min < lower_z - 0.2,
                        "{}: lower leg z_min={:.3} should extend well below X-point z={:.3}",
                        label,
                        sep_z_min,
                        lower_z
                    );
                    assert!(
                        sep_z_max > upper_z + 0.2,
                        "{}: upper leg z_max={:.3} should extend well above X-point z={:.3}",
                        label,
                        sep_z_max,
                        upper_z
                    );
                }
                _ => {}
            }
        }
    }

    /// A short closed core ring and a longer open chain at the same level
    /// (the shape of the ramp-phase case the PR #24 review measured: a
    /// private-flux arc beside a small ψ_N = 0.01 ring). The longest-chain
    /// rule takes the arc; the around-the-axis rule takes the ring.
    #[test]
    fn test_contours_around_pick_the_core_ring_not_the_longest_chain() {
        let (nr, nz) = (121, 121);
        let (r0, r1, z0, z1) = (0.0, 2.0, -1.0, 1.0);
        let mut grid = vec![0.0; nr * nz];
        for ir in 0..nr {
            for iz in 0..nz {
                let r = r0 + (r1 - r0) * ir as f64 / (nr - 1) as f64;
                let z = z0 + (z1 - z0) * iz as f64 / (nz - 1) as f64;
                let core = (-((r - 1.0).powi(2) + z.powi(2)) / 0.01).exp();
                let side = (-((r - 1.0).powi(2) + (z + 1.4).powi(2)) / 0.5).exp();
                grid[ir * nz + iz] = core.max(side);
            }
        }
        let level = 0.6;
        let longest = &extract_contours(&grid, nr, nz, r0, r1, z0, z1, &[level])[0].points;
        let core = &extract_contours_around(&grid, nr, nz, r0, r1, z0, z1, &[level], (1.0, 0.0), 0.5)[0].points;
        let mean = |c: &Vec<(f64, f64)>| {
            let n = c.len() as f64;
            c.iter().fold((0.0, 0.0), |a, p| (a.0 + p.0 / n, a.1 + p.1 / n))
        };
        assert!(longest.len() > core.len(), "the open arc must be the longer chain here");
        assert!(mean(longest).1 < -0.5, "longest chain is the arc below: {:?}", mean(longest));
        assert!(is_closed(core, 1e-12), "the core chain is closed");
        assert!(encloses(core, (1.0, 0.0)), "the core chain encloses the anchor");
        let (mr, mz) = mean(core);
        assert!((mr - 1.0).abs() < 0.01 && mz.abs() < 0.01, "core ring centered on the anchor: ({mr}, {mz})");
    }


    /// Shared fixture: a grid of the larger of a narrow core Gaussian at
    /// (1, 0) and a broad off-grid Gaussian below, plus optionally a ring
    /// bump (a same-level closed ring around the core).
    fn two_bump_grid(ring: bool) -> (Vec<f64>, usize, usize) {
        let (nr, nz) = (121, 121);
        let mut grid = vec![0.0; nr * nz];
        for ir in 0..nr {
            for iz in 0..nz {
                let r = 2.0 * ir as f64 / (nr - 1) as f64;
                let z = -1.0 + 2.0 * iz as f64 / (nz - 1) as f64;
                let rho = ((r - 1.0).powi(2) + z.powi(2)).sqrt();
                let core = (-(rho * rho) / 0.01).exp();
                let side = (-((r - 1.0).powi(2) + (z + 1.4).powi(2)) / 0.5).exp();
                let annulus = if ring { 0.9 * (-((rho - 0.6).powi(2)) / 0.002).exp() } else { 0.0 };
                grid[ir * nz + iz] = core.max(side).max(annulus);
            }
        }
        (grid, nr, nz)
    }

    /// The nearest-closed fallback: the anchor sits beside the core ring,
    /// outside it (an engine axis a few cm off), with a longer open arc at
    /// the same level. The ring is kept while it is within `max_dist`; past
    /// `max_dist` the old longest-chain rule applies.
    #[test]
    fn test_contours_around_nearest_closed_fallback_and_its_radius() {
        let (grid, nr, nz) = two_bump_grid(false);
        let anchor = (1.2, 0.0); // outside the ~0.07 m core ring
        let near = &extract_contours_around(&grid, nr, nz, 0.0, 2.0, -1.0, 1.0, &[0.6], anchor, 0.5)[0].points;
        assert!(is_closed(near, 1e-12) && !encloses(near, anchor), "fallback keeps the closed core ring");
        let far = &extract_contours_around(&grid, nr, nz, 0.0, 2.0, -1.0, 1.0, &[0.6], anchor, 0.1)[0].points;
        assert!(!is_closed(far, 1e-12), "beyond max_dist the longest (open) chain is taken");
    }

    /// Two closed rings at one level both enclosing the anchor (the core
    /// ring and a ring around it): the smaller, the core, is kept.
    #[test]
    fn test_contours_around_prefer_the_smallest_enclosing_ring() {
        let (grid, nr, nz) = two_bump_grid(true);
        let all = chain_list(march_squares_raw(&grid, nr, nz, 0.0, -1.0, 2.0 / 120.0, 2.0 / 120.0, 0.6));
        let enclosing = all.iter().filter(|c| is_closed(c, 1e-12) && encloses(c, (1.0, 0.0))).count();
        assert!(enclosing >= 2, "fixture must have two enclosing rings, has {enclosing}");
        let pick = &extract_contours_around(&grid, nr, nz, 0.0, 2.0, -1.0, 1.0, &[0.6], (1.0, 0.0), 0.5)[0].points;
        let rmax = pick.iter().map(|p| ((p.0 - 1.0).powi(2) + p.1.powi(2)).sqrt()).fold(0.0, f64::max);
        assert!(rmax < 0.2, "kept the core ring, not the outer one (max radius {rmax})");
    }
}

/// Keep only the chains that belong to the plasma: those passing within
/// `tol` of one of the `anchors` (the X-points — the LCFS body and every
/// divertor leg meet there).
///
/// The analytic solution has further ψ=0 chains far from the plasma. At
/// flat-top size they lie outside the vessel and the wall clip removes them,
/// but around a small start-up plasma they fall inside the limiter and were
/// drawn as stray petals. Chains are delimited by jump discontinuities,
/// matching `clip_separatrix_to_wall` and the renderer.
pub fn keep_chains_near(contour: &mut Contour, anchors: &[(f64, f64)], tol: f64) {
    if anchors.is_empty() || contour.points.len() < 2 {
        return;
    }
    const JUMP: f64 = 0.15;
    let pts = std::mem::take(&mut contour.points);
    let n = pts.len();
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(n);
    let mut start = 0usize;
    for i in 1..=n {
        let brk = i == n || {
            let (a, b) = (pts[i - 1], pts[i]);
            (a.0 - b.0).hypot(a.1 - b.1) > JUMP
        };
        if brk {
            let chain = &pts[start..i];
            let near = chain.iter().any(|p| {
                anchors
                    .iter()
                    .any(|x| (p.0 - x.0).hypot(p.1 - x.1) <= tol)
            });
            if near {
                out.extend_from_slice(chain);
            }
            start = i;
        }
    }
    contour.points = out;
}
