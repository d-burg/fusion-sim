//! Cerfon-Freidberg analytic equilibrium solver.
//!
//! Implements the analytic solution to the Grad-Shafranov equation under the
//! Solov'ev assumption (constant p' and FF'). Based on:
//!
//! A. J. Cerfon and J. P. Freidberg, "One size fits all analytic solutions
//! to the Grad-Shafranov equation," Physics of Plasmas 17, 032502 (2010).
//!
//! The general solution in normalized coordinates (x = R/R₀, y = Z/R₀) is:
//!
//!   ψ(x,y) = ψ_particular(x) + Σᵢ cᵢ · ψᵢ(x,y)   (i = 1..12)
//!
//! The 12 coefficients are determined by boundary conditions that enforce
//! the desired plasma shape (elongation, triangularity, X-point location).

use serde::{Deserialize, Serialize};

use crate::devices::{Device, MagneticConfig};

/// Parameters controlling the equilibrium shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeParams {
    /// Inverse aspect ratio ε = a/R₀
    pub epsilon: f64,
    /// Elongation κ
    pub kappa: f64,
    /// Triangularity δ at the X-point end of the plasma (lower for LSN,
    /// upper for USN, and both by symmetry for DN).
    pub delta: f64,
    /// Triangularity δ at the crown — the smooth end opposite the X-point.
    ///
    /// Real single-null shapes are not up-down symmetric: a DIII-D H-mode
    /// runs δ_lower ≈ 0.77 against δ_upper ≈ 0.35, and the recent SPARC
    /// scenarios sit at 0.63 / 0.53. The Cerfon-Freidberg up-down asymmetric
    /// formulation carries both, so the crown row uses this while the
    /// X-point rows use `delta`. `None` falls back to `delta`, reproducing
    /// the old symmetric behaviour.
    pub delta_upper: Option<f64>,
    /// Solov'ev parameter A: ratio of pressure to current contributions.
    /// A = 0 → pure toroidal current; A = 1 → pure pressure driven.
    /// Typical range: -0.2 to 0.3
    pub a_param: f64,
    /// Magnetic configuration
    pub config: MagneticConfig,
    /// X-point location parameter α (poloidal angle, radians).
    /// For LSN, this controls the X-point vertical position.
    /// Typically α = arcsin(δ) for the Cerfon-Freidberg formulation.
    pub x_point_alpha: Option<f64>,
    /// Inboard squareness: extra offset on α in the INBOARD equatorial
    /// curvature row N₂ only. See `Device::equilibrium_squareness`.
    pub squareness: f64,
    /// Outboard squareness: extra offset on α in the OUTBOARD equatorial
    /// curvature row N₁ only. Splitting the two lets the outboard midplane
    /// curvature flatten (fuller shoulder) without tightening the inboard
    /// side — with `squareness_out == squareness` the old single-knob
    /// behaviour is reproduced exactly.
    pub squareness_out: f64,
}

impl ShapeParams {
    pub fn from_device(device: &Device) -> Self {
        // Equilibrium-only triangularities: the GEQDSK-fitted shape wants a
        // different delta than the published values that calibrate transport
        // (see Device::equilibrium_delta_upper).
        let delta = device.equilibrium_delta_lower;
        ShapeParams {
            epsilon: device.epsilon() * device.equilibrium_a_scale,
            kappa: device.kappa * device.equilibrium_kappa_scale,
            delta,
            delta_upper: Some(device.equilibrium_delta_upper),
            a_param: -0.05, // Sensible default
            config: device.config,
            x_point_alpha: Some(delta.asin()),
            // Must match what the running simulation passes, or a device's
            // static preview solves a different shape than its pulse does.
            squareness: device.equilibrium_squareness,
            squareness_out: device.equilibrium_squareness_out,
        }
    }
}

/// The solved Cerfon-Freidberg equilibrium.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CerfonEquilibrium {
    /// The 12 coefficients c₁..c₁₂
    pub coeffs: [f64; 12],
    /// Solov'ev parameter A
    pub a_param: f64,
    /// Major radius R₀ (m) for denormalization
    pub r0: f64,
    /// Vertical offset of plasma center (m).
    /// Z_physical = z0 + y * R₀  (y is the normalized vertical coordinate)
    pub z0: f64,
    /// Shape parameters used
    pub shape: ShapeParams,
    /// Magnetic axis location (x_axis, y_axis) in normalized coords
    pub axis: (f64, f64),
    /// ψ value at the magnetic axis (maximum of ψ)
    pub psi_axis: f64,
    /// ψ value at the separatrix (= 0 by construction)
    pub psi_boundary: f64,
}

// ─── Basis functions ───────────────────────────────────────────────────────

/// Particular solution: ψ_p(x) = x⁴/8 + A·(x²·ln(x)/2 - x⁴/8)
fn psi_particular(x: f64, a: f64) -> f64 {
    let x2 = x * x;
    let x4 = x2 * x2;
    x4 / 8.0 + a * (0.5 * x2 * x.ln() - x4 / 8.0)
}

/// Partial derivatives of the particular solution.
fn dpsi_particular_dx(x: f64, a: f64) -> f64 {
    let x2 = x * x;
    let x3 = x2 * x;
    x3 / 2.0 + a * (x * x.ln() + x / 2.0 - x3 / 2.0)
}

fn d2psi_particular_dy2(x: f64, a: f64) -> f64 {
    // ψ_p has no y dependence, but ∂²ψ_p/∂y² = 0
    let _ = (x, a);
    0.0
}

fn d2psi_particular_dx2(x: f64, a: f64) -> f64 {
    let x2 = x * x;
    3.0 * x2 / 2.0 + a * (x.ln() + 1.5 - 3.0 * x2 / 2.0)
}

/// The 12 homogeneous basis functions ψ_i(x, y).
/// These are exact solutions to the homogeneous GS equation.
fn psi_basis(x: f64, y: f64) -> [f64; 12] {
    let x2 = x * x;
    let x4 = x2 * x2;
    let x6 = x4 * x2;
    let y2 = y * y;
    let y3 = y2 * y;
    let y4 = y2 * y2;
    let y5 = y4 * y;
    let y6 = y4 * y2;
    let lnx = x.ln();

    [
        // ψ₁ = 1
        1.0,
        // ψ₂ = x²
        x2,
        // ψ₃ = y² - x² ln(x)
        y2 - x2 * lnx,
        // ψ₄ = x⁴ - 4x²y²
        x4 - 4.0 * x2 * y2,
        // ψ₅ = 2y⁴ - 9x²y² + 3x⁴ ln(x) - 12x²y² ln(x)
        2.0 * y4 - 9.0 * x2 * y2 + 3.0 * x4 * lnx - 12.0 * x2 * y2 * lnx,
        // ψ₆ = x⁶ - 12x⁴y² + 8x²y⁴
        x6 - 12.0 * x4 * y2 + 8.0 * x2 * y4,
        // ψ₇ = 8y⁶ - 140x²y⁴ + 75x⁴y² - 15x⁶ ln(x) + 180x⁴y² ln(x) - 120x²y⁴ ln(x)
        8.0 * y6 - 140.0 * x2 * y4 + 75.0 * x4 * y2 - 15.0 * x6 * lnx
            + 180.0 * x4 * y2 * lnx
            - 120.0 * x2 * y4 * lnx,
        // ψ₈ = y
        y,
        // ψ₉ = y·x²
        y * x2,
        // ψ₁₀ = y³ - 3y·x² ln(x)
        y3 - 3.0 * y * x2 * lnx,
        // ψ₁₁ = 3y·x⁴ - 4y³·x²
        3.0 * y * x4 - 4.0 * y3 * x2,
        // ψ₁₂ = 8y⁵ - 45y·x⁴ - 80y³·x² ln(x) + 60y·x⁴ ln(x)
        8.0 * y5 - 45.0 * y * x4 - 80.0 * y3 * x2 * lnx + 60.0 * y * x4 * lnx,
    ]
}

/// ∂ψᵢ/∂x for each basis function
fn dpsi_basis_dx(x: f64, y: f64) -> [f64; 12] {
    let x2 = x * x;
    let x3 = x2 * x;
    let x4 = x2 * x2;
    let x5 = x4 * x;
    let y2 = y * y;
    let y3 = y2 * y;
    let y4 = y2 * y2;
    let lnx = x.ln();

    [
        // d/dx(1) = 0
        0.0,
        // d/dx(x²) = 2x
        2.0 * x,
        // d/dx(y² - x² ln(x)) = -2x·ln(x) - x
        -2.0 * x * lnx - x,
        // d/dx(x⁴ - 4x²y²) = 4x³ - 8xy²
        4.0 * x3 - 8.0 * x * y2,
        // d/dx(ψ₅)
        -18.0 * x * y2 + 12.0 * x3 * lnx + 3.0 * x3 - 24.0 * x * y2 * lnx
            - 12.0 * x * y2,
        // d/dx(x⁶ - 12x⁴y² + 8x²y⁴) = 6x⁵ - 48x³y² + 16xy⁴
        6.0 * x5 - 48.0 * x3 * y2 + 16.0 * x * y4,
        // d/dx(ψ₇) = -400xy⁴ + 480x³y² - 90x⁵ln(x) - 15x⁵
        //            + 720x³y² ln(x) - 240xy⁴ ln(x)
        -400.0 * x * y4 + 480.0 * x3 * y2 - 90.0 * x5 * lnx - 15.0 * x5
            + 720.0 * x3 * y2 * lnx
            - 240.0 * x * y4 * lnx,
        // d/dx(y) = 0
        0.0,
        // d/dx(y·x²) = 2xy
        2.0 * x * y,
        // d/dx(y³ - 3y·x² ln(x)) = -6xy·ln(x) - 3xy
        -6.0 * x * y * lnx - 3.0 * x * y,
        // d/dx(3y·x⁴ - 4y³·x²) = 12yx³ - 8y³x
        12.0 * y * x3 - 8.0 * y3 * x,
        // d/dx(ψ₁₂)
        -180.0 * y * x3 - 160.0 * y3 * x * lnx - 80.0 * y3 * x + 240.0 * y * x3 * lnx
            + 60.0 * y * x3,
    ]
}

/// ∂ψᵢ/∂y for each basis function
fn dpsi_basis_dy(x: f64, y: f64) -> [f64; 12] {
    let x2 = x * x;
    let x4 = x2 * x2;
    let y2 = y * y;
    let y3 = y2 * y;
    let y4 = y2 * y2;
    let y5 = y4 * y;
    let lnx = x.ln();

    [
        0.0,                   // d/dy(1)
        0.0,                   // d/dy(x²)
        2.0 * y,               // d/dy(y² - x²ln(x))
        -8.0 * x2 * y,        // d/dy(x⁴ - 4x²y²)
        8.0 * y3 - 18.0 * x2 * y - 24.0 * x2 * y * lnx, // d/dy(ψ₅)
        -24.0 * x4 * y + 32.0 * x2 * y3,                 // d/dy(ψ₆)
        // d/dy(ψ₇) = 48y⁵ - 560x²y³ + 150x⁴y + 360x⁴y ln(x) - 480x²y³ ln(x)
        48.0 * y5 - 560.0 * x2 * y3 + 150.0 * x4 * y + 360.0 * x4 * y * lnx
            - 480.0 * x2 * y3 * lnx,
        1.0,        // d/dy(y)
        x2,         // d/dy(y·x²)
        3.0 * y2 - 3.0 * x2 * lnx, // d/dy(ψ₁₀)
        3.0 * x4 - 12.0 * y2 * x2, // d/dy(ψ₁₁)
        // d/dy(ψ₁₂)
        40.0 * y4 - 45.0 * x4 - 240.0 * y2 * x2 * lnx + 60.0 * x4 * lnx,
    ]
}

/// ∂²ψᵢ/∂y² for each basis function
fn d2psi_basis_dy2(x: f64, y: f64) -> [f64; 12] {
    let x2 = x * x;
    let x4 = x2 * x2;
    let y2 = y * y;
    let y3 = y2 * y;
    let y4 = y2 * y2;
    let lnx = x.ln();

    [
        0.0,
        0.0,
        2.0,
        -8.0 * x2,
        24.0 * y2 - 18.0 * x2 - 24.0 * x2 * lnx,
        -24.0 * x4 + 96.0 * x2 * y2,
        // ψ₇: 240y⁴ - 1680x²y² + 150x⁴ + 360x⁴ln(x) - 1440x²y² ln(x)
        240.0 * y4 - 1680.0 * x2 * y2 + 150.0 * x4 + 360.0 * x4 * lnx
            - 1440.0 * x2 * y2 * lnx,
        0.0,
        0.0,
        6.0 * y,
        -24.0 * y * x2,
        160.0 * y3 - 480.0 * y * x2 * lnx,
    ]
}

/// ∂²ψᵢ/∂x² for each basis function
fn d2psi_basis_dx2(x: f64, y: f64) -> [f64; 12] {
    let x2 = x * x;
    let x4 = x2 * x2;
    let y2 = y * y;
    let y3 = y2 * y;
    let y4 = y2 * y2;
    let lnx = x.ln();

    [
        0.0,
        2.0,
        -2.0 * lnx - 3.0,
        12.0 * x2 - 8.0 * y2,
        // ψ₅
        -54.0 * y2 + 36.0 * x2 * lnx + 21.0 * x2 - 24.0 * y2 * lnx,
        // ψ₆
        30.0 * x4 - 144.0 * x2 * y2 + 16.0 * y4,
        // ψ₇
        -640.0 * y4 + 2160.0 * x2 * y2 - 450.0 * x4 * lnx - 165.0 * x4
            + 2160.0 * x2 * y2 * lnx
            - 240.0 * y4 * lnx,
        0.0,
        2.0 * y,
        -6.0 * y * lnx - 9.0 * y,
        36.0 * y * x2 - 8.0 * y3,
        // ψ₁₂
        -120.0 * y * x2 - 160.0 * y3 * lnx - 240.0 * y3 + 720.0 * y * x2 * lnx,
    ]
}

// ─── Boundary condition assembly ───────────────────────────────────────────

/// Assemble the 12×12 linear system for a lower single null equilibrium.
///
/// Boundary conditions (Cerfon-Freidberg Table I for "up-down asymmetric"):
/// 1. ψ = 0 at outboard midplane (x = 1+ε, y = 0)
/// 2. ψ = 0 at inboard midplane (x = 1-ε, y = 0)
/// 3. ψ = 0 at X-point (x_X, y_X)
/// 4. ∂ψ/∂x = 0 at X-point
/// 5. ∂ψ/∂y = 0 at X-point
/// 6. ∂ψ/∂y = 0 at outboard midplane (midplane symmetry)
/// 7. ∂ψ/∂y = 0 at inboard midplane
/// 8-9. ∂²ψ/∂y² curvature at outboard/inboard for elongation
/// 10. ψ = 0 at upper crown (x_top, y_top) - top of plasma
/// 11. ∂ψ/∂x = 0 at upper crown (vertical tangent)
/// 12. Constraint on curvature at top for triangularity
fn assemble_lsn_system(shape: &ShapeParams) -> ([f64; 144], [f64; 12]) {
    let eps = shape.epsilon;
    let kappa = shape.kappa;
    let delta = shape.delta;
    let a = shape.a_param;
    let sq = shape.squareness;
    let sq_out = shape.squareness_out;

    // Key boundary points in normalized coordinates
    let x_out = 1.0 + eps; // outboard midplane
    let x_in = 1.0 - eps; // inboard midplane
    let y_mid = 0.0;

    // X-point location for LSN — governed by the lower triangularity.
    let alpha = shape.x_point_alpha.unwrap_or(delta.asin());
    let x_xpt = 1.0 - 1.01 * eps * delta; // slightly inboard due to Shafranov shift
    let y_xpt = -1.01 * eps * kappa; // below midplane

    // Upper crown (top of plasma) — governed by the UPPER triangularity,
    // which on a real single null differs substantially from the lower one.
    let delta_top = shape.delta_upper.unwrap_or(delta);
    let alpha_top = delta_top.asin();
    let x_top = 1.0 - eps * delta_top;
    let y_top = eps * kappa;

    // N1, N2, N3 curvature constraints from Cerfon-Freidberg.
    //
    // All three are curvatures of the parametrized boundary
    //   R = 1 + ε cos(τ + α sin τ),  Z = εκ sin τ
    // and so share the same α = arcsin(δ):
    //   N1 = -(1+α)² / (ε κ²)   outboard equatorial point
    //   N2 =  (1-α)² / (ε κ²)   inboard equatorial point
    //   N3 = -κ / (ε cos²α)     high point
    //
    // Squareness is an additional device knob layered on top of α in the
    // equatorial rows only (see Device::equilibrium_squareness), split per
    // side: `squareness_out` shifts the OUTBOARD row N1, `squareness` the
    // INBOARD row N2. The split exists because one shared offset couples two
    // opposite appetites — flattening the outboard midplane curvature (a
    // fuller shoulder) previously tightened the inboard side in lockstep.
    //
    // The equatorial rows see the mean of the two triangularities, since each
    // equatorial point is shared between the upper and lower halves; the
    // crown row N3 uses the upper α alone.
    let alpha_eq = 0.5 * (alpha + alpha_top);
    let n1 = -(1.0 + alpha_eq + sq_out).powi(2) / (eps * kappa * kappa);
    let n2 = (1.0 - (alpha_eq + sq)).powi(2) / (eps * kappa * kappa);
    let n3 = -kappa / (eps * alpha_top.cos().powi(2));

    let mut mat = [0.0f64; 144]; // 12×12 row-major
    let mut rhs = [0.0f64; 12];

    // Helper to set row i of the matrix
    let set_row = |mat: &mut [f64; 144], row: usize, vals: &[f64; 12]| {
        for j in 0..12 {
            mat[row * 12 + j] = vals[j];
        }
    };

    // Row 0: ψ = 0 at outboard midplane
    let basis_out = psi_basis(x_out, y_mid);
    set_row(&mut mat, 0, &basis_out);
    rhs[0] = -psi_particular(x_out, a);

    // Row 1: ψ = 0 at inboard midplane
    let basis_in = psi_basis(x_in, y_mid);
    set_row(&mut mat, 1, &basis_in);
    rhs[1] = -psi_particular(x_in, a);

    // Row 2: ψ = 0 at X-point
    let basis_xpt = psi_basis(x_xpt, y_xpt);
    set_row(&mut mat, 2, &basis_xpt);
    rhs[2] = -psi_particular(x_xpt, a);

    // Row 3: ∂ψ/∂x = 0 at X-point
    let dbasis_dx_xpt = dpsi_basis_dx(x_xpt, y_xpt);
    set_row(&mut mat, 3, &dbasis_dx_xpt);
    rhs[3] = -dpsi_particular_dx(x_xpt, a);

    // Row 4: ∂ψ/∂y = 0 at X-point
    let dbasis_dy_xpt = dpsi_basis_dy(x_xpt, y_xpt);
    set_row(&mut mat, 4, &dbasis_dy_xpt);
    rhs[4] = 0.0; // particular solution has no y dependence

    // Row 5: ∂ψ/∂y = 0 at outboard midplane
    let dbasis_dy_out = dpsi_basis_dy(x_out, y_mid);
    set_row(&mut mat, 5, &dbasis_dy_out);
    rhs[5] = 0.0;

    // Row 6: ∂ψ/∂y = 0 at inboard midplane
    let dbasis_dy_in = dpsi_basis_dy(x_in, y_mid);
    set_row(&mut mat, 6, &dbasis_dy_in);
    rhs[6] = 0.0;

    // Row 7: Curvature at outboard midplane → elongation
    // N1 · ∂ψ/∂x + ∂²ψ/∂y² = 0 at (x_out, 0)
    let d2basis_dy2_out = d2psi_basis_dy2(x_out, y_mid);
    let dbasis_dx_out = dpsi_basis_dx(x_out, y_mid);
    let mut row7 = [0.0f64; 12];
    for j in 0..12 {
        row7[j] = n1 * dbasis_dx_out[j] + d2basis_dy2_out[j];
    }
    set_row(&mut mat, 7, &row7);
    rhs[7] = -(n1 * dpsi_particular_dx(x_out, a) + d2psi_particular_dy2(x_out, a));

    // Row 8: Curvature at inboard midplane → elongation
    let d2basis_dy2_in = d2psi_basis_dy2(x_in, y_mid);
    let dbasis_dx_in = dpsi_basis_dx(x_in, y_mid);
    let mut row8 = [0.0f64; 12];
    for j in 0..12 {
        row8[j] = n2 * dbasis_dx_in[j] + d2basis_dy2_in[j];
    }
    set_row(&mut mat, 8, &row8);
    rhs[8] = -(n2 * dpsi_particular_dx(x_in, a) + d2psi_particular_dy2(x_in, a));

    // Row 9: ψ = 0 at upper crown
    let basis_top = psi_basis(x_top, y_top);
    set_row(&mut mat, 9, &basis_top);
    rhs[9] = -psi_particular(x_top, a);

    // Row 10: ∂ψ/∂x = 0 at upper crown (vertical tangent)
    let dbasis_dx_top = dpsi_basis_dx(x_top, y_top);
    set_row(&mut mat, 10, &dbasis_dx_top);
    rhs[10] = -dpsi_particular_dx(x_top, a);

    // Row 11: Curvature at upper crown → triangularity
    // N3 · ∂ψ/∂y + ∂²ψ/∂x² = 0 at (x_top, y_top)
    let d2basis_dx2_top = d2psi_basis_dx2(x_top, y_top);
    let dbasis_dy_top = dpsi_basis_dy(x_top, y_top);
    let mut row11 = [0.0f64; 12];
    for j in 0..12 {
        row11[j] = n3 * dbasis_dy_top[j] + d2basis_dx2_top[j];
    }
    set_row(&mut mat, 11, &row11);
    rhs[11] = -(n3 * 0.0 + d2psi_particular_dx2(x_top, a));

    (mat, rhs)
}

/// Assemble the 12×12 system for a LIMITED (up-down symmetric, X-point-free)
/// equilibrium — Cerfon-Freidberg Sec. III, the "one size fits all" symmetric
/// case with a smooth high point instead of a null.
///
/// A limited plasma has no X-point at all: its last closed surface is the
/// smooth boundary
///   x = 1 + ε cos(τ + α sin τ),   y = εκ sin τ,   α = arcsin δ
/// tangent to a limiter. Solving `Limited` with the LSN system instead (as
/// this module used to) imposes ∇ψ = 0 at a point below the plasma, which
/// gives a pointed bottom and a pair of virtual divertor legs — the shape a
/// limited discharge specifically does not have.
///
/// Up-down symmetry kills the odd basis functions ψ₈–ψ₁₂, so there are seven
/// unknowns c₁–c₇ and seven conditions (C-F eqs. 9–11):
///
/// 1. ψ(1+ε, 0)   = 0                       outer equatorial point
/// 2. ψ(1−ε, 0)   = 0                       inner equatorial point
/// 3. ψ(1−δε, κε) = 0                       high point
/// 4. ψ_x(1−δε, κε) = 0                     high point is a boundary maximum
/// 5. ψ_yy(1+ε, 0)   = −N₁ ψ_x(1+ε, 0)      outer equatorial curvature
/// 6. ψ_yy(1−ε, 0)   = −N₂ ψ_x(1−ε, 0)      inner equatorial curvature
/// 7. ψ_xx(1−δε, κε) = −N₃ ψ_y(1−δε, κε)    high-point curvature
///
/// with N₁ = −(1+α)²/(εκ²), N₂ = (1−α)²/(εκ²), N₃ = −κ/(ε cos²α).
///
/// As with `assemble_dn_system`, the remaining rows 7–11 are identity rows
/// forcing c₈ = … = c₁₂ = 0 so the existing 12×12 solver is reused unchanged.
///
/// Deliberately ignored for this configuration:
/// * `delta_upper` — the shape is up-down symmetric by construction, so a
///   separate crown triangularity has no meaning here;
/// * `squareness` / `squareness_out` — those knobs were fitted against
///   diverted flat-top reference equilibria and the caller already ramps them
///   to zero through the limited phase;
/// * `x_point_alpha` — there is no X-point; α is taken as arcsin δ.
fn assemble_limited_system(shape: &ShapeParams) -> ([f64; 144], [f64; 12]) {
    let eps = shape.epsilon;
    let kappa = shape.kappa;
    let delta = shape.delta;
    let a = shape.a_param;

    let x_out = 1.0 + eps;
    let x_in = 1.0 - eps;
    let y_mid = 0.0;

    // High point (top of the plasma). Its mirror image at −κε is enforced
    // automatically by the up-down symmetry of the retained basis.
    let x_top = 1.0 - delta * eps;
    let y_top = kappa * eps;

    let alpha = delta.asin();
    let n1 = -(1.0 + alpha).powi(2) / (eps * kappa * kappa);
    let n2 = (1.0 - alpha).powi(2) / (eps * kappa * kappa);
    let n3 = -kappa / (eps * alpha.cos().powi(2));

    let mut mat = [0.0f64; 144];
    let mut rhs = [0.0f64; 12];

    let set_row = |mat: &mut [f64; 144], row: usize, vals: &[f64; 12]| {
        for j in 0..12 {
            mat[row * 12 + j] = vals[j];
        }
    };

    // Row 0: ψ = 0 at the outer equatorial point
    set_row(&mut mat, 0, &psi_basis(x_out, y_mid));
    rhs[0] = -psi_particular(x_out, a);

    // Row 1: ψ = 0 at the inner equatorial point
    set_row(&mut mat, 1, &psi_basis(x_in, y_mid));
    rhs[1] = -psi_particular(x_in, a);

    // Row 2: ψ = 0 at the high point
    set_row(&mut mat, 2, &psi_basis(x_top, y_top));
    rhs[2] = -psi_particular(x_top, a);

    // Row 3: ∂ψ/∂x = 0 at the high point (horizontal tangent → it is the
    // vertical extremum of the boundary)
    set_row(&mut mat, 3, &dpsi_basis_dx(x_top, y_top));
    rhs[3] = -dpsi_particular_dx(x_top, a);

    // Row 4: N₁ curvature at the outer equatorial point
    let d2basis_dy2_out = d2psi_basis_dy2(x_out, y_mid);
    let dbasis_dx_out = dpsi_basis_dx(x_out, y_mid);
    let mut row4 = [0.0f64; 12];
    for j in 0..12 {
        row4[j] = n1 * dbasis_dx_out[j] + d2basis_dy2_out[j];
    }
    set_row(&mut mat, 4, &row4);
    rhs[4] = -(n1 * dpsi_particular_dx(x_out, a) + d2psi_particular_dy2(x_out, a));

    // Row 5: N₂ curvature at the inner equatorial point
    let d2basis_dy2_in = d2psi_basis_dy2(x_in, y_mid);
    let dbasis_dx_in = dpsi_basis_dx(x_in, y_mid);
    let mut row5 = [0.0f64; 12];
    for j in 0..12 {
        row5[j] = n2 * dbasis_dx_in[j] + d2basis_dy2_in[j];
    }
    set_row(&mut mat, 5, &row5);
    rhs[5] = -(n2 * dpsi_particular_dx(x_in, a) + d2psi_particular_dy2(x_in, a));

    // Row 6: N₃ curvature at the high point → triangularity
    let d2basis_dx2_top = d2psi_basis_dx2(x_top, y_top);
    let dbasis_dy_top = dpsi_basis_dy(x_top, y_top);
    let mut row6 = [0.0f64; 12];
    for j in 0..12 {
        row6[j] = n3 * dbasis_dy_top[j] + d2basis_dx2_top[j];
    }
    set_row(&mut mat, 6, &row6);
    // ψ_p has no y dependence, so the N₃ ψ_p,y term vanishes.
    rhs[6] = -d2psi_particular_dx2(x_top, a);

    // Rows 7–11: enforce c₈ = c₉ = c₁₀ = c₁₁ = c₁₂ = 0 (odd basis = 0)
    for k in 0..5 {
        let row = 7 + k;
        let col = 7 + k; // coefficients c₈–c₁₂ (indices 7–11)
        mat[row * 12 + col] = 1.0;
        rhs[row] = 0.0;
    }

    (mat, rhs)
}

/// Assemble the 12×12 system for an upper single null equilibrium.
///
/// Mirror of LSN: the X-point is above the midplane (+y), and the
/// "lower crown" (bottom of plasma) carries the curvature constraint.
fn assemble_usn_system(shape: &ShapeParams) -> ([f64; 144], [f64; 12]) {
    let eps = shape.epsilon;
    let kappa = shape.kappa;
    let delta = shape.delta;
    let a = shape.a_param;
    let sq = shape.squareness;
    let sq_out = shape.squareness_out;

    let x_out = 1.0 + eps;
    let x_in = 1.0 - eps;
    let y_mid = 0.0;

    // X-point above midplane for USN. The roles of the two triangularities
    // swap relative to LSN: the X-point is now the upper end of the plasma
    // and the crown the lower, so `delta_upper` drives the X-point and
    // `delta` (the X-point-end value) drives the crown.
    let delta_xpt = shape.delta_upper.unwrap_or(delta);
    let alpha = shape
        .x_point_alpha
        .unwrap_or_else(|| delta_xpt.asin());
    let x_xpt = 1.0 - 1.01 * eps * delta_xpt;
    let y_xpt = 1.01 * eps * kappa; // POSITIVE — above midplane

    // Lower crown (bottom of plasma) — mirror of LSN upper crown
    let alpha_bot = delta.asin();
    let x_bot = 1.0 - eps * delta;
    let y_bot = -eps * kappa; // below midplane

    // Same Cerfon-Freidberg curvatures as the LSN case (see there), with the
    // same per-side squareness split.
    let alpha_eq = 0.5 * (alpha + alpha_bot);
    let n1 = -(1.0 + alpha_eq + sq_out).powi(2) / (eps * kappa * kappa);
    let n2 = (1.0 - (alpha_eq + sq)).powi(2) / (eps * kappa * kappa);
    // N3 curvature at the lower crown (sign flipped vs LSN); the crown's own
    // triangularity governs it, as in the LSN case.
    let n3 = -kappa / (eps * alpha_bot.cos().powi(2));

    let mut mat = [0.0f64; 144];
    let mut rhs = [0.0f64; 12];

    let set_row = |mat: &mut [f64; 144], row: usize, vals: &[f64; 12]| {
        for j in 0..12 {
            mat[row * 12 + j] = vals[j];
        }
    };

    // Row 0: ψ = 0 at outboard midplane
    set_row(&mut mat, 0, &psi_basis(x_out, y_mid));
    rhs[0] = -psi_particular(x_out, a);

    // Row 1: ψ = 0 at inboard midplane
    set_row(&mut mat, 1, &psi_basis(x_in, y_mid));
    rhs[1] = -psi_particular(x_in, a);

    // Row 2: ψ = 0 at X-point (above midplane)
    set_row(&mut mat, 2, &psi_basis(x_xpt, y_xpt));
    rhs[2] = -psi_particular(x_xpt, a);

    // Row 3: ∂ψ/∂x = 0 at X-point
    set_row(&mut mat, 3, &dpsi_basis_dx(x_xpt, y_xpt));
    rhs[3] = -dpsi_particular_dx(x_xpt, a);

    // Row 4: ∂ψ/∂y = 0 at X-point
    set_row(&mut mat, 4, &dpsi_basis_dy(x_xpt, y_xpt));
    rhs[4] = 0.0;

    // Row 5: ∂ψ/∂y = 0 at outboard midplane
    set_row(&mut mat, 5, &dpsi_basis_dy(x_out, y_mid));
    rhs[5] = 0.0;

    // Row 6: ∂ψ/∂y = 0 at inboard midplane
    set_row(&mut mat, 6, &dpsi_basis_dy(x_in, y_mid));
    rhs[6] = 0.0;

    // Row 7: Curvature at outboard midplane → elongation
    let d2basis_dy2_out = d2psi_basis_dy2(x_out, y_mid);
    let dbasis_dx_out = dpsi_basis_dx(x_out, y_mid);
    let mut row7 = [0.0f64; 12];
    for j in 0..12 {
        row7[j] = n1 * dbasis_dx_out[j] + d2basis_dy2_out[j];
    }
    set_row(&mut mat, 7, &row7);
    rhs[7] = -(n1 * dpsi_particular_dx(x_out, a) + d2psi_particular_dy2(x_out, a));

    // Row 8: Curvature at inboard midplane → elongation
    let d2basis_dy2_in = d2psi_basis_dy2(x_in, y_mid);
    let dbasis_dx_in = dpsi_basis_dx(x_in, y_mid);
    let mut row8 = [0.0f64; 12];
    for j in 0..12 {
        row8[j] = n2 * dbasis_dx_in[j] + d2basis_dy2_in[j];
    }
    set_row(&mut mat, 8, &row8);
    rhs[8] = -(n2 * dpsi_particular_dx(x_in, a) + d2psi_particular_dy2(x_in, a));

    // Row 9: ψ = 0 at lower crown (bottom of plasma)
    set_row(&mut mat, 9, &psi_basis(x_bot, y_bot));
    rhs[9] = -psi_particular(x_bot, a);

    // Row 10: ∂ψ/∂x = 0 at lower crown (vertical tangent)
    set_row(&mut mat, 10, &dpsi_basis_dx(x_bot, y_bot));
    rhs[10] = -dpsi_particular_dx(x_bot, a);

    // Row 11: Curvature at lower crown → triangularity
    // N3 · ∂ψ/∂y + ∂²ψ/∂x² = 0 at (x_bot, y_bot)
    // Note: for the lower crown we negate N3 because the curvature
    // direction reverses relative to the upper crown in LSN.
    let d2basis_dx2_bot = d2psi_basis_dx2(x_bot, y_bot);
    let dbasis_dy_bot = dpsi_basis_dy(x_bot, y_bot);
    let mut row11 = [0.0f64; 12];
    for j in 0..12 {
        row11[j] = -n3 * dbasis_dy_bot[j] + d2basis_dx2_bot[j];
    }
    set_row(&mut mat, 11, &row11);
    rhs[11] = -(-n3 * 0.0 + d2psi_particular_dx2(x_bot, a));

    (mat, rhs)
}

/// Assemble the 12×12 system for a double null (up-down symmetric) equilibrium.
///
/// For DN, up-down symmetry forces the odd basis functions (ψ₈–ψ₁₂) to zero,
/// reducing to 7 unknowns (c₁–c₇).  We use the full 12×12 matrix with
/// identity rows for c₈–c₁₂ = 0.
///
/// The 7 boundary conditions are:
/// 1. ψ = 0 at outboard midplane
/// 2. ψ = 0 at inboard midplane
/// 3. ψ = 0 at lower X-point (upper is automatic by symmetry)
/// 4. ∂ψ/∂x = 0 at lower X-point
/// 5. ∂ψ/∂y = 0 at lower X-point
/// 6. N1 curvature at outboard midplane
/// 7. N2 curvature at inboard midplane
fn assemble_dn_system(shape: &ShapeParams) -> ([f64; 144], [f64; 12]) {
    let eps = shape.epsilon;
    let kappa = shape.kappa;
    let delta = shape.delta;
    let a = shape.a_param;
    let sq = shape.squareness;
    let sq_out = shape.squareness_out;

    let x_out = 1.0 + eps;
    let x_in = 1.0 - eps;
    let y_mid = 0.0;

    // X-point location (lower) — upper is symmetric at +y_xpt
    let x_xpt = 1.0 - 1.01 * eps * delta;
    let y_xpt = -1.01 * eps * kappa;

    // Same Cerfon-Freidberg curvatures as the LSN case (see there). Double
    // null has no crown row, so only the equatorial N1/N2 appear.
    let alpha = shape.x_point_alpha.unwrap_or(delta.asin());
    let n1 = -(1.0 + alpha + sq_out).powi(2) / (eps * kappa * kappa);
    let n2 = (1.0 - (alpha + sq)).powi(2) / (eps * kappa * kappa);

    let mut mat = [0.0f64; 144];
    let mut rhs = [0.0f64; 12];

    let set_row = |mat: &mut [f64; 144], row: usize, vals: &[f64; 12]| {
        for j in 0..12 {
            mat[row * 12 + j] = vals[j];
        }
    };

    // Row 0: ψ = 0 at outboard midplane
    set_row(&mut mat, 0, &psi_basis(x_out, y_mid));
    rhs[0] = -psi_particular(x_out, a);

    // Row 1: ψ = 0 at inboard midplane
    set_row(&mut mat, 1, &psi_basis(x_in, y_mid));
    rhs[1] = -psi_particular(x_in, a);

    // Row 2: ψ = 0 at lower X-point
    set_row(&mut mat, 2, &psi_basis(x_xpt, y_xpt));
    rhs[2] = -psi_particular(x_xpt, a);

    // Row 3: ∂ψ/∂x = 0 at lower X-point
    set_row(&mut mat, 3, &dpsi_basis_dx(x_xpt, y_xpt));
    rhs[3] = -dpsi_particular_dx(x_xpt, a);

    // Row 4: ∂ψ/∂y = 0 at lower X-point
    set_row(&mut mat, 4, &dpsi_basis_dy(x_xpt, y_xpt));
    rhs[4] = 0.0;

    // Row 5: N1 curvature at outboard midplane → elongation
    let d2basis_dy2_out = d2psi_basis_dy2(x_out, y_mid);
    let dbasis_dx_out = dpsi_basis_dx(x_out, y_mid);
    let mut row5 = [0.0f64; 12];
    for j in 0..12 {
        row5[j] = n1 * dbasis_dx_out[j] + d2basis_dy2_out[j];
    }
    set_row(&mut mat, 5, &row5);
    rhs[5] = -(n1 * dpsi_particular_dx(x_out, a) + d2psi_particular_dy2(x_out, a));

    // Row 6: N2 curvature at inboard midplane → elongation
    let d2basis_dy2_in = d2psi_basis_dy2(x_in, y_mid);
    let dbasis_dx_in = dpsi_basis_dx(x_in, y_mid);
    let mut row6 = [0.0f64; 12];
    for j in 0..12 {
        row6[j] = n2 * dbasis_dx_in[j] + d2basis_dy2_in[j];
    }
    set_row(&mut mat, 6, &row6);
    rhs[6] = -(n2 * dpsi_particular_dx(x_in, a) + d2psi_particular_dy2(x_in, a));

    // Rows 7–11: enforce c₈ = c₉ = c₁₀ = c₁₁ = c₁₂ = 0 (odd basis = 0)
    for k in 0..5 {
        let row = 7 + k;
        let col = 7 + k; // coefficients c₈–c₁₂ (indices 7–11)
        mat[row * 12 + col] = 1.0;
        rhs[row] = 0.0;
    }

    (mat, rhs)
}

// ─── Linear algebra (12×12 Gaussian elimination) ──────────────────────────

/// Solve a 12×12 linear system Ax = b using Gaussian elimination with
/// partial pivoting. Returns the solution vector x.
fn solve_12x12(mat: &[f64; 144], rhs: &[f64; 12]) -> Option<[f64; 12]> {
    let n = 12;
    // Create augmented matrix [A|b]
    let mut aug = [[0.0f64; 13]; 12];
    for i in 0..n {
        for j in 0..n {
            aug[i][j] = mat[i * n + j];
        }
        aug[i][n] = rhs[i];
    }

    // Forward elimination with partial pivoting
    for col in 0..n {
        // Find pivot
        let mut max_val = aug[col][col].abs();
        let mut max_row = col;
        for row in (col + 1)..n {
            if aug[row][col].abs() > max_val {
                max_val = aug[row][col].abs();
                max_row = row;
            }
        }

        if max_val < 1e-15 {
            return None; // Singular matrix
        }

        // Swap rows
        if max_row != col {
            aug.swap(col, max_row);
        }

        // Eliminate below
        let pivot = aug[col][col];
        for row in (col + 1)..n {
            let factor = aug[row][col] / pivot;
            for j in col..=n {
                aug[row][j] -= factor * aug[col][j];
            }
        }
    }

    // Back substitution
    let mut x = [0.0f64; 12];
    for i in (0..n).rev() {
        let mut sum = aug[i][n];
        for j in (i + 1)..n {
            sum -= aug[i][j] * x[j];
        }
        x[i] = sum / aug[i][i];
    }

    Some(x)
}

// ─── Public API ────────────────────────────────────────────────────────────

impl CerfonEquilibrium {
    /// Solve for the equilibrium coefficients given shape parameters.
    pub fn solve(shape: &ShapeParams, r0: f64, z0: f64) -> Option<Self> {
        let (mat, rhs) = match shape.config {
            MagneticConfig::LowerSingleNull => assemble_lsn_system(shape),
            // A limited plasma is X-point-free: it gets the up-down symmetric
            // smooth-boundary system, not the LSN one (see
            // `assemble_limited_system`).
            MagneticConfig::Limited => assemble_limited_system(shape),
            MagneticConfig::UpperSingleNull => assemble_usn_system(shape),
            MagneticConfig::DoubleNull => assemble_dn_system(shape),
        };

        let coeffs = solve_12x12(&mat, &rhs)?;

        let mut eq = CerfonEquilibrium {
            coeffs,
            a_param: shape.a_param,
            r0,
            z0,
            shape: shape.clone(),
            axis: (1.0, 0.0), // initial guess
            psi_axis: 0.0,
            psi_boundary: 0.0,
        };

        // Find the magnetic axis (O-point) by searching for ψ maximum
        eq.find_axis();

        Some(eq)
    }

    /// Solve equilibrium for a given device with default shape.
    /// The equilibrium centre carries the device's fit shift (see
    /// Device::equilibrium_r0_shift) — physics quantities do not.
    pub fn from_device(device: &Device) -> Option<Self> {
        let shape = ShapeParams::from_device(device);
        Self::solve(&shape, device.r0 + device.equilibrium_r0_shift, device.z0)
    }

    /// Evaluate ψ at normalized coordinates (x, y).
    #[inline]
    pub fn psi_normalized(&self, x: f64, y: f64) -> f64 {
        if x <= 0.0 {
            return 0.0;
        }
        let basis = psi_basis(x, y);
        let mut val = psi_particular(x, self.a_param);
        for i in 0..12 {
            val += self.coeffs[i] * basis[i];
        }
        val
    }

    /// Evaluate ψ at physical coordinates (R, Z) in meters.
    /// The z0 offset is subtracted so the equilibrium "sees" coordinates
    /// relative to the plasma center.
    #[inline]
    pub fn psi(&self, r: f64, z: f64) -> f64 {
        self.psi_normalized(r / self.r0, (z - self.z0) / self.r0)
    }

    /// Evaluate normalized poloidal flux ψ_N ∈ [0, 1] where 0 = axis, 1 = separatrix.
    #[inline]
    pub fn psi_norm(&self, r: f64, z: f64) -> f64 {
        if self.psi_axis.abs() < 1e-20 {
            return 0.0;
        }
        let psi_val = self.psi(r, z);
        (psi_val - self.psi_axis) / (self.psi_boundary - self.psi_axis)
    }

    /// ∂ψ/∂x at normalized coordinates
    pub fn dpsi_dx(&self, x: f64, y: f64) -> f64 {
        if x <= 0.0 {
            return 0.0;
        }
        let dbasis = dpsi_basis_dx(x, y);
        let mut val = dpsi_particular_dx(x, self.a_param);
        for i in 0..12 {
            val += self.coeffs[i] * dbasis[i];
        }
        val
    }

    /// ∂ψ/∂y at normalized coordinates
    pub fn dpsi_dy(&self, x: f64, y: f64) -> f64 {
        let dbasis = dpsi_basis_dy(x, y);
        let mut val = 0.0; // particular solution has no y dependence
        for i in 0..12 {
            val += self.coeffs[i] * dbasis[i];
        }
        val
    }

    /// Evaluate ψ on a grid in physical coordinates.
    /// Returns a flat array of ψ values, row-major (Z varies fastest).
    pub fn psi_grid(
        &self,
        r_min: f64,
        r_max: f64,
        z_min: f64,
        z_max: f64,
        nr: usize,
        nz: usize,
    ) -> Vec<f64> {
        let mut grid = vec![0.0; nr * nz];
        let dr = (r_max - r_min) / (nr - 1) as f64;
        let dz = (z_max - z_min) / (nz - 1) as f64;

        for ir in 0..nr {
            let r = r_min + ir as f64 * dr;
            for iz in 0..nz {
                let z = z_min + iz as f64 * dz;
                grid[ir * nz + iz] = self.psi(r, z);
            }
        }
        grid
    }

    /// Evaluate normalized ψ on a grid suitable for contouring.
    pub fn psi_norm_grid(
        &self,
        r_min: f64,
        r_max: f64,
        z_min: f64,
        z_max: f64,
        nr: usize,
        nz: usize,
    ) -> Vec<f64> {
        let mut grid = vec![0.0; nr * nz];
        let dr = (r_max - r_min) / (nr - 1) as f64;
        let dz = (z_max - z_min) / (nz - 1) as f64;

        for ir in 0..nr {
            let r = r_min + ir as f64 * dr;
            for iz in 0..nz {
                let z = z_min + iz as f64 * dz;
                grid[ir * nz + iz] = self.psi_norm(r, z);
            }
        }
        grid
    }

    /// Find the magnetic axis (O-point) by gradient search.
    fn find_axis(&mut self) {
        // Always start from a fixed starting guess near the geometric center.
        // Using the previous axis as a starting guess can cause convergence issues
        // when epsilon changes between frames (the axis can drift to a false maximum
        // outside the plasma, especially during the limited→diverted transition).
        let (mut x, mut y) = (1.0 + 0.05, 0.0); // slight Shafranov shift outboard

        for _ in 0..100 {
            let gx = self.dpsi_dx(x, y);
            let gy = self.dpsi_dy(x, y);

            if gx.abs() < 1e-12 && gy.abs() < 1e-12 {
                break;
            }

            // Simple gradient ascent (ψ is maximum at axis for our convention)
            let step = 0.001;
            x += step * gx;
            y += step * gy;

            // Keep within plasma region
            x = x.clamp(1.0 - self.shape.epsilon * 0.9, 1.0 + self.shape.epsilon * 0.9);
            y = y.clamp(-self.shape.epsilon * self.shape.kappa * 0.5,
                        self.shape.epsilon * self.shape.kappa * 0.5);
        }

        self.axis = (x, y);
        self.psi_axis = self.psi_normalized(x, y);
        self.psi_boundary = 0.0; // separatrix is ψ = 0 by construction
    }

    /// Get the magnetic axis in physical coordinates (R, Z) in meters.
    pub fn axis_physical(&self) -> (f64, f64) {
        (self.axis.0 * self.r0, self.axis.1 * self.r0 + self.z0)
    }

    /// Get the primary X-point location in physical coordinates.
    /// For LSN/DN returns the lower X-point; for USN returns the upper.
    pub fn x_point_physical(&self) -> (f64, f64) {
        let eps = self.shape.epsilon;
        let kappa = self.shape.kappa;
        let delta = self.shape.delta;
        let x_xpt = 1.0 - 1.01 * eps * delta;
        match self.shape.config {
            MagneticConfig::UpperSingleNull => {
                let y_xpt = 1.01 * eps * kappa;
                (x_xpt * self.r0, y_xpt * self.r0 + self.z0)
            }
            _ => {
                let y_xpt = -1.01 * eps * kappa;
                (x_xpt * self.r0, y_xpt * self.r0 + self.z0)
            }
        }
    }

    /// Get both X-point locations: (lower, upper).
    /// Returns (None, None) for Limited; (Some, None) for LSN; etc.
    pub fn x_points_physical(&self) -> (Option<(f64, f64)>, Option<(f64, f64)>) {
        let eps = self.shape.epsilon;
        let kappa = self.shape.kappa;
        let delta = self.shape.delta;
        let x_xpt = 1.0 - 1.01 * eps * delta;
        let r_xpt = x_xpt * self.r0;
        let z_lower = -1.01 * eps * kappa * self.r0 + self.z0;
        let z_upper = 1.01 * eps * kappa * self.r0 + self.z0;
        match self.shape.config {
            MagneticConfig::Limited => (None, None),
            MagneticConfig::LowerSingleNull => (Some((r_xpt, z_lower)), None),
            MagneticConfig::UpperSingleNull => (None, Some((r_xpt, z_upper))),
            MagneticConfig::DoubleNull => {
                (Some((r_xpt, z_lower)), Some((r_xpt, z_upper)))
            }
        }
    }

    /// Grid bounds in physical coordinates that encompass the plasma + margin.
    pub fn grid_bounds(&self) -> (f64, f64, f64, f64) {
        let eps = self.shape.epsilon;
        let kappa = self.shape.kappa;
        let margin = 0.15;
        let r_min = self.r0 * (1.0 - eps - margin);
        let r_max = self.r0 * (1.0 + eps + margin);
        let z_min = self.z0 + self.r0 * (-eps * kappa - margin);
        let z_max = self.z0 + self.r0 * (eps * kappa + margin);
        (r_min, r_max, z_min, z_max)
    }

    /// Update the equilibrium for new shape/plasma parameters.
    /// This re-solves the coefficient system — fast (12×12 linear solve).
    pub fn update(&mut self, shape: &ShapeParams) -> bool {
        let (mat, rhs) = match shape.config {
            MagneticConfig::LowerSingleNull => assemble_lsn_system(shape),
            // A limited plasma is X-point-free: it gets the up-down symmetric
            // smooth-boundary system, not the LSN one (see
            // `assemble_limited_system`).
            MagneticConfig::Limited => assemble_limited_system(shape),
            MagneticConfig::UpperSingleNull => assemble_usn_system(shape),
            MagneticConfig::DoubleNull => assemble_dn_system(shape),
        };

        if let Some(coeffs) = solve_12x12(&mat, &rhs) {
            self.coeffs = coeffs;
            self.a_param = shape.a_param;
            self.shape = shape.clone();
            self.find_axis();
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::devices;

    #[test]
    fn test_basis_functions_at_origin() {
        // At x=1, y=0 (normalized center), check basis values
        let b = psi_basis(1.0, 0.0);
        assert!((b[0] - 1.0).abs() < 1e-10); // ψ₁ = 1
        assert!((b[1] - 1.0).abs() < 1e-10); // ψ₂ = x² = 1
        assert!(b[2].abs() < 1e-10); // ψ₃ = y² - x²ln(x) = 0
        assert!((b[3] - 1.0).abs() < 1e-10); // ψ₄ = x⁴ = 1
    }

    // ─── Basis verification (github issue #2) ──────────────────────────────
    //
    // Two independent numerical checks on the Cerfon-Freidberg basis:
    //
    //   1. every ψᵢ must satisfy the homogeneous GS operator Δ*ψ = 0;
    //   2. every analytic derivative table must agree with a finite
    //      difference of `psi_basis`.
    //
    // Both are needed. Check 1 cannot see an error in a derivative table,
    // because those tables are not used to build ψ — they only enter the
    // boundary-condition rows. Check 2 cannot see a ψᵢ that is internally
    // consistent but is not a GS solution.

    /// Points spanning the region the solver actually evaluates:
    /// x ∈ [1−ε, 1+ε] for ε up to ~0.45, y out to ~±εκ.
    const BASIS_SAMPLE_POINTS: [(f64, f64); 6] = [
        (0.75, -0.5),
        (1.0, 0.2),
        (1.3, 0.6),
        (0.9, -0.55),
        (0.6, 0.35),
        (1.45, -0.15),
    ];

    fn basis_at(i: usize, x: f64, y: f64) -> f64 {
        psi_basis(x, y)[i]
    }

    /// Δ*ψ ≡ ψ_xx − ψ_x/x + ψ_yy, evaluated on `psi_basis` by central
    /// differences so the analytic derivative tables play no part.
    fn delta_star_fd(i: usize, x: f64, y: f64, h: f64) -> f64 {
        let f = |a: f64, b: f64| basis_at(i, a, b);
        let f0 = f(x, y);
        let psi_xx = (f(x + h, y) - 2.0 * f0 + f(x - h, y)) / (h * h);
        let psi_yy = (f(x, y + h) - 2.0 * f0 + f(x, y - h)) / (h * h);
        let psi_x = (f(x + h, y) - f(x - h, y)) / (2.0 * h);
        psi_xx - psi_x / x + psi_yy
    }

    #[test]
    fn test_basis_functions_are_grad_shafranov_solutions() {
        // With h = 1e-4 the finite-difference floor over these points is
        // ~1e-5 (roundoff ε|ψ|/h² plus truncation h²ψ''''/12, with |ψ| up to
        // ~1e2 here). A 1e-3 bound leaves two decades of headroom above the
        // floor while sitting six decades below the residual of a basis
        // function that is not actually a solution.
        const H: f64 = 1e-4;
        const TOL: f64 = 1e-3;

        let mut worst = [0.0f64; 12];
        for (x, y) in BASIS_SAMPLE_POINTS {
            for i in 0..12 {
                let residual = delta_star_fd(i, x, y, H).abs();
                if residual > worst[i] {
                    worst[i] = residual;
                }
            }
        }

        for (i, &residual) in worst.iter().enumerate() {
            assert!(
                residual < TOL,
                "ψ{} does not satisfy Δ*ψ = 0: max |Δ*ψ| = {:.4e} over the \
                 sample points (tolerance {:.0e}). Every homogeneous basis \
                 function must be annihilated by the GS operator.",
                i + 1,
                residual,
                TOL
            );
        }
    }

    #[test]
    fn test_particular_solution_drives_the_right_source() {
        // Cerfon-Freidberg: Δ*ψ_p = (1 − A)x² + A, which is what makes the
        // full ψ a solution of the inhomogeneous GS equation.
        const H: f64 = 1e-4;
        const TOL: f64 = 1e-3;

        for a in [-0.05, 0.0, 0.3] {
            for (x, _) in BASIS_SAMPLE_POINTS {
                let f = |v: f64| psi_particular(v, a);
                let psi_xx = (f(x + H) - 2.0 * f(x) + f(x - H)) / (H * H);
                let psi_x = (f(x + H) - f(x - H)) / (2.0 * H);
                let delta_star = psi_xx - psi_x / x; // no y dependence
                let expected = (1.0 - a) * x * x + a;
                assert!(
                    (delta_star - expected).abs() < TOL,
                    "Δ*ψ_p at x = {}, A = {}: got {:.6}, expected {:.6}",
                    x,
                    a,
                    delta_star,
                    expected
                );
            }
        }
    }

    #[test]
    fn test_analytic_first_derivatives_match_finite_differences() {
        // First-order central differences: truncation h²ψ'''/6, roundoff
        // ε|ψ|/h. At h = 1e-5 both sit below ~1e-8 for these functions.
        const H: f64 = 1e-5;
        const TOL: f64 = 1e-4;

        for (x, y) in BASIS_SAMPLE_POINTS {
            let dx = dpsi_basis_dx(x, y);
            let dy = dpsi_basis_dy(x, y);
            for i in 0..12 {
                let fd_x = (basis_at(i, x + H, y) - basis_at(i, x - H, y)) / (2.0 * H);
                let fd_y = (basis_at(i, x, y + H) - basis_at(i, x, y - H)) / (2.0 * H);
                assert!(
                    (dx[i] - fd_x).abs() < TOL * (1.0 + fd_x.abs()),
                    "dψ{}/dx at ({}, {}): analytic {:.6}, finite difference {:.6}",
                    i + 1,
                    x,
                    y,
                    dx[i],
                    fd_x
                );
                assert!(
                    (dy[i] - fd_y).abs() < TOL * (1.0 + fd_y.abs()),
                    "dψ{}/dy at ({}, {}): analytic {:.6}, finite difference {:.6}",
                    i + 1,
                    x,
                    y,
                    dy[i],
                    fd_y
                );
            }
        }
    }

    #[test]
    fn test_analytic_second_derivatives_match_finite_differences() {
        // Second-order central differences bottom out near 1e-5 at h = 1e-4
        // for |ψ| ~ 1e2; the relative bound below is ~1e-3 of the derivative
        // magnitude, which is far tighter than any dropped product-rule term.
        const H: f64 = 1e-4;
        const TOL: f64 = 1e-3;

        for (x, y) in BASIS_SAMPLE_POINTS {
            let dxx = d2psi_basis_dx2(x, y);
            let dyy = d2psi_basis_dy2(x, y);
            for i in 0..12 {
                let f0 = basis_at(i, x, y);
                let fd_xx =
                    (basis_at(i, x + H, y) - 2.0 * f0 + basis_at(i, x - H, y)) / (H * H);
                let fd_yy =
                    (basis_at(i, x, y + H) - 2.0 * f0 + basis_at(i, x, y - H)) / (H * H);
                assert!(
                    (dxx[i] - fd_xx).abs() < TOL * (1.0 + fd_xx.abs()),
                    "d²ψ{}/dx² at ({}, {}): analytic {:.6}, finite difference {:.6}",
                    i + 1,
                    x,
                    y,
                    dxx[i],
                    fd_xx
                );
                assert!(
                    (dyy[i] - fd_yy).abs() < TOL * (1.0 + fd_yy.abs()),
                    "d²ψ{}/dy² at ({}, {}): analytic {:.6}, finite difference {:.6}",
                    i + 1,
                    x,
                    y,
                    dyy[i],
                    fd_yy
                );
            }
        }
    }

    #[test]
    fn test_solved_equilibria_satisfy_grad_shafranov() {
        // End-to-end: the assembled ψ for every shipped device must satisfy
        // Δ*ψ = (1 − A)x² + A throughout the plasma volume, not just at the
        // boundary points the 12×12 system pins down.
        const H: f64 = 1e-4;
        const TOL: f64 = 1e-3;

        for device in devices::all_devices() {
            let eq = CerfonEquilibrium::from_device(&device)
                .unwrap_or_else(|| panic!("{} equilibrium should solve", device.id));
            let eps = eq.shape.epsilon;
            let kappa = eq.shape.kappa;

            let mut worst: f64 = 0.0;
            for xi in 0..5 {
                for yi in 0..5 {
                    // Interior sample points, inset from the separatrix.
                    let x = 1.0 + 0.6 * eps * (-1.0 + 0.5 * xi as f64);
                    let y = 0.6 * eps * kappa * (-1.0 + 0.5 * yi as f64);
                    let f = |a: f64, b: f64| eq.psi_normalized(a, b);
                    let f0 = f(x, y);
                    let psi_xx = (f(x + H, y) - 2.0 * f0 + f(x - H, y)) / (H * H);
                    let psi_yy = (f(x, y + H) - 2.0 * f0 + f(x, y - H)) / (H * H);
                    let psi_x = (f(x + H, y) - f(x - H, y)) / (2.0 * H);
                    let delta_star = psi_xx - psi_x / x + psi_yy;
                    let expected = (1.0 - eq.a_param) * x * x + eq.a_param;
                    worst = worst.max((delta_star - expected).abs());
                }
            }
            assert!(
                worst < TOL,
                "{}: solved ψ violates the GS equation by up to {:.4e} \
                 (tolerance {:.0e})",
                device.id,
                worst,
                TOL
            );
        }
    }

    #[test]
    fn test_diiid_equilibrium_solves() {
        let device = devices::diiid();
        let eq = CerfonEquilibrium::from_device(&device);
        assert!(eq.is_some(), "DIII-D equilibrium should solve");

        let eq = eq.unwrap();
        // ψ should be 0 at the equilibrium's own midplane boundary points —
        // the device's equilibrium_a_scale shrinks the solved plasma, so the
        // boundary sits at 1 ± ε·a_scale, not 1 ± ε.
        let eps_eq = device.epsilon() * device.equilibrium_a_scale;
        let x_out = 1.0 + eps_eq;
        let psi_out = eq.psi_normalized(x_out, 0.0);
        assert!(
            psi_out.abs() < 1e-6,
            "ψ at outboard midplane should be ~0, got {}",
            psi_out
        );

        // ψ should be 0 at inboard midplane
        let x_in = 1.0 - eps_eq;
        let psi_in = eq.psi_normalized(x_in, 0.0);
        assert!(
            psi_in.abs() < 1e-6,
            "ψ at inboard midplane should be ~0, got {}",
            psi_in
        );
    }

    #[test]
    fn test_iter_equilibrium_solves() {
        let device = devices::iter();
        let eq = CerfonEquilibrium::from_device(&device);
        assert!(eq.is_some(), "ITER equilibrium should solve");

        let eq = eq.unwrap();
        // Axis should be slightly outboard of geometric center
        let (x_ax, _y_ax) = eq.axis;
        assert!(
            x_ax > 1.0,
            "Magnetic axis should be outboard of geometric center"
        );

        // ψ at axis should be nonzero (maximum)
        assert!(
            eq.psi_axis.abs() > 1e-6,
            "ψ at axis should be nonzero"
        );
    }

    #[test]
    fn test_psi_positive_inside() {
        let device = devices::diiid();
        let eq = CerfonEquilibrium::from_device(&device).unwrap();

        // ψ at the magnetic axis should be the extremum
        // (positive or negative depending on convention — we just check it's nonzero)
        let psi_center = eq.psi_normalized(eq.axis.0, eq.axis.1);
        assert!(
            psi_center.abs() > 1e-6,
            "ψ at axis should be significantly nonzero"
        );
    }

    #[test]
    fn test_psi_grid_evaluation() {
        let device = devices::diiid();
        let eq = CerfonEquilibrium::from_device(&device).unwrap();

        let (r_min, r_max, z_min, z_max) = eq.grid_bounds();
        let grid = eq.psi_grid(r_min, r_max, z_min, z_max, 32, 32);
        assert_eq!(grid.len(), 32 * 32);

        // Grid should contain both positive and negative values (inside and outside separatrix)
        let has_pos = grid.iter().any(|&v| v > 0.0);
        let has_neg = grid.iter().any(|&v| v < 0.0);
        assert!(
            has_pos || has_neg,
            "Grid should have variation in ψ values"
        );
    }

    #[test]
    fn test_12x12_solver() {
        // Simple test: identity matrix
        let mut mat = [0.0f64; 144];
        for i in 0..12 {
            mat[i * 12 + i] = 1.0;
        }
        let rhs = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0];
        let sol = solve_12x12(&mat, &rhs).unwrap();
        for i in 0..12 {
            assert!((sol[i] - rhs[i]).abs() < 1e-10);
        }
    }

    // ─── Limited (X-point-free) equilibrium ────────────────────────────────
    //
    // `MagneticConfig::Limited` is solved by `assemble_limited_system`, the
    // Cerfon-Freidberg up-down symmetric smooth-boundary case. The tests
    // below check the seven imposed conditions, and then the property that
    // motivated the whole configuration: there is no X-point anywhere on the
    // boundary, so no pointed bottom and no divertor legs.

    /// (ε, κ, δ) triples spanning the range the simulation drives the limited
    /// start-up phase through, including the δ = 0 (ellipse-like) end.
    const LIMITED_SHAPES: [(f64, f64, f64); 6] = [
        (0.32, 1.70, 0.00),
        (0.32, 1.70, 0.20),
        (0.08, 1.00, 0.00),
        (0.36, 2.10, 0.35),
        (0.12, 1.45, 0.10),
        (0.25, 1.85, 0.30),
    ];

    fn limited_shape(eps: f64, kappa: f64, delta: f64) -> ShapeParams {
        ShapeParams {
            epsilon: eps,
            kappa,
            delta,
            // Deliberately non-trivial: the limited system must ignore all
            // three of these (see `assemble_limited_system`).
            delta_upper: Some(0.55),
            a_param: -0.05,
            config: MagneticConfig::Limited,
            x_point_alpha: Some(0.9),
            squareness: 0.07,
            squareness_out: -0.04,
        }
    }

    #[test]
    fn test_limited_boundary_conditions_hold() {
        for (eps, kappa, delta) in LIMITED_SHAPES {
            let shape = limited_shape(eps, kappa, delta);
            let eq = CerfonEquilibrium::solve(&shape, 1.0, 0.0).unwrap_or_else(|| {
                panic!("limited equilibrium ε={eps} κ={kappa} δ={delta} should solve")
            });

            let x_top = 1.0 - delta * eps;
            let y_top = kappa * eps;
            // The four points the system pins ψ = 0 at. The low point is not
            // an imposed row — it comes for free from up-down symmetry, which
            // is itself a check that c₈..c₁₂ really are zero.
            for (label, x, y) in [
                ("outer equatorial", 1.0 + eps, 0.0),
                ("inner equatorial", 1.0 - eps, 0.0),
                ("high point", x_top, y_top),
                ("low point", x_top, -y_top),
            ] {
                let psi = eq.psi_normalized(x, y);
                assert!(
                    psi.abs() < 1e-10,
                    "ε={eps} κ={kappa} δ={delta}: ψ at the {label} \
                     ({x:.4}, {y:.4}) should be 0, got {psi:.3e}"
                );
            }

            // ∂ψ/∂x = 0 at both the high and the low point: each is the
            // vertical extremum of the boundary, i.e. the boundary has a
            // horizontal tangent there.
            for (label, y) in [("high", y_top), ("low", -y_top)] {
                let dx = eq.dpsi_dx(x_top, y);
                assert!(
                    dx.abs() < 1e-10,
                    "ε={eps} κ={kappa} δ={delta}: ∂ψ/∂x at the {label} point \
                     should be 0, got {dx:.3e}"
                );
            }

            // Up-down symmetry: the odd basis coefficients must be exactly
            // the zeros the identity rows ask for.
            for i in 7..12 {
                assert!(
                    eq.coeffs[i].abs() < 1e-12,
                    "ε={eps} κ={kappa} δ={delta}: c{} = {:.3e}, should be 0 \
                     for an up-down symmetric limited equilibrium",
                    i + 1,
                    eq.coeffs[i]
                );
            }
        }
    }

    #[test]
    fn test_limited_system_is_well_conditioned_over_the_operating_range() {
        // The simulation drives the limited phase across the whole start-up
        // ramp, so the system has to stay solvable — and stay accurate — over
        // the full (ε, κ, δ) box, not just at the handful of spot shapes
        // above. ε reaches down to 0.08 because the plasma starts at 35% of
        // its flat-top minor radius.
        for i in 0..8 {
            let eps = 0.08 + (0.36 - 0.08) * (i as f64) / 7.0;
            for j in 0..6 {
                let kappa = 1.0 + (2.1 - 1.0) * (j as f64) / 5.0;
                for k in 0..6 {
                    let delta = 0.35 * (k as f64) / 5.0;
                    let shape = limited_shape(eps, kappa, delta);
                    let eq = CerfonEquilibrium::solve(&shape, 1.0, 0.0)
                        .unwrap_or_else(|| {
                            panic!(
                                "limited system singular at ε={eps:.3} \
                                 κ={kappa:.2} δ={delta:.2}"
                            )
                        });
                    let x_top = 1.0 - delta * eps;
                    let y_top = kappa * eps;
                    let worst = [
                        eq.psi_normalized(1.0 + eps, 0.0),
                        eq.psi_normalized(1.0 - eps, 0.0),
                        eq.psi_normalized(x_top, y_top),
                        eq.dpsi_dx(x_top, y_top),
                    ]
                    .into_iter()
                    .fold(0.0f64, |m, v| m.max(v.abs()));
                    // Residual of the imposed rows. A badly conditioned 12×12
                    // shows up here first: the Gaussian elimination still
                    // returns something, but it no longer satisfies its own
                    // boundary conditions.
                    assert!(
                        worst < 1e-9,
                        "ε={eps:.3} κ={kappa:.2} δ={delta:.2}: imposed limited \
                         boundary conditions violated by {worst:.3e} — the \
                         12×12 system is ill-conditioned here"
                    );
                    // The axis must land inside the plasma, outboard of the
                    // geometric centre (Shafranov shift), with a real ψ
                    // extremum on it.
                    assert!(
                        eq.psi_axis.abs() > 1e-9,
                        "ε={eps:.3} κ={kappa:.2} δ={delta:.2}: ψ_axis ≈ 0"
                    );
                }
            }
        }
    }

    /// Trace the ψ = 0 boundary by bisecting radially outward from the
    /// magnetic axis over `n` poloidal angles. Returns the radii, or None if
    /// any ray fails to bracket a sign change out to 3× the minor radius.
    fn trace_limited_boundary(eq: &CerfonEquilibrium, n: usize) -> Option<Vec<f64>> {
        let (ax, ay) = eq.axis;
        let sign = eq.psi_normalized(ax, ay).signum();
        let r_far = 3.0 * eq.shape.epsilon * eq.shape.kappa.max(1.0);
        let mut radii = Vec::with_capacity(n);
        for k in 0..n {
            let theta = 2.0 * std::f64::consts::PI * (k as f64) / (n as f64);
            let (cx, cy) = (theta.cos(), theta.sin());
            // Bracket: march out until ψ flips sign.
            let mut lo = 0.0;
            let mut hi = 0.0;
            let steps = 4000;
            let mut found = false;
            for s in 1..=steps {
                let r = r_far * (s as f64) / (steps as f64);
                let x = ax + r * cx;
                if x <= 1e-6 {
                    break;
                }
                if eq.psi_normalized(x, ay + r * cy) * sign <= 0.0 {
                    hi = r;
                    lo = r_far * ((s - 1) as f64) / (steps as f64);
                    found = true;
                    break;
                }
            }
            if !found {
                return None;
            }
            for _ in 0..80 {
                let mid = 0.5 * (lo + hi);
                if eq.psi_normalized(ax + mid * cx, ay + mid * cy) * sign > 0.0 {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            radii.push(0.5 * (lo + hi));
        }
        Some(radii)
    }

    /// Every critical point (∇ψ = 0) of the solved ψ inside the vessel box
    /// [1−1.3ε, 1+1.3ε] × [−1.3κε, 1.3κε], as (x, y, det Hessian).
    ///
    /// A coarse grid locates the local minima of |∇ψ|; each is then refined
    /// by Newton's method on ∇ψ = 0. The Hessian comes from central
    /// differences of the *analytic* gradient, so no new derivative table is
    /// needed and the mixed derivative ψ_xy is available. det H > 0 is an
    /// extremum (the magnetic axis); det H < 0 is a saddle — an X-point.
    fn critical_points_in_vessel_box(eq: &CerfonEquilibrium) -> Vec<(f64, f64, f64)> {
        let eps = eq.shape.epsilon;
        let kappa = eq.shape.kappa;
        let (x_lo, x_hi) = (1.0 - 1.3 * eps, 1.0 + 1.3 * eps);
        let (y_lo, y_hi) = (-1.3 * kappa * eps, 1.3 * kappa * eps);
        const N: usize = 161;
        const H: f64 = 1e-6;

        let grad = |x: f64, y: f64| (eq.dpsi_dx(x, y), eq.dpsi_dy(x, y));
        let mag = |x: f64, y: f64| {
            let (gx, gy) = grad(x, y);
            gx.hypot(gy)
        };

        let mut g = vec![0.0f64; N * N];
        for i in 0..N {
            let x = x_lo + (x_hi - x_lo) * (i as f64) / ((N - 1) as f64);
            for j in 0..N {
                let y = y_lo + (y_hi - y_lo) * (j as f64) / ((N - 1) as f64);
                g[i * N + j] = mag(x, y);
            }
        }

        // Scale for "∇ψ is zero": the typical gradient magnitude across the
        // plasma, |ψ_axis| / a.
        let scale = eq.psi_axis.abs() / (eps * kappa.max(1.0));
        let mut found: Vec<(f64, f64, f64)> = Vec::new();

        for i in 1..N - 1 {
            for j in 1..N - 1 {
                let v = g[i * N + j];
                let mut is_min = true;
                for di in 0..3 {
                    for dj in 0..3 {
                        if di == 1 && dj == 1 {
                            continue;
                        }
                        if g[(i + di - 1) * N + (j + dj - 1)] < v {
                            is_min = false;
                        }
                    }
                }
                if !is_min {
                    continue;
                }

                // Newton refine from this cell.
                let mut x = x_lo + (x_hi - x_lo) * (i as f64) / ((N - 1) as f64);
                let mut y = y_lo + (y_hi - y_lo) * (j as f64) / ((N - 1) as f64);
                let mut det = 0.0;
                let mut ok = false;
                for _ in 0..60 {
                    let (gx, gy) = grad(x, y);
                    let (gxp, gyp) = grad(x + H, y);
                    let (gxm, gym) = grad(x - H, y);
                    let (gxyp, gyyp) = grad(x, y + H);
                    let (gxym, gyym) = grad(x, y - H);
                    let hxx = (gxp - gxm) / (2.0 * H);
                    let hxy = 0.5 * ((gxyp - gxym) / (2.0 * H) + (gyp - gym) / (2.0 * H));
                    let hyy = (gyyp - gyym) / (2.0 * H);
                    det = hxx * hyy - hxy * hxy;
                    if det.abs() < 1e-14 {
                        break;
                    }
                    let dx = -(hyy * gx - hxy * gy) / det;
                    let dy = -(-hxy * gx + hxx * gy) / det;
                    // Damp the step so Newton cannot leap out of the box.
                    let cap = 0.2 * eps;
                    let s = (cap / dx.hypot(dy).max(1e-30)).min(1.0);
                    x += s * dx;
                    y += s * dy;
                    if x < x_lo - eps || x > x_hi + eps {
                        break;
                    }
                    if mag(x, y) < 1e-10 * scale {
                        ok = true;
                        break;
                    }
                }
                if !ok || x < x_lo || x > x_hi || y < y_lo || y > y_hi {
                    continue;
                }
                if found
                    .iter()
                    .any(|&(fx, fy, _)| (fx - x).hypot(fy - y) < 1e-4 * eps)
                {
                    continue;
                }
                found.push((x, y, det));
            }
        }
        found
    }

    #[test]
    fn test_limited_boundary_has_no_x_point() {
        // The bug this configuration fixes: solved with the LSN system, the
        // limited boundary carries a saddle below the plasma — a cusp in
        // r(θ) and a point where ∇ψ vanishes on ψ = 0. Neither may appear
        // in the limited solution.
        const N: usize = 48;

        for (eps, kappa, delta) in LIMITED_SHAPES {
            let shape = limited_shape(eps, kappa, delta);
            let eq = CerfonEquilibrium::solve(&shape, 1.0, 0.0).unwrap();
            let (ax, ay) = eq.axis;
            let radii = trace_limited_boundary(&eq, N).unwrap_or_else(|| {
                panic!(
                    "ε={eps} κ={kappa} δ={delta}: the ψ = 0 boundary must be a \
                     closed curve around the axis — a ray found no crossing"
                )
            });

            // 1. The decisive check: ψ has NO saddle anywhere in the vessel
            //    box — the single critical point there is the magnetic axis,
            //    a maximum (det H > 0). Solved with the LSN system every one
            //    of these shapes instead shows a second critical point with
            //    det H ≈ −1 to −3 sitting at y = −1.01κε, which is exactly
            //    the spurious X-point that gave the limited plasma its
            //    pointed bottom and virtual divertor legs.
            let crit = critical_points_in_vessel_box(&eq);
            let saddles: Vec<_> = crit.iter().filter(|c| c.2 < 0.0).collect();
            assert!(
                saddles.is_empty(),
                "ε={eps} κ={kappa} δ={delta}: found {} saddle point(s) of ψ \
                 inside the vessel box, first at ({:.5}, {:.5}) with \
                 det H = {:.3e}. A limited equilibrium has no X-point.",
                saddles.len(),
                saddles[0].0,
                saddles[0].1,
                saddles[0].2
            );
            assert_eq!(
                crit.len(),
                1,
                "ε={eps} κ={kappa} δ={delta}: expected exactly one critical \
                 point (the magnetic axis) in the vessel box, found {:?}",
                crit
            );
            assert!(
                crit[0].1.abs() < 1e-6,
                "ε={eps} κ={kappa} δ={delta}: the magnetic axis should sit on \
                 the midplane, found y = {:.3e}",
                crit[0].1
            );

            // 2. r(θ) is smooth: no cusp. Second differences of a smooth
            //    closed curve sampled at 48 angles scale like (2π/48)² r'' —
            //    at most 0.12·r over the shapes below. A corner on the
            //    contour instead makes the second difference O(r) itself.
            //    Bound at 0.35·r_mean, ~3× the smooth value.
            let r_mean = radii.iter().sum::<f64>() / (N as f64);
            for k in 0..N {
                let d2 = radii[(k + 1) % N] - 2.0 * radii[k] + radii[(k + N - 1) % N];
                assert!(
                    d2.abs() < 0.35 * r_mean,
                    "ε={eps} κ={kappa} δ={delta}: cusp in the ψ = 0 boundary at \
                     θ = {:.1}° — second difference {:.4} vs mean radius {:.4}. \
                     A limited equilibrium must have a smooth LCFS.",
                    360.0 * (k as f64) / (N as f64),
                    d2,
                    r_mean
                );
            }

            // 3. ∇ψ never comes close to vanishing on the LCFS itself, so
            //    the boundary is everywhere a regular flux surface with a
            //    well-defined poloidal field. Normalized by ψ_axis/a to be
            //    shape-independent; the measured minimum over these shapes is
            //    1.3, so the 0.2 floor sits well clear of it while still
            //    being far below the O(1) value of a healthy boundary.
            let a_norm = eps * kappa.max(1.0);
            for k in 0..N {
                let theta = 2.0 * std::f64::consts::PI * (k as f64) / (N as f64);
                let x = ax + radii[k] * theta.cos();
                let y = ay + radii[k] * theta.sin();
                let grad = eq.dpsi_dx(x, y).hypot(eq.dpsi_dy(x, y));
                let scaled = grad * a_norm / eq.psi_axis.abs();
                assert!(
                    scaled > 0.2,
                    "ε={eps} κ={kappa} δ={delta}: |∇ψ| ≈ 0 on the boundary at \
                     ({x:.4}, {y:.4}) — scaled |∇ψ| = {scaled:.4e}. That is an \
                     X-point, which a limited equilibrium must not have."
                );
            }

            // 4. Up-down symmetry of the traced boundary itself: r(θ) must
            //    mirror about the midplane (the axis sits at y = 0).
            assert!(
                ay.abs() < 1e-9,
                "ε={eps} κ={kappa} δ={delta}: axis off-midplane at y = {ay:.3e}"
            );
            for k in 1..N / 2 {
                let mirror = radii[N - k];
                assert!(
                    (radii[k] - mirror).abs() < 1e-9 * (1.0 + radii[k]),
                    "ε={eps} κ={kappa} δ={delta}: boundary is not up-down \
                     symmetric — r({:.1}°) = {:.6} vs r(−) = {:.6}",
                    360.0 * (k as f64) / (N as f64),
                    radii[k],
                    mirror
                );
            }
        }
    }

    #[test]
    fn test_limited_zero_delta_is_symmetric_ellipse() {
        // δ = 0: the boundary parametrization degenerates to an ellipse
        // centered on x = 1. The two equatorial radii and the high-point
        // abscissa are imposed rows, so they hold to solver precision; the
        // interior is then Shafranov-shifted outboard, which is physics, not
        // an asymmetry of the boundary.
        for (eps, kappa) in [(0.32, 1.70), (0.10, 1.00), (0.36, 2.10)] {
            let shape = limited_shape(eps, kappa, 0.0);
            let eq = CerfonEquilibrium::solve(&shape, 1.0, 0.0).unwrap();

            // Both equatorial extents reach exactly ±ε from x = 1.
            for (label, x) in [("outboard", 1.0 + eps), ("inboard", 1.0 - eps)] {
                assert!(
                    eq.psi_normalized(x, 0.0).abs() < 1e-6,
                    "ε={eps} κ={kappa} δ=0: {label} boundary point x = {x:.4} \
                     should be on ψ = 0, got {:.3e}",
                    eq.psi_normalized(x, 0.0)
                );
            }

            // With δ = 0 the top of the plasma sits at x = 1, not shifted
            // inboard, and at y = +κε.
            let psi_top = eq.psi_normalized(1.0, kappa * eps);
            assert!(
                psi_top.abs() < 1e-6,
                "ε={eps} κ={kappa} δ=0: top of plasma should be at x = 1, \
                 y = κε; ψ there is {psi_top:.3e}"
            );

            // ...and it really is the vertical extremum there.
            let dx_top = eq.dpsi_dx(1.0, kappa * eps);
            assert!(
                dx_top.abs() < 1e-6,
                "ε={eps} κ={kappa} δ=0: ∂ψ/∂x at the top should be 0, \
                 got {dx_top:.3e}"
            );

            // Up-down symmetric: the low point mirrors the high point.
            let psi_bot = eq.psi_normalized(1.0, -kappa * eps);
            assert!(
                psi_bot.abs() < 1e-6,
                "ε={eps} κ={kappa} δ=0: bottom of plasma should mirror the \
                 top; ψ there is {psi_bot:.3e}"
            );
        }
    }

    #[test]
    fn test_limited_config_does_not_use_the_lsn_system() {
        // Guard against the routing regressing: `Limited` and
        // `LowerSingleNull` with otherwise identical shape parameters must
        // produce different coefficients, and only the limited one may have
        // zero odd coefficients.
        let mut shape = limited_shape(0.32, 1.70, 0.20);
        let limited = CerfonEquilibrium::solve(&shape, 1.0, 0.0).unwrap();
        shape.config = MagneticConfig::LowerSingleNull;
        let lsn = CerfonEquilibrium::solve(&shape, 1.0, 0.0).unwrap();

        let odd_lsn: f64 = lsn.coeffs[7..].iter().map(|c| c.abs()).sum();
        assert!(
            odd_lsn > 1e-9,
            "the LSN system should populate the odd basis; it did not, so \
             this test cannot distinguish the two systems"
        );
        let diff: f64 = limited
            .coeffs
            .iter()
            .zip(lsn.coeffs.iter())
            .map(|(a, b)| (a - b).abs())
            .sum();
        assert!(
            diff > 1e-6,
            "Limited is still being solved with the LSN X-point system"
        );
    }

    #[test]
    fn test_limited_solved_psi_satisfies_grad_shafranov() {
        // Same end-to-end check as `test_solved_equilibria_satisfy_grad_shafranov`,
        // for the limited system's coefficients.
        const H: f64 = 1e-4;
        const TOL: f64 = 1e-3;

        for (eps, kappa, delta) in LIMITED_SHAPES {
            let shape = limited_shape(eps, kappa, delta);
            let eq = CerfonEquilibrium::solve(&shape, 1.0, 0.0).unwrap();
            let mut worst: f64 = 0.0;
            for xi in 0..5 {
                for yi in 0..5 {
                    let x = 1.0 + 0.6 * eps * (-1.0 + 0.5 * xi as f64);
                    let y = 0.6 * eps * kappa * (-1.0 + 0.5 * yi as f64);
                    let f = |a: f64, b: f64| eq.psi_normalized(a, b);
                    let f0 = f(x, y);
                    let psi_xx = (f(x + H, y) - 2.0 * f0 + f(x - H, y)) / (H * H);
                    let psi_yy = (f(x, y + H) - 2.0 * f0 + f(x, y - H)) / (H * H);
                    let psi_x = (f(x + H, y) - f(x - H, y)) / (2.0 * H);
                    let delta_star = psi_xx - psi_x / x + psi_yy;
                    let expected = (1.0 - eq.a_param) * x * x + eq.a_param;
                    worst = worst.max((delta_star - expected).abs());
                }
            }
            assert!(
                worst < TOL,
                "ε={eps} κ={kappa} δ={delta}: limited ψ violates the GS \
                 equation by up to {worst:.4e} (tolerance {TOL:.0e})"
            );
        }
    }

    #[test]
    fn test_equilibrium_update() {
        let device = devices::diiid();
        let mut eq = CerfonEquilibrium::from_device(&device).unwrap();

        // Update with slightly different shape
        let mut shape = ShapeParams::from_device(&device);
        shape.kappa = 1.7; // slightly less elongated
        let success = eq.update(&shape);
        assert!(success, "Update should succeed");

        // Verify boundary condition still holds
        let x_out = 1.0 + shape.epsilon;
        let psi_out = eq.psi_normalized(x_out, 0.0);
        assert!(
            psi_out.abs() < 1e-6,
            "ψ at outboard midplane should be ~0 after update"
        );
    }
}
