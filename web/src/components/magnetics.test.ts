/**
 * Regime mapping for the synthetic magnetics diagnostic.
 *
 * The panel itself is a canvas animation, so these tests cover the part that
 * carries the physics claim: which fluctuation state each plasma condition
 * maps to, and the EDA/QCE discriminator (AUG: Δf_QCM < 10 kHz ⇒ EDA).
 *
 * Standalone, like src/lib/divertorThermal.test.ts — this project has no test
 * runner, and `tsc -b` (which the production build runs) typechecks src/, so a
 * `vitest` import would fail the build for a dependency that is not installed.
 *
 * Run with: npx tsx src/components/magnetics.test.ts
 */
import { deriveMode } from '../lib/magnetics'
import type { Snapshot } from '../lib/types'

// ── Minimal describe/it/expect shim ────────────────────────────────────────
let failures = 0
let checks = 0

function describe(name: string, body: () => void) {
  console.log(`\n${name}`)
  body()
}

function it(name: string, body: () => void) {
  try {
    body()
    console.log(`  ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`)
  }
}

function expect(actual: unknown) {
  checks++
  return {
    toBe(want: unknown) {
      if (actual !== want) throw new Error(`expected ${String(want)}, got ${String(actual)}`)
    },
    toBeGreaterThan(bound: number) {
      if (!((actual as number) > bound)) {
        throw new Error(`expected > ${bound}, got ${String(actual)}`)
      }
    },
    toBeLessThan(bound: number) {
      if (!((actual as number) < bound)) {
        throw new Error(`expected < ${bound}, got ${String(actual)}`)
      }
    },
  }
}

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    ip: 8.7, te0: 12, te_ped: 4.5, beta_n: 0.9, f_greenwald: 0.46,
    in_hmode: true, elm_suppressed: false, elm_active: false,
    p_loss: 30, p_rad: 8,
    ...over,
  } as Snapshot
}

describe('deriveMode', () => {
  it('reports nothing before the plasma exists', () => {
    expect(deriveMode(null).regime).toBe('none')
    expect(deriveMode(snap({ ip: 0.01 })).regime).toBe('none')
  })

  it('gives L-mode broadband turbulence with no coherent mode', () => {
    const m = deriveMode(snap({ in_hmode: false }))
    expect(m.regime).toBe('lmode')
    expect(m.amplitude).toBe(0)
    expect(m.fQcm).toBe(0)
    expect(m.broadband).toBeGreaterThan(0)
  })

  it('gives Type-I ELMy H-mode no steady coherent mode', () => {
    const m = deriveMode(snap({ in_hmode: true, elm_suppressed: false }))
    expect(m.regime).toBe('elmy')
    expect(m.amplitude).toBe(0)
  })

  it('gives QCE a broad quasi-coherent mode at high edge density', () => {
    const m = deriveMode(snap({ elm_suppressed: true, f_greenwald: 0.6 }))
    expect(m.regime).toBe('qce')
    expect(m.amplitude).toBeGreaterThan(0)
    // AUG discriminator: QCE is the broad-band branch
    expect(m.bandwidth).toBeGreaterThan(10)
  })

  it('gives EDA a narrow, coherent mode at lower edge density', () => {
    const m = deriveMode(snap({ elm_suppressed: true, f_greenwald: 0.35 }))
    expect(m.regime).toBe('eda')
    // AUG discriminator: Δf < 10 kHz means EDA rather than QCE
    expect(m.bandwidth).toBeLessThan(10)
  })

  it('reads the default SPARC operating point (f_GW ≈ 0.46) as QCE', () => {
    const m = deriveMode(snap({ elm_suppressed: true, f_greenwald: 0.46 }))
    expect(m.regime).toBe('qce')
  })

  it('puts the QCM frequency in the published C-Mod band', () => {
    const m = deriveMode(snap({ elm_suppressed: true, f_greenwald: 0.6 }))
    expect(m.fQcm).toBeGreaterThan(50)
    expect(m.fQcm).toBeLessThan(150)
  })

  it('moves the QCM frequency with the plasma, not fixed', () => {
    const a = deriveMode(snap({ elm_suppressed: true, te_ped: 3.0, beta_n: 1.2 }))
    const b = deriveMode(snap({ elm_suppressed: true, te_ped: 6.0, beta_n: 0.6 }))
    expect(b.fQcm).toBeGreaterThan(a.fQcm)
  })
})

// Throw rather than process.exit: the app tsconfig has no node types, and a
// thrown error is still a non-zero exit under `npx tsx` (same as
// divertorThermal.test.ts).
if (failures > 0) {
  throw new Error(`${failures} failing (${checks} assertions)`)
}
console.log(`\nall passing (${checks} assertions)`)
