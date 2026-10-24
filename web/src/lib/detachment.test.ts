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

// DIII-D-like: a = 0.56 m, κ = 1.7 (devices.rs)
// surface_area enters only through the L-H floor on P_sep (kept below the
// powers used here unless a test says otherwise)
const diiid = { id: 'diiid', a: 0.56, kappa: 1.7, bt_max: 2.2, surface_area: 60 } as Device
const iter = { id: 'iter', a: 1.7, kappa: 2.1, bt_max: 5.3, surface_area: 680 } as Device
function snap(o: Partial<Snapshot>): Snapshot {
  const base = { ip: 1.5, p_loss: 5.0, p_rad: 0.6, f_greenwald: 0.6, impurity_fraction: 0, bt: 2.0, q95: 3.5, ne_bar: 0.5 }
  return { ...base, ...o } as Snapshot
}

// ── 1. GRS calibration: the AUG comparison case (P_sep 10.7 MW, <Bp> 0.34 T,
//       κ 1.63, n_sep/n_GW 0.486) must give c_N,div = 4 %. Reconstruct it with
//       a device whose a and Ip reproduce <Bp> = 0.34 T. ──
{
  const kappa = 1.63
  const a = 0.52
  const MU0 = 4 * Math.PI * 1e-7
  // Ip such that μ0 Ip / (2π a sqrt((1+κ²)/2)) = 0.34 T
  const ip_MA = 0.34 * 2 * Math.PI * a * Math.sqrt((1 + kappa * kappa) / 2) / MU0 / 1e6
  const aug = { id: 'aug', a, kappa, bt_max: 2.5, surface_area: 42 } as Device
  // n_sep/n_GW = 7e19/1.44e20 means f_GW (line-averaged) = that / 0.6
  const s = snap({ ip: ip_MA, p_loss: 10.7, p_rad: 0, f_greenwald: (7e19 / 1.44e20) / 0.6 })
  const c_core = detachmentThreshold(s, aug)
  // threshold is core neon: divide the 4 % divertor nitrogen by 2.0 × 3.0
  assert(near(c_core, 0.04 / 6, 1e-6), `AUG calibration: expected ${(0.04 / 6).toFixed(5)}, got ${c_core.toFixed(5)}`)
}

// ── 2. Unseeded DIII-D H-mode: half detached at f_GW = 0.7 (the calibration
//       point chosen to match the earlier density-only model), and the same
//       (f_GW/0.7)^6 density shape at fixed power. ──
{
  const base = { ip: 1.5, p_loss: 5.0, p_rad: 0.6 }  // P_sep = 4.4 MW
  const half = detachmentFraction(snap({ ...base, f_greenwald: 0.7 }), diiid)
  assert(near(half, 0.5, 0.03), `DIII-D unseeded at f_GW 0.7 should be ~half detached, got ${half.toFixed(3)}`)
  // Shape: f_det(f) follows 1 − 1/(1 + (f/f0)^6) with f0 set by the 0.7 point
  const f0 = 0.7 * Math.pow(1 / half - 1, 1 / 6)
  for (const f of [0.4, 0.55, 0.85, 1.0]) {
    const got = detachmentFraction(snap({ ...base, f_greenwald: f }), diiid)
    const want = Math.min(1 - 1 / (1 + Math.pow(f / f0, 6)), 0.97)
    assert(near(got, want, 1e-9), `density shape at f_GW ${f}: ${got} vs ${want}`)
  }
}

// ── 3. The GRS dependences: harder with power, easier with current (poloidal
//       field) and with density; seeding brings it on at fixed density. ──
{
  const lo = detachmentFraction(snap({ p_loss: 5.0, f_greenwald: 0.6 }), diiid)
  const hiPower = detachmentFraction(snap({ p_loss: 10.0, f_greenwald: 0.6 }), diiid)
  assert(hiPower < lo, `doubling P_sep must make detachment harder (${hiPower} vs ${lo})`)
  const hiIp = detachmentFraction(snap({ ip: 2.0, p_loss: 5.0, f_greenwald: 0.6 }), diiid)
  assert(hiIp > lo, `higher Ip (poloidal field) must make detachment easier (${hiIp} vs ${lo})`)
  const seeded = detachmentFraction(snap({ p_loss: 5.0, f_greenwald: 0.6, impurity_fraction: 0.005 }), diiid)
  assert(seeded > 0.6 && seeded > lo, `0.5 % neon at f_GW 0.6 should detach a DIII-D-like divertor, got ${seeded.toFixed(3)}`)
  // Threshold itself scales ∝ P_sep / Ip
  const t1 = detachmentThreshold(snap({ p_loss: 5.0, p_rad: 0, ip: 1.5 }), diiid)
  const t2 = detachmentThreshold(snap({ p_loss: 10.0, p_rad: 0, ip: 3.0 }), diiid)
  assert(near(t1, t2, 1e-9), 'threshold ∝ P_sep / Ip')
}

// ── 4. ITER-like: large P_sep demands far more seeding than DIII-D, so an
//       unseeded ITER flat-top is attached and needs of order a percent. ──
{
  const s = snap({ ip: 15, p_loss: 100, p_rad: 10, f_greenwald: 0.85, bt: 5.3, q95: 3.0 })
  const c_det = detachmentThreshold(s, iter)
  assert(c_det > 0.005 && c_det < 0.03, `ITER core-neon threshold should be ~1 %, got ${(c_det * 100).toFixed(2)} %`)
  assert(detachmentFraction(s, iter) < 0.2, 'unseeded ITER flat-top should be attached')
  assert(detachmentFraction({ ...s, impurity_fraction: 1.5 * c_det } as Snapshot, iter) > 0.7, 'ITER detaches once c_z exceeds the threshold')
}

// ── 5. Monotone in both drivers, capped, and finite with no plasma. ──
{
  let prev = -1
  for (let c = 0; c <= 0.05; c += 0.005) {
    const f = detachmentFraction(snap({ impurity_fraction: c }), diiid)
    assert(f >= prev, `not monotone in c_z at ${c}`)
    prev = f
  }
  prev = -1
  for (let g = 0; g <= 1.5; g += 0.05) {
    const f = detachmentFraction(snap({ f_greenwald: g }), diiid)
    assert(f >= prev, `not monotone in f_GW at ${g}`)
    prev = f
  }
  assert(detachmentFraction(snap({ f_greenwald: 2.0, impurity_fraction: 0.1 }), diiid) <= 0.97, 'cap at 0.97')
  const dead = detachmentFraction(snap({ ip: 0, f_greenwald: 0 }), diiid)
  assert(dead === 0, `no plasma → attached (0), got ${dead}`)
  assert(Number.isFinite(detachmentFraction(snap({ ip: 0.05, f_greenwald: 1.8, p_loss: 0.01, p_rad: 0 }), diiid)), 'finite at breakdown')
  // A 1 MW ohmic ramp at f_GW 0.5: the L-H floor (≈2.4 MW on DIII-D at this
  // density) keeps it from reading as fully detached.
  const ramp = detachmentFraction(snap({ ip: 1.0, p_loss: 1.2, p_rad: 0.2, f_greenwald: 0.5, ne_bar: 0.5 }), diiid)
  assert(ramp < 0.6, `ohmic ramp-up should not be fully detached, got ${ramp.toFixed(2)}`)
  const floored = detachmentThreshold(snap({ ip: 1.0, p_loss: 1.2, p_rad: 0.2, f_greenwald: 0.5, ne_bar: 0.5 }), diiid)
  const atLH = detachmentThreshold(snap({ ip: 1.0, p_loss: 2.6, p_rad: 0.2, f_greenwald: 0.5, ne_bar: 0.5 }), diiid)
  assert(near(floored, atLH, 1e-9), 'below P_LH the threshold is the P_LH value')
}

console.log('detachment.test.ts: all tests passed')
