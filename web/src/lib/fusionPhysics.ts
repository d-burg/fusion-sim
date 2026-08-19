/**
 * Fusion power, neutron rate, and Q computation.
 *
 * Uses Bosch & Hale (1992) parameterisation of DT and DD reactivities,
 * integrated over the 51-point ne/Te profiles from the simulator.
 *
 * Reference: H.-S. Bosch and G. M. Hale, Nucl. Fusion 32 (1992) 611.
 */

import type { Snapshot } from './types'
import type { Device } from './wasm'

// ── Physical constants ───────────────────────────────────────────────
const MEV_TO_JOULE = 1.602_176_634e-13  // 1 MeV in Joules
const E_DT_TOTAL = 17.59 * MEV_TO_JOULE // Total DT energy (MeV → J)
const E_DT_NEUTRON = 14.07 * MEV_TO_JOULE // DT neutron energy
const E_DT_ALPHA = 3.52 * MEV_TO_JOULE  // DT alpha energy

// DD has two branches, each ~50%:
//   D+D → T(1.01) + p(3.02)     [3.27 MeV total, no neutron]
//   D+D → He3(0.82) + n(2.45)   [3.27 MeV total, neutron branch]
const E_DD_TOTAL = 3.27 * MEV_TO_JOULE  // Average per DD reaction (both branches)
const E_DD_NEUTRON = 2.45 * MEV_TO_JOULE // Neutron energy (neutron branch only)

// ── Bosch-Hale DT reactivity parameterisation ───────────────────────
// Table IV from Bosch & Hale, Nucl. Fusion 32 (1992) 611
// Valid for 0.2 ≤ T ≤ 100 keV
const BH_DT = {
  BG2: 34.3827 ** 2,  // Gamow constant squared
  MC2: 1124656,       // reduced mass × c² (keV)
  C1: 1.17302e-9,
  C2: 1.51361e-2,
  C3: 7.51886e-2,
  C4: 4.60643e-3,
  C5: 1.35e-2,
  C6: -1.0675e-4,
  C7: 1.366e-5,
}

/**
 * DT fusion reactivity ⟨σv⟩ in m³/s using Bosch-Hale parameterisation.
 * @param T_keV Ion temperature in keV (valid 0.2–100 keV)
 */
function sigmav_DT(T_keV: number): number {
  if (T_keV < 0.2) return 0
  const T = Math.min(T_keV, 100)
  const { BG2, MC2, C1, C2, C3, C4, C5, C6, C7 } = BH_DT

  const denom = 1 + T * (C3 + T * (C5 + T * C7))
  const numer = T * (C2 + T * (C4 + T * C6))
  const theta = T / (1 - numer / denom)
  const xi = Math.cbrt(BG2 / (4 * theta))
  const sv = C1 * theta * Math.sqrt(xi / (MC2 * T * T * T)) * Math.exp(-3 * xi)

  // Convert from cm³/s to m³/s
  return sv * 1e-6
}

// ── DD reactivity (both branches combined) ──────────────────────────
// Simplified Bosch-Hale style fit for total DD (both branches).
// Uses Bosch & Hale Table IV for D(d,n)He3 and D(d,p)T separately.

const BH_DD_n = {
  // D(d,n)He3 branch
  BG2: 31.3970 ** 2,
  MC2: 937814,
  C1: 5.43360e-12,
  C2: 5.85778e-3,
  C3: 7.68222e-3,
  C4: 0.0,
  C5: -2.964e-6,
  C6: 0.0,
  C7: 0.0,
}

const BH_DD_p = {
  // D(d,p)T branch
  BG2: 31.3970 ** 2,
  MC2: 937814,
  C1: 5.65718e-12,
  C2: 3.41267e-3,
  C3: 1.99167e-3,
  C4: 0.0,
  C5: 1.05060e-5,
  C6: 0.0,
  C7: 0.0,
}

function sigmav_BH(T_keV: number, params: typeof BH_DD_n): number {
  if (T_keV < 0.2) return 0
  const T = Math.min(T_keV, 100)
  const { BG2, MC2, C1, C2, C3, C4, C5, C6, C7 } = params

  const denom = 1 + T * (C3 + T * (C5 + T * C7))
  const numer = T * (C2 + T * (C4 + T * C6))
  const theta = T / (1 - numer / denom)
  const xi = Math.cbrt(BG2 / (4 * theta))
  const sv = C1 * theta * Math.sqrt(xi / (MC2 * T * T * T)) * Math.exp(-3 * xi)

  return sv * 1e-6  // cm³/s → m³/s
}

/**
 * Total DD reactivity ⟨σv⟩ in m³/s (both branches).
 */
function sigmav_DD(T_keV: number): number {
  return sigmav_BH(T_keV, BH_DD_n) + sigmav_BH(T_keV, BH_DD_p)
}

/**
 * Neutron-producing branch fraction of DD.
 * D(d,n)He3 branch / total DD.
 */
function dd_neutron_fraction(T_keV: number): number {
  const sn = sigmav_BH(T_keV, BH_DD_n)
  const sp = sigmav_BH(T_keV, BH_DD_p)
  const total = sn + sp
  return total > 0 ? sn / total : 0.5
}

// ── Fusion state interface ──────────────────────────────────────────

export interface FusionState {
  p_fus: number          // Total fusion power (MW)
  p_alpha: number        // Alpha heating power (MW) — DT: P_fus/5; DD: charged products
  neutron_rate: number   // Neutrons per second
  neutron_power: number  // Power carried by neutrons (MW)
  q_plasma: number       // P_fus / P_input
  fuel_type: 'DD' | 'DT'
}

// ── Main computation ────────────────────────────────────────────────

/**
 * Compute fusion power, neutron rate, and Q from current plasma state.
 *
 * Integrates over the 51-point ne/Te profiles using the device volume
 * and Bosch-Hale reactivities.
 */
export function computeFusion(snapshot: Snapshot, device: Device): FusionState {
  const isDT = device.mass_number > 2.0
  const fuel_type = isDT ? 'DT' : 'DD'

  const ne_prof = snapshot.ne_profile  // 10²⁰ m⁻³
  const te_prof = snapshot.te_profile  // keV
  const N = ne_prof.length             // 51
  const drho = 1.0 / (N - 1)          // 0.02

  const f_fuel = Math.max(1.0 - snapshot.impurity_fraction, 0.5)
  const V_total = device.volume        // m³

  // Build volume weights: dV_i ∝ ρ_i · dρ (cylindrical-like shells)
  // Normalise so Σ w_i = 1, then dV_i = V_total * w_i
  let wSum = 0
  const weights: number[] = new Array(N)
  for (let i = 0; i < N; i++) {
    const rho = i * drho
    // At rho=0, the shell has zero radius → zero weight (correct)
    weights[i] = 2 * rho * drho
    wSum += weights[i]
  }
  // Normalise
  if (wSum > 0) {
    for (let i = 0; i < N; i++) weights[i] /= wSum
  }

  // Integrate reaction rate density over volume
  let totalReactionRate = 0  // reactions/s (total)
  let totalNeutronRate = 0   // neutrons/s
  let totalPower = 0         // Watts

  for (let i = 0; i < N; i++) {
    const ne = ne_prof[i] * 1e20  // convert 10²⁰ m⁻³ → m⁻³
    const Te = te_prof[i]         // keV
    const dV = V_total * weights[i]

    if (ne <= 0 || Te < 0.2 || dV <= 0) continue

    let reactionRateDensity: number  // reactions / m³ / s
    let E_per_reaction: number       // J per reaction
    let neutrons_per_reaction: number

    if (isDT) {
      // n_D · n_T = (ne · f_fuel / 2)²  for 50-50 DT mix
      const nDnT = (ne * f_fuel / 2) ** 2
      const sv = sigmav_DT(Te)
      reactionRateDensity = nDnT * sv
      E_per_reaction = E_DT_TOTAL
      neutrons_per_reaction = 1.0
    } else {
      // DD: n_D = ne · f_fuel, rate = n_D² / 2 · <σv>  (factor 1/2 for identical particles)
      const nD = ne * f_fuel
      const sv = sigmav_DD(Te)
      reactionRateDensity = (nD * nD / 2) * sv
      E_per_reaction = E_DD_TOTAL
      neutrons_per_reaction = dd_neutron_fraction(Te)  // ~0.5
    }

    const localRate = reactionRateDensity * dV  // reactions/s in this shell
    totalReactionRate += localRate
    totalNeutronRate += localRate * neutrons_per_reaction
    totalPower += localRate * E_per_reaction    // Watts
  }

  const p_fus_MW = totalPower / 1e6

  // Alpha / charged particle power
  let p_alpha_MW: number
  let neutron_power_MW: number

  if (isDT) {
    // DT: 20% to alpha (3.52 MeV), 80% to neutron (14.07 MeV)
    p_alpha_MW = p_fus_MW * (E_DT_ALPHA / E_DT_TOTAL)  // ~20%
    neutron_power_MW = p_fus_MW * (E_DT_NEUTRON / E_DT_TOTAL)  // ~80%
  } else {
    // DD: neutron branch carries E_DD_NEUTRON per neutron
    neutron_power_MW = totalNeutronRate * E_DD_NEUTRON / 1e6
    p_alpha_MW = p_fus_MW - neutron_power_MW  // rest is charged products
  }

  // Q = P_fus / P_external (external heating only, excludes alpha self-heating).
  // snapshot.p_input now includes p_alpha from the Rust transport model,
  // so subtract it for the standard physics Q definition.
  //
  // During ramp-down, P_external drops faster than the thermal energy decays,
  // causing a nonphysical spike in Q = P_fus / P_ext.  Suppress this by
  // requiring P_external to be at least 20% of P_input (i.e. alpha power
  // isn't dominating the denominator) and smoothly ramping Q to zero when
  // Ip is below 50% of nominal (plasma is no longer in a meaningful state).
  // Q = P_fusion / P_external, with protections against rampdown spikes.
  // During rampdown, external heating drops before fusion power decays
  // (thermal inertia), causing Q = P_fus/P_ext to spike. Solution:
  // 1. Floor the denominator at the total external heating (not alpha)
  // 2. Fade Q smoothly as Ip drops below flat-top
  // 3. Cap at 15 to prevent display artifacts
  const p_alpha = snapshot.p_alpha ?? 0
  const p_external = snapshot.p_input - p_alpha
  const p_aux = snapshot.p_input - p_alpha - (snapshot.p_ohmic ?? 0)
  const ip_frac = device.ip_max > 0 ? snapshot.ip / device.ip_max : 0
  const prog_ip_frac = device.ip_max > 0 ? (snapshot.prog_ip ?? snapshot.ip) / device.ip_max : 0
  // Fade starts early (98% Ip) and reaches zero at 30%
  const ip_fade = Math.min(Math.max((prog_ip_frac - 0.30) / 0.68, 0), 1.0)
    * Math.min(Math.max((ip_frac - 0.20) / 0.60, 0), 1.0)
  // Denominator: use the larger of actual p_external or the auxiliary
  // heating power. This prevents the denom from collapsing when heating
  // is cut before stored energy decays.
  const denom = Math.max(p_external, p_aux, 1.0)
  const q_plasma = denom > 1.0
    ? Math.min(p_fus_MW / denom, 15) * ip_fade
    : 0

  return {
    p_fus: p_fus_MW,
    p_alpha: Math.max(p_alpha_MW, 0),
    neutron_rate: totalNeutronRate,
    neutron_power: Math.max(neutron_power_MW, 0),
    q_plasma,
    fuel_type,
  }
}

// ── Divertor heat flux ──────────────────────────────────────────────

export interface DivertorState {
  q_peak: number       // Peak heat flux (MW/m²) — includes ELM transients
  q_interELM: number   // Inter-ELM baseline heat flux (MW/m²)
  lambda_q: number     // SOL power width (mm)
  p_sol: number        // Power to SOL (MW)
  f_detach: number     // Detachment fraction (0–1)
  t_surface: number    // Divertor surface temperature (°C) — from 0D thermal model
  wall_material: 'W' | 'C'  // Tungsten or Carbon wall
  elm_q: number        // ELM-only heat flux contribution (MW/m²)
  tau_elm: number      // ELM deposition timescale (seconds)
}

/**
 * 0D divertor thermal model.  Integrates surface temperature using:
 *
 *   C_th × dT/dt = q_applied − q_cooling − q_radiation
 *
 * where C_th is the thermal capacitance of the armor tile (ρ × c_p × L),
 * q_applied is the incident heat flux, q_cooling is active water cooling
 * (ITER only) or inter-pulse water cooling (JET/DIII-D ≈ 0 during pulse),
 * and q_radiation is Stefan-Boltzmann radiative cooling from the surface.
 *
 * This gives realistic thermal evolution: temperature rises through the
 * pulse, spikes during ELMs, and recovers between ELMs.
 */
export class DivertorThermalModel {
  t_surface: number   // Current surface temperature (°C)
  private deviceId: string

  // Material properties
  private rho: number       // Density (kg/m³)
  private cp: number        // Specific heat (J/kg/K)
  private armor_L: number   // Armor thickness (m)
  private C_th: number      // Thermal capacitance per unit area (J/m²/K)
  private T_coolant: number // Coolant temperature (°C)
  private h_cool: number    // Active cooling HTC (W/m²/K), 0 = inertial

  constructor(deviceId: string) {
    this.deviceId = deviceId
    this.t_surface = this.ambientTemp(deviceId)

    if (deviceId === 'diiid') {
      // Carbon/graphite PFCs — inertially cooled during pulse.
      // Graphite cp increases with temperature (~710 at RT, ~1800 at 1000°C).
      // Use effective average ~1200 J/kg/K for the operating range.
      // Target: 400–600°C at 5 MW/m² after 3 s pulse.
      this.rho = 1800        // graphite density (kg/m³)
      this.cp = 1200         // effective average specific heat (J/kg/K)
      this.armor_L = 0.025   // 25 mm effective tile + substrate thickness
      this.T_coolant = 25    // room temp water (between pulses only)
      this.h_cool = 0        // no active cooling during pulse
    } else if (deviceId === 'iter') {
      // ITER tungsten monoblocks — actively water-cooled.
      // Full thermal resistance: 6 mm W armor (k drops from 170→110 at 1000°C)
      // + 1 mm Cu interlayer + CuCrZr pipe wall + convective HTC.
      // Effective h_cool reduced to match published T_surface ~ 1200–1500°C
      // at 10 MW/m² steady-state (ITER design basis).
      this.rho = 19350       // tungsten density (kg/m³)
      this.cp = 150          // W specific heat ~150 J/kg/K at operating temp
      this.armor_L = 0.006   // 6 mm armor thickness
      this.T_coolant = 100   // pressurized water inlet ~100°C
      this.h_cool = 8500     // effective HTC through full W→Cu→CuCrZr→water path
                             // tuned to give ~1300°C at 10 MW/m² steady-state
    } else if (deviceId === 'jet') {
      // JET ILW — bulk W lamellae on CFC substrate, inertially cooled.
      // The full thermal stack (W lamellae + CFC carrier + support) has
      // much larger effective thermal mass than the 6 mm W alone.
      // Target: 600–1000°C at 5–8 MW/m² mid-pulse (5–10 s).
      // JOI operational limit: 1200°C.
      this.rho = 19350
      this.cp = 150
      this.armor_L = 0.022   // 22 mm effective thermal depth (W lamellae + CFC substrate)
      this.T_coolant = 200   // JET vessel baked at 200°C
      this.h_cool = 0        // inertial cooling only
    } else if (deviceId === 'sparc') {
      // SPARC — tungsten PFCs with NO active divertor cooling. The 10 s pulse
      // is short enough that the divertor is inertially cooled, and the
      // steady-state load is handled by sweeping the strike point at ~1 Hz
      // over the flat-top instead (Kuang et al., JPP 86, 865860505, 2020).
      //
      // Carbon is also under evaluation in the published design; tungsten is
      // assumed here and stated as an assumption in the Bibliography.
      //
      // The effective thermal depth is larger than the ITER monoblock armour
      // because there is no cooled substrate holding the back face at inlet
      // temperature — the heat soaks into the full tile.
      this.rho = 19350
      this.cp = 150
      this.armor_L = 0.020  // 20 mm effective inertial thermal depth
      this.T_coolant = 80   // between-pulse baseline only
      this.h_cool = 0       // inertial: no active cooling during the pulse
    } else {
      // CENTAUR (conceptual) — actively cooled W monoblocks, similar to ITER
      // but with slightly better cooling from advanced design.
      // Target: ~800–1000°C at nominal heat flux.
      this.rho = 19350
      this.cp = 150
      this.armor_L = 0.006
      this.T_coolant = 80
      this.h_cool = 15000
    }

    this.C_th = this.rho * this.cp * this.armor_L  // J/m²/K
  }

  private ambientTemp(id: string): number {
    switch (id) {
      case 'diiid': return 25   // room temperature
      case 'jet':   return 200  // JET baked at 200°C
      case 'iter':  return 100  // ITER coolant pre-heats to ~100°C
      case 'sparc': return 80   // inertially cooled; starts near vessel temp
      default:      return 80
    }
  }

  /** Reset to ambient when starting a new pulse or switching device */
  reset(): void {
    this.t_surface = this.ambientTemp(this.deviceId)
  }

  /**
   * Advance the thermal model by dt seconds.
   *
   * @param q_base_MW  Inter-ELM baseline heat flux (MW/m²) — sustained for dt
   * @param elm_q_MW   ELM transient heat flux (MW/m²) — applied as impulse
   * @param tau_elm    ELM duration (seconds) — how long the ELM flux lasts
   * @param dt         Simulation timestep (seconds)
   *
   * The ELM heat is deposited as a short impulse: the energy is
   * elm_q × tau_elm, regardless of the simulation timestep dt.
   * This prevents the temperature from swinging wildly when dt >> tau_elm.
   */
  step(q_base_MW: number, elm_q_MW: number, tau_elm: number, dt: number): number {
    if (dt <= 0 || dt > 2.0) return this.t_surface

    const q_base = q_base_MW * 1e6  // W/m²

    // ── Sub-step 1: ELM impulse (if active) ──
    // Deposit ELM energy as a fixed thermal impulse: ΔT = q_elm × tau_elm / C_th
    if (elm_q_MW > 0 && tau_elm > 0) {
      const q_elm = elm_q_MW * 1e6  // W/m²
      const dT_elm = (q_elm * tau_elm) / this.C_th
      this.t_surface += dT_elm
    }

    // ── Sub-step 2: Inter-ELM baseline for full dt ──
    // Active cooling: Newton's law
    const q_cool = this.h_cool * Math.max(this.t_surface - this.T_coolant, 0)

    // Radiative cooling: Stefan-Boltzmann (significant above ~1000°C)
    const sigma = 5.67e-8  // W/m²/K⁴
    const eps = this.deviceId === 'diiid' ? 0.8 : 0.3  // C ~ 0.8, W ~ 0.3
    const T_K = this.t_surface + 273.15
    const T_amb_K = this.T_coolant + 273.15
    const q_rad = sigma * eps * (T_K ** 4 - T_amb_K ** 4)

    // dT/dt = (q_base - q_cool - q_rad) / C_th
    const dTdt = (q_base - q_cool - q_rad) / this.C_th
    this.t_surface += dTdt * dt

    // Floor at ambient
    this.t_surface = Math.max(this.t_surface, this.ambientTemp(this.deviceId))

    return this.t_surface
  }
}

/**
 * Estimate divertor peak heat flux using Eich scaling for the SOL
 * power width and a simple detachment model based on Greenwald fraction.
 * ELM heat flux computed from Loarte scaling (ΔW_ELM ~ fraction of W_stored).
 *
 * References:
 *   T. Eich et al., Nucl. Fusion 53, 093031 (2013) — SOL width
 *   A. Loarte et al., PPCF 45, 1549 (2003) — ELM energy scaling
 *   Pitts et al., JNM 2009 — JET ELM loads
 */
export function computeDivertorHeatFlux(snapshot: Snapshot, device: Device): DivertorState {
  const MU0 = 4 * Math.PI * 1e-7
  const ip_A = snapshot.ip * 1e6  // MA → A
  const a = device.a              // minor radius (m)
  const kappa = device.kappa
  const R0 = device.r0            // major radius (m)

  // Poloidal magnetic field at the outboard midplane
  const B_pol = MU0 * ip_A / (2 * Math.PI * a * Math.sqrt(kappa))

  // Eich scaling: λ_q ≈ 1.35 / B_pol^0.9 (mm), with minimum 0.5 mm
  let lambda_q_m = Math.max(1.35e-3 / Math.pow(B_pol, 0.9), 0.5e-3) // metres

  // SPARC design assumption: the narrowest of the surveyed heat-flux-width
  // scalings, λ_q = 0.18 mm at the outboard midplane, is taken as the design
  // value (Kuang et al. 2020, table 2). Eich alone would give a wider result
  // here, so floor it at the published design number.
  if (device.id === 'sparc') {
    lambda_q_m = Math.min(lambda_q_m, 0.18e-3)
  }

  // Negative triangularity correction: NT plasmas have 1.5–2× wider SOL
  const delta_avg = (device.delta_upper + device.delta_lower) / 2
  if (delta_avg < -0.1) {
    const nt_factor = 1.0 + Math.min(Math.abs(delta_avg) / 0.55, 1.0)
    lambda_q_m *= nt_factor
  }

  // Device-specific flux expansion at the divertor target
  const f_x = (() => {
    switch (device.id) {
      case 'centaur': return 18  // snowflake-like divertor
      // SPARC: value unused for the tile-average — the sweep model below
      // replaces the wetted-stripe area with the swept target area. Kept for
      // the ELM stripe (ELMs deposit on the instantaneous strike stripe).
      case 'sparc':   return 14
      case 'iter':    return 8   // standard vertical target
      case 'jet':     return 12  // Mk2-HD high-delta divertor
      case 'diiid':   return 7   // open lower divertor
      default:        return 8
    }
  })()

  // Divertor radiation fraction
  const f_div_rad = (() => {
    switch (device.id) {
      case 'jet':     return 0.50
      case 'iter':    return 0.70
      case 'diiid':   return 0.35
      case 'centaur': return 0.25
      case 'sparc':   return 0.50  // baseline design assumption (Kuang 2020 §2.3)
      default:        return 0.30
    }
  })()

  // Wetted area: toroidal ring × SOL width × flux expansion
  let A_wet = 2 * Math.PI * R0 * lambda_q_m * f_x  // m²

  // ── SPARC: strike-point sweep ──
  // The inertially cooled targets survive because the strike point is swept
  // at ~1 Hz across the target for the whole flat-top (Kuang 2020): the
  // *tile-averaged* load is set by the swept area (outer target ≈ 4.5 m²),
  // not by the instantaneous λ_q stripe. Without this, the λ_q = 0.18 mm
  // stripe gives ~200 MW/m², melts the model tile in a second, and drives
  // the divertor glow to blackbody white — which is exactly what the stripe
  // WOULD do to the real machine if the sweep failed.
  //
  // The stripe passing back and forth over the reference tile appears as the
  // sweep-phase factor below: a Gaussian pass twice per period (the Rust
  // equilibrium sweeps δ at the same 1 Hz, so the glow position and the tile
  // heat pulse move together), normalized to a unit time-average so the
  // energy delivered over a sweep period is conserved.
  const SPARC_SWEEP_HZ = 1.0
  const SPARC_SWEPT_AREA = 4.5 // m² — outer target swept area (Kuang 2020 §2.4)
  let sweepMod = 1.0
  if (device.id === 'sparc') {
    A_wet = SPARC_SWEPT_AREA
    const t = snapshot.time ?? 0
    const sPhase = Math.sin(2 * Math.PI * SPARC_SWEEP_HZ * t)
    const prox = Math.exp(-(sPhase * sPhase) / (0.35 * 0.35))
    sweepMod = prox / 0.2047 // ⟨prox⟩ over a period = 0.2047
  }

  // Power crossing the separatrix
  const p_sol = Math.max(snapshot.p_loss - snapshot.p_rad, 0)  // MW
  const p_sol_target = p_sol * (1 - f_div_rad)

  // Double-null split
  const isDN = snapshot.magnetic_config === 'DoubleNull'
  const p_sol_per_div = isDN ? p_sol_target / 2 : p_sol_target
  const p_sol_per_div_W = p_sol_per_div * 1e6

  // Inter-ELM attached heat flux (2/3 inner/outer sharing)
  const q_attached = A_wet > 0 ? 0.67 * p_sol_per_div_W / A_wet : 0  // W/m²

  // Detachment correction
  const f_GW = snapshot.f_greenwald
  const f_detach = Math.min(1 - 1 / (1 + Math.pow(f_GW / 0.7, 6)), 0.97)

  // Inter-ELM baseline heat flux (sweep-modulated on SPARC; sweepMod = 1
  // everywhere else)
  const q_interELM = q_attached * (1 - f_detach) * sweepMod / 1e6  // MW/m²

  // ── ELM transient heat flux ──────────────────────────────
  // Published ELM energy and heat flux values (Loarte 2003, Pitts 2009):
  //   DIII-D:  ΔW_ELM ~ 10–55 kJ,  q_ELM ~ 10–25 MW/m²
  //   JET:     ΔW_ELM ~ 100–900 kJ, q_ELM ~ 50–200 MW/m² (perp)
  //   ITER:    ΔW_ELM ~ 5–22 MJ,    q_ELM ~ unmitigated would be catastrophic
  //
  // Model: ΔW_ELM = f_ELM × W_stored, deposited on 2× λ_q wetted area
  // over ~0.5–1 ms timescale.
  // ELM deposition timescale (device-specific, seconds)
  const elm_tau = (() => {
    switch (device.id) {
      case 'diiid':   return 0.001  // 1 ms
      case 'jet':     return 0.0004 // 0.4 ms (faster crash)
      case 'iter':    return 0.0005 // 0.5 ms (projected)
      case 'sparc':   return 0.00012 // 0.12 ms (Hughes et al. 2020, §4.1)
      default:        return 0.001
    }
  })()

  let elm_q = 0  // MW/m²
  if (snapshot.elm_active && snapshot.in_hmode) {
    // Device-specific ELM energy fraction (% of W_stored)
    const f_elm = (() => {
      switch (device.id) {
        case 'diiid':   return 0.05   // 5%: 10–55 kJ from 0.5–1.5 MJ
        case 'jet':     return 0.08   // 8%: 100–600 kJ from 4–8 MJ
        case 'iter':    return 0.06   // 6%: 5–22 MJ from ~350 MJ
        case 'centaur': return 0.0    // NT-edge: no ELMs
        // SPARC never produces Type-I ELMs in this model — the machine is
        // designed to avoid them at all costs (a single unmitigated 1.4–2.2 MJ
        // crash risks flash-melting the inertially cooled W targets, Hughes
        // 2020 §4.1). ELMing SPARC plasmas are grassy Type-II, ~0.5–1.5 % of
        // W_th per crash.
        case 'sparc':   return 0.012
        default:        return 0.06
      }
    })()

    // Pre-crash W_th (snapshot is post-crash)
    const w_pre = (snapshot.w_th ?? 0) / Math.max(1 - f_elm, 0.5)
    const dW_elm = w_pre * f_elm  // MJ

    // ELM broadened wetted area (ELMs deposit on ~2× the inter-ELM λ_q)
    const A_wet_elm = 2 * Math.PI * R0 * lambda_q_m * 2.0 * f_x

    // Transient ELM power: ΔW_ELM / τ_ELM
    const P_elm = dW_elm / elm_tau  // MW

    // 60% of ELM energy goes to outer target
    elm_q = A_wet_elm > 0 ? (P_elm * 0.60 * 1e6) / A_wet_elm / 1e6 : 0  // MW/m²

    // DT has more stored energy → bigger ELMs
    if ((snapshot.mass_number ?? 2.0) > 2.0) elm_q *= 1.3
  }

  // Total peak heat flux: inter-ELM baseline + ELM spike
  const q_peak = Math.max(q_interELM, 0) + elm_q

  const wall_material: 'W' | 'C' = device.id === 'diiid' ? 'C' : 'W'

  // Temperature is computed externally by DivertorThermalModel.step()
  // Pass 0 here; the StatusPanel will overwrite with the thermal model's value.
  return {
    q_peak: Math.max(q_peak, 0),
    q_interELM: Math.max(q_interELM, 0),
    lambda_q: lambda_q_m * 1000,  // m → mm
    p_sol,
    f_detach,
    t_surface: 0,  // filled in by DivertorThermalModel
    wall_material,
    elm_q: Math.max(elm_q, 0),
    tau_elm: elm_tau,
  }
}

// ── Formatting helpers ──────────────────────────────────────────────

/**
 * Format neutron rate in scientific notation: "2.4×10¹⁵"
 */
export function formatNeutronRate(rate: number): string {
  if (rate <= 0) return '0'
  const exp = Math.floor(Math.log10(rate))
  const mantissa = rate / Math.pow(10, exp)

  const superscripts: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '-': '⁻',
  }
  const expStr = String(exp).split('').map(c => superscripts[c] ?? c).join('')
  return `${mantissa.toFixed(1)}×10${expStr}`
}

/**
 * Format Q value appropriately for the magnitude.
 */
export function formatQ(q: number): string {
  if (q >= 100) return q.toFixed(0)
  if (q >= 10) return q.toFixed(1)
  if (q >= 1) return q.toFixed(2)
  if (q >= 0.01) return q.toFixed(3)
  if (q >= 0.0001) return q.toExponential(1)
  if (q > 0) return q.toExponential(0)
  return '0'
}

/**
 * Compute a 0–1 signal level for the neutron bar display (log scale).
 * Maps from ~10¹⁰ (barely detectable) to ~10²¹ (ITER-class) on a 0–1 scale.
 */
export function neutronSignalLevel(rate: number): number {
  if (rate <= 1e10) return 0
  // log10(1e10)=10, log10(1e21)=21 → map [10, 21] to [0, 1]
  const logRate = Math.log10(rate)
  return Math.min(Math.max((logRate - 10) / 11, 0), 1)
}
