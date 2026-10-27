/**
 * Standalone tests for the pulse-sonification level model (no Web Audio needed).
 * Run with: npx tsx src/lib/pulseAudio.test.ts
 */
import {
  DEAD_TIME, DRIVE_HZ_MAX, DRIVE_HZ_MIN, EVENT_FLOOR, GATE_ATTACK, GATE_HOLD, GATE_RELEASE,
  ROAR_HZ_MAX, ROAR_HZ_MIN, eventRate, poissonCount, pulseLevels,
} from './pulseAudio'
import type { Device } from './wasm'
import type { Snapshot } from './types'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol
const inUnit = (x: number) => x >= 0 && x <= 1

function device(o: Partial<Device> = {}): Device {
  return {
    name: 'DIII-D', id: 'diiid', r0: 1.67, a: 0.67, bt_max: 2.2, ip_max: 3.0, kappa: 1.8, kappa_areal: 1.8,
    delta_upper: 0.4, delta_lower: 0.4, volume: 20, surface_area: 60, mass_number: 2, z_eff: 1.5, v_loop_max: 10,
    wall_outline: [], config: 'LowerSingleNull', ...o,
  }
}

/** Flat profiles so the fusion integral is easy to reason about. */
const flat = (v: number) => new Array(51).fill(v)

/** A DIII-D flat-top snapshot: hot, dense, in H-mode. */
function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    time: 3, duration: 7, device_id: 'diiid', mass_number: 2,
    prog_ip: 1.2, prog_ip_peak: 1.2, prog_bt: 2, prog_ne: 0.5, prog_p_nbi: 5, prog_p_ech: 0, prog_p_ich: 0,
    ip: 1.2, bt: 2, te0: 2, ne_bar: 0.5, w_th: 0.5, tau_e: 0.1, p_input: 6, p_ohmic: 1, p_rad: 1, p_loss: 5, p_alpha: 0,
    beta_n: 1.5, beta_t: 1, q95: 4, f_greenwald: 0.5, li: 1, h_factor: 1, in_hmode: true, elm_active: false,
    elm_suppressed: false, ne_ped: 0.3, te_ped: 0.5, ne_line: 0.5, impurity_fraction: 0, d2_puff: 0, neon_puff: 0,
    te_profile: flat(2), ne_profile: flat(0.5), disruption_risk: 0, disrupted: false, disruption_phase: '',
    v_loop: 0.4,
    diagnostics: { ip: 1.2, ne_bar: 0.5, te0: 2, w_mhd: 0.5, p_rad: 1, d_alpha: 0.1, soft_xray: 0, locked_mode: 0, neutron_rate: 0, p_input: 6, beta_n: 1.5, q95: 4, f_greenwald: 0.5, v_loop: 0.4 },
    flux_surfaces: [], separatrix: { level: 0, points: [] }, axis_r: 1.7, axis_z: 0, xpoint_r: 1.5, xpoint_z: -1, xpoint_upper_r: 0, xpoint_upper_z: 0,
    is_limited: false, magnetic_config: 'LowerSingleNull', status: 'Running',
    ...o,
  }
}

// ── Silence ───────────────────────────────────────────────────────────
{
  const l = pulseLevels(snap(), device(), false)
  assert(l.drive === 0 && l.sol === 0 && l.roar === 0 && l.events === 0 && l.hiss === 0, 'a paused pulse is silent')
  assert(pulseLevels(null, device(), true).drive === 0, 'no snapshot, no sound')
  assert(pulseLevels(snap(), null, true).roar === 0, 'no device, no sound')
  assert(pulseLevels(snap({ disrupted: true }), device(), true).roar === 0, 'a disrupted plasma makes no pulse sound (the hall thuds instead)')
  const off = pulseLevels(snap({ ip: 0, v_loop: 3, p_loss: 0, p_rad: 0 }), device(), true)
  assert(off.drive === 0, 'no current, no whine, even with voltage on the gap')
}

// ── The current ramp ──────────────────────────────────────────────────
{
  const ramp = pulseLevels(snap({ ip: 0.6, v_loop: 4.2, in_hmode: false, p_loss: 0.9, p_rad: 0.2 }), device(), true)
  const flatTop = pulseLevels(snap(), device(), true)
  assert(ramp.drive > flatTop.drive, 'the whine is louder during the ramp than at flat-top')
  assert(ramp.drive > 0.8, 'a DIII-D ramp at 4 V and 0.6 MA is most of a full whine')
  const peak = pulseLevels(snap({ ip: 1.03, v_loop: 4.13, in_hmode: false, p_loss: 1.6, p_rad: 0.4 }), device(), true)
  assert(peak.drive === 1, 'the end of the DIII-D ramp, 4 V at 1 MA, is the full whine')
  assert(flatTop.drive > 0.3 && flatTop.drive < 0.6, 'the flat-top whine settles but does not vanish')
  assert(near(ramp.driveHz, DRIVE_HZ_MIN + (DRIVE_HZ_MAX - DRIVE_HZ_MIN) * 0.5), 'the pitch follows Ip against the programmed peak')
  assert(near(flatTop.driveHz, DRIVE_HZ_MAX), 'flat-top is the top of the sweep')
  const down = pulseLevels(snap({ ip: 0.6, v_loop: -4.2 }), device(), true)
  assert(near(down.drive, ramp.drive), 'the converter works just as hard driving the current down')
  const over = pulseLevels(snap({ ip: 1.5 }), device(), true)
  assert(near(over.driveHz, DRIVE_HZ_MAX), 'an overshoot does not sweep past the top')
  const noPeak = pulseLevels(snap({ prog_ip_peak: undefined, ip: 1.5 }), device(), true)
  assert(near(noPeak.driveHz, DRIVE_HZ_MIN + (DRIVE_HZ_MAX - DRIVE_HZ_MIN) * 0.5), 'without a programmed peak the sweep is against the device limit')
}

// ── The divertor lights up ────────────────────────────────────────────
{
  const lmode = pulseLevels(snap({ in_hmode: false, p_loss: 2, p_rad: 0.4 }), device(), true)
  const hmode = pulseLevels(snap(), device(), true)
  assert(hmode.sol > lmode.sol, 'more power across the separatrix, more rumble')
  assert(hmode.roar > lmode.roar, 'more heat flux, more roar')
  assert(hmode.roarHz > lmode.roarHz, 'and a brighter roar')
  assert(hmode.roarHz <= ROAR_HZ_MAX && lmode.roarHz >= ROAR_HZ_MIN, 'the cutoff stays in its range')
  const hot = pulseLevels(snap({ p_loss: 200, p_rad: 1 }), device(), true)
  assert(hot.roar === 1 && hot.sol === 1 && near(hot.roarHz, ROAR_HZ_MAX), 'the roar saturates')
}

// ── The neutron detector ──────────────────────────────────────────────
{
  assert(eventRate(0) === 0 && eventRate(EVENT_FLOOR) === 0, 'below the floor the detector is silent')
  assert(eventRate(1e13) > 0 && eventRate(1e13) < 3, 'a DD pulse ticks sparsely')
  assert(eventRate(2e18) > 15 && eventRate(2e18) < 25, 'a JET DT pulse crackles')
  assert(eventRate(1.4e20) > eventRate(2e18), 'ITER crackles harder')
  assert(eventRate(Infinity) === Infinity || eventRate(1e300) > 100, 'monotone without an upper clamp (the dead time bounds the audible rate)')
  const cold = pulseLevels(snap({ te_profile: flat(0.1) }), device(), true)
  assert(cold.events === 0 && cold.hiss === 0, 'a cold plasma makes no neutrons')
  const dd = pulseLevels(snap({ te_profile: flat(5), ne_profile: flat(0.8) }), device(), true)
  const dt = pulseLevels(snap({ te_profile: flat(5), ne_profile: flat(0.8), mass_number: 2.5 }), device(), true)
  assert(dt.events > dd.events, 'the DT override on the snapshot raises the event rate over DD on the same device')
  assert(dt.hiss > dd.hiss, 'and the hiss')
  assert(inUnit(dt.hiss), 'the hiss stays in [0, 1]')
  // The maximum audible rate is one event per gate-plus-dead-time.
  assert(1 / (GATE_ATTACK + GATE_HOLD + GATE_RELEASE + DEAD_TIME) < 20, 'the detector saturates below 20 events/s')
}

// ── Poisson draws ─────────────────────────────────────────────────────
{
  assert(poissonCount(0) === 0 && poissonCount(-1) === 0 && poissonCount(NaN) === 0, 'no expectation, no events')
  let seed = 12345
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000 }
  for (const mean of [0.05, 0.5, 3, 12, 50]) {
    let sum = 0
    const N = 20000
    for (let i = 0; i < N; i++) sum += poissonCount(mean, rand)
    const avg = sum / N
    assert(Math.abs(avg - mean) < 0.05 * mean + 0.01, `mean ${mean}: sample mean ${avg.toFixed(3)} is within 5 %`)
  }
  assert(Number.isInteger(poissonCount(2.5, rand)) && poissonCount(2.5, rand) >= 0, 'counts are non-negative integers')
}

// ── Bounds under extreme inputs ───────────────────────────────────────
{
  const wild = pulseLevels(snap({ ip: 30, v_loop: -1e4, p_loss: 1e5, p_rad: -5, te_profile: flat(100), ne_profile: flat(50) }), device(), true)
  assert(inUnit(wild.drive) && inUnit(wild.sol) && inUnit(wild.roar) && inUnit(wild.hiss), 'every level stays in [0, 1]')
  assert(Number.isFinite(wild.driveHz) && Number.isFinite(wild.roarHz) && Number.isFinite(wild.events), 'every rate stays finite')
  const zero = pulseLevels(snap(), device({ ip_max: 0, v_loop_max: 0 }), true)
  assert(Number.isFinite(zero.drive) && Number.isFinite(zero.driveHz), 'a device with zero limits does not divide by zero')
}

console.log('pulseAudio.test.ts: all assertions passed')
