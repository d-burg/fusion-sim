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

    let n_segs = segments.len() / 2;
    let mut used = vec![false; n_segs];
    let mut best_chain: Vec<(f64, f64)> = Vec::new();

    let dist2 = |a: (f64, f64), b: (f64, f64)| -> f64 {
        (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)
    };

    let tolerance = 1e-10;

    // Find all chains, keep the longest
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

        if chain.len() > best_chain.len() {
            best_chain = chain;
        }
    }

    best_chain
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
}
