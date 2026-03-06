use serde::{Deserialize, Serialize};

/// Impurity seeding and ELM regime parameters (device-specific).
///
/// Named generically ("impurity") to support future noble gas species
/// (argon, krypton, nitrogen) beyond the initial neon implementation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpurityElmParams {
    /// Impurity fraction threshold to start affecting Type I ELM frequency
    pub impurity_type1_onset: f64,
    /// Impurity fraction for Type I → Type II (grassy) transition
    pub impurity_type2_threshold: f64,
    /// Impurity fraction for full ELM suppression (QCE window)
    pub impurity_qce_threshold: f64,
    /// Impurity fraction above which radiative collapse begins
    pub impurity_collapse_threshold: f64,
    /// q95 range for grassy/Type II ELMs (min, max)
    pub q95_grassy_range: (f64, f64),
    /// Minimum delta (triangularity) for grassy ELMs
    pub delta_grassy_min: f64,
}

/// Tokamak device geometry and operational parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub name: String,
    pub id: String,
    /// Major radius (m)
    pub r0: f64,
    /// Minor radius (m)
    pub a: f64,
    /// Maximum toroidal field on axis (T)
    pub bt_max: f64,
    /// Maximum plasma current (MA)
    pub ip_max: f64,
    /// Reference elongation
    pub kappa: f64,
    /// Reference upper triangularity
    pub delta_upper: f64,
    /// Reference lower triangularity
    pub delta_lower: f64,
    /// Plasma volume (m³)
    pub volume: f64,
    /// Plasma surface area (m²)
    pub surface_area: f64,
    /// Default ion mass number (deuterium = 2)
    pub mass_number: f64,
    /// Default effective charge
    pub z_eff: f64,
    /// Wall outline for display: (R, Z) points in meters
    pub wall_outline: Vec<(f64, f64)>,
    /// Magnetic configuration
    pub config: MagneticConfig,
    /// Impurity seeding / ELM regime parameters
    pub impurity_elm: ImpurityElmParams,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum MagneticConfig {
    Limited,
    LowerSingleNull,
    UpperSingleNull,
    DoubleNull,
}

impl Device {
    /// Inverse aspect ratio ε = a/R₀
    pub fn epsilon(&self) -> f64 {
        self.a / self.r0
    }

    /// Greenwald density limit (10²⁰ m⁻³), given Ip in MA
    pub fn greenwald_density(&self, ip_ma: f64) -> f64 {
        ip_ma / (std::f64::consts::PI * self.a * self.a)
    }
}

/// Approximate DIII-D first wall outline (hand-crafted polygon).
///
/// Based on the actual DIII-D vessel cross-section with a D-shaped upper
/// wall, inboard limiters, and open lower divertor with inner/outer baffles
/// and a divertor floor. Coordinates in (R, Z) meters.
///
/// Traversed clockwise starting from the outboard midplane.
fn diiid_wall() -> Vec<(f64, f64)> {
    vec![
        // Outboard midplane → top (outer wall, slight D-shape)
        (2.37, 0.00),
        (2.36, 0.20),
        (2.33, 0.40),
        (2.28, 0.60),
        (2.20, 0.80),
        (2.08, 0.95),
        // Top dome (flattened, shifted inward)
        (1.93, 1.07),
        (1.75, 1.14),
        (1.58, 1.17),
        (1.40, 1.14),
        (1.25, 1.07),
        // Inboard wall (vertical high-field side)
        (1.13, 0.95),
        (1.04, 0.75),
        (1.01, 0.50),
        (1.01, 0.25),
        (1.01, 0.00),
        (1.01, -0.25),
        (1.01, -0.50),
        (1.04, -0.75),
        (1.10, -0.92),
        // Inner divertor baffle (shelf turning toward floor)
        (1.13, -1.02),
        (1.15, -1.10),
        (1.13, -1.18),
        (1.10, -1.25),
        // Divertor floor (flat bottom, connects inner→outer)
        (1.15, -1.36),
        (1.25, -1.42),
        (1.40, -1.46),
        (1.55, -1.48),
        (1.70, -1.46),
        (1.85, -1.42),
        (1.95, -1.36),
        // Outer divertor baffle (shelf rising from floor)
        (2.04, -1.25),
        (2.10, -1.10),
        (2.14, -1.00),
        // Outboard lower wall → midplane
        (2.22, -0.85),
        (2.30, -0.65),
        (2.34, -0.45),
        (2.36, -0.22),
        (2.37, 0.00),
    ]
}

/// Approximate ITER wall outline (simplified polygon)
fn iter_wall() -> Vec<(f64, f64)> {
    let n = 60;
    let r0 = 6.2;
    let a_wall = 2.1;
    let kappa_wall = 1.8;
    let delta_wall: f64 = 0.35;
    let mut wall = Vec::with_capacity(n + 1);
    for i in 0..=n {
        let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
        let r = r0 + a_wall * (theta + delta_wall.asin() * theta.sin()).cos();
        let z = kappa_wall * a_wall * theta.sin();
        wall.push((r, z));
    }
    wall
}

pub fn diiid() -> Device {
    Device {
        name: "DIII-D".to_string(),
        id: "diiid".to_string(),
        r0: 1.67,
        a: 0.56, // effective plasma minor radius in diverted operation (limiter is ~0.67m)
        bt_max: 2.2,
        ip_max: 3.0,
        kappa: 1.65,
        delta_upper: 0.35,
        delta_lower: 0.35,
        volume: 19.4,
        surface_area: 47.0,
        mass_number: 2.0,
        z_eff: 1.5,
        wall_outline: diiid_wall(),
        config: MagneticConfig::LowerSingleNull,
        impurity_elm: ImpurityElmParams {
            impurity_type1_onset: 0.0005,
            impurity_type2_threshold: 0.001,
            impurity_qce_threshold: 0.003,
            impurity_collapse_threshold: 0.02,
            q95_grassy_range: (6.0, 7.5),
            delta_grassy_min: 0.4,
        },
    }
}

pub fn iter() -> Device {
    Device {
        name: "ITER".to_string(),
        id: "iter".to_string(),
        r0: 6.2,
        a: 2.0,
        bt_max: 5.3,
        ip_max: 15.0,
        kappa: 1.7,
        delta_upper: 0.33,
        delta_lower: 0.33,
        volume: 837.0,
        surface_area: 683.0,
        mass_number: 2.5, // D-T mix
        z_eff: 1.7,
        wall_outline: iter_wall(),
        config: MagneticConfig::LowerSingleNull,
        impurity_elm: ImpurityElmParams {
            impurity_type1_onset: 0.0003,
            impurity_type2_threshold: 0.0008,
            impurity_qce_threshold: 0.002,
            impurity_collapse_threshold: 0.015,
            q95_grassy_range: (4.5, 6.0),
            delta_grassy_min: 0.3,
        },
    }
}

pub fn get_device(id: &str) -> Option<Device> {
    match id {
        "diiid" => Some(diiid()),
        "iter" => Some(iter()),
        _ => None,
    }
}

pub fn all_devices() -> Vec<Device> {
    vec![diiid(), iter()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_params() {
        let d = diiid();
        assert!((d.epsilon() - 0.3353).abs() < 0.01); // a/R₀ = 0.56/1.67
        // Greenwald density at 2 MA
        let ngw = d.greenwald_density(2.0);
        assert!(ngw > 1.0 && ngw < 2.5); // a=0.56 → ngw ≈ 1.59
    }

    #[test]
    fn test_iter_params() {
        let d = iter();
        assert!((d.epsilon() - 0.3226).abs() < 0.01);
        let ngw = d.greenwald_density(15.0);
        assert!(ngw > 1.0 && ngw < 2.0); // ~1.19
    }

    #[test]
    fn test_wall_outlines() {
        let d = diiid();
        assert!(!d.wall_outline.is_empty());
        // Wall should be closed (first ≈ last)
        let first = d.wall_outline.first().unwrap();
        let last = d.wall_outline.last().unwrap();
        assert!((first.0 - last.0).abs() < 0.01);
        assert!((first.1 - last.1).abs() < 0.01);
    }
}
