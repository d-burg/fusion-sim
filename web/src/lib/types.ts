/** Mirrors the Rust SimulationSnapshot struct. */

export interface Contour {
  level: number
  points: [number, number][]
}

export interface DiagnosticSignals {
  ip: number
  ne_bar: number
  te0: number
  w_mhd: number
  p_rad: number
  d_alpha: number
  soft_xray: number
  locked_mode: number
  neutron_rate: number
  p_input: number
  beta_n: number
  q95: number
  f_greenwald: number
  v_loop: number
}

export type SimStatus = 'Ready' | 'Running' | 'Paused' | 'Disrupted' | 'Complete'

export type DisruptionCause =
  | ''
  | 'density_limit'
  | 'beta_limit'
  | 'kink_limit'
  | 'radiative_collapse'
  | 'locked_mode'
  | 'wall_contact'

export interface Snapshot {
  time: number
  duration: number
  device_id: string
  mass_number: number

  // Programmed references
  prog_ip: number
  /** Peak programmed Ip over the pulse (MA); the flat-top value. */
  prog_ip_peak?: number
  prog_bt: number
  prog_ne: number
  prog_p_nbi: number
  prog_p_ech: number
  prog_p_ich: number

  // Transport state
  ip: number
  bt: number
  te0: number
  ne_bar: number
  w_th: number
  tau_e: number
  p_input: number
  p_ohmic: number
  p_rad: number
  p_loss: number
  p_alpha: number
  beta_n: number
  beta_t: number
  q95: number
  f_greenwald: number
  li: number
  h_factor: number
  in_hmode: boolean
  elm_active: boolean
  elm_type?: number
  elm_energy_loss?: number
  elm_suppressed: boolean
  ne_ped: number
  te_ped: number
  ne_line: number
  impurity_fraction: number
  d2_puff: number
  neon_puff: number
  /** Nitrogen and argon seeding rates (10²⁰ atoms/s) */
  n2_puff?: number
  argon_puff?: number
  /** Core seeded-impurity fractions per species */
  imp_n?: number
  imp_ne?: number
  imp_ar?: number
  /** Effective charge including the seeded species */
  z_eff?: number
  /** Fuel ion fraction n_fuel/n_e after dilution by the seeded species */
  fuel_fraction?: number

  // Profiles (51-point arrays, rho = 0.00 to 1.00)
  te_profile: number[]
  ne_profile: number[]

  // Disruption
  /** Hazard rate: probability per second of a disruption starting. */
  disruption_risk: number
  disrupted: boolean
  disruption_phase?: '' | 'precursor' | 'thermal_quench' | 'current_quench' | 'complete'
  /** Dominant hazard term at the trigger; '' until a disruption starts. */
  disruption_cause?: DisruptionCause
  /** Individual hazard terms (0-1) behind disruption_risk. */
  risk_greenwald?: number
  risk_beta?: number
  risk_q95?: number
  risk_radiation?: number
  risk_locked_mode?: number
  /** L-H power threshold (MW). */
  p_lh?: number

  // Ohmic drive
  /** Surface loop voltage (V) the poloidal-field system applies; the
   *  resistive drop across the cold plasma during a current quench. */
  v_loop?: number
  /** Solenoid flux swing used so far and available (Wb = V·s). */
  flux_consumed?: number
  flux_budget?: number
  /** Non-inductive current (MA): bootstrap, and beam/EC driven. */
  i_bootstrap?: number
  i_cd?: number
  /** The Ohmic supply is at its voltage limit (or the flux is gone) and Ip
   *  is not following its programme. */
  oh_saturated?: boolean
  /** The flux swing is used up: no more positive loop voltage. */
  flux_exhausted?: boolean

  // Diagnostics
  diagnostics: DiagnosticSignals

  // Equilibrium geometry
  flux_surfaces: Contour[]
  separatrix: Contour
  axis_r: number
  axis_z: number
  xpoint_r: number
  xpoint_z: number
  xpoint_upper_r: number
  xpoint_upper_z: number
  is_limited: boolean
  magnetic_config: string

  // Status
  status: SimStatus
}

/** A single point in a time history ring buffer. */
export interface TracePoint {
  t: number
  ip: number
  te0: number
  ne_bar: number
  w_th: number
  p_input: number
  p_rad: number
  p_loss: number
  d_alpha: number
  beta_n: number
  disruption_risk: number
  li: number
  q95: number
  v_loop: number
  /** Solenoid flux used (V·s) and non-inductive current (MA). */
  psi_oh: number
  i_ni: number
  h_factor: number
  f_greenwald: number
  ne_ped: number
  te_ped: number
  ne_line: number
  impurity_fraction: number
  p_fus: number
  /** Alpha heating (MW), so the report's Q uses the same P_ext as the readouts. */
  p_alpha?: number
  elm_suppressed: boolean
  elm_active?: boolean
  in_hmode: boolean
}

/** Raw profile frame captured every 50ms during simulation. */
export interface ProfileFrame {
  time: number
  te_profile: number[]  // 51 points
  ne_profile: number[]  // 51 points
  in_hmode: boolean
}

/** Post-processed profile with pre-generated Thomson scatter. */
export interface ProcessedProfile {
  time: number
  te_profile: number[]
  ne_profile: number[]
  in_hmode: boolean
  te_thomson: { rho: number; val: number }[]
  ne_thomson: { rho: number; val: number }[]
}
