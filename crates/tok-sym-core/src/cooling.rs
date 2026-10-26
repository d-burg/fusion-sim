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
