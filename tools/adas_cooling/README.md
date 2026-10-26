# Coronal cooling tables from OpenADAS

`crates/tok-sym-core/src/cooling_tables.rs` is generated from public OpenADAS
adf11 files (https://open.adas.ac.uk): `scd` (ionisation) and `acd`
(recombination) coefficients give the coronal ionisation balance at
n_e = 1e20 m^-3, and `plt` (line power) and `prb` (recombination plus
bremsstrahlung power) give the radiated power per electron per ion. The
tables hold L_z(T_e) in W m^3 together with the mean charge <Z> and <Z^2>.

Regenerate (the adf11 files are not kept in the repository):

```
mkdir -p /tmp/adas && cd /tmp/adas
for f in scd96 acd96 plt96 prb96; do for el in n ne; do
  curl -sO https://open.adas.ac.uk/download/adf11/$f/${f}_$el.dat; done; done
for f in scd89 acd89 plt89 prb89; do curl -sO https://open.adas.ac.uk/download/adf11/$f/${f}_ar.dat; done
for el in n ne ar; do python3 -I <repo>/tools/adas_cooling/coronal.py . $el 14 > lz_$el.txt; done
python3 -I <repo>/tools/adas_cooling/emit_rust.py > <repo>/crates/tok-sym-core/src/cooling_tables.rs
```

Nitrogen and neon use the ADAS "96" GCR-project data; argon uses the "89"
series (Abels-van Maanen 1985). The curves are coronal; in a cold, dense
divertor with finite impurity residence time the low-Z species radiate more
(see Goldston, Reinke and Schwartz 2017, fig. 1), which the detachment model
accounts for through its own calibration rather than through these tables.
