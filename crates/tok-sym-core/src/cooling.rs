//! Seeded-impurity atomic physics: coronal cooling curves and mean charge
//! states from OpenADAS (see `cooling_tables.rs` and tools/adas_cooling/).

use crate::cooling_tables::{CoolingRow, ARGON, NEON, NITROGEN};

/// A seeded impurity species.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Species {
    Nitrogen,
    Neon,
    Argon,
}

impl Species {
    pub const ALL: [Species; 3] = [Species::Nitrogen, Species::Neon, Species::Argon];

    /// Nuclear charge.
    pub fn z(self) -> f64 {
        match self {
            Species::Nitrogen => 7.0,
            Species::Neon => 10.0,
            Species::Argon => 18.0,
        }
    }

    fn table(self) -> &'static [CoolingRow] {
        match self {
            Species::Nitrogen => NITROGEN,
            Species::Neon => NEON,
            Species::Argon => ARGON,
        }
    }
}

/// Coronal radiated power per electron per impurity ion (W m³), mean charge
/// state <Z> and <Z²> at electron temperature `te_ev`, interpolated
/// log-log in temperature and clamped to the table's range.
pub fn lookup(species: Species, te_ev: f64) -> (f64, f64, f64) {
    let t = species.table();
    let te = te_ev.max(t[0].0).min(t[t.len() - 1].0);
    let mut hi = 1;
    while hi < t.len() - 1 && t[hi].0 < te {
        hi += 1;
    }
    let (t0, l0, z0, q0) = t[hi - 1];
    let (t1, l1, z1, q1) = t[hi];
    let w = if t1 > t0 { ((te.ln() - t0.ln()) / (t1.ln() - t0.ln())).clamp(0.0, 1.0) } else { 0.0 };
    let lz = (l0.ln() + w * (l1.ln() - l0.ln())).exp();
    (lz, z0 + w * (z1 - z0), q0 + w * (q1 - q0))
}

/// Volume-averaged cooling rate and charge states for a seeded species in
/// a plasma of central temperature `te0_kev`, over an assumed profile
/// T(ρ) = T_e0 [0.85 (1 − ρ²)^1.5 + 0.15 (1 − ρ⁸)] + 5 eV (a peaked core on
/// a pedestal) and n(ρ) ∝ 1 − 0.4 ρ². The radiated power is weighted by
/// n² dV and the charge states by n dV. A single core temperature would
/// miss the cooler mantle, where nitrogen and neon radiate several times
/// more than at the axis.
pub fn profile_average(species: Species, te0_kev: f64) -> (f64, f64, f64) {
    const N: usize = 24;
    let (mut lz_sum, mut w2_sum, mut zb_sum, mut z2_sum, mut w1_sum) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for k in 0..N {
        let rho = (k as f64 + 0.5) / N as f64;
        let shape = 0.85 * (1.0 - rho * rho).powf(1.5) + 0.15 * (1.0 - rho.powi(8));
        let te_ev = (te0_kev.max(0.0) * 1000.0 * shape + 5.0).max(1.0);
        let n = 1.0 - 0.4 * rho * rho;
        let (lz, zb, z2) = lookup(species, te_ev);
        let w2 = rho * n * n;
        let w1 = rho * n;
        lz_sum += w2 * lz;
        w2_sum += w2;
        zb_sum += w1 * zb;
        z2_sum += w1 * z2;
        w1_sum += w1;
    }
    (lz_sum / w2_sum, zb_sum / w1_sum, z2_sum / w1_sum)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tables_are_monotone_in_temperature_and_charge() {
        for sp in Species::ALL {
            let t = sp.table();
            assert!(t.len() > 20, "{sp:?} table too short");
            for w in t.windows(2) {
                assert!(w[1].0 > w[0].0, "{sp:?}: temperature not increasing");
                assert!(w[1].2 >= w[0].2 - 1e-9, "{sp:?}: <Z> not increasing at {} eV", w[1].0);
            }
            let last = t[t.len() - 1];
            assert!((last.2 - sp.z()).abs() < 0.2, "{sp:?}: fully stripped at the top, got <Z> {}", last.2);
        }
    }

    #[test]
    fn test_lookup_interpolates_and_clamps() {
        let (lz_lo, _, _) = lookup(Species::Neon, 0.1);
        let (lz_first, _, _) = lookup(Species::Neon, NEON[0].0);
        assert!((lz_lo - lz_first).abs() < 1e-40, "clamped below the table");
        let (a, _, _) = lookup(Species::Nitrogen, 10.0);
        let (b, _, _) = lookup(Species::Nitrogen, 12.0);
        let (c, _, _) = lookup(Species::Nitrogen, 15.0);
        assert!((b > a.min(c)) && (b < a.max(c)), "interpolation stays between neighbours: {a} {b} {c}");
    }

    #[test]
    fn test_tables_against_external_anchors() {
        // Absolute anchor: the Li-like nitrogen 2s–2p resonance line at 10 eV
        // gives about 5e-32 W m³ by a van Regemorter estimate, which is
        // essentially all of nitrogen's coronal cooling there.
        let (n10, _, _) = lookup(Species::Nitrogen, 10.0);
        assert!(n10 > 0.7 * 5.0e-32 && n10 < 1.4 * 5.0e-32, "N at 10 eV: {n10:.2e}");
        // Relative anchor: GRS 2017 fig. 1d's coronal asymptote (τ → 0.1 s)
        // gives Ne/N ≈ 4.2 and Ar/N ≈ 16 for ∫ T^½ L_z dT over 1–150 eV.
        let integral = |sp: Species| {
            let mut acc = 0.0;
            let mut t = 1.0;
            while t < 150.0 {
                let dt = t * 0.05;
                let (lz, _, _) = lookup(sp, t + 0.5 * dt);
                acc += (t + 0.5 * dt).sqrt() * lz * dt;
                t += dt;
            }
            acc
        };
        let (n, ne, ar) = (integral(Species::Nitrogen), integral(Species::Neon), integral(Species::Argon));
        assert!((ne / n - 4.2).abs() < 0.25 * 4.2, "Ne/N dissipation ratio {:.2}", ne / n);
        assert!((ar / n - 16.0).abs() < 0.25 * 16.0, "Ar/N dissipation ratio {:.2}", ar / n);
        // Bremsstrahlung limit at 20 keV: within a Gaunt factor plus residual
        // line power (1.1–2.2×) of 5.35e-37 Z² √T[keV] for every species.
        for sp in Species::ALL {
            let (lz, _, _) = lookup(sp, 20_000.0);
            let brems = 5.35e-37 * sp.z() * sp.z() * 20.0_f64.sqrt();
            assert!(lz > 1.1 * brems && lz < 2.2 * brems, "{sp:?} at 20 keV: {lz:.2e} vs brems {brems:.2e}");
        }
    }

    #[test]
    fn test_profile_average_exceeds_the_axis_value_for_low_z() {
        // The cooler mantle radiates more than the axis for nitrogen and neon
        // (about 1.7× for nitrogen at Te0 = 2 keV with the n² weighting).
        for sp in [Species::Nitrogen, Species::Neon] {
            let (axis, _, _) = lookup(sp, 0.7 * 2000.0);
            let (avg, _, _) = profile_average(sp, 2.0);
            assert!(avg > 1.3 * axis, "{sp:?}: profile average {avg:.2e} vs axis {axis:.2e}");
        }
        let (_, zb, _) = profile_average(Species::Argon, 2.0);
        assert!(zb > 12.0 && zb < 17.0, "argon mean charge over the profile {zb:.1}");
    }

    #[test]
    fn test_argon_is_the_core_radiator() {
        // At a 1 keV core, argon radiates far more per ion than neon or nitrogen:
        // that is why argon is a mantle radiator and nitrogen a divertor one.
        let (n, _, _) = lookup(Species::Nitrogen, 1000.0);
        let (ne, _, _) = lookup(Species::Neon, 1000.0);
        let (ar, _, _) = lookup(Species::Argon, 1000.0);
        assert!(ar > 5.0 * ne && ne > n, "L_z(1 keV): N {n:.2e}, Ne {ne:.2e}, Ar {ar:.2e}");
        // and the bare-ion bremsstrahlung limit is approached at 10 keV
        // (ADAS prb includes a Gaunt factor and residual line power; within 3x).
        let brems = 5.35e-37 * 18.0_f64.powi(2) * 10.0_f64.sqrt();
        let (ar10, zb, _) = lookup(Species::Argon, 10_000.0);
        assert!(ar10 > brems && ar10 < 3.0 * brems, "Ar at 10 keV {ar10:.2e} vs brems {brems:.2e}");
        assert!(zb > 17.8);
    }
}
