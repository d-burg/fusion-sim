# fusionsimulator.io — Physics Model Documentation

This document describes the physics models, assumptions, and known limitations
of the fusionsimulator.io tokamak simulator.

---

## 1. Transport Model

### 1.1 Energy Confinement (IPB98(y,2))

The global energy confinement time uses the ITER Physics Basis 1998 H-mode
scaling (IPB98(y,2)):

    tau_E = 0.0562 * Ip^0.93 * Bt^0.15 * ne19^0.41 * P^(-0.69)
            * R0^1.97 * eps^0.58 * kappa^0.78 * M^0.19

where Ip is in MA, Bt in T, ne19 in 10^19 m^-3, P in MW, R0 in m,
eps = a/R0, kappa is elongation, and M is the average ion mass in AMU.

**References:**
- ITER Physics Basis, Chapter 2: Nucl. Fusion 39 (1999) 2175

### 1.2 Confinement Mode Multipliers

| Mode | H-factor | Notes |
|------|----------|-------|
| L-mode | 0.5 | IPB98 is calibrated to H-mode; L-mode is ~0.5x |
| H-mode | 1.0 | Standard Type I ELMy H-mode |
| NT-edge (CENTAUR) | ~0.65 | ~65% of H-mode; ELM-free, ballooning-limited edge |

### 1.3 Triangularity Correction

Higher positive triangularity (delta) stabilizes edge peeling-ballooning
modes, broadens the pressure profile, and improves energy confinement.
This effect is not captured by IPB98 (which omits delta). The correction:

    tau_E *= 1.0 + 0.20 * (delta - 0.40)    [clamped to 0.92–1.10]

At the typical H-mode reference delta=0.40, no correction is applied. At
ITER's delta=0.55, tau_E increases by ~3%. At low delta=0.20, tau_E
decreases by ~4%. This also affects Te_ped through improved pedestal
stability (see Section 9).

The correction applies in H-mode only (positive delta). Negative-delta
NT plasmas handle confinement through the h_factor multiplier instead.

### 1.4 D-T Isotope Enhancement

D-T plasmas receive a 1.10x confinement enhancement beyond the IPB98 M^0.19
scaling, representing residual isotope effects on turbulent transport beyond
what the mass scaling captures (e.g., reduced ITG growth rates). The IPB98
M^0.19 already gives ~1.19x for DT (M=2.5) vs DD (M=2.0), so the total
confinement advantage from mass alone is 1.19 × 1.10 = 1.31x on tau_E.
The dominant DT performance advantage comes from alpha self-heating, which
drives higher Te and W_th through the positive feedback loop in the power
balance.

**References:**
- Cordey et al., Nucl. Fusion 39 (1999) 301
- Maggi et al., Plasma Phys. Control. Fusion 60 (2018) 014045

### 1.5 Negative Triangularity Confinement

For negative-triangularity devices (CENTAUR), the confinement factor is set
to h=0.65 (between L-mode and H-mode). An additional 1.05x DT isotope boost
is applied for DT fuel. NT plasmas operate ELM-free with a small
ballooning-limited pedestal rather than the full H-mode transport barrier.

**References:**
- Marinoni et al., Nucl. Fusion 61 (2021) 116010
- Austin et al., Phys. Rev. Lett. 122 (2019) 115001

### 1.6 Device-Specific Confinement Correction

A per-device correction factor multiplies tau_E to account for effects not
captured by generic scalings (wall conditioning, NBI deposition geometry,
divertor closure, etc.):

| Device | Factor | Justification |
|--------|--------|---------------|
| DIII-D | 1.00 | IPB98 calibrated to DIII-D data directly |
| JET | 1.35 | DTE2 optimized scenarios (high shaping, ILW conditioning) |
| ITER | 1.00 | Reference machine for IPB98 extrapolation |
| CENTAUR | 1.00 | Conceptual design, no empirical correction |

### 1.7 Intrinsic Radiation

Intrinsic impurity radiation from wall materials (carbon, tungsten,
beryllium) is modeled as a fraction of external heating power:

    P_intrinsic = (0.10 * max(Z_eff - 1, 0.2) + 0.05) * P_external

This produces ~10-15% radiative fraction for typical H-mode parameters,
consistent with experimental observations in well-conditioned machines.
The scaling with P_external (rather than ne^2 * V) avoids unphysical
machine-size dependence and ensures the intrinsic radiation doesn't
suppress the alpha self-heating loop in burning plasmas.

---

## 2. Fusion Power

### 2.1 Reactivity

The D-T and D-D fusion reactivities use the Bosch-Hale parameterization,
which is accurate to within 1% over the range 0.2-100 keV.

**D-T reaction:** D + T -> He-4 (3.52 MeV) + n (14.07 MeV)
**D-D reactions:** Two branches with roughly equal probability, producing
~3.65 MeV per reaction on average.

The effective ion temperature for the volume-averaged reactivity is estimated
as Ti_eff = 0.70 * Te0, accounting for profile peaking and the Ti/Te ratio.

**References:**
- Bosch and Hale, Nucl. Fusion 32 (1992) 611

### 2.2 Profile Correction Factor

The 0D alpha heating uses a profile peaking correction f_profile = 0.48,
representing the ratio of the volume-averaged <n^2 * sigma_v(T)> to the
product of volume-averaged quantities n_bar^2 * sigma_v(T_bar). This factor
accounts for the fact that both density and temperature peak on axis.
(Calibrated against full profile integration using Bosch-Hale over the
51-point Te/ne profiles.)

The displayed P_fus in the status panel and trace uses the full 51-point
profile integration via `computeFusion()`, which integrates ne^2 * sigma_v(Te)
over the tanh-pedestal profiles. The 0D f_profile estimate is used only for
the alpha self-heating feedback in the transport power balance.

### 2.3 Q_plasma

    Q_plasma = P_fusion / P_external

where P_external = P_input - P_alpha (i.e., the externally supplied heating
power excluding self-heating from alpha particles).

---

The displayed Q is faded to zero as the programmed current drops below
30 % of **this pulse's flat-top current** (the peak of the programmed Ip
waveform), and capped at 15, to suppress the ramp-down artefact where
external heating is cut before the stored energy has decayed. The
reference is the pulse's own flat-top, not the machine's maximum rating,
so a machine run below its rated current is not penalised.


## 3. ELM Model

### 3.1 ELM Types

| Type | Frequency | Energy Loss | Character |
|------|-----------|-------------|-----------|
| Type I | 5-25 Hz (DIII-D scale) | 5-13% W_th | Large, distinct crashes |
| Type II | 80-200 Hz (DIII-D scale) | 0.5-1.5% W_th | Small "grassy" ELMs |
| Suppressed (QCE) | N/A | Continuous small losses | No discrete ELMs |

ELM frequency scales inversely with energy confinement time (tau_E) to
account for machine size: larger machines with longer tau_E have lower ELM
frequency because the pedestal pressure gradient rebuilds more slowly.

### 3.2 Pedestal Crash

Each ELM applies an amplified fractional crash to the pedestal Te and ne:

    Te_ped *= (1 - elm_fraction * 1.5)    [Type I]
    Te_ped *= (1 - elm_fraction * 1.2)    [Type II]
    ne_ped *= (1 - elm_fraction * 0.8 * amplification)

The pedestal recovery time is 100ms (tau_ped), representing the inter-ELM
pedestal pressure gradient rebuild.

### 3.3 ELM Heat Flux to Divertor

The ELM energy to the divertor is calculated from the Loarte scaling:

    Delta_W_ELM = elm_fraction * W_th  (5-13% for Type I)

The resulting transient heat flux spike is:

    q_ELM = Delta_W_ELM / (A_wet * tau_ELM)

where tau_ELM ~ 0.5-1.0 ms is the ELM crash duration and A_wet is the
divertor wetted area (including flux expansion).

**References:**
- Loarte et al., Plasma Phys. Control. Fusion 45 (2003) 1549
- Eich et al., Nucl. Mater. Energy 12 (2017) 84

---

## 4. Divertor Heat Flux

### 4.1 Scrape-Off Layer Width (Eich Scaling)

The SOL power decay length uses the Eich multi-machine scaling:

    lambda_q = 1.35 / B_pol^0.9  (mm)

with a minimum of 0.5 mm. For negative-triangularity configurations, lambda_q
is broadened by a factor of 1.0-2.0 depending on the triangularity magnitude.

**References:**
- Eich et al., Nucl. Fusion 53 (2013) 093031

### 4.2 Detachment Model

A simplified sigmoid model for divertor detachment:

    f_detach = min(1 - 1/(1 + (f_GW/0.7)^6), 0.97)

Higher Greenwald fraction drives stronger divertor radiation and detachment,
reducing the target heat flux. Maximum detachment reduces heat flux by 97%.

---

## 5. Divertor Thermal Model

### 5.1 Approach

The divertor surface temperature is computed using a **0D lumped thermal
capacitance model**:

    C_th * dT/dt = q_total - h_cool * (T - T_coolant)

where:
- C_th = rho * cp * L is the thermal capacitance per unit area (J/m^2/K)
- q_total is the total heat flux including inter-ELM and ELM contributions
- h_cool is the effective heat transfer coefficient to the coolant
- T_coolant is the coolant temperature

### 5.2 Device-Specific Parameters

| Parameter | DIII-D | JET | ITER | CENTAUR |
|-----------|--------|-----|------|---------|
| Wall material | Carbon (C) | Tungsten (W) | Tungsten (W) | Tungsten (W) |
| Armor thickness (mm) | 25 | 22 | 6 | 6 |
| Density (kg/m^3) | 1800 | 19350 | 19350 | 19350 |
| Specific heat (J/kg/K) | 1200 | 150 | 150 | 150 |
| T_coolant (C) | 25 | 200 | 100 | 80 |
| h_cool (W/m^2/K) | 0 | 0 | 8500 | 15000 |
| Cooling type | Inertial | Inertial | Active water | Active water |

### 5.3 Target Steady-State Temperatures

| Device | Condition | Model Prediction | Published/Expected Range |
|--------|-----------|-----------------|-------------------------|
| DIII-D | 5 MW/m^2, 3 s pulse | ~300 C | 200-600 C |
| JET | 7 MW/m^2, 8 s pulse | ~1000 C | 600-1200 C (JOI limit) |
| ITER | 10 MW/m^2, steady-state | ~1300 C | 1200-1500 C (design basis) |

### 5.4 Known Limitations

**Single-layer approximation:** The model treats the divertor armor as a
single thermal lump with uniform temperature. In reality, ELM energy deposits
in a very thin surface skin (~0.1 mm thermal diffusion depth at tau_ELM ~ 1 ms).
This means:

- **ELM temperature spikes are underestimated**: The real surface temperature
  during an unmitigated Type I ELM on ITER can transiently exceed tungsten's
  melting point (3422 C), but our model spreads the energy across the full
  6 mm armor thickness, producing a modest ~100-200 C rise.

- **ELM temperature recovery is too slow**: The real surface cools back to
  near-steady-state within ~10-100 ms as heat diffuses into the cooler bulk.
  Our lumped model shows recovery over seconds because the full thermal mass
  must equilibrate.

- **Qualitative behavior is correct**: The model correctly shows that (1) ITER
  DT H-mode with unmitigated Type I ELMs produces dangerously high divertor
  temperatures, (2) actively cooled devices equilibrate while inertially cooled
  devices heat monotonically, and (3) the inter-ELM steady-state temperatures
  match published design values.

A two-layer model (thin surface skin + bulk substrate) would capture the
fast transient dynamics more accurately but is not currently implemented.

**References:**
- Pitts et al., J. Nucl. Mater. 415 (2011) S957 (ITER divertor design)
- Hirai et al., Fusion Eng. Des. 127 (2018) 66 (ITER W monoblock qualification)
- Matthews et al., J. Nucl. Mater. 438 (2013) S2 (JET ILW divertor performance)

---

## 6. Equilibrium and MHD

### 6.1 Flux Surface Geometry

The equilibrium flux surfaces are computed from a parameterized
Grad-Shafranov-like model using the Miller parameterization (R, Z, kappa,
delta_upper, delta_lower). The poloidal flux function psi is constructed
analytically with Shafranov shift and shaping corrections.

### 6.2 Safety Factor

    q95 = 5 * a^2 * Bt * f_shape / (R0 * Ip)

where the shape factor includes elongation and triangularity:

    f_shape = (1 + kappa^2 * (1 + 2*delta^2 - 1.2*delta^3)) / 2

### 6.3 Normalized Beta

    beta_N = beta_t * a * Bt / Ip  (in percent-meters-Tesla/MA)

The Troyon stability limit is approximately beta_N ~ 2.8 for standard
H-mode and up to ~3.5 for advanced scenarios.

### 6.4 Internal Inductance

    li = <B_pol^2> / B_pol(a)^2

Evolves based on current profile shape, with the L-H transition causing
a characteristic broadening of the current profile (decreasing li).

---

## 7. Disruption Model

Disruptions are triggered when operational limits are violated:

- **Density limit (Greenwald):** f_GW > 1.0
- **Beta limit (Troyon):** beta_N > beta_N_max
- **Safety factor limit:** q95 < 2.0
- **Locked modes:** Large locked mode amplitude

The disruption probability increases as multiple limits are approached
simultaneously. The displayed quantity is a **hazard rate**: the
probability per second that a disruption begins. It is built only from
named causes (the four limits above plus a small locked-mode baseline of
0.05 %/s, amplified near the limits); there is no constant floor, so a
pulse kept well inside its limits almost never disrupts.

Once triggered, the sequence is: precursor (50-100 ms, growing locked-mode
amplitude), thermal quench (1-3 ms), then current quench (5-50 ms).

**Thermal quench and the Ip spike.** The thermal quench flattens the
current profile. Poloidal flux is conserved on this timescale, so with
L_p ∝ Λ_ext + l_i/2 (Λ_ext = ln(8R/(a√κ)) − 2) the total current rises by

    ΔIp/Ip = Δ(l_i/2) / (Λ_ext + l_i/2)

The flattening is taken as partial (l_i falls by 30 %, floored at 0.5),
which gives overshoots of 5-15 % for the devices here (about 12 % on
DIII-D with l_i = 1.2, about 9 % on ITER with l_i = 0.8). Both l_i and Ip
follow a quarter-sine over the quench, so the spike peaks at its end; Te
collapses linearly to ~1 % over the same interval. This is the inductive
Ip spike seen at every real disruption.

**Current quench.** From the top of the spike, Ip decays exponentially
with a time constant of one third of the quench duration, reaching zero
at the end; l_i stays flat. The envelope is evaluated at the elapsed
quench time and applied to the onset current, so it is exact for any
integration step. The frontend steps and records the physics at 0.25 ms
through both quench phases (5 ms elsewhere), so the spike and the decay
render as curves.

---

## 8. Diagnostic Noise Model

All simulated diagnostic signals include realistic measurement noise:

| Signal | Noise Level | Basis |
|--------|-------------|-------|
| Ip | 0.2% | Rogowski coil precision |
| ne_bar | 1% | Interferometer noise |
| Te0 | 2% | ECE radiometer |
| W_th | 0.5% | Diamagnetic loop |
| P_rad | 5% | Bolometer uncertainties |

D-alpha signals include ELM spikes (8x baseline for Type I, 2.5x for Type II)
with appropriate noise to reproduce the irregular appearance of real signals.

---

## 9. Radial Profiles and 0D Coupling

### 9.1 Profile Parameterization

H-mode profiles use the OMFIT tanh-pedestal parameterization with independently
shaped core and pedestal regions. L-mode uses a simple parabolic model.

### 9.2 0D → Profile Coupling

The 0D transport model determines W_th from power balance and derives:

    Te_avg = W_th / (3 * ne_vol * V * 1.602e-2)
    Te0 = Te_avg * 2.5    (peaking factor)
    ne0 = ne_bar * 1.3    (density peaking)

The profile module then sets:

    Te_core = Te0 (smoothed with 150ms tau)
    Te_ped = ped_ratio * Te0, where ped_ratio = 0.30 + 0.20 * delta
             (clamped to 0.25-0.50; positive delta only)
    ne_core = ne0
    ne_ped = 0.55 * ne0

The pedestal height depends on triangularity: higher delta stabilizes
peeling-ballooning modes, allowing higher pedestal pressure.

For negative-triangularity (NT-edge) plasmas, a small ballooning-limited
pedestal is maintained: Te_ped ≈ 0.12 * Te0, ne_ped ≈ 0.40 * ne0.

### 9.3 Profile Energy Normalization

After the profile parameters are set, the Te core value is rescaled so
that the profile-integrated stored energy matches the 0D W_th:

    W_profiles = integral(3 * ne(rho) * Te(rho) * dV) * 1.602e-2

If W_profiles differs from W_th, Te_core is scaled by W_th/W_profiles
(clamped to 0.6-1.8x). Only the core is adjusted — the pedestal height
is preserved since it is set by MHD stability, not global energy content.

The W_th input to normalization is smoothed with a time constant equal
to tau_E (minimum 50ms), preventing ELM crashes from instantly
propagating to the core profile. This reflects the physical reality
that fusion reactions are concentrated in the hot core, which acts as
a thermal low-pass filter — edge perturbations propagate inward on the
energy confinement timescale, not the ELM crash timescale.

### 9.4 Tuning Coefficients

| Parameter | Value | Effect |
|-----------|-------|--------|
| Te0 peaking factor | 2.5 | Te0 = Te_avg * 2.5 |
| ne0 peaking factor | 1.3 | ne0 = ne_bar * 1.3 |
| ne_vol / ne_bar | 0.85 | Volume-average density |
| Ped_ratio base | 0.30 | Te_ped / Te0 at delta=0 |
| Ped_ratio delta coeff | 0.20 | Additional Te_ped per unit delta |
| ne_ped / ne0 | 0.55 | ~0.72 * ne_bar in H-mode |
| NT Te_ped / Te0 | 0.12 | Small ballooning-limited pedestal |
| Pedestal tau | 100 ms | Pedestal recovery timescale |
| Core smoothing tau | 150 ms | Core ELM resilience |
