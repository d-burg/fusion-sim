// Run with: npm run matrix:check   (npx tsx scripts/programMatrix.test.ts)
// The committed fixture must match what the current presets, slider ranges
// and program builder produce; otherwise the Rust envelope test is checking
// programs the planner can no longer make.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { emitMatrix, FIXTURE_PATH } from './emit_program_matrix'
import { snapToStep, durationLevels, defaultMassNumber } from '../src/lib/programMatrix'

assert.equal(snapToStep(0.3749, 0, 0.5), 0.5)
assert.equal(snapToStep(1.0 + 0.3 * 1.2, 1.0, 0.05), 1.35)
assert.deepEqual(durationLevels('diiid'), [1, 2.5, 5, 7.5, 10])
assert.deepEqual(durationLevels('centaur'), [1, 7.5, 15, 22.5, 30])
assert.equal(defaultMassNumber('iter'), 2.5)
assert.equal(defaultMassNumber('diiid'), null)

const fresh = await emitMatrix()
const entries = JSON.parse(fresh) as { id: string; knob: string; device: string }[]
assert.ok(entries.length > 600, `matrix has ${entries.length} entries`)
const ids = new Set(entries.map((e) => e.id))
assert.equal(ids.size, entries.length, 'entry ids are unique')
assert.ok(entries.some((e) => e.id === 'iter/hmode/base/0'))
assert.ok(!entries.some((e) => e.device === 'iter' && e.knob === 'n2_puff'), 'ITER has no nitrogen line')
assert.ok(!entries.some((e) => e.device === 'jet' && e.knob === 'config'), 'config selector is DIII-D only')

let committed = ''
try {
  committed = readFileSync(FIXTURE_PATH, 'utf8')
} catch {
  assert.fail(`fixture missing at ${FIXTURE_PATH}; run: npm run matrix:emit`)
}
assert.equal(committed, fresh, 'program_matrix.json is stale; run: npm run matrix:emit')
console.log(`programMatrix.test.ts: ok (${entries.length} entries match the committed fixture)`)
