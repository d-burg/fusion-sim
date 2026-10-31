/**
 * Standalone tests for the event log's Ohmic-drive lines and report rows.
 * Run with: npx tsx src/lib/pulseLog.test.ts
 */
import { buildReport, deriveEvents, fluxFraction, newLogContext, type LogEvent } from './pulseLog'
import type { Snapshot, TracePoint } from './types'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

/** A quiet DIII-D flat-top snapshot; every alarm input sits well inside its limits. */
function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    time: 0, duration: 10, device_id: 'diiid', mass_number: 2,
    prog_ip: 1.2, prog_ip_peak: 1.2, prog_bt: 2, prog_ne: 0.5, prog_p_nbi: 5, prog_p_ech: 0, prog_p_ich: 0,
    ip: 1.2, bt: 2, te0: 2, ne_bar: 0.5, w_th: 0.5, tau_e: 0.1, p_input: 6, p_ohmic: 1, p_rad: 1, p_loss: 5, p_alpha: 0,
    beta_n: 1.5, beta_t: 1, q95: 4, f_greenwald: 0.5, li: 1, h_factor: 1, in_hmode: true, elm_active: false,
    elm_suppressed: false, ne_ped: 0.3, te_ped: 0.5, ne_line: 0.5, impurity_fraction: 0, d2_puff: 0, neon_puff: 0,
    te_profile: [], ne_profile: [], disruption_risk: 0, disrupted: false, disruption_phase: '', p_lh: 2,
    v_loop: 0.5, flux_consumed: 3, flux_budget: 7.5, i_bootstrap: 0.1, i_cd: 0.1, oh_saturated: false, flux_exhausted: false,
    diagnostics: { ip: 1.2, ne_bar: 0.5, te0: 2, w_mhd: 0.5, p_rad: 1, d_alpha: 0.1, soft_xray: 0, locked_mode: 0, neutron_rate: 0, p_input: 6, beta_n: 1.5, q95: 4, f_greenwald: 0.5, v_loop: 0.5 },
    flux_surfaces: [], separatrix: { level: 0, points: [] }, axis_r: 1.7, axis_z: 0, xpoint_r: 1.5, xpoint_z: -1, xpoint_upper_r: 0, xpoint_upper_z: 0,
    is_limited: false, magnetic_config: 'LowerSingleNull', status: 'Running',
    ...o,
  }
}

/** Feed a sequence of snapshots through the edge detector. */
function run(seq: Snapshot[]): LogEvent[] {
  const ctx = newLogContext(1, 'DIII-D')
  const out: LogEvent[] = []
  let prev: Snapshot | null = null
  for (const s of seq) {
    deriveEvents(prev, s, ctx, out)
    prev = s
  }
  return out
}
const texts = (ev: LogEvent[]) => ev.map((e) => e.text)

// ── Flux milestones: one line at 90 %, one at exhaustion, never repeated ──
{
  const seq = [0.5, 0.7, 0.85, 0.91, 0.95].map((f, i) => snap({ time: 2 + i, flux_consumed: 7.5 * f }))
  seq.push(snap({ time: 7, flux_consumed: 7.5, flux_exhausted: true, oh_saturated: true, ip: 1.15 }))
  seq.push(snap({ time: 7.5, flux_consumed: 7.5, flux_exhausted: true, oh_saturated: true, ip: 1.0 }))
  const ev = run(seq)
  const warn = ev.filter((e) => e.text.startsWith('Solenoid flux 9'))
  assert(warn.length === 1 && warn[0].severity === 'minor', `one 90 % line, got ${JSON.stringify(texts(ev))}`)
  assert(warn[0].text.includes('91 % used') && warn[0].text.includes('6.8 of 7.5 V·s'), warn[0].text)
  const gone = ev.filter((e) => e.text.startsWith('Solenoid flux exhausted'))
  assert(gone.length === 1 && gone[0].severity === 'major' && gone[0].t === 7, `one exhaustion line, got ${JSON.stringify(texts(ev))}`)
  assert(!!gone[0].detail && gone[0].detail.includes('V·s'), 'exhaustion detail')
  assert(fluxFraction(seq[5]) === 1, 'fraction at the budget')
  assert(fluxFraction(snap({ flux_budget: 0 })) === 0, 'no budget → 0')
}

// ── Ip tracking alarm: saturated supply plus a 5 % error, debounced, with hysteresis ──
{
  const base = snap({ time: 1 })
  const sat = (t: number, ip: number, exhausted = false) => snap({ time: t, ip, oh_saturated: true, flux_exhausted: exhausted, flux_consumed: exhausted ? 7.5 : 3 })
  // A single saturated step (a momentary clip) raises nothing: 100 ms debounce.
  let ev = run([base, sat(1.05, 1.1), snap({ time: 1.1 })])
  assert(!texts(ev).some((t) => t.includes('Ohmic supply')), `momentary clip should not alarm: ${JSON.stringify(texts(ev))}`)
  // Sustained: raised once, with the voltage-limit wording, then cleared when Ip is back within 2 %.
  ev = run([base, sat(1.05, 1.1), sat(1.1, 1.1), sat(1.2, 1.1), sat(1.3, 1.1), snap({ time: 1.4, ip: 1.15 }), snap({ time: 1.5, ip: 1.19 }), snap({ time: 1.6, ip: 1.2 })])
  const raised = ev.filter((e) => e.text.includes('Ohmic supply at its voltage limit'))
  assert(raised.length === 1 && raised[0].severity === 'minor', `one tracking alarm, got ${JSON.stringify(texts(ev))}`)
  assert(raised[0].text.startsWith('Ip 1.10 MA against 1.20 MA programmed'), raised[0].text)
  // 1.15 MA is a 4 % error (inside the 5 % raise, outside the 2 % clear);
  // 1.19 MA is back within 2 % and clears it.
  const cleared = ev.filter((e) => e.text === 'Ip back on its program')
  assert(cleared.length === 1 && cleared[0].t === 1.5, `cleared once at 1.5 s, got ${JSON.stringify(ev.map((e) => [e.t, e.text]))}`)
  // With the flux gone the same alarm names the cause.
  ev = run([base, sat(1.05, 1.0, true), sat(1.1, 1.0, true), sat(1.2, 1.0, true)])
  assert(texts(ev).some((t) => t.includes('solenoid flux exhausted')), `exhausted wording: ${JSON.stringify(texts(ev))}`)
  // A 3 % error while saturated (a ramp the supply only just keeps up with) is not an alarm.
  ev = run([base, sat(1.05, 1.17), sat(1.1, 1.17), sat(1.2, 1.17), sat(1.3, 1.17)])
  assert(!texts(ev).some((t) => t.includes('Ohmic supply')), `3 % error should not alarm: ${JSON.stringify(texts(ev))}`)
  // Nothing during the programmed ramp-down.
  ev = run([base, snap({ time: 8.5, prog_ip: 0.6, ip: 0.5, oh_saturated: true }), snap({ time: 8.6, prog_ip: 0.6, ip: 0.5, oh_saturated: true }), snap({ time: 8.8, prog_ip: 0.6, ip: 0.5, oh_saturated: true })])
  assert(!texts(ev).some((t) => t.includes('Ohmic supply')), `ramp-down lag is not an alarm: ${JSON.stringify(texts(ev))}`)
}

// ── Ramp-down is logged once the programme comes down, never at start-up ──
{
  // 1.1 MA is still above 90 % of the 1.2 MA peak; 1.0 MA is the ramp-down.
  const ev = run([snap({ time: 0.005, prog_ip: 0, ip: 0 }), snap({ time: 0.5, prog_ip: 0.36, ip: 0.36 }), snap({ time: 1.5 }), snap({ time: 5.2, prog_ip: 1.1 }), snap({ time: 5.4, prog_ip: 1.0 })])
  const down = ev.filter((e) => e.text === 'Ip ramp-down')
  assert(down.length === 1 && down[0].t === 5.4, `one ramp-down line at 5.4 s, got ${JSON.stringify(ev.map((e) => [e.t, e.text]))}`)
}

// ── Report rows: flat-top loop voltage and solenoid flux ──
{
  const pt = (t: number, ip: number, v: number, psi: number): TracePoint => ({
    t, ip, te0: 2, ne_bar: 0.5, w_th: 0.5, p_input: 6, p_rad: 1, p_loss: 5, d_alpha: 0.1, beta_n: 1.5, disruption_risk: 0, li: 1, q95: 4,
    v_loop: v, psi_oh: psi, i_ni: 0.2, h_factor: 1, f_greenwald: 0.5, ne_ped: 0.3, te_ped: 0.5, ne_line: 0.5, impurity_fraction: 0, p_fus: 0,
    elm_suppressed: false, in_hmode: true,
  })
  const program = JSON.stringify({ ip: [[0, 0], [1.5, 1.2], [8, 1.2], [10, 0]], duration: 10 })
  const history: TracePoint[] = []
  for (let t = 0; t <= 10; t += 0.1) {
    const ip = t < 1.5 ? 0.8 * t : t < 8 ? 1.2 : 1.2 * (10 - t) / 2
    const v = t < 1.5 ? 4 : t < 8 ? 0.8 : -1.5
    const psi = Math.min(7.5, t < 1.5 ? 3 * t / 1.5 : 3 + 0.8 * (t - 1.5))
    history.push(pt(+t.toFixed(3), ip, v, psi))
  }
  const rows = buildReport({ history, programJson: program, disrupted: false, cause: '', disruptionTime: null, elmCount: 0, fluxBudget: 7.5 })
  const vRow = rows.find((r) => r.label === 'Flat-top V_loop')
  assert(!!vRow && vRow.achieved === '0.80 V', `flat-top V row: ${JSON.stringify(vRow)}`)
  const fRow = rows.find((r) => r.label === 'Solenoid flux')
  assert(!!fRow && fRow.programmed === '7.5 V·s' && fRow.achieved === '7.5 V·s (100 %), exhausted' && fRow.status === 'major', `flux row: ${JSON.stringify(fRow)}`)
  const rows2 = buildReport({ history: history.map((p) => ({ ...p, psi_oh: p.psi_oh * 0.6 })), programJson: program, disrupted: false, cause: '', disruptionTime: null, elmCount: 0, fluxBudget: 7.5 })
  const fRow2 = rows2.find((r) => r.label === 'Solenoid flux')
  assert(!!fRow2 && fRow2.achieved === '4.5 V·s (60 %)' && fRow2.status === 'ok', `flux row at 60 %: ${JSON.stringify(fRow2)}`)
  // Exhausted at any point counts as exhausted, even if the trace peaked just under the budget.
  const rows4 = buildReport({ history: history.map((p) => ({ ...p, psi_oh: Math.min(p.psi_oh, 7.49) })), programJson: program, disrupted: false, cause: '', disruptionTime: null, elmCount: 0, fluxBudget: 7.5, fluxExhausted: true })
  const fRow4 = rows4.find((r) => r.label === 'Solenoid flux')
  assert(!!fRow4 && fRow4.achieved === '7.5 V·s (100 %), exhausted' && fRow4.status === 'major', `exhausted row: ${JSON.stringify(fRow4)}`)
  // The flat-top loop-voltage mean stops at the disruption, so the quench spike stays out of it.
  const spiked = history.map((p) => (p.t >= 6 ? { ...p, v_loop: 200 } : p))
  const rows5 = buildReport({ history: spiked, programJson: program, disrupted: true, cause: 'density_limit', disruptionTime: 6, elmCount: 0, fluxBudget: 7.5 })
  const vRow5 = rows5.find((r) => r.label === 'Flat-top V_loop')
  assert(!!vRow5 && vRow5.achieved === '0.80 V', `flat-top V row with a quench: ${JSON.stringify(vRow5)}`)
  // No budget known (older engine): no flux row, V row still present.
  const rows3 = buildReport({ history, programJson: program, disrupted: false, cause: '', disruptionTime: null, elmCount: 0 })
  assert(!rows3.some((r) => r.label === 'Solenoid flux'), 'no flux row without a budget')
}

console.log('pulseLog tests passed')
