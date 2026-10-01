//! Dump the last closed flux surface of every shipped device to JSON.
//!
//! Used to compare the separatrix before and after the Cerfon-Freidberg basis
//! corrections (github issue #2): run it once on each version of
//! `equilibrium.rs` and plot the two files against each other.
//!
//!   cargo run -p tok-sym-core --example lcfs_export -- /tmp/after.json
//!
//! Every device is solved at its shipped defaults — `Device::from_device`
//! shape parameters, no overrides — so the two runs differ only by the basis.

use tok_sym_core::{
    contour, devices,
    equilibrium::{CerfonEquilibrium, ShapeParams},
};

/// Grid resolution for the marching-squares extraction. High enough that the
/// contour discretisation is well below the shape differences being measured.
const NR: usize = 801;
const NZ: usize = 801;

fn point_in_poly(poly: &[(f64, f64)], r: f64, z: f64) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        if ((yi > z) != (yj > z)) && r < (xj - xi) * (z - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn dist_to_poly(poly: &[(f64, f64)], r: f64, z: f64) -> f64 {
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

fn main() {
    let out_path = std::env::args()
        .nth(1)
        .expect("usage: lcfs_export <output.json>");

    let mut records = Vec::new();

    for device in devices::all_devices() {
        // `CerfonEquilibrium::from_device` hardcodes squareness = 0, but the
        // running simulation passes `device.equilibrium_squareness` (SPARC
        // ships 0.10, fitted to the published inboard chamfer). Match the
        // simulation, so this really is the shape the device runs with.
        let mut shape = ShapeParams::from_device(&device);
        shape.squareness = device.equilibrium_squareness;
        let eq = CerfonEquilibrium::solve(
            &shape,
            device.r0 + device.equilibrium_r0_shift,
            device.z0,
        )
        .unwrap_or_else(|| panic!("{} equilibrium failed to solve", device.id));

        // Extract over the union of the equilibrium grid and the vessel:
        // `grid_bounds()` alone stops ~0.15 R0 outside the plasma and cuts
        // the divertor legs off at the grid edge before they reach their
        // targets, which hides the strike points from any downstream plot.
        let bounds = {
            let (mut r_lo, mut r_hi, mut z_lo, mut z_hi) = eq.grid_bounds();
            for &(r, z) in &device.wall_outline {
                r_lo = r_lo.min(r - 0.05);
                r_hi = r_hi.max(r + 0.05);
                z_lo = z_lo.min(z - 0.05);
                z_hi = z_hi.max(z + 0.05);
            }
            (r_lo, r_hi, z_lo, z_hi)
        };
        let sep = contour::extract_separatrix(&eq, NR, NZ, Some(bounds));
        let (r_axis, z_axis) = eq.axis_physical();

        // The ψ = 0 contour is not purely the plasma boundary: it also carries
        // the open divertor legs, and in double null it splits into inboard
        // and outboard branches at the two X-points. For *shape* metrics we
        // want a surface that is unambiguously closed, so a flux surface just
        // inside the separatrix is extracted as well. It tracks the boundary
        // shape while staying clear of the X-point topology.
        let core_level = 0.995;
        let norm_grid = eq.psi_norm_grid(bounds.0, bounds.1, bounds.2, bounds.3, NR, NZ);
        let core = contour::extract_contours(
            &norm_grid,
            NR,
            NZ,
            bounds.0,
            bounds.1,
            bounds.2,
            bounds.3,
            &[core_level],
        );
        let core_pts: Vec<serde_json::Value> = core
            .first()
            .map(|c| {
                c.points
                    .iter()
                    .map(|(r, z)| serde_json::json!([r, z]))
                    .collect()
            })
            .unwrap_or_default();

        // Bulk wall clearance, measured the way the simulator's limiter check
        // and the SPARC fit harness do: separatrix points below the X-point
        // height, against the published wall polygon.
        let y_xpt = eq.z0 + eq.r0 * 1.01 * eq.shape.epsilon * eq.shape.kappa;
        let wall = &device.wall_outline;
        let mut min_clear = f64::MAX;
        let mut n_outside = 0usize;
        for &(r, z) in &sep.points {
            if (z - eq.z0).abs() >= (y_xpt - eq.z0).abs() - 0.05 {
                continue;
            }
            if point_in_poly(wall, r, z) {
                min_clear = min_clear.min(dist_to_poly(wall, r, z));
            } else {
                n_outside += 1;
            }
        }

        let pts: Vec<serde_json::Value> = sep
            .points
            .iter()
            .map(|(r, z)| serde_json::json!([r, z]))
            .collect();

        records.push(serde_json::json!({
            "id": device.id,
            "name": device.name,
            "config": format!("{:?}", device.config),
            "r0": device.r0,
            "a": device.a,
            "kappa_input": eq.shape.kappa,
            "delta_input": eq.shape.delta,
            "epsilon_input": eq.shape.epsilon,
            "squareness": eq.shape.squareness,
            "coeffs": eq.coeffs,
            "axis": [r_axis, z_axis],
            "psi_axis": eq.psi_axis,
            "bounds": [bounds.0, bounds.1, bounds.2, bounds.3],
            "wall": device.wall_outline,
            "min_wall_clearance_mm": if min_clear == f64::MAX { -1.0 } else { min_clear * 1000.0 },
            "points_outside_wall": n_outside,
            "core_level": core_level,
            "core_surface": core_pts,
            "separatrix": pts,
        }));
    }

    let doc = serde_json::json!({ "devices": records });
    std::fs::write(&out_path, serde_json::to_string(&doc).unwrap())
        .unwrap_or_else(|e| panic!("failed to write {out_path}: {e}"));
    eprintln!("wrote {out_path}");
}
