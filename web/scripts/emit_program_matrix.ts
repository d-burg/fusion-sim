// Regenerate the envelope matrix fixture read by the Rust envelope test.
//   npm run matrix:emit          (from web/)
// Loads the committed wasm bundle in Node to fetch the base presets, then
// writes crates/tok-sym-core/tests/fixtures/program_matrix.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import init from '../src/wasm/tok_sym_core.js'
import { getDevices, getPreset } from '../src/lib/wasm'
import { generateMatrix, serializeMatrix } from '../src/lib/programMatrix'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = resolve(here, '../src/wasm/tok_sym_core_bg.wasm')
export const FIXTURE_PATH = resolve(here, '../../crates/tok-sym-core/tests/fixtures/program_matrix.json')

export async function emitMatrix(): Promise<string> {
  await init({ module_or_path: readFileSync(wasmPath) })
  return serializeMatrix(generateMatrix(getDevices(), getPreset))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await emitMatrix()
  writeFileSync(FIXTURE_PATH, text)
  const n = text.split('\n').length - 3
  console.log(`wrote ${n} programs (${(text.length / 1e6).toFixed(2)} MB) to ${FIXTURE_PATH}`)
}
