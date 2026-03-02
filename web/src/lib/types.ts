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

export interface Snapshot {
  time: number
  duration: number
  device_id: string

  // Programmed references
  prog_ip: number
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
  beta_n: number
  beta_t: number
  q95: number
  f_greenwald: number
  li: number
  h_factor: number
  in_hmode: boolean
  elm_active: boolean

  // Disruption
  disruption_risk: number
  disrupted: boolean

  // Diagnostics
  diagnostics: DiagnosticSignals

  // Equilibrium geometry
  flux_surfaces: Contour[]
  separatrix: Contour
  axis_r: number
  axis_z: number
  xpoint_r: number
  xpoint_z: number

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
}
