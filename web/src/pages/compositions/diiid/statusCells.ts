import type { DisruptionCause, Snapshot } from '../../../lib/types'
import { q95Disp } from '../Fixed'
import { betaTone, fmtHazard, hazardTone } from '../useDiagnostics'

/** DIII-D says shot, not pulse: the shared log and report text, as this look prints it. */
export const shotWords = (text: string) => text.replace(/\bPulse\b/g, 'Shot').replace(/\bpulse\b/g, 'shot')

export type Lamp = 'off' | 'ok' | 'warn' | 'bad' | 'info'

/** `fit`: the widest text a numeric value can show; the grid sets the value in a slot that wide (../Fixed). */
export interface Cell { k: string; v: string; lamp: Lamp; fit?: string }

const CAUSE: Record<string, string> = {
  density_limit: 'DENSITY LIMIT', beta_limit: 'BETA LIMIT', kink_limit: 'KINK LIMIT', radiative_collapse: 'RADIATIVE COLLAPSE',
  locked_mode: 'LOCKED MODE', wall_contact: 'WALL CONTACT',
}

/** The engine reports the shape config as a Rust enum name (LowerSingleNull, ...). */
function configCode(raw: string, limited: boolean): string {
  const c = raw.toLowerCase()
  if (limited || c.includes('limit')) return 'LIMITED'
  if (c.includes('double')) return 'DN'
  if (c.includes('lower')) return 'LSN'
  if (c.includes('upper')) return 'USN'
  return raw ? raw.toUpperCase().slice(0, 4) : '--'
}

/** `cause`: the disruption cause as the log resolved it at the trigger ('' when not resolved). */
export function statusCells(s: Snapshot | null, running: boolean, fuel: string, elming: boolean, cause: DisruptionCause = ''): Cell[] {
  if (!s) {
    return [
      { k: 'STATUS', v: 'READY', lamp: 'off' }, { k: 'MODE', v: '--', lamp: 'off' }, { k: 'ELM', v: '--', lamp: 'off' }, { k: 'CONFIGURATION', v: '--', lamp: 'off' },
      { k: 'f_GW', v: '--', lamp: 'off' }, { k: 'q95', v: '--', lamp: 'off' }, { k: 'β_N', v: '--', lamp: 'off' }, { k: 'P_rad/P_in', v: '--', lamp: 'off' },
      { k: 'OH', v: '--', lamp: 'off' }, { k: 'Ψ_OH', v: '--', lamp: 'off' }, { k: 'V_loop', v: '--', lamp: 'off' }, { k: 'P_LH', v: '--', lamp: 'off' },
      { k: 'H98', v: '--', lamp: 'off' }, { k: 'Z_eff', v: '--', lamp: 'off' }, { k: 'HAZARD', v: '--', lamp: 'off' }, { k: 'FUEL', v: fuel, lamp: 'info' },
    ]
  }
  const alive = s.ip > 0.05 && !s.disrupted
  const fgw = s.f_greenwald
  const flux = (s.flux_budget ?? 0) > 0 ? (s.flux_consumed ?? 0) / (s.flux_budget as number) : 0
  const prad = s.p_input > 0.05 ? s.p_rad / s.p_input : 0
  const risk = s.disruption_risk
  const hz = hazardTone(risk)
  const bt = betaTone(s.beta_n, s)
  const plh = s.p_lh ?? 0
  const status = s.status.toUpperCase()
  const cfg = configCode(s.magnetic_config || '', s.is_limited)
  return [
    { k: 'STATUS', v: status, lamp: s.disrupted ? 'bad' : status === 'RUNNING' ? 'ok' : status === 'COMPLETE' ? 'info' : 'off' },
    { k: 'MODE', v: !alive ? '--' : s.in_hmode ? 'H-MODE' : 'L-MODE', lamp: !alive ? 'off' : s.in_hmode ? 'ok' : 'info' },
    { k: 'ELM', v: !alive ? '--' : s.elm_suppressed ? 'SUPPRESSED' : elming ? 'ELMING' : s.in_hmode ? 'NO ELM' : '--', lamp: !alive ? 'off' : elming ? 'warn' : s.elm_suppressed ? 'ok' : s.in_hmode ? 'info' : 'off' },
    { k: 'CONFIGURATION', v: alive ? cfg : '--', lamp: alive ? 'info' : 'off' },
    { k: 'f_GW', v: alive ? fgw.toFixed(2) : '--', fit: '8.88', lamp: !alive ? 'off' : fgw > 0.95 ? 'bad' : fgw > 0.8 ? 'warn' : 'ok' },
    { k: 'q95', v: alive ? (q95Disp(s.q95) as number).toFixed(2) : '--', fit: '88.88', lamp: !alive ? 'off' : s.q95 < 2.3 ? 'bad' : s.q95 < 3 ? 'warn' : 'ok' },
    { k: 'β_N', v: alive ? s.beta_n.toFixed(2) : '--', fit: '8.88', lamp: !alive ? 'off' : bt === 'bad' ? 'bad' : bt === 'warn' ? 'warn' : 'ok' },
    { k: 'P_rad/P_in', v: alive ? prad.toFixed(2) : '--', fit: '8.88', lamp: !alive ? 'off' : prad > 0.8 ? 'bad' : prad > 0.5 ? 'warn' : 'ok' },
    { k: 'OH', v: !alive ? '--' : s.flux_exhausted ? 'FLUX EXHAUSTED' : s.oh_saturated ? 'SATURATED' : 'OK', lamp: !alive ? 'off' : s.flux_exhausted ? 'bad' : s.oh_saturated ? 'warn' : 'ok' },
    { k: 'Ψ_OH', v: alive ? `${(flux * 100).toFixed(0)}%` : '--', fit: '888%', lamp: !alive ? 'off' : flux >= 1 ? 'bad' : flux > 0.9 ? 'warn' : 'ok' },
    { k: 'V_loop', v: alive ? `${(s.v_loop ?? 0).toFixed(2)} V` : '--', fit: '-88.88 V', lamp: !alive ? 'off' : 'info' },
    { k: 'P_LH', v: !alive || plh <= 0 ? '--' : `${(s.p_input / plh).toFixed(2)}×`, fit: '88.88×', lamp: !alive || plh <= 0 ? 'off' : s.p_input >= plh ? 'ok' : 'warn' },
    { k: 'H98', v: alive && s.h_factor > 0 ? s.h_factor.toFixed(2) : '--', fit: '8.88', lamp: !alive || s.h_factor <= 0 ? 'off' : s.h_factor >= 0.95 ? 'ok' : s.h_factor >= 0.7 ? 'info' : 'warn' },
    { k: 'Z_eff', v: alive ? (s.z_eff ?? 0).toFixed(2) : '--', fit: '8.88', lamp: !alive ? 'off' : (s.z_eff ?? 0) > 3 ? 'warn' : 'ok' },
    { k: 'HAZARD', v: s.disrupted ? (CAUSE[cause] ?? 'DISRUPTED') : alive ? `${fmtHazard(risk)}%/s` : '--', fit: s.disrupted ? undefined : '88.8%/s', lamp: s.disrupted ? 'bad' : !alive ? 'off' : hz === 'bad' ? 'bad' : hz === 'warn' ? 'warn' : 'ok' },
    { k: 'FUEL', v: fuel, lamp: running ? 'info' : 'off' },
  ]
}
