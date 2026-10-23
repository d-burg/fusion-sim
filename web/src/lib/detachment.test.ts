/**
 * Standalone sanity tests for the detachment model.
 * Run with: npx tsx src/lib/detachment.test.ts
 */
import { detachmentFraction } from './fusionPhysics'
import type { Snapshot } from './types'
import type { Device } from './wasm'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

const device = { id: 'diiid', bt_max: 2.2 } as Device
const snap = (f_greenwald: number, impurity_fraction: number, bt = 2.0, q95 = 3.5): Snapshot =>
  ({ f_greenwald, impurity_fraction, bt, q95 } as Snapshot)

// ── 1. Unseeded: identical to the earlier density-only sigmoid ──
for (const f of [0.3, 0.5, 0.7, 0.85, 1.0, 1.2]) {
  const legacy = Math.min(1 - 1 / (1 + Math.pow(f / 0.7, 6)), 0.97)
  const now = detachmentFraction(snap(f, 0), device)
  assert(near(now, legacy, 1e-12), `unseeded f_GW=${f}: ${now} vs legacy ${legacy}`)
}
assert(near(detachmentFraction(snap(0.7, 0), device), 0.5, 1e-9), 'unseeded half-detached at f_GW 0.7')

// ── 2. 1 % neon on a DIII-D-like divertor: half detached at f_GW ≈ 0.5 ──
{
  const f = detachmentFraction(snap(0.495, 0.01), device)
  assert(near(f, 0.5, 0.02), `1% neon at f_GW 0.495 should be half detached, got ${f.toFixed(3)}`)
  const full = detachmentFraction(snap(0.72, 0.01), device)
  assert(full > 0.85, `1% neon at f_GW 0.72 should be nearly fully detached, got ${full.toFixed(3)}`)
}

// ── 3. ITER-like field and q95 need about twice the seeding ──
{
  const iter = { id: 'iter', bt_max: 5.3 } as Device
  const one = detachmentFraction(snap(0.495, 0.01, 5.3, 3.0), iter)
  const two = detachmentFraction(snap(0.495, 0.02, 5.3, 3.0), iter)
  assert(one < 0.35, `ITER at 1% neon should still be mostly attached, got ${one.toFixed(3)}`)
  assert(near(two, 0.5, 0.06), `ITER at 2% neon should be about half detached, got ${two.toFixed(3)}`)
}

// ── 4. Monotone in both drivers, capped at 0.97 ──
{
  let prev = -1
  for (let c = 0; c <= 0.05; c += 0.005) {
    const f = detachmentFraction(snap(0.5, c), device)
    assert(f >= prev, `not monotone in c_z at ${c}`)
    prev = f
  }
  prev = -1
  for (let g = 0; g <= 1.5; g += 0.05) {
    const f = detachmentFraction(snap(g, 0.01), device)
    assert(f >= prev, `not monotone in f_GW at ${g}`)
    prev = f
  }
  assert(detachmentFraction(snap(2.0, 0.1), device) <= 0.97, 'cap at 0.97')
}

// ── 5. Ramp-up: huge q95 and zero Bt must not blow up ──
{
  const f = detachmentFraction(snap(0.2, 0.01, 0, 40), device)
  assert(Number.isFinite(f) && f >= 0 && f < 0.1, `ramp-up case should be attached and finite, got ${f}`)
}

console.log('detachment.test.ts: all tests passed')
