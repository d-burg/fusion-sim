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

  // Q = P_fus / P_heat (external heating)
  const p_heat = snapshot.p_input  // MW (= P_OH + P_NBI + P_ECH + P_ICH)
  const q_plasma = p_heat > 0.001 ? p_fus_MW / p_heat : 0

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
  q_peak: number       // Peak heat flux (MW/m²)
  lambda_q: number     // SOL power width (mm)
  p_sol: number        // Power to SOL (MW)
  f_detach: number     // Detachment fraction (0–1)
  t_surface: number    // Estimated divertor surface temperature (°C)
  wall_material: 'W' | 'C'  // Tungsten or Carbon wall
}

/**
 * Estimate divertor peak heat flux using Eich scaling for the SOL
 * power width and a simple detachment model based on Greenwald fraction.
 *
 * Reference: T. Eich et al., Nucl. Fusion 53, 093031 (2013).
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
  const lambda_q_m = Math.max(1.35e-3 / Math.pow(B_pol, 0.9), 0.5e-3) // metres

  // Flux expansion at the divertor target (typical value ~5–10)
  const f_x = 8.0

  // Wetted area: toroidal ring at major radius times SOL width times expansion
  const A_wet = 2 * Math.PI * R0 * lambda_q_m * f_x  // m²

  // Power crossing the separatrix into the SOL
  const p_sol = Math.max(snapshot.p_loss, 0)  // MW
  const p_sol_W = p_sol * 1e6                 // W

  // Attached heat flux (Loarte-like factor 2/3 for inner/outer sharing)
  const q_attached = A_wet > 0 ? 0.67 * p_sol_W / A_wet : 0  // W/m²

  // Detachment correction: higher Greenwald fraction → more radiative
  // divertor → lower target heat flux.  Simple sigmoid model.
  const f_GW = snapshot.f_greenwald
  const f_detach = Math.min(1 - 1 / (1 + Math.pow(f_GW / 0.7, 6)), 0.97)

  // Peak heat flux at the divertor target
  const q_peak = q_attached * (1 - f_detach) / 1e6  // W/m² → MW/m²

  // Wall material: DIII-D is carbon; JET (ILW) and ITER are tungsten divertors
  // DIII-D uses carbon/graphite PFCs; JET (ILW) and ITER use tungsten divertors
  const wall_material: 'W' | 'C' = device.id === 'diiid' ? 'C' : 'W'

  // Estimate divertor surface temperature from heat flux.
  // Simplified 1D thermal model: T_surface ≈ T_coolant + q_peak · (L / k)
  // where L is the armor thickness and k is thermal conductivity.
  //
  // For tungsten monoblock (ITER-like):
  //   k_W ≈ 110 W/(m·K) at 500°C, L ≈ 6 mm, T_coolant ≈ 150°C
  //   T_surface ≈ 150 + q(MW/m²) × 6e-3 / 110 × 1e6 ≈ 150 + 54.5 × q
  //
  // For carbon (DIII-D): k_C ≈ 80 W/(m·K), L ≈ 20 mm, T_coolant ≈ 25°C
  //   T_surface ≈ 25 + q(MW/m²) × 20e-3 / 80 × 1e6 ≈ 25 + 250 × q
  //
  // Add a radiation background of ~200°C during H-mode from divertor recycling.
  const q_MW = Math.max(q_peak, 0)
  let t_surface: number
  if (wall_material === 'W') {
    const T_coolant = 150  // °C (pressurised water)
    const thermal_resistance = 55  // °C per MW/m² (6mm W armor)
    t_surface = T_coolant + thermal_resistance * q_MW
    // Add radiative/recycling background during active plasma
    if (snapshot.ip > 0.01) t_surface += 150
  } else {
    const T_coolant = 25  // °C (room-temp water for DIII-D)
    const thermal_resistance = 250  // °C per MW/m² (thicker carbon tiles)
    t_surface = T_coolant + thermal_resistance * q_MW
    if (snapshot.ip > 0.01) t_surface += 100
  }

  return {
    q_peak: Math.max(q_peak, 0),
    lambda_q: lambda_q_m * 1000,  // m → mm
    p_sol,
    f_detach,
    t_surface,
    wall_material,
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
