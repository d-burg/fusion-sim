/**
 * Standalone tests for the hall-audio level model (no Web Audio needed).
 * Run with: npx tsx src/lib/hallAudio.test.ts
 */
import {
  DEFAULT_PLANT, GENERATOR_HZ, GENERATOR_SAG, LOAD_TAU, PLANTS,
  elmClickAmplitude, generatorLoad, hallLevels, plantFor, plantLoad, thumpAmplitude,
} from './hallAudio'
import type { Device } from './wasm'
import type { Snapshot } from './types'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

function device(o: Partial<Device> = {}): Device {
  return {
    name: 'DIII-D', id: 'diiid', r0: 1.67, a: 0.67, bt_max: 2.2, ip_max: 3.0, kappa: 1.8, kappa_areal: 1.8,
    delta_upper: 0.4, delta_lower: 0.4, volume: 20, surface_area: 60, mass_number: 2, z_eff: 1.5,
    wall_outline: [], config: 'LowerSingleNull', ...o,
  }
}

/** A DIII-D flat-top snapshot with the beam on. */
function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    time: 3, duration: 7, device_id: 'diiid', mass_number: 2,
    prog_ip: 1.2, prog_ip_peak: 1.2, prog_bt: 2, prog_ne: 0.5, prog_p_nbi: 5, prog_p_ech: 0, prog_p_ich: 0,
    ip: 1.2, bt: 2, te0: 2, ne_bar: 0.5, w_th: 0.5, tau_e: 0.1, p_input: 6, p_ohmic: 1, p_rad: 1, p_loss: 5, p_alpha: 0,
    beta_n: 1.5, beta_t: 1, q95: 4, f_greenwald: 0.5, li: 1, h_factor: 1, in_hmode: true, elm_active: false,
    elm_suppressed: false, ne_ped: 0.3, te_ped: 0.5, ne_line: 0.5, impurity_fraction: 0, d2_puff: 0, neon_puff: 0,
    te_profile: [], ne_profile: [], disruption_risk: 0, disrupted: false, disruption_phase: '',
    diagnostics: { ip: 1.2, ne_bar: 0.5, te0: 2, w_mhd: 0.5, p_rad: 1, d_alpha: 0.1, soft_xray: 0, locked_mode: 0, neutron_rate: 0, p_input: 6, beta_n: 1.5, q95: 4, f_greenwald: 0.5, v_loop: 0.5 },
    flux_surfaces: [], separatrix: { level: 0, points: [] }, axis_r: 1.7, axis_z: 0, xpoint_r: 1.5, xpoint_z: -1, xpoint_upper_r: 0, xpoint_upper_z: 0,
    is_limited: false, magnetic_config: 'LowerSingleNull', status: 'Running',
    ...o,
  }
}

const inUnit = (x: number) => x >= 0 && x <= 1

// ── A quiet hall ──────────────────────────────────────────────────────
{
  const l = hallLevels(snap(), device(), false, 0.5)
  assert(l.hum === 0 && l.plant === 0 && l.generator === 0 && l.beam === 0, 'a paused or finished pulse is silent')
  assert(l.humHz === 60, 'the silent hall still reports the device mains frequency')
  const n = hallLevels(null, device(), true, 0)
  assert(n.hum === 0 && n.beam === 0, 'no snapshot, no sound')
  const d = hallLevels(snap(), null, true, 0)
  assert(d.hum === 0 && d.generator === 0, 'no device, no sound')
}

// ── DIII-D: copper coils, flywheel generators, a beam line ───────────
{
  const l = hallLevels(snap(), device(), true, 0)
  assert(l.hum > 0, 'the coils and converters hum at flat-top')
  assert(l.humHz === 60, 'DIII-D hums at 60 Hz')
  assert(l.plant === 0, 'no cryoplant on a copper machine')
  assert(l.generator === 1, 'the motor-generator set runs through the pulse')
  assert(near(l.generatorHz, GENERATOR_HZ), 'no load, no sag')
  assert(l.beam > 0, 'the beam line is audible with 5 MW of NBI')
  const quiet = hallLevels(snap({ prog_p_nbi: 0, prog_p_ech: 3 }), device(), true, 0)
  assert(quiet.beam === 0, 'ECH alone makes no beam-line noise')
  assert(quiet.hum < l.hum, 'less heating, less converter hum')
  const field = hallLevels(snap({ ip: 0, prog_p_nbi: 0 }), device(), true, 0)
  assert(field.hum > 0, 'the toroidal field alone hums (magnetostriction)')
  const noField = hallLevels(snap({ bt: 0, ip: 0, prog_p_nbi: 0 }), device(), true, 0)
  assert(noField.hum === 0, 'no field, no current, no heating: no hum')
}

// ── ITER: superconducting, grid-fed ──────────────────────────────────
{
  const iter = device({ id: 'iter', bt_max: 5.3, ip_max: 15 })
  const idle = hallLevels(snap({ device_id: 'iter', bt: 5.3, ip: 0, prog_p_nbi: 0 }), iter, true, 0)
  assert(idle.hum === 0, 'superconducting coils do not hum with the field')
  assert(idle.plant === 1, 'the cryoplant runs whenever the machine is up')
  assert(idle.generator === 0, 'no flywheel generators on ITER')
  assert(idle.humHz === 50, 'ITER hums at 50 Hz')
  const burn = hallLevels(snap({ device_id: 'iter', bt: 5.3, ip: 15, prog_p_nbi: 33, prog_p_ech: 20 }), iter, true, 1)
  assert(burn.hum > 0, 'the converters hum with current and heating')
  assert(near(burn.generatorHz, GENERATOR_HZ * (1 - GENERATOR_SAG)), 'the pitch is still computed (and silent) off the flywheel machines')
}

// ── Generator sag and its inertia ─────────────────────────────────────
{
  const full = hallLevels(snap(), device(), true, 1)
  assert(near(full.generatorHz, GENERATOR_HZ * (1 - GENERATOR_SAG)), 'full load sags the pitch by GENERATOR_SAG')
  const over = hallLevels(snap(), device(), true, 7)
  assert(near(over.generatorHz, full.generatorHz), 'load is clamped to 1')
  assert(near(generatorLoad(0, 1, LOAD_TAU), 1 - Math.exp(-1)), 'one time constant reaches 63 % of the step')
  assert(generatorLoad(0.5, 0.5, 10) === 0.5, 'a steady load stays put')
  assert(generatorLoad(0, 1, 0) === 0, 'zero wall time, no change')
  assert(generatorLoad(0, 1, -1) === 0, 'a clock going backwards is treated as no time')
  let x = 0
  for (let i = 0; i < 1000; i++) x = generatorLoad(x, 1, 0.05)
  assert(x > 0.999, 'the lag converges to the target')
}

// ── Plant load ────────────────────────────────────────────────────────
{
  const d = device()
  assert(plantLoad(snap({ ip: 0, prog_p_nbi: 0 }), d) === 0, 'nothing drawn, no load')
  assert(plantLoad(snap({ ip: 3.0, prog_p_nbi: 23 }), d) === 1, 'full current and full heating is full load')
  assert(plantLoad(snap({ ip: 30, prog_p_nbi: 500 }), d) === 1, 'load is clamped to 1')
  const half = plantLoad(snap({ ip: 1.5, prog_p_nbi: 0 }), d)
  assert(near(half, 0.4 * 0.25), 'the current term is quadratic')
}

// ── Bounds under extreme inputs ───────────────────────────────────────
{
  const wild = hallLevels(snap({ ip: 30, bt: -40, prog_p_nbi: 1e4, prog_p_ech: -5 }), device(), true, 1e6)
  assert(inUnit(wild.hum) && inUnit(wild.beam) && inUnit(wild.plant) && inUnit(wild.generator), 'every level stays in [0, 1]')
  assert(wild.generatorHz > 0 && Number.isFinite(wild.generatorHz), 'the pitch stays finite and positive')
  const zero = hallLevels(snap(), device({ bt_max: 0, ip_max: 0 }), true, 0)
  assert(Number.isFinite(zero.hum) && Number.isFinite(zero.beam), 'a device with zero limits does not divide by zero')
}

// ── One-shots ─────────────────────────────────────────────────────────
{
  assert(thumpAmplitude(3, 3) === 1, 'a full-current disruption is the loudest thud')
  assert(near(thumpAmplitude(1.5, 3), 0.25), 'half the current, a quarter of the force')
  assert(thumpAmplitude(0.05, 3) === 0.15, 'a tiny plasma still thuds at the floor')
  assert(thumpAmplitude(1, 0) === 0.15, 'an unknown device limit falls to the floor')
  assert(elmClickAmplitude(0, 0.5) === 0.3, 'an ELM of unknown size clicks at the floor')
  assert(elmClickAmplitude(0.05, 0.5) > elmClickAmplitude(0.005, 0.5), 'a bigger crash clicks harder')
  assert(elmClickAmplitude(5, 0.5) === 1, 'the click is capped')
  assert(elmClickAmplitude(0.01, 0) === 0.3, 'no stored energy, floor click')
}

// ── Plant table ───────────────────────────────────────────────────────
{
  assert(plantFor('sparc') === DEFAULT_PLANT, 'an unlisted device gets the default plant')
  assert(plantFor(null) === DEFAULT_PLANT && plantFor(undefined) === DEFAULT_PLANT, 'no device id, default plant')
  for (const [id, p] of Object.entries(PLANTS)) {
    assert(p.auxRef > 0, `${id}: the heating reference must be positive`)
    assert(p.mains === 50 || p.mains === 60, `${id}: mains is 50 or 60 Hz`)
  }
  assert(PLANTS.iter.superconducting && PLANTS.centaur.superconducting, 'ITER and CENTAUR are superconducting')
  assert(PLANTS.diiid.flywheel && PLANTS.jet.flywheel, 'DIII-D and JET run on flywheel generators')
}

console.log('hallAudio.test.ts: all assertions passed')
