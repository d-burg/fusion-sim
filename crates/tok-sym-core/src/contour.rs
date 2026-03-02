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

/// Extract a single contour at the given level using marching squares.
/// Returns line segments as a flat list of (R, Z) points.
/// Consecutive pairs of points form line segments.
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

    // Chain segments into ordered contour paths
    chain_segments(segments)
}

/// Chain disconnected line segments into ordered polylines.
/// Input: pairs of points forming segments [(p0,p1), (p2,p3), ...].
/// Output: ordered points forming connected paths.
fn chain_segments(segments: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    if segments.len() < 2 {
        return segments;
    }

    let n_segs = segments.len() / 2;
    let mut used = vec![false; n_segs];
    let mut result = Vec::with_capacity(segments.len());

    let dist2 = |a: (f64, f64), b: (f64, f64)| -> f64 {
        (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)
    };

    // Find chains starting from unused segments
    for start in 0..n_segs {
        if used[start] {
            continue;
        }

        used[start] = true;
        let mut chain = vec![segments[start * 2], segments[start * 2 + 1]];

        // Extend forward
        let tolerance = 1e-10;
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

        result.extend_from_slice(&chain);
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
pub fn extract_separatrix(
    eq: &crate::equilibrium::CerfonEquilibrium,
    nr: usize,
    nz: usize,
) -> Contour {
    let (r_min, r_max, z_min, z_max) = eq.grid_bounds();
    let grid = eq.psi_grid(r_min, r_max, z_min, z_max, nr, nz);

    let contours = extract_contours(&grid, nr, nz, r_min, r_max, z_min, z_max, &[0.0]);
    contours.into_iter().next().unwrap_or(Contour {
        level: 0.0,
        points: vec![],
    })
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

        let sep = extract_separatrix(&eq, 64, 64);
        assert!(
            !sep.points.is_empty(),
            "Separatrix should have points"
        );
    }
}
