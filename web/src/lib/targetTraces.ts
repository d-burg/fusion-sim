/**
 * Compute target/reference traces from the pulse program.
 *
 * - ipTarget: direct from the programmed Ip waveform
 * - betaNTarget: computed from programmed waveforms using IPB98(y,2) scaling
 */
import type { PulseProgram, WaveformPoint, Device } from './wasm'

const MU_0 = 4 * Math.PI * 1e-7

/** Linear interpolation of a waveform at time t. */
function interpWaveform(waveform: WaveformPoint[], t: number): number {
  if (waveform.length === 0) return 0
  if (t <= waveform[0][0]) return waveform[0][1]
  if (t >= waveform[waveform.length - 1][0]) return waveform[waveform.length - 1][1]

  for (let i = 0; i < waveform.length - 1; i++) {
    const [t0, v0] = waveform[i]
    const [t1, v1] = waveform[i + 1]
    if (t >= t0 && t <= t1) {
      const frac = (t - t0) / (t1 - t0)
      return v0 + frac * (v1 - v0)
    }
  }
  return waveform[waveform.length - 1][1]
}

/**
 * IPB98(y,2) energy confinement time scaling.
 *
 * τE = 0.0562 * Ip^0.93 * Bt^0.15 * ne19^0.41 * P_MW^-0.69
 *      * R^1.97 * ε^0.58 * κ^0.78 * M^0.19
 *
 * Ip in MA, Bt in T, ne19 in 10^19 m^-3, P in MW, R in m, ε = a/R, M in amu
 */
function ipb98y2(
  ip_ma: number,
  bt: number,
  ne19: number,
  p_mw: number,
  r0: number,
  epsilon: number,
  kappa: number,
  mass: number,
): number {
  if (ip_ma <= 0 || bt <= 0 || ne19 <= 0 || p_mw <= 0) return 0
  return (
    0.0562 *
    Math.pow(ip_ma, 0.93) *
    Math.pow(bt, 0.15) *
    Math.pow(ne19, 0.41) *
    Math.pow(p_mw, -0.69) *
    Math.pow(r0, 1.97) *
    Math.pow(epsilon, 0.58) *
    Math.pow(kappa, 0.78) *
    Math.pow(mass, 0.19)
  )
}

export interface TargetTraces {
  ipTarget: [number, number][]
  betaNTarget: [number, number][]
}

/**
 * Compute target traces from the pulse program and device parameters.
 * Called once when the program changes.
 */
export function computeTargetTraces(
  program: PulseProgram,
  device: Device,
): TargetTraces {
  // Ip target is directly the programmed waveform
  const ipTarget: [number, number][] = program.ip.map(([t, v]) => [t, v])

  // βN target: compute at N evenly-spaced time points
  const N = 100
  const dt = program.duration / N
  const r0 = device.r0
  const a = device.a
  const epsilon = a / r0
  // IPB98(y,2) is defined with the areal elongation κ_a = S/(πa²), not the
  // separatrix elongation — matches Device::areal_ratio in the Rust model.
  const kappa = device.kappa_areal
  const mass = device.mass_number
  const volume = device.volume

  const betaNTarget: [number, number][] = []

  for (let i = 0; i <= N; i++) {
    const t = i * dt
    const ip_ma = interpWaveform(program.ip, t)
    const bt = interpWaveform(program.bt, t)
    const ne_target = interpWaveform(program.ne_target, t) // 10^20 m^-3
    const p_nbi = interpWaveform(program.p_nbi, t) // MW
    const p_ech = interpWaveform(program.p_ech, t) // MW
    const p_ich = interpWaveform(program.p_ich, t) // MW

    // Skip early points where Ip is too low
    if (ip_ma < 0.05 || bt < 0.1) {
      betaNTarget.push([t, 0])
      continue
    }

    // Estimate ohmic power: P_ohmic ≈ η * Ip² where η is neoclassical Spitzer
    // Simplified: P_ohmic ≈ 0.5 * Ip_MA^2 / Te_keV^1.5 (rough Spitzer)
    // For the target estimate, use a rough Te ~ 1-3 keV
    const p_ohmic_est = 0.5 * ip_ma * ip_ma / Math.pow(2.0, 1.5) // ~0.18 * Ip² MW

    const p_total = Math.max(p_ohmic_est + p_nbi + p_ech + p_ich, 0.01)

    // ne in 10^19 m^-3 for scaling (input is 10^20)
    const ne19 = ne_target * 10.0

    // τE from IPB98(y,2)
    const tau_e = ipb98y2(ip_ma, bt, ne19, p_total, r0, epsilon, kappa, mass)

    // Steady-state stored energy W_th = P_total * τE (in MW * s = MJ)
    const w_th_mj = p_total * tau_e
    const w_th_j = w_th_mj * 1e6

    // β_t = 2μ₀ * <p> / B_t² where <p> = (2/3) * W_th / V
    const p_avg = (2.0 / 3.0) * w_th_j / volume
    const beta_t = (2.0 * MU_0 * p_avg) / (bt * bt)

    // βN = β_t * a * B_t / I_p (with β_t in absolute, Ip in MA → need ×100 for %)
    // Standard definition: βN = β_t(%) * a * B_t / I_p(MA)
    const beta_t_pct = beta_t * 100
    const beta_n = beta_t_pct * a * bt / ip_ma

    betaNTarget.push([t, Math.max(beta_n, 0)])
  }

  return { ipTarget, betaNTarget }
}
