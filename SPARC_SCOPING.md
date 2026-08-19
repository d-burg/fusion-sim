# Adding SPARC to fusion-sim — scoping report

Branch: `feature/sparc-device`
Date: 2026-08-13
Status: **implemented** — see §13 for the as-built result and where it departs
from what was planned here.

Scope of this document: (1) what the repo requires to add a device, using CENTAUR as the
template; (2) what SPARC machine/plasma/geometry/scenario data is available from *public,
published* sources; (3) how the two map onto each other, where the physics regime differs
from CENTAUR, and what has to be assumed because it is not public.

**Everything below comes from open-literature papers or the MIT-licensed
[`cfs-energy/SPARCPublic`](https://github.com/cfs-energy/SPARCPublic) repository.** No
proprietary or non-public CFS material is used or needed.

---

## 1. What the repo requires to add a device

A device is not a single record — it is threaded through 14 files. Full checklist,
derived by tracing `centaur` through the tree:

### 1.1 Rust core (`crates/tok-sym-core`)

| File | What must be added |
|---|---|
| [devices.rs:331](crates/tok-sym-core/src/devices.rs#L331) | `sparc_wall()` — `Vec<(f64, f64)>` wall polygon (R, Z) in metres |
| [devices.rs:376](crates/tok-sym-core/src/devices.rs#L376) | `pub fn sparc() -> Device` — the 18-field `Device` record incl. `ImpurityElmParams` |
| [devices.rs:413](crates/tok-sym-core/src/devices.rs#L413) | `get_device()` match arm + `all_devices()` ordering |
| [simulation.rs:102](crates/tok-sym-core/src/simulation.rs#L102) | `standard_hmode()` — `(ip_flat, duration, p_nbi, p_ech, p_ich, ne_frac)` |
| [simulation.rs:112](crates/tok-sym-core/src/simulation.rs#L112) | `bt` fraction of `bt_max` |
| [simulation.rs:121–135](crates/tok-sym-core/src/simulation.rs#L121) | three waveform-timing tuples (Ip ramp, heating on/off, density) as fractions of `duration` |
| [simulation.rs:218](crates/tok-sym-core/src/simulation.rs#L218), [:276](crates/tok-sym-core/src/simulation.rs#L276) | `lmode()` and `density_limit()` absolute timings |
| [profiles.rs:155](crates/tok-sym-core/src/profiles.rs#L155) | `Profiles::for_device()` arm + `sparc_te_params()` / `sparc_ne_params()` (mtanh: `edge`, `ped`, `core`, `expin`, `expout`, `widthp`, `xphalf`) |
| [tests/physics_audit.rs:763](crates/tok-sym-core/tests/physics_audit.rs#L763) | `sparc_*_refs()` `ReferenceValues` + an audit test |
| [simulation.rs:1169](crates/tok-sym-core/src/simulation.rs#L1169) | a peak-values unit test, mirroring `test_centaur_peak_values` |

Note: `profiles.rs` currently only special-cases ITER; everything else falls back to
DIII-D profile shapes. SPARC needs its own — a 22.8 keV core on a DIII-D-shaped profile
is meaningless.

### 1.2 Web (`web/src`)

| File | What must be added |
|---|---|
| `lib/sparc-geometry.ts` (new) | `SPARC_LIMITER: [number, number][]` — mirrors `centaur-geometry.ts` |
| [DeviceSelect.tsx:11](web/src/pages/DeviceSelect.tsx#L11) | `DEVICE_META` entry (location, status, description) |
| [DeviceSelect.tsx:32](web/src/pages/DeviceSelect.tsx#L32) | `DEVICE_LIMITERS` entry |
| [ControlRoom.tsx:19](web/src/pages/ControlRoom.tsx#L19), [:24](web/src/pages/ControlRoom.tsx#L24), [:58](web/src/pages/ControlRoom.tsx#L58) | limiter map, preset list, `defaultFuel` (SPARC ⇒ `DT`) |
| [ProgramPulse.tsx:49](web/src/pages/ProgramPulse.tsx#L49) | preset list (`getPresets`) |
| [UnifiedTracePanel.tsx:74](web/src/components/UnifiedTracePanel.tsx#L74) | default traces — SPARC is a burning plasma, so it belongs with ITER/CENTAUR (P_fus, Q) |
| [PulsePlanner.tsx:265](web/src/components/PulsePlanner.tsx#L265) | mode-label branch |
| [fusionPhysics.ts:301](web/src/lib/fusionPhysics.ts#L301) | `DivertorThermal` constructor branch (**does not fall through cleanly** — see §5.3) |
| [fusionPhysics.ts:352](web/src/lib/fusionPhysics.ts#L352), [:444](web/src/lib/fusionPhysics.ts#L444), [:455](web/src/lib/fusionPhysics.ts#L455), [:498](web/src/lib/fusionPhysics.ts#L498), [:510](web/src/lib/fusionPhysics.ts#L510) | ambient temp, flux expansion `f_x`, divertor radiation fraction, ELM crash time, ELM energy fraction |
| [portview/config.ts:201](web/src/components/portview/config.ts#L201) | **a `sparc` entry already exists** — placeholder geometry, needs replacing with real numbers |
| [portview/config.ts:304](web/src/components/portview/config.ts#L304), [:315](web/src/components/portview/config.ts#L315), [:351](web/src/components/portview/config.ts#L351) | opacity / power / glow tuning — `sparc` keys already present, values are guesses |
| [Bibliography.tsx](web/src/pages/Bibliography.tsx) | add the SPARC physics-basis references + geometry provenance |
| [TutorialOverlay.tsx:353](web/src/components/TutorialOverlay.tsx#L353) | device list string |

**Pre-existing partial scaffold.** `portview/config.ts` and `PortView.old.tsx` already
carry `sparc` keys (`portR: 2.10`, glow tuning, opacity 0.10, power scale 0.8). These
predate any SPARC device and are not based on published geometry — `portR: 2.10` is
inconsistent with the real outboard wall at R = 2.43 m. Treat them as placeholders to
overwrite, not as a starting point.

### 1.3 What is *not* device-specific

`equilibrium.rs` (Cerfon–Freidberg) is fully parametric on `(R₀, a, κ, δ, config)`;
`transport.rs`, `disruption.rs`, `diagnostics.rs`, `contour.rs` take everything through
`Device`/`ProgramValues`. So no solver work is needed — SPARC is a data-and-tuning job,
not a physics-engine job.

---

## 2. Why CENTAUR is the right template — and where it breaks down

CENTAUR is the closest structural analogue: compact, high-field HTS, D-T by default
(`mass_number: 2.5`), burning-plasma trace defaults, ICRF-only heating, actively-cooled
tungsten divertor assumptions. Copying its wiring pattern is correct.

The **regime is materially different**, and four of CENTAUR's tunings must be inverted:

| | CENTAUR ([devices.rs:376](crates/tok-sym-core/src/devices.rs#L376)) | SPARC |
|---|---|---|
| Triangularity | δ = **−0.55** (negative) | δ_sep = **+0.54** (strongly positive) |
| Edge regime | NT-edge, deliberately **ELM-free**, `p_lh_factor: 3.0` to *keep it out of* H-mode | **QCE / EDA H-mode is the default** (see §11); unmitigated Type-I ELMs of 1.4–2.2 MJ at 2.7–15 Hz are the thing being *avoided*, reachable off-default |
| ELM heat loads | `elmEnergyFraction → 0.0` ([fusionPhysics.ts:513](web/src/lib/fusionPhysics.ts#L513)) | small filamentary transport in QCE; large Type-I fraction when pushed out of the QCE window |
| Divertor cooling | actively cooled, `h_cool: 15000` ([fusionPhysics.ts:346](web/src/lib/fusionPhysics.ts#L346)) | **inertially cooled** (no active divertor cooling) + ~1 Hz strike-point sweep |
| Divertor topology | `DoubleNull`, `f_x: 18` (snowflake-like) | LSN baseline (DN also planned), conventional vertical targets, `f_x` ≈ 5–8 |
| Confinement | `confinement_factor: 1.0`, H98 ≈ 0.96 claimed | H98,y2 = **1.0** by design assumption |

Also: `fusionPhysics.ts`'s `DivertorThermal` constructor uses a bare `else` branch that
currently means "CENTAUR" ([fusionPhysics.ts:338](web/src/lib/fusionPhysics.ts#L338)).
Adding SPARC there without restructuring would silently give SPARC CENTAUR's active
cooling — the opposite of the published design. This branch must become an explicit
`deviceId === 'centaur'` check with SPARC as its own case.

---

## 3. Public data inventory

### 3.1 `cfs-energy/SPARCPublic` (MIT licence)

Verified contents (repo tree pulled and files parsed):

| Path | Content | Usable for |
|---|---|---|
| `PrimaryReferenceDischarge/1 - PRD_POPCON_*.csv` | 0D operating point, 16 quantities | `Device` fields, preset targets |
| `PrimaryReferenceDischarge/2,3,7` | FreeGS GEQDSKs — **DN and LSN**, PRD | separatrix shape, **555-pt first-wall contour**, volume/area |
| `PrimaryReferenceDischarge/4` | CHEASE core equilibrium | (not needed) |
| `PrimaryReferenceDischarge/5 - transp_*.txt` | TRANSP `input.gacode`-style profiles: ρ, ψ, q, Te, Ti, ne on 101 pts | `sparc_te_params()` / `sparc_ne_params()` fits |
| `PrimaryReferenceDischarge/6 - cgyro_*.txt` | CGYRO profiles (Rodriguez-Fernandez NF 62 076036) | cross-check |
| `PrimaryReferenceDischarge/8 - coilData_*.dat` | PF coil positions/currents | portview / future free-boundary work |
| `XPointTarget/` | XPT scenario POPCON + DN/LSN equilibria | an optional 4th preset |
| `LmodeLowerSingleNull/{VV,VH,HV}/` | L-mode LSN equilibria, 3 target geometries (Ip = 8.5 MA, p₀ = 0.5 MPa) | L-mode preset, divertor target geometry |
| `EQlibrary/` | ~100 GEQDSKs + PNG previews | ramp-up shape sequence (see §6) |
| `DeviceDescription/OS_SPARC_Device_Description.json` | IMAS/OMAS schema: 176-pt limiter outline, inner/outer vessel wall outlines, 22 PF coils, 19 circuits, VS-coil covers | portview vessel + ports |

Licence: MIT (`Copyright (c) 2022 aqkuang`) with a requested acknowledgement:

> "The information, data, or work presented herein builds on the SPARC primary reference
> discharge and X-point target discharge data provided by Commonwealth Fusion Systems."

Caveat, quoted from `DeviceDescription/README.md`: *"This is not an accurate description of
the geometry of SPARC"* — coil turn divisions are toy data and details are removed. The
limiter/wall contour is a **simplified** first wall. That is fine for this simulator (all
existing walls are simplified polygons) but must be stated in the Bibliography page.

### 3.2 Published papers

The SPARC Physics Basis — *Journal of Plasma Physics* **86**(5), 2020, seven papers, all
open access:

1. Creely et al., *Overview of the SPARC tokamak*, 865860502 — **machine table, three
   operating scenarios, campaign plan** ✔ used below
2. Rodriguez-Fernandez et al., *Predictions of core plasma performance*, 865860503
3. Hughes et al., *Projections of H-mode access and edge pedestal*, 865860504 — **P_LH,
   pedestal, ELM size/frequency** ✔ used below
4. Kuang et al., *Divertor heat flux challenge and mitigation*, 865860505 — **P_SOL, λ_q,
   sweeping, PFC material** ✔ used below
5. Lin, Wright & Wukitch, *Physics basis for the ICRF system*, 865860506
6. Sweeney et al., *MHD stability and disruptions*, 865860507
7. Scott et al., *Fast-ion physics in SPARC*, 865860508

Plus Rodriguez-Fernandez et al., *Overview of the SPARC physics basis towards the
exploration of burning-plasma regimes*, **Nucl. Fusion 62** 042003 (2022).

---

## 4. Parameter mapping — `Device` struct → published value

All values below are taken from the sources named; nothing is invented.

| `Device` field | Value | Source |
|---|---|---|
| `name` / `id` | `"SPARC"` / `"sparc"` | — |
| `r0` | **1.85** m | Creely Table 1 |
| `a` | **0.57** m | Creely Table 1 |
| `bt_max` | **12.2** T | Creely Table 1 (GEQDSK: `bcentr/R₀` = 22.49/1.85 = 12.16 T) |
| `ip_max` | **8.7** MA | Creely Table 1 |
| `kappa` | 1.97 (sep) / 1.91 (κ₉₉₅) / **1.75 (κ_a)** | Creely T1, Hughes T1, Creely §4 — *see decision below* |
| `delta_upper`/`delta_lower` | 0.54 (sep) / **0.45–0.49 (δ₉₅/δ₉₉₅)** | Creely T1 & §4, Hughes T1 |
| `volume` | **20.1** m³ | computed by revolving the PRD LSN separatrix from the public GEQDSK (DN: 20.2) |
| `surface_area` | **58.7** m² | same contour, surface of revolution (DN: 59.6) |
| `mass_number` | **2.5** | Hughes Table 1 (50:50 D-T) |
| `z_eff` | **1.5** | Creely Table 2 |
| `z0` | **0.0** | GEQDSK `zmaxis` = −0.002 m; vessel is exactly up-down symmetric |
| `config` | `LowerSingleNull` | Creely §4.1: baseline is attached single-null with sweeping; DN also planned |
| `p_lh_factor` | see §5.2 | Hughes: P_th = **21 MW (D-T)**, **> 25 MW (D-D)** |
| `confinement_factor` | 1.0 | H98,y2 = 1.0 is the design assumption |

**κ / δ decision needed.** `device.kappa` and the programmed `delta` feed *both* the
Cerfon–Freidberg boundary shape ([equilibrium.rs:48](crates/tok-sym-core/src/equilibrium.rs#L48))
*and* the IPB98 τ_E scaling ([transport.rs:384](crates/tok-sym-core/src/transport.rs#L384))
and the Uckan q\* ([transport.rs:222](crates/tok-sym-core/src/transport.rs#L222)). The
shape wants κ_sep = 1.97 / δ_sep = 0.54; the scalings want κ_a = 1.75 / δ₉₅ ≈ 0.45
(exactly what Creely used to get q\* = 3.05, q₉₅ ≈ 3.4). Using 1.97 in IPB98 inflates
τ_E by ≈ 1.10×. Existing devices already blur this (JET κ = 1.95 vs κ_a ≈ 1.7), so the
low-effort path is κ_sep and accepting the bias; the correct path is a separate
`kappa_areal` field used by the scalings only. **Recommend the latter** — it is a ~10 %
confinement error otherwise, and it would also fix JET/ITER.

### Derived cross-checks (all consistent)

- Greenwald: `ip_max / (π a²)` = 8.7/(π·0.57²) = **8.52×10²⁰ m⁻³** vs Hughes' quoted 8.5 ✔
  (so `Device::greenwald_density` needs no special-casing)
- f_GW at PRD: 3.1/8.5 = **0.37** ✔ matches Creely Table 2
- ε = a/R₀ = **0.308** ✔ matches Creely Table 1 (0.31)

---

## 5. Plasma regime and physics tunings

### 5.0 Heating systems — ICRF only, no ECH, no NBI

Checked explicitly. **SPARC has no electron cyclotron heating and no neutral beams.**

- ECH is not viable: the EC resonance at 12.2 T needs sources above **300 GHz**, which do
  not exist. *SPARC as a platform to advance tokamak science* (Phys. Plasmas **30**,
  090601, 2023) states it could be fielded only if such sources were developed.
- The sole auxiliary heating is **ICRF: 25 MW at 120 MHz**, D(He³)/hydrogen-minority
  (Creely §3; Lin, Wright & Wukitch 2020). Of the 18 midplane ports, seven carry pairs of
  four-strap ICRF antennas.

Consequences for the sim:
- `p_nbi` and `p_ech` should be **pinned to zero** for SPARC in every preset, and ideally
  greyed out in the PulsePlanner so users cannot dial in heating the machine does not have.
  `p_ich` is the only heating knob.
- The "push it into ELMy H-mode by adding power" path is therefore an **ICRF** slider, not
  a gyrotron one.
- ICRF-only heating is not incidental: it is precisely why **EDA H-mode is a natural
  candidate for SPARC** — EDA has historically been accessed on wave-heated devices
  (C-Mod), and SPARC is the closest modern analogue.

### 5.1 Profiles (from the public TRANSP file, parsed)

| ρ | T_e (keV) | T_i (keV) | n_e (10¹⁹ m⁻³) | q |
|---|---|---|---|---|
| 0.00 | 22.77 | 19.98 | 41.7 | 0.85 |
| 0.50 | 10.32 | 9.66 | 34.7 | 1.05 |
| 0.90 | 4.57 | 4.61 | 29.2 | 2.93 |
| 0.95 | 4.14 | 4.15 | 27.9 | 3.56 |
| 0.99 | 0.36 | 0.66 | 9.0 | 4.51 |
| 1.00 | 0.27 | 0.57 | 8.4 | 5.17 |

Direct read-off for `ProfileParams`: `core` ≈ 22.8 keV / 4.17×10²⁰, `ped` ≈ 4.1 keV /
2.8×10²⁰, `edge` ≈ 0.27 keV / 0.84×10²⁰, pedestal foot at ρ ≈ 0.96 with `widthp` ≈ 0.04.
Note T_e ≠ T_i in the core (22.8 vs 20.0) — the current 0D model carries a single
temperature, so this is lost; acceptable, but worth a note in the Bibliography.

### 5.2 H-mode access — the interesting bit

Hughes projects **P_th ≈ 21 MW in D-T** (Martin scaling with a 20 % isotope reduction and
radiated power subtracted) against 25 MW of installed ICRF — *and states that alpha
heating is likely needed for H-mode sustainment*. In **D-D, P_th,min > 25 MW**, i.e.
**H-mode access is not assured without fusion alphas**. That is a genuinely different and
more interesting scenario than any device currently in the sim, and it exercises code the
sim already has (`p_lh_factor`, alpha heating in `net_heating`). It also means the DD/DT
fuel toggle in ControlRoom is physically load-bearing for SPARC in a way it is not for
DIII-D. Recommend `p_lh_factor` be *calibrated* so the model reproduces ≈ 21 MW (D-T)
rather than picked by feel; ITER's 0.35 and CENTAUR's 3.0 were both hand-set.

### 5.3 Divertor (Kuang 2020) — needs real changes, not a copy of CENTAUR

| Quantity | Published value |
|---|---|
| P_SOL (design upper limit) | **29 MW** (integrated modelling gives 19–21 MW) |
| P_SOL·B₀/R₀ | **191 MW·T/m** (H-mode), 199 (L-mode) — ~6× C-Mod |
| λ_q (design assumption) | **0.18 mm** (narrowest of the scalings surveyed; range up to 0.45 mm) |
| Inner : outer power split | 40 % : 70 % (deliberately over-allocated for margin) → 11.6 / 20.3 MW |
| Divertor radiation fraction | **50 %** assumed for baseline design |
| B_pol at OMP | 2.83 T |
| Cooling | **inertial** — no active divertor cooling; 10 s pulse |
| Mitigation | **~1 Hz strike-point sweep** over the 10 s flat-top; 0.3 m inner / 0.4 m outer poloidal arc (2.6 / 4.5 m²) |
| PFC material | **carbon or tungsten, both under evaluation** (paper is explicit that it is undecided) |
| ELMs | ΔW_ELM = **1.4–2.2 MJ**, f_ELM = **2.7–15 Hz**, τ_ELM ≈ 0.12 ms; W flash-melt limit ≈ 50 MJ m⁻² s^(−1/2) |

Implications for `fusionPhysics.ts`:
- `h_cool = 0` (inertial), not 15000. Armor thickness/material depends on the C-vs-W
  choice — recommend W with a stated assumption, since the sim needs *a* number.
- The 1 Hz sweep is a genuine modelling choice: either model it (time-varying wetted
  area, which would make the divertor temperature trace visibly saw-tooth at 1 Hz — a nice
  visual) or fold it into an effective wetted-area multiplier and say so.
- `elmCrashTime` = 0.12 ms and an ELM energy fraction from ΔW_ELM/W_ped, not a guess.

### 5.4 Disruptions

Sweeney 2020 covers MHD limits, thermal/current quench, runaway electrons and halo
currents. Not yet mined for numbers — the sim's `disruption.rs` has device-independent
thresholds, so this is optional for a first pass but is the obvious source if SPARC-specific
disruption behaviour is wanted later.

---

## 6. Geometry — what we can build

### 6.1 First wall / limiter ✔ excellent coverage

The PRD GEQDSKs carry a **555-point limiter contour**, R ∈ [1.269, 2.430], Z ∈ [±1.599],
verified **exactly up-down symmetric** (mirror mismatch 0.0), including resolved
divertor baffle/target structure at both ends. The IMAS device description carries an
independent 176-point limiter outline over the same extent, plus inner and outer vacuum
vessel wall outlines.

Plan: decimate the 555-point contour to ~60–90 points (matching the density of
`jet-geometry.ts`, 258 lines) for `SPARC_LIMITER`, and a coarser ~40-point version for
`devices.rs::sparc_wall()`. This is a genuine published contour — better provenance than
DIII-D's or JET's hand-crafted polygons, and better than CENTAUR's 20-point outline.

### 6.2 Separatrix ✔

PRD boundary from the GEQDSKs (102 points each):

| | R₀ | a | κ | δ_upper | δ_lower | Z range |
|---|---|---|---|---|---|---|
| LSN | 1.851 | 0.571 | 1.897 | 0.402 | 0.489 | −1.111 … 1.055 |
| DN | 1.851 | 0.570 | 1.955 | 0.561 | 0.491 | −1.111 … 1.117 |

These can be used to validate the Cerfon–Freidberg output rather than just trusting it —
a check no other device in the repo currently has.

### 6.3 Portview 3D ⚠ partial

Available: 18 TF coils; three ports at each toroidal location (one midplane, one
symmetric pair above/below) — Creely §3; PF coil positions from both the coil data file
and the IMAS description; vessel inner/outer wall outlines. Toroidally continuous,
tightly baffled divertor. ICRF: 25 MW at 120 MHz, sole auxiliary heating.

Not available publicly: port dimensions, antenna dimensions/toroidal extent, tile
layout. These will have to be styled by analogy (as every other device in `config.ts`
already is) — the existing `sparc` block is a reasonable *structure* to keep, with
dimensions rescaled to the real wall radius (2.43 m, not 2.10 m) and the port count set
to 18 rather than 10.

---

## 7. Pulse plan — three published scenarios map straight onto the three presets

Creely Table 2 gives three complete D-T operating points. This is an unusually clean fit
to the existing preset structure:

| | Full-field H-mode (PRD) | Full-field L-mode | 8 T H-mode |
|---|---|---|---|
| B₀ (T) | 12.2 | 12.2 | 8 |
| I_p (MA) | 8.7 | 8.7 | 5.7 |
| q\*_Uckan | 3.05 | 3.05 | 3.05 |
| H98,y2 | 1.0 | 1.0 | 1.0 |
| τ_E (s) | 0.77 | 0.44 | 0.65 |
| P_RF (MW) | 11.1 | 24.1 | 9.9 |
| P_ohmic (MW) | 1.7 | 1.1 | 1.1 |
| ⟨T⟩ (keV) | 7.3 | 9.7 | 5.6 |
| ⟨n_e⟩ (10²⁰ m⁻³) | 3.1 | 1.4 | 1.5 |
| f_GW | 0.37 | 0.16 | 0.26 |
| β_N | 1.0 | 0.6 | 0.8 |
| P_fus (MW) | 140 | 55 | 17 |
| Q | 11.0 | 2.2 | 1.6 |

Proposed preset mapping (revised — see §11, the default is **QCE**, not the PRD):
- `hmode` → **QCE scenario** (degraded pedestal, Q ≈ 5), *not* the PRD; the PRD's
  unmitigated Type-I ELMy state is reachable by raising ICRF power past the QCE window
- `lmode` → **full-field L-mode** (note: this is *not* a low-power scenario — 24.1 MW of
  RF and Q = 2.2; the generic `lmode()` builder, which sets `p_nbi = p_ech = p_ich = 0`
  and `ip = 0.4·ip_max`, is wrong for SPARC and needs a device arm)
- `density_limit` → constructible: f_GW = 0.37 nominal against n_G = 8.5×10²⁰ leaves an
  enormous margin, so a density-limit push is a *long* way from the operating point.
  Physically honest, if less dramatic than on DIII-D.
- Optional 4th: **X-point target** (`XPointTarget/` POPCON: 5 MA, 16.7 MW RF, 23.5 MW
  fusion) — a distinct divertor-physics scenario with its own public equilibrium.

**Timing.** Flat-top is **10 s** (Creely Table 1), with 42 Wb of flux available.
Creely Fig. 3 shows TSC-computed I_p and q traces; the current profile is equilibrated
within ~5 s of flat-top start, and flat-top spans >10 τ_E. What is *not* published as a
table is the ramp-rate breakdown — Fig. 3 is a figure, not data. Two options:
(a) digitise the figure, or (b) use the `EQlibrary/` ~100 equilibria, which appear to
span the shape/current evolution, to infer a plausible ramp sequence. Either way the
ramp itself is an approximation and should be labelled as such; the 10 s flat-top is
firm.

Recommended shape, expressed in the existing fraction-tuple form: ~25 s total (≈4 s ramp
to 8.7 MA, 10 s flat-top, ~4 s ramp-down, padded), ICRF on shortly after flat-top start
and off before ramp-down begins.

---

## 8. Gaps — things that must be assumed, and should be labelled as assumptions

1. **PFC material.** Officially undecided in the 2020 basis (C vs W). Pick W, state it.
2. **Ramp rates.** Figure-only; see §7.
3. **Port/antenna dimensions** for the 3D view. Style by analogy.
4. **Divertor target tile geometry.** The wall contour resolves the divertor shape, but
   tile-level detail, sweep waveform amplitude in (R, Z), and target tilt are not public
   at usable fidelity.
5. **Impurity/ELM thresholds** (`ImpurityElmParams`). SPARC-specific seeding thresholds
   are not published; Kuang gives detachment impurity fractions (33.5 % N / 11.5 % Ne by
   a Reinke-scaling extrapolation) but those are divertor, not core-seeding, numbers.
   Will have to be scaled from ITER's values with a comment.
6. **T_e ≠ T_i** in the core — not representable in the current 0D model.
7. **Sawteeth.** Public q-profile has q₀ = 0.85 < 1, so sawteeth are expected and are
   discussed in the papers; the sim has no sawtooth model.

---

## 9. Attribution obligations (must be honoured in the Bibliography page)

- Cite the seven JPP 2020 physics-basis papers + Rodriguez-Fernandez NF 62 042003 (2022).
- Reproduce the CFS acknowledgement sentence from `SPARCPublic` verbatim (§3.1).
- Preserve the MIT licence notice for any data files derived from `SPARCPublic`.
- State that the wall contour is CFS's *simplified* public first wall, and that the
  device description is explicitly not an accurate SPARC geometry.
- SPARC is a real machine under construction by a private company — the `DEVICE_META`
  description and any performance claims should track the published projections and not
  overstate them.

---

## 10. Proposed implementation order

1. Vendor the derived geometry: decimate wall contour → `sparc_wall()` + `sparc-geometry.ts`,
   with provenance comments and the CFS acknowledgement.
2. `devices::sparc()` with the §4 table; add to `get_device` / `all_devices`.
3. `sparc_te_params()` / `sparc_ne_params()` fitted to the public TRANSP profiles;
   `Profiles::for_device` arm.
4. Presets: `standard_hmode` → **QCE scenario** (§11.4), a SPARC arm for `lmode`
   (full-field L-mode, 24 MW ICRF), `density_limit`. ICRF-only: pin `p_nbi`/`p_ech` to 0.
5. ~~Resolve the κ_areal decision (§4)~~ — **done**: `Device::kappa_areal` +
   `Device::areal_ratio()` added; IPB98, Uckan q* and the poloidal cross-section now use
   κ_a, the boundary shape still uses κ_sep. Existing devices set κ_a = κ_sep so their
   calibration is untouched (all 55 lib tests pass); revisiting JET/ITER properly is a
   separate, re-tuning job.
6. Calibrate `p_lh_factor` against P_th = 21 MW (D-T) / >25 MW (D-D); verify the DD case
   genuinely fails to reach H-mode.
7. `physics_audit.rs` reference ranges from Creely Table 2 (Q = 11, P_fus = 140 MW,
   τ_E = 0.77 s, β_N = 1.0, ⟨T⟩ = 7.3 keV) — these are strict, published targets, so this
   is the real acceptance test.
8. **QCE regime work (§11):** density/α_t gate alongside the impurity gate, QCE pedestal
   penalty (0.75–0.80×), audit target Q ≈ 4–6, and the transient-Type-I-then-QCE entry
   sequence in the waveforms.
9. Divertor: restructure the `DivertorThermal` else-branch, add inertial-cooling SPARC
   case, λ_q = 0.18 mm floor, 50 % divertor radiation, sweep model or documented effective
   wetted area, Type-I ELM parameters (for the off-default ELMy state).
10. Web wiring (§1.2) + portview `sparc` config rebuilt on real dimensions.
11. **Magnetics module (§12).**
12. Bibliography entries and provenance notes.

Steps 1–7 are the physics core and are all backed by published numbers. Steps 8–10 involve
the documented assumptions in §8.

---

## 11. SPARC as the QCE demonstrator

**Decision:** SPARC's default scenario is the **QCE regime**, not the Type-I ELMy PRD.
Rationale: 1.4–2.2 MJ ELMs at 2.7–15 Hz would flash-melt the (inertially cooled) divertor
in the sim's own thermal model and would look, correctly, like a machine destroying
itself; and small/no-ELM operation is where CFS and the community are actually heading.
Calling the regime "QCE" throughout (rather than distinguishing QCE from EDA in the UI)
keeps it teachable.

### 11.1 What QCE is, from the literature

The quasi-continuous exhaust regime is a **type-I ELM-free H-mode obtained at high plasma
shaping and high separatrix density**. Ideal/resistive ballooning modes just inside the
separatrix are the leading explanation for type-I ELM stabilisation: as fuelling rises the
pedestal foot becomes ballooning-unstable, and transport is carried by high-frequency,
low-amplitude filaments instead of discrete crashes. Established on ASDEX Upgrade and
reproduced on JET (Faitsch, Harrer et al.).

| Quantity | Published value |
|---|---|
| Critical separatrix density for QCE access | **0.3–0.4 n_GW** |
| SepOS access parameter | **α_t ≳ 0.55** (AUG-calibrated) |
| Shaping requirement | high κ *and* δ, correlated with closeness to double-null |
| EDA vs QCE | same family; EDA sits at **lower** separatrix density/fuelling, QCE at higher |
| Distinguishing signature | QCM bandwidth **Δf < 10 kHz ⇒ EDA**, broader ⇒ QCE |

**Entry sequence** (AUG *and* JET, and the thing to reproduce in the waveforms):
L→H transition → **a transient Type-I ELMy phase** → final shaping reached and fuelling
raised → **QCE, held for the whole flat-top**. This is a genuinely nice pulse narrative:
the user sees a handful of big ELMs, then the trace goes quiet as the machine settles
into QCE.

### 11.2 One correction to the plan: impurity seeding does *not* buy QCE access

This is the main thing the literature search changed. The repo's current QCE gate is
**purely impurity-driven** ([transport.rs:483](crates/tok-sym-core/src/transport.rs#L483)):
`impurity_fraction ≥ impurity_qce_threshold && delta ≥ delta_grassy_min`. For SPARC that
is backwards. Lomanowski, Eich, Lore, Park, Body & Stangeby, *The power exhaust
constrained SPARC separatrix operational space* (arXiv:2607.18558, July 2026) finds:

- Ne seeding **reduces** separatrix density — **≈50 % reduction at 2 % separatrix Ne
  concentration** — through power starvation of the SOL;
- since QCE access needs *high* n_e,sep, seeding therefore **impairs** QCE access;
- recovering the lost n_e,sep requires substantially more D₂ fuelling;
- meanwhile the divertor genuinely needs radiation: **q_⊥ < 10 MW/m²** and **T_e,target
  ≲ 20 eV** (to suppress W sputtering);
- conclusion, quoted: *"a compromise between high radiative fraction and high
  density/neutral pressure is required for QCE access"*.

So the default SPARC pulse should be **heavy D₂ fuelling + full shaping to reach
n_e,sep ≈ 0.3–0.4 n_GW, with modest Ne seeding for divertor protection** — and
*over*-seeding should knock the plasma back out of QCE. That is a better control-room
lesson than "seed neon → ELMs stop": it makes the two knobs genuinely compete, which is
the real operational problem.

**Code change required:** add a density/α_t-style gate alongside the impurity gate rather
than replacing it (CENTAUR and the other devices keep their current behaviour). The 0D
state already carries `f_greenwald`, which is the available proxy for n_e,sep/n_GW.
Proposal: extend `ImpurityElmParams` with `qce_fgw_threshold` and a
`qce_impurity_ceiling`, and make SPARC's QCE window
`f_greenwald ≥ qce_fgw_threshold && delta ≥ delta_grassy_min && impurity_fraction ≤ qce_impurity_ceiling`.
Note the sim's `f_greenwald` is a line-averaged quantity, not a separatrix one, so the
threshold is a *tuned proxy* and must be commented as such — the published 0.3–0.4 n_GW
is a **separatrix** density.

### 11.3 Degraded pedestal and the performance target

QCE buys ELM-free operation at the cost of pedestal pressure. Published anchor, from
Hughes 2020 §4.2: *"even if ELM mitigation techniques result in a 2× reduction of the
pedestal pressure, Q > 2 is still predicted."*

That brackets the target: full pedestal ⇒ Q = 11; half pedestal ⇒ Q > 2. A **0.75–0.80×
pedestal**, as proposed, lands in between at roughly **Q ≈ 4–6, P_fus ≈ 60–90 MW** — so
targeting **Q ≈ 5** is well-supported rather than invented. Worth stating in the
Bibliography that the specific 0.78 factor is our interpolation, not a published SPARC
projection.

Implementation: the QCE branch in
[transport.rs:573](crates/tok-sym-core/src/transport.rs#L573) currently applies only a
small continuous loss (`qce_loss_rate = 0.005`) and **no confinement penalty at all** — a
device sitting in QCE today gets ELM-free operation for free. Add a pedestal/confinement
multiplier active in the QCE branch, and check the resulting Q against the 4–6 window in
the physics audit.

### 11.4 Preset lineup

Recommended for SPARC: **QCE** (default) · **L-mode** · **Density Limit**.

- **QCE** — full field/current, ~11–15 MW ICRF, heavy D₂ puff, modest Ne. Ends in QCE
  after a brief Type-I phase. Q ≈ 5.
- **L-mode** — the published full-field L-mode point (24.1 MW ICRF, Q = 2.2, f_GW = 0.16).
  Reached from QCE by cutting fuelling and seeding. Note this is *not* a low-power
  scenario, so the generic `lmode()` builder needs a SPARC arm.
- **Density Limit** — retained, though SPARC's f_GW = 0.37 nominal against n_G = 8.5×10²⁰
  leaves a large margin, so this is a long push.
- **Type-I ELMy H-mode** — deliberately *not* a preset. It is what you get by raising ICRF
  power past the QCE window, which is the intended discovery moment (and where the
  divertor thermal model should visibly complain).

Mechanically this follows the CENTAUR pattern exactly: keep the `PresetId` union
(`'hmode' | 'lmode' | 'density_limit'`) unchanged, give SPARC its own arm inside
`standard_hmode()`, and relabel `hmode` → "QCE" in the UI per device — the same trick
CENTAUR uses for "NT-edge" ([ProgramPulse.tsx:34](web/src/pages/ProgramPulse.tsx#L34),
[PulsePlanner.tsx:280](web/src/components/PulsePlanner.tsx#L280),
[ControlRoom.tsx:25](web/src/pages/ControlRoom.tsx#L25)). No new plumbing.

---

## 12. Magnetics module (new UI component)

A synthetic magnetics panel — raw Mirnov signal plus a spectrogram — showing the edge
oscillation that carries the QCE transport. This is the diagnostic physicists actually use
to identify these regimes, and the sim currently has nothing like it.

### 12.1 Published QCM characteristics

| | Alcator C-Mod (EDA) | ASDEX Upgrade (EDA / QCE) |
|---|---|---|
| Frequency | **~50–150 kHz** (often quoted 50–200; "of order 100 kHz") | **~15–35 kHz** |
| Toroidal mode number | n ≈ 17 | harmonics up to n = 10 |
| Wavenumber | k_θ ≈ 5 cm⁻¹ | 0.025 < k_θρ_s < 0.075, k_r ≈ 0 |
| Location | pedestal density-gradient region | ρ_pol = 0.993 ± 0.007 (≈7 mm inside separatrix) |
| Propagation | electron diamagnetic direction (lab frame) | ion diamagnetic direction (plasma frame) |
| Role | drives particle transport, prevents impurity accumulation, holds edge gradients below the peeling–ballooning limit — hence no Type-I ELMs |

AUG also reports a frequency scaling **f_QCM·R₀/c_s ∝ 1/β_pol²**, which gives the mode
something physical to respond to rather than sitting at a fixed frequency.

For SPARC, anchoring near the **C-Mod value (~100 kHz)** is the defensible choice — high
field, compact, ICRF-heated, and the explicit basis for SPARC's EDA candidacy.

### 12.2 Proposed synthesis

Two stacked plots, ~200 ms rolling window:

1. **Mirnov coil trace** (dB_θ/dt, arbitrary units) — broadband noise plus the coherent
   component, so users see that the mode is buried in turbulence and only becomes obvious
   in the transform.
2. **Spectrogram**, 0–200 kHz vs time.

Signal model, driven by the existing sim state:

| Regime | Synthetic content |
|---|---|
| L-mode | broadband/pink turbulence floor only — no coherent band |
| Type-I ELMy H-mode | quiet inter-ELM band + a **vertical broadband burst** at every ELM event (`elm_active` already exists) |
| QCE | QCM band at f_QCM with **Δf > 10 kHz**, plus continuous low-level filament noise, no discrete bursts |
| EDA-like (low fuelling edge of the window) | same band narrowed to **Δf < 10 kHz** |

Plus 1–2 harmonics, amplitude scaled by pedestal pressure, and f_QCM moved by the β_pol
scaling so it drifts as the plasma evolves.

### 12.3 Honesty requirements

This is a **synthetic, illustrative diagnostic** — the 0D model does not compute edge MHD.
It must be labelled as such in the panel and in the Bibliography, in the same way the
existing Dα and divertor-thermal traces are. The teaching value (what a Mirnov coil is,
what a spectrogram shows, how a regime is *identified* rather than declared) is real; the
signal is a reconstruction consistent with published mode parameters, not a prediction.

### 12.4 Placement

`ControlRoom` already carries `UnifiedTracePanel`, `ProfilePanel`, `PortView`,
`DisruptionGauge`. The magnetics panel is a natural sibling of `UnifiedTracePanel` and
should probably be a toggleable tab there rather than permanent screen real estate —
it is only interesting on SPARC (and, later, any device driven into QCE).

---

## 13. As built — results, and where reality differed from the plan

### 13.1 The QCE scenario works, and enters the published way

Measured from `cargo run --release --example sparc_check` (a dev harness added
alongside this work) and locked in by two unit tests in `simulation.rs`:

| | Value |
|---|---|
| L–H transition | t ≈ 4.8 s |
| Transient Type-I ELMy phase | ≈ 24 crashes |
| QCE onset | t ≈ 11.3 s, held to the end of flat-top |
| Flat-top Q | **2.7** |
| Flat-top P_fus | **51 MW** |
| τ_E | 0.84 s |
| T_e0 | 11.7 keV |
| β_N | 0.84 |
| f_GW | 0.46 |
| Disruption | none |

Off-nominal behaviour, all as intended:

- **+25 MW ICRF held all pulse** → 45 Type-I crashes instead of 24, QCE pushed
  out past the flat-top, P_fus 82 MW, Q 3.1. More power, more fusion, and the
  big ELMs come back — the intended discovery.
- **Heavy Ne seeding** → QCE never accessed; the plasma radiates away.
- **L-mode preset** → never reaches H-mode, no ELMs, T_e0 3.6 keV.

### 13.2 Q lands at ≈2.7, not the ≈5 anticipated in §11.3

The interpolation in §11.3 (0.78 pedestal ⇒ Q ≈ 4–6) assumed the pedestal was
the binding constraint. In the running model it is not — **the L-H sustainment
power is**. At the elevated density QCE needs, the Martin threshold reaches
≈29 MW, so holding H-mode costs ≈17 MW of ICRF on top of the alphas, and that
recirculating power is exactly what divides into Q. Backing the RF down further
drops the plasma out of H-mode and into an alpha-power death spiral.

That is a more interesting result than the one planned for, and it is the honest
one: **QCE costs gain mainly through recirculating power, not through the
pedestal.** Q = 2.7 also sits right at SPARC's actual mission requirement
(Q > 2) and close to the published full-field L-mode point (Q = 2.2).

Getting to Q ≈ 5 would mean weakening either `qce_fgw_threshold` or
`h_mode_sustain_factor` — both tuned proxies, both currently justified — so it
would be a decision to make the demo prettier at the cost of self-consistency.

### 13.3 Four model changes SPARC forced, beyond adding a device

These are physics changes, not SPARC tuning, and they are flagged because they
affect (or could have affected) other devices:

1. **Neon cooling rate rolled off above 2 keV**
   ([transport.rs](crates/tok-sym-core/src/transport.rs)). The existing `Lz`
   expression *rose* without limit with temperature, which is backwards — neon
   is fully stripped above ~2 keV. Uncorrected, SPARC radiated ~29 MW from a
   neon fraction of 5×10⁻⁴ and collapsed. The low-temperature branch is
   untouched, so DIII-D and JET are unaffected; **ITER's neon scan
   (`test_audit_iter_neon_scan`, `#[ignore]`d) will now give different numbers**
   and should be re-checked.
2. **L-H hysteresis is now a device parameter** (`h_mode_sustain_factor`).
   Previously hardcoded at 0.8; still 0.8 for every pre-existing device, 0.65
   for SPARC. Without it the plasma drops out of H-mode precisely when the edge
   density becomes high enough to be interesting.
3. **`equilibrium_a_scale`** separates the parametric-equilibrium minor radius
   from the physics minor radius. SPARC needed 0.93 because the analytic
   Cerfon–Freidberg boundary bulges past the published wall at the inboard
   corners even though the *real* separatrix clears it by 7 mm. DIII-D and JET
   currently fudge `a` itself for the same reason, which distorts their
   Greenwald limits — they should migrate.
4. **`lmode()` fuelling times now scale with the device flat-top.** They were
   hardcoded at 1/6/7 s, correct for DIII-D's 8 s pulse but leaving ITER,
   CENTAUR and SPARC at 5×10¹⁸ m⁻³ for most of flat-top — and therefore at
   absurd temperatures. This is a pre-existing bug that SPARC exposed; ITER and
   CENTAUR L-mode presets change as a result.

### 13.4 Verification status

- `cargo test -p tok-sym-core --lib` — **57 passed, 0 failed** (55 pre-existing
  plus the two new SPARC QCE tests).
- `npx vitest run src/components/magnetics.test.ts` — **7 passed**, covering the
  regime mapping and the EDA/QCE bandwidth discriminator.
- `tsc --noEmit` and `eslint` clean on all changed web files.
- Browser: SPARC device page, geometry, preset lineup, pulse planner with NBI
  and ECH hard-disabled at zero, and the magnetics panel all verified rendering.
  **The time evolution into QCE was not watched in the browser** — the
  automation pane keeps the tab hidden, which throttles `requestAnimationFrame`
  to zero, so the pulse cannot advance there. The regime sequence is verified in
  the Rust harness and by unit test instead.

---

## 14. Round 2 — as built

Changes made after review of the first build (all verified: 57 Rust lib tests,
7 vitest, tsc + eslint clean):

1. **Double-null by default.** `config: MagneticConfig::DoubleNull` — the
   vessel is exactly up-down symmetric and DN operation is planned. SPARC is
   exempted from the generic 0.88 DN plasma shrink (its wall *is* a DN vessel
   and `equilibrium_a_scale` already encodes clearance). The frontend divertor
   model's DN power split now applies automatically.
2. **1 Hz strike-point sweep**, implemented in the *equilibrium*: the boundary
   triangularity oscillates at `strike_sweep_hz` (new `Device` fields), which
   moves the X-points — and with them the separatrix legs, the strike points,
   the equilibrium panel and the portview glow — self-consistently. The sweep
   is **inward-only** (δ ∈ [δ₀ − 0.04, δ₀]) because the swept boundary must
   never protrude past a wall the baseline barely clears: the first attempt
   swept symmetrically and put the plasma into the wall at t ≈ 6 s. On the
   frontend, the tile-averaged divertor load now uses the published swept
   target area (4.5 m²) with a sweep-phase proximity factor (unit time-average)
   so the tile temperature shows the ~1–2 Hz sawtooth of the stripe passing.
3. **Grassy-only ELMs.** `impurity_type2_threshold: -1.0` is a documented
   sentinel making Type-II (grassy) the floor regime whenever SPARC is in
   ELMing H-mode, with the q95 gate widened to (2.0, 9.0). SPARC produces
   **zero Type-I ELMs under any input** — asserted by both unit tests. The QCE
   entry sequence is now L-H → grassy phase (~100 small crashes) → QCE.
   Frontend ELM energy fraction cut 0.10 → 0.012 accordingly.
4. **Q recovered to 2.4** at flat-top (46 MW) despite the DN split, since the
   grassy phase no longer dumps large energy losses during entry.
5. **Divertor glow palette** rebuilt on emission physics (see §14.1) and the
   near-white SPARC glow diagnosed and fixed.
6. **Magnetics panel** rebuilt on a sim-time basis: spectrogram renders from
   the trace history window ending at the *displayed* time, so it freezes on
   pause and scrubs with the trace scroll bar; noise substantially increased
   (broadband floor, amplitude jitter, intermittent filaments, speckle).
   Synthesis logic moved to `lib/magnetics.ts`.
7. **StatusPanel regime chip** now reads QCE (emerald) when ELM-suppressed in
   H-mode, matching the trace panel's QCE label.
8. **Front page**: the "select a device" affordance flashes/bounces for 7 s
   after "Skip tutorial" and is clickable to scroll.

### 14.1 Why the SPARC glow was almost white — and what colors are right

The white was the model being honest about a physics bug: with the λ_q =
0.18 mm stripe and **no sweep model**, the wetted area was ~0.03 m² and the
tile-averaged load ~200 MW/m². The inertial thermal model drove the tile
toward melting within a second, `incandescence → 1`, and the glow tint became
pure blackbody — near-white. That is exactly what would happen to the real
machine if the sweep failed. With the swept-area model the tile sits at
realistic temperatures and the base recycling-light color shows through.

The base colors are now grounded in what divertor cameras record:

| Device | Wall | Dominant visible emission | Color |
|---|---|---|---|
| DIII-D | carbon | C II (426/515 nm) + C III (465 nm) — the classic blue-green carbon divertor | cyan |
| JET | Be/W (ILW) | D Balmer (Dα red + Dβ/Dγ blue) → pink-magenta, as ILW divertor cameras show | pink-magenta |
| ITER | W | deeply detached; recombination-dominated Balmer → magenta-violet | magenta-violet |
| SPARC | W (assumed) | Balmer pink + Ne-seeding orange-red lines | salmon-pink |
| CENTAUR | W | Balmer + Ne | pink |

Tungsten itself contributes almost nothing in the visible — sputtered-W line
emission is negligible next to fuel recycling light. Tile incandescence
(blackbody) is layered on top by the thermal model and *should* push toward
white only when tiles genuinely approach ~1300 °C.

---

## 15. Scoping: close-fitting the DN separatrix to the limiter

**Goal.** Make the Cerfon–Freidberg DN separatrix hug the published wall as
closely as possible without intersecting it anywhere, with both divertor legs
threading the baffle throats and landing on the target plates.

**Current state (hand-tuned).** `equilibrium_a_scale = 0.92` gives ~7 mm
worst-corner clearance (the binding constraint is the inboard-top/bottom
corner near (1.39, ±0.9), where the wall chamfers from R = 1.269 at the
midplane to R = 1.46 at |Z| = 1.10). Leg landing is *not* asserted anywhere.
The published DN separatrix (GEQDSK) clears the wall by 7 mm min / 25 mm
median — so ~0.92–0.95 of full size is close to what the real shape achieves,
and the analytic form is the limitation, not the physics.

**Why the analytic form falls short.** The CF boundary is a smooth harmonic
shape; the real separatrix is squarer in exactly the corners that bind. The
solver's `ShapeParams` already carries an unused `squareness` knob — positive
squareness fills the corners and should buy back most of the lost minor
radius.

**Recommended approach — offline fit against the *solved* contour:**

1. **Harness**: an `#[ignore]`d Rust test (or example) that, for a candidate
   parameter set, builds the `CerfonEquilibrium`, extracts the separatrix and
   both legs via `contour.rs`, and scores:
   - `c_bulk` = min signed clearance of the bulk separatrix to the 45-pt wall
     polygon (legs and X-point neighbourhoods excluded, as the wall-contact
     check already does);
   - `legs_ok` = each leg crosses the baffle throat (the R ∈ [1.48, 1.645]
     gap at |Z| ≈ 1.18) and terminates on a target face
     (outer: R ∈ [1.73, 1.85], |Z| ∈ [1.40, 1.60]; inner slot:
     R ∈ [1.28, 1.48]) — at *both* extremes of the strike sweep;
   - objective: maximize `a_scale` subject to `c_bulk ≥ 10 mm` and `legs_ok`,
     tie-break on `c_bulk`.
2. **Knobs**, in order of expected value: `equilibrium_a_scale`;
   `squareness` (exposed per-device — new optional `Device` field);
   equilibrium-only δ offset (moves X-point R without touching the physics δ);
   `x_point_alpha` (leg angle at the X-point, controls where legs land).
   Grid-search is fine — the space is 3–4 dimensional and each evaluation is
   a single linear solve.
3. **Validation**: Hausdorff distance between the fitted separatrix and the
   published DN GEQDSK boundary (102 points; parsed copies exist from the
   SPARCPublic pull — commit them under `tests/data/` for the harness).
4. **Bake + guard**: write the winning constants into `devices::sparc()` with
   provenance, and add a *fast* regression test asserting bulk containment and
   leg-landing boxes at both sweep extremes, so later geometry edits cannot
   silently break it.
5. **Longer term**: the same harness generalises to DIII-D and JET, both of
   which currently fudge `a` itself (distorting their Greenwald limits) —
   migrating them to `equilibrium_a_scale` + squareness closes issue #1's
   sibling problem.

### 15.1 Executed (round 3)

The §15 harness now exists as `examples/fit_sparc_shape.rs` and the fit is
baked in. What changed to make it work:

1. **The wall-contact check now ray-marches the SOLVED boundary** (ψ_N = 1
   from the axis, 24 rays) instead of sampling the analytic parametrization.
   The solved Cerfon–Freidberg contour deviates from its own boundary
   parametrization by a few cm — an outboard bulge (the intersection visible
   in the equilibrium panel) and squarer corners — so the analytic proxy both
   missed real contacts and reported false ones. This applies to every device.
2. **Three new equilibrium-only `Device` knobs** (physics untouched):
   `equilibrium_r0_shift` (rigid inboard shift; kills the outboard bulge
   contact), `equilibrium_kappa_scale` (restores the X-point height the
   a-scale shrink took away), `equilibrium_squareness` (wired into the CF
   curvature constraints N1/N2; lets the inboard side follow the vessel
   chamfer the way the published separatrix does — it holds a ~55 mm gap
   along the chamfer, which the plain analytic shape cannot).
3. **Grid search result** (shift −0.050 m, κ×1.10, squareness 0.10 — revised
   from the first pick after review: the extra κ tilts the outer leg onto the
   inboard side of the outboard channel so it lands at the channel's back
   corner rather than mid-face), verified in the browser against the rendered
   contour at both sweep extremes:

   Revised again after review (the back-corner landing clipped the top-back
   segment, which is baffle): final constants shift −0.050, κ×1.105,
   squareness 0.10, sweep amplitude 0.03 — and the sweep now excursions to
   HIGHER δ, so the strike walks INBOARD along the roof diagonal, never
   toward the vertical-face baffle. Verified live at both sweep extremes:

   | Metric | Sweep at rest | Sweep at +amp |
   |---|---|---|
   | Any separatrix point outside wall | ≤6 mm at one throat corner (decimation sliver, sub-pixel) | same |
   | Outer strike | (1.794, 1.568) — ON the roof diagonal, 40 mm from its outermost point | (1.592, 1.318) |
   | Min baffle clearance over full sweep cycles | 40 mm | — |

   Published DN GEQDSK X-points: (≈1.53, ±1.11). Over each 1 Hz cycle the
   outer strike processes ~320 mm inboard along the diagonal and back.

   κ_scale is 1.103 and the landing is **bistable at the render grid's
   resolution**: 1.102 snaps the strike onto the back-corner baffle (2 mm
   clearance). The constant must be tuned against the LIVE equilibrium — the
   β-driven Shafranov term shifts the bistable boundary relative to the
   fixed-pressure fit harness, which is why the harness and the running sim
   disagree by one κ notch.

### 15.2 Round 4 — deeper outer landing, inner strike sweep

   Final sweep architecture (all measured live at the doubled 96×144
   separatrix grid, flat-top window t = 6–15.4 s):

   - **Separatrix extraction at 2× resolution** — the leg landing quantized
     on ~45 mm marching-squares cells, which faked the landing depth and hid
     the inner strike's motion entirely.
   - **Vertical rock added to the sweep** (`strike_sweep_z` = 30 mm, up-only,
     quadratically eased, in phase with the δ modulation): the δ sweep alone
     moved the inner strike just 7 mm because the inner slot runs nearly
     parallel to the leg's radial response; rocking the plasma vertically —
     how real DN machines share divertor power — slides the landing along
     the angled slot faces directly. Inner strike travel: **7 → 61 mm**.
     Phasing and easing are load-bearing: an out-of-phase or linear rock
     flips the grazing outer landing onto the corner branch mid-sweep.
   - **β-compensated strike-point control**: below β_N ≈ 0.7 the equilibrium
     κ scale rises (+0.006 per unit β_N deficit, on the smoothed β), which
     retreats the landing inboard as the pulse terminates — the rampdown β
     collapse otherwise slid the strike past the corner onto the vertical
     face.
   - **Sweep gated to true flat-top** (`prog.ip > 0.97 ip_max`) — during the
     Ip/κ ramps the programmed shape passes through the corner-landing band
     by construction, so the sweep holds a static shape there.

   Round 4 final (after review): the vertical rock was **removed** — the
   X-points now trace a purely lateral arc (δ-only sweep, zero vertical
   excursion, measured) — and with the rock gone the β-compensated strike
   control holds the deep landing branch at κ_scale 1.1025: the outer strike
   rests at (1.80, ±1.57), **33 mm from the back corner with 33 mm minimum
   baffle clearance** over the whole flat-top, reproducible across
   RNG-varied pulses. The rock had been the branch-flipping culprit all
   along: with it, every κ in the usable range clipped the corner at some
   pulse phase. Cost of removing it: the inner strikes return to their
   δ-only motion (~mm-scale; the slot geometry cancels the X-point's radial
   travel — moving them requires vertical plasma motion by geometry, which
   is exactly what was rejected). The flat-top sweep gate, β compensation
   and 2× separatrix grid are all retained. Two brief ≤0.2 s corner
   traverses per pulse remain during shape formation/termination — the
   programmed κ waveform passing through the band — and are accepted as
   physical.

   **Leg termination**: `contour::clip_separatrix_to_wall` now truncates each
   separatrix chain at its first wall impact (keeping the longest in-vessel
   run per chain, with the exact crossing point as the endpoint plus a 3 mm
   overshoot so the frontend's strike-point intersection detection still
   fires). A leg that strikes a baffle is no longer drawn re-emerging beyond
   it, and spurious far-SOL ψ=0 chains are dropped entirely. Applied in ALL
   phases including limited — the limited-phase ψ=0 extraction produced
   spurious chains up to 386 mm outside the limiter during ramp-up/ramp-down
   (12,903 offending points over a pulse, now 2 points at ≤6 mm). The tangent
   LCFS itself survives the clip untouched.

   Findings from the search worth keeping: the leg *angle* cannot be set
   directly (x_point_alpha only enters the crown-curvature constraint — the
   grid showed zero sensitivity), so leg landing is controlled indirectly by
   κ-scale (X-point height → how far up the channel the legs enter) and
   squareness (lower squareness → deeper landings; sq 0.10 beat 0.30–0.40,
   which also cost inboard clearance).

## 16. Round 3 — QCE entry compression, dwell-equalized sweep, portview topology fix

Three user reports, three fixes (2026-08-14):

**Faster QCE entry (preset timing + gate exponent).** The grassy ELMy phase
ran ~6 s; SPARC would push into QCE as fast as possible to spare the
inertially cooled divertor. The intermediate 0.78·n̄ plateau is now ~0.5 s
(fuelling ramp starts at 0.245·t_dur, full QCE density by 0.285·t_dur) and
the ICRF step-back moved up to match (24 MW → 17 MW over 0.285–0.325·t_dur).
Result: L-H at 4.84 s → QCE at 7.41 s (2.6 s transient, 38 grassy ELMs, no
Type-I, no dropout). The plateau cannot be removed entirely — ramping
straight to the QCE density still radiatively collapses the plasma before
L-H. Alongside, the QCE access-density power exponent was raised 0.35 → 0.65
(`fgw_needed = qce_fgw_threshold · (P_net/P_LH)^0.65`): at 0.35 even 25 MW
held all pulse stayed inside the QCE window, erasing the designed "turn the
RF up and the ELMs come back" discovery. At 0.65 the held-25-MW case gets
1.4 s of QCE (rampdown only) vs 7.8 s nominal, and runs grassy ELMy H-mode
through flat-top (165 crashes, 0 Type-I). Flagged: this is a calibration
knob, not a published number. Steady flat-top Q at the 17 MW second level is
1.7 (peak 3.0 during the 24 MW phase); an RF scan (examples/rf_scan.rs)
shows Q rising with the second-level power (2.2 @ 21 MW, 3.0 @ 25 MW) since
the 0D reactivity is steep near 10 keV — kept at 17 MW pending a decision,
since backing the RF off as the alphas build is the burning-plasma story the
scenario teaches. Below 17 MW the H-mode drops out.

**Dwell-equalized strike sweep.** Measured with examples/sweep_dwell.rs: the
δ→strike-arc mapping along the roof diagonal is compressive at the +δ
(inboard) end — s(u) ≈ u^0.33 — so the old sinusoid piled 30% of the period
into one 25 mm band at the inboard end of the sweep while the outboard half
got a grazing instant. The waveform is now a triangle wave in normalized arc
position warped through the inverse mapping (u = v³, v = triangle):
measured dwell is flat (6–8% per 25 mm bin) across the full 180–541 mm arc
range, and the strike now spends real time at the very back of the leg
(reaching the corner at arc 541 mm) — the "deeper outboard" request came for
free, with no amplitude change and no new baffle risk. Inner strikes remain
geometrically pinned (~2 mm range): the slot faces cancel δ-driven radial
motion; moving them needs vertical plasma motion, rejected in Round 2.

**Portview phantom strip (topology bug).** At the outboard sweep extreme the
DN ψ_N=1 boundary arrives from marching squares as TWO long open arcs
(outboard arc strike-to-strike through both outer legs; inboard arc through
both inner legs) instead of one closed loop + leg chains — 722 of ~1075
frames over a pulse. `rebuildSepGeometry` assumed chains[0] closed;
`densifyContour`'s wraparound then painted a straight vertical chord at
R ≈ 1.82 m from z = +1.6 to −1.6 into the glow mesh (the user's "vertical
strip connecting top and bottom of the vessel", flickering as the topology
switched). Fix: render every chain ≥ 60 pts (up to 3), each with closure
decided from its RAW endpoint gap (< 0.12 m) before densification, open
arcs densified without wraparound. Bonus: the inboard limb (all of
chains[1] in the split state) was previously never rendered and vanished at
the outboard extreme — now it persists. Verified over the full pulse: worst
rendered segment 52 mm (was 3.2 m), inboard limb never absent while
diverted.
