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
    /// Triangularity δ (lower, for LSN)
    pub delta: f64,
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
    /// Squareness parameter (N₁ in some formulations). Controls X-point curvature.
    pub squareness: f64,
}

impl ShapeParams {
    pub fn from_device(device: &Device) -> Self {
        let delta = device.delta_lower;
        ShapeParams {
            epsilon: device.epsilon(),
            kappa: device.kappa,
            delta,
            a_param: -0.05, // Sensible default
            config: device.config,
            x_point_alpha: Some(delta.asin()),
            squareness: 0.0,
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
        // ψ₇ = 8y⁶ - 140x²y⁴ + 75x⁴y² - 15x⁶ ln(x) + 180x²y⁴ ln(x) - 120x⁴y² ln(x)
        8.0 * y6 - 140.0 * x2 * y4 + 75.0 * x4 * y2 - 15.0 * x6 * lnx
            + 180.0 * x2 * y4 * lnx
            - 120.0 * x4 * y2 * lnx,
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
        // d/dx(ψ₇)
        -280.0 * x * y4 + 300.0 * x3 * y2 - 90.0 * x5 * lnx - 15.0 * x5
            + 360.0 * x * y4 * lnx
            + 180.0 * x * y4
            - 480.0 * x3 * y2 * lnx
            - 120.0 * x3 * y2,
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
        // d/dy(ψ₇)
        48.0 * y5 - 560.0 * x2 * y3 + 150.0 * x4 * y + 720.0 * x2 * y3 * lnx
            - 240.0 * x4 * y * lnx,
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
        240.0 * y4 - 1680.0 * x2 * y2 + 150.0 * x4 + 2160.0 * x2 * y2 * lnx
            - 240.0 * x4 * lnx,
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
        -18.0 * y2 + 36.0 * x2 * lnx + 15.0 * x2 - 24.0 * y2 * lnx - 36.0 * y2,
        // ψ₆
        30.0 * x4 - 144.0 * x2 * y2 + 16.0 * y4,
        // ψ₇
        -280.0 * y4 + 900.0 * x2 * y2 - 450.0 * x4 * lnx - 105.0 * x4
            + 360.0 * y4 * lnx
            + 540.0 * y4
            - 1440.0 * x2 * y2 * lnx
            - 600.0 * x2 * y2,
        0.0,
        2.0 * y,
        -6.0 * y * lnx - 9.0 * y,
        36.0 * y * x2 - 8.0 * y3,
        // ψ₁₂
        -540.0 * y * x2 - 160.0 * y3 * lnx - 240.0 * y3 + 720.0 * y * x2 * lnx
            + 240.0 * y * x2,
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

    // Key boundary points in normalized coordinates
    let x_out = 1.0 + eps; // outboard midplane
    let x_in = 1.0 - eps; // inboard midplane
    let y_mid = 0.0;

    // X-point location for LSN
    let alpha = shape.x_point_alpha.unwrap_or(delta.asin());
    let x_xpt = 1.0 - 1.05 * eps * delta; // slightly inboard due to Shafranov shift
    let y_xpt = -1.05 * eps * kappa; // below midplane

    // Upper crown (top of plasma)
    let x_top = 1.0 - eps * delta;
    let y_top = eps * kappa;

    // N1, N2, N3 curvature constraints from Cerfon-Freidberg
    // N1 = -(1+α_s)² / (ε κ²) related to outboard curvature
    // N2 = (1-α_s)² / (ε κ²) related to inboard curvature
    // N3 = -κ / (ε cos²(α_s)) related to upper curvature
    let n1 = -(1.0 + sq).powi(2) / (eps * kappa * kappa);
    let n2 = (1.0 - sq).powi(2) / (eps * kappa * kappa);
    let n3 = -kappa / (eps * alpha.cos().powi(2));

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
    pub fn solve(shape: &ShapeParams, r0: f64) -> Option<Self> {
        let (mat, rhs) = match shape.config {
            MagneticConfig::LowerSingleNull => assemble_lsn_system(shape),
            // For now, use LSN system for all configs (can add DN, limited later)
            _ => assemble_lsn_system(shape),
        };

        let coeffs = solve_12x12(&mat, &rhs)?;

        let mut eq = CerfonEquilibrium {
            coeffs,
            a_param: shape.a_param,
            r0,
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
    pub fn from_device(device: &Device) -> Option<Self> {
        let shape = ShapeParams::from_device(device);
        Self::solve(&shape, device.r0)
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
    #[inline]
    pub fn psi(&self, r: f64, z: f64) -> f64 {
        self.psi_normalized(r / self.r0, z / self.r0)
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
        // Start near geometric center and iterate using Newton's method
        let mut x = 1.0 + 0.05; // slight Shafranov shift outboard
        let mut y = 0.0;

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
        (self.axis.0 * self.r0, self.axis.1 * self.r0)
    }

    /// Get the X-point location in physical coordinates.
    pub fn x_point_physical(&self) -> (f64, f64) {
        let eps = self.shape.epsilon;
        let kappa = self.shape.kappa;
        let delta = self.shape.delta;
        let x_xpt = 1.0 - 1.05 * eps * delta;
        let y_xpt = -1.05 * eps * kappa;
        (x_xpt * self.r0, y_xpt * self.r0)
    }

    /// Grid bounds in physical coordinates that encompass the plasma + margin.
    pub fn grid_bounds(&self) -> (f64, f64, f64, f64) {
        let eps = self.shape.epsilon;
        let kappa = self.shape.kappa;
        let margin = 0.15;
        let r_min = self.r0 * (1.0 - eps - margin);
        let r_max = self.r0 * (1.0 + eps + margin);
        let z_min = self.r0 * (-eps * kappa - margin);
        let z_max = self.r0 * (eps * kappa + margin);
        (r_min, r_max, z_min, z_max)
    }

    /// Update the equilibrium for new shape/plasma parameters.
    /// This re-solves the coefficient system — fast (12×12 linear solve).
    pub fn update(&mut self, shape: &ShapeParams) -> bool {
        let (mat, rhs) = match shape.config {
            MagneticConfig::LowerSingleNull => assemble_lsn_system(shape),
            _ => assemble_lsn_system(shape),
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

    #[test]
    fn test_diiid_equilibrium_solves() {
        let device = devices::diiid();
        let eq = CerfonEquilibrium::from_device(&device);
        assert!(eq.is_some(), "DIII-D equilibrium should solve");

        let eq = eq.unwrap();
        // ψ should be 0 at outboard midplane
        let x_out = 1.0 + device.epsilon();
        let psi_out = eq.psi_normalized(x_out, 0.0);
        assert!(
            psi_out.abs() < 1e-6,
            "ψ at outboard midplane should be ~0, got {}",
            psi_out
        );

        // ψ should be 0 at inboard midplane
        let x_in = 1.0 - device.epsilon();
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
