/**
 * Standalone sanity tests for the detachment model.
 * Run with: npx tsx src/lib/detachment.test.ts
 */
import { detachmentFraction, detachmentThreshold } from './fusionPhysics'
import type { Snapshot } from './types'
import type { Device } from './wasm'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
const MU0 = 4 * Math.PI * 1e-7

// Devices as in devices.rs (κ is the separatrix value; the model maps it to κ95)
const diiid = { id: 'diiid', a: 0.56, kappa: 1.7, bt_max: 2.2, surface_area: 47 } as Device
const iter = { id: 'iter', a: 1.7, kappa: 2.1, bt_max: 5.3, surface_area: 680 } as Device

/** Greenwald density (10²⁰ m⁻³) for Ip (MA) and a (m). */
const nGW = (ip: number, a: number) => ip / (Math.PI * a * a)

/** A self-consistent snapshot: n̄ follows from f_GW, Ip and a; p_lh is the
 *  Martin threshold at that density unless given. */
function snap(dev: Device, o: Partial<Snapshot> & { ip: number; f_greenwald: number; p_loss: number }): Snapshot {
  const ne_bar = o.ne_bar ?? o.f_greenwald * nGW(o.ip, dev.a)
  const bt = o.bt ?? dev.bt_max
  const p_lh = o.p_lh ?? 0.0488 * Math.pow(ne_bar, 0.717) * Math.pow(bt, 0.803) * Math.pow(dev.surface_area, 0.941)
  // Heating power: enough that H-mode is accessible unless a test says otherwise
  const p_input = o.p_input ?? Math.max(o.p_loss, p_lh) * 1.2
  return { p_rad: 0, impurity_fraction: 0, q95: 3.5, ...o, ne_bar, bt, p_lh, p_input } as Snapshot
}

// ── 1. GRS calibration: the AUG comparison case (P_sep 10.7 MW, <Bp> 0.34 T,
//       κ95 1.63, n_sep/n_GW 0.486) must give c_N,div = 4 % before the
//       neon/enrichment conversion. Build a device whose κ_sep maps to κ95
//       1.63 and whose Ip reproduces <Bp>; floor switched off. ──
{
  const kappa95 = 1.63
  const kappaSep = 1 + (kappa95 - 1) / 0.75
  const a = 0.52
  const ip_MA = 0.34 * 2 * Math.PI * a * Math.sqrt((1 + kappa95 * kappa95) / 2) / MU0 / 1e6
  const aug = { id: 'aug', a, kappa: kappaSep, bt_max: 2.5, surface_area: 42 } as Device
  const s = snap(aug, { ip: ip_MA, p_loss: 10.7, f_greenwald: (7e19 / 1.44e20) / 0.6, p_lh: 0 })
  const c_core = detachmentThreshold(s, aug)
  assert(near(c_core * 3.5 * 3.0, 0.04, 1e-6), `AUG calibration: c_N,div expected 0.04, got ${(c_core * 10.5).toFixed(5)}`)
}

// ── 2. Unseeded DIII-D H-mode: half detached at f_GW = 0.7 (the calibration
//       point chosen to match the earlier density-only model). Above the
//       floor the density shape is (f_GW/f0)^6 at fixed power; test it with
//       the floor off so the shape is isolated. ──
{
  const base = { ip: 1.5, p_loss: 5.0, p_rad: 0.6 }  // P_sep = 4.4 MW, above the DIII-D floor
  const half = detachmentFraction(snap(diiid, { ...base, f_greenwald: 0.7 }), diiid)
  assert(near(half, 0.5, 0.03), `DIII-D unseeded at f_GW 0.7 should be ~half detached, got ${half.toFixed(3)}`)
  const halfOff = detachmentFraction(snap(diiid, { ...base, f_greenwald: 0.7, p_lh: 0 }), diiid)
  const f0 = 0.7 * Math.pow(1 / halfOff - 1, 1 / 6)
  for (const f of [0.4, 0.55, 0.85, 1.0]) {
    const got = detachmentFraction(snap(diiid, { ...base, f_greenwald: f, p_lh: 0 }), diiid)
    const want = Math.min(1 - 1 / (1 + Math.pow(f / f0, 6)), 0.97)
    assert(near(got, want, 1e-9), `density shape at f_GW ${f}: ${got} vs ${want}`)
  }
}

// ── 3. The GRS dependences: threshold ∝ P_sep / <Bp> / (1+κ95²)^1.5 / f_sep². ──
{
  const t = (o: Partial<Snapshot> & { ip: number; f_greenwald: number; p_loss: number }, dev = diiid) =>
    detachmentThreshold(snap(dev, { p_lh: 0, ...o }), dev)
  const ref = t({ ip: 1.5, p_loss: 5.0, f_greenwald: 0.6 })
  assert(near(t({ ip: 1.5, p_loss: 10.0, f_greenwald: 0.6 }) / ref, 2, 1e-9), 'threshold ∝ P_sep')
  assert(near(t({ ip: 3.0, p_loss: 5.0, f_greenwald: 0.6 }) / ref, 0.5, 1e-9), 'threshold ∝ 1/Ip (poloidal field)')
  assert(near(t({ ip: 1.5, p_loss: 5.0, f_greenwald: 1.2 }) / ref, 0.25, 1e-9), 'threshold ∝ 1/f_sep²')
  // Elongation: <Bp> ∝ 1/√((1+κ²)/2) and the explicit (1+κ²)^1.5 combine to (1+κ95²)^-1
  const k1 = { ...diiid, kappa: 1.4 } as Device
  const k2 = { ...diiid, kappa: 2.0 } as Device
  const k95 = (k: number) => 1 + 0.75 * (k - 1)
  const want = (1 + k95(1.4) ** 2) / (1 + k95(2.0) ** 2)
  const got = t({ ip: 1.5, p_loss: 5.0, f_greenwald: 0.6 }, k2) / t({ ip: 1.5, p_loss: 5.0, f_greenwald: 0.6 }, k1)
  assert(near(got, want, 1e-9), `threshold ∝ 1/(1+κ95²): got ${got}, want ${want}`)
  // Seeding brings detachment on at fixed density
  const lo = detachmentFraction(snap(diiid, { ip: 1.5, p_loss: 5.0, f_greenwald: 0.6 }), diiid)
  const seeded = detachmentFraction(snap(diiid, { ip: 1.5, p_loss: 5.0, f_greenwald: 0.6, impurity_fraction: 0.003 }), diiid)
  assert(seeded > 0.6 && seeded > lo, `0.3 % neon at f_GW 0.6 should detach a DIII-D-like divertor, got ${seeded.toFixed(3)}`)
}

// ── 4. ITER-like flat-top, self-consistent density (f_GW 0.85 → n̄ ≈ 1.4):
//       the floor (0.8 P_LH with ITER's 0.35 factor) is below 90 MW, so the
//       real power applies; the threshold is a few tenths of a percent of
//       core neon, well under ITER's 1.5 % collapse threshold. ──
{
  const s = snap(iter, { ip: 15, p_loss: 100, p_rad: 10, f_greenwald: 0.85, bt: 5.3, q95: 3.0 })
  s.p_lh = 0.35 * (s.p_lh ?? 0)   // the engine applies the device factor
  assert(0.8 * (s.p_lh ?? 0) < 90, 'floor inactive at an ITER flat-top')
  const c_det = detachmentThreshold(s, iter)
  assert(c_det > 0.002 && c_det < 0.012, `ITER core-neon threshold should be a few tenths of a percent, got ${(c_det * 100).toFixed(2)} %`)
  assert(detachmentFraction(s, iter) < 0.3, 'unseeded ITER flat-top should be attached')
  assert(detachmentFraction({ ...s, impurity_fraction: 1.5 * c_det } as Snapshot, iter) > 0.7, 'ITER detaches once c_z exceeds the threshold')
}

// ── 5. Monotone in both drivers, capped, finite with no plasma, and the
//       floor keeps a 1 MW ohmic ramp from reading as fully detached. ──
{
  let prev = -1
  for (let c = 0; c <= 0.05; c += 0.005) {
    const f = detachmentFraction(snap(diiid, { ip: 1.5, p_loss: 5.0, f_greenwald: 0.6, impurity_fraction: c }), diiid)
    assert(f >= prev, `not monotone in c_z at ${c}`)
    prev = f
  }
  prev = -1
  for (let g = 0.05; g <= 1.5; g += 0.05) {
    const f = detachmentFraction(snap(diiid, { ip: 1.5, p_loss: 5.0, f_greenwald: g }), diiid)
    assert(f >= prev, `not monotone in f_GW at ${g}`)
    prev = f
  }
  assert(detachmentFraction(snap(diiid, { ip: 1.5, p_loss: 5.0, f_greenwald: 2.0, impurity_fraction: 0.1 }), diiid) <= 0.97, 'cap at 0.97')
  assert(detachmentFraction(snap(diiid, { ip: 0, p_loss: 0, f_greenwald: 0 }), diiid) === 0, 'no plasma → attached (0)')
  const ramp = snap(diiid, { ip: 1.0, p_loss: 1.2, p_rad: 0.2, f_greenwald: 0.5 })
  assert(detachmentFraction(ramp, diiid) < 0.6, `ohmic ramp-up should not be fully detached, got ${detachmentFraction(ramp, diiid).toFixed(2)}`)
  const floored = detachmentThreshold(ramp, diiid)
  const atFloor = detachmentThreshold({ ...ramp, p_loss: 0.8 * (ramp.p_lh ?? 0) + 0.2 } as Snapshot, diiid)
  assert(near(floored, atFloor, 1e-9), 'below 0.8 P_LH the threshold is the floor value')
  // A machine whose L-H threshold is out of reach of its heating (CENTAUR's
  // negative-triangularity edge, threshold factor 3) gets no floor.
  const nt = { id: 'centaur', a: 0.72, kappa: 1.65, bt_max: 10.9, surface_area: 95 } as Device
  const ntSnap = snap(nt, { ip: 8, p_loss: 30, p_rad: 2, f_greenwald: 0.65, p_input: 35 })
  ntSnap.p_lh = 3 * (ntSnap.p_lh ?? 0)
  assert((ntSnap.p_lh ?? 0) > 35, 'test premise: threshold above the heating')
  const unfloored = detachmentThreshold(ntSnap, nt)
  const sameNoLh = detachmentThreshold({ ...ntSnap, p_lh: 0 } as Snapshot, nt)
  assert(near(unfloored, sameNoLh, 1e-12), 'no floor when H-mode is not accessible')
}

console.log('detachment.test.ts: all tests passed')
