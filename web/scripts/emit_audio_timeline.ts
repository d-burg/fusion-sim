// Run one pulse through the engine in Node and write the snapshot timeline
// the audio renderer plays back offline, plus the per-step drivers of the
// pulse sonification so its normalization can be checked against the model.
//   npx tsx scripts/emit_audio_timeline.ts <device> <preset> <out.json> [dt|dd]
// Steps at the UI's 5 ms (0.25 ms in a quench) and records one snapshot per
// 15 ms tick, like the control room; profiles are kept (the fusion model
// integrates them), flux surfaces are dropped.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import init from '../src/wasm/tok_sym_core.js'
import { getDevice, getPreset, SimHandle, type PresetId } from '../src/lib/wasm'
import { computeFusion, computeDivertorHeatFlux } from '../src/lib/fusionPhysics'
import type { Snapshot } from '../src/lib/types'

const here = dirname(fileURLToPath(import.meta.url))
const [deviceId, preset, out, fuel] = process.argv.slice(2)
if (!deviceId || !preset || !out) { console.error('usage: emit_audio_timeline <device> <preset> <out.json> [dt|dd]'); process.exit(2) }
await init({ module_or_path: readFileSync(resolve(here, '../src/wasm/tok_sym_core_bg.wasm')) })
const device = getDevice(deviceId)
const program = getPreset(deviceId, preset as PresetId)
if (!device || !program) { console.error('unknown device or preset'); process.exit(2) }
if (fuel === 'dt') device.mass_number = 2.5
if (fuel === 'dd') device.mass_number = 2.0
const sim = new SimHandle(deviceId, JSON.stringify(program))
if (fuel) sim.set_mass_number(device.mass_number)

const DT = 0.005, DT_QUENCH = 0.00025, TICK = 0.015
const inQuench = (s: Snapshot | null) => !!s && s.disrupted && (s.disruption_phase === 'thermal_quench' || s.disruption_phase === 'current_quench')
const frames: Snapshot[] = []
let prev: Snapshot | null = null
let elmCount = 0
let t = 0
while (true) {
  let advanced = 0
  let snap: Snapshot | null = null
  let elmInTick = false
  while (advanced < TICK - 1e-9) {
    const dt = inQuench(prev) ? DT_QUENCH : DT
    snap = JSON.parse(sim.step(dt)) as Snapshot
    advanced += dt
    if (snap.elm_active) elmInTick = true
    prev = snap
    if (snap.status === 'Complete' || snap.status === 'Disrupted') break
  }
  if (!snap) break
  t += advanced
  if (elmInTick) elmCount++
  frames.push({ ...snap, elm_active: elmInTick, flux_surfaces: [], separatrix: { level: 0, points: [] } })
  if (snap.status === 'Complete' || snap.status === 'Disrupted') break
}
writeFileSync(out, JSON.stringify({ device, frames }))
console.log(`${deviceId}/${preset}${fuel ? '/' + fuel : ''}: ${frames.length} frames, ${t.toFixed(2)} s, ${elmCount} ELM ticks, ended ${frames[frames.length - 1].status}`)

// Driver table: what the sonification will normalize against.
console.log('   t     Ip   Vloop  V*Ip   Pin   Psol  qpk   qIE   Hmode   n/s    Pfus')
for (let i = 0; i < frames.length; i += Math.max(1, Math.round(frames.length / 28))) {
  const s = frames[i]
  const f = computeFusion(s, device)
  const d = computeDivertorHeatFlux(s, device)
  console.log(`${s.time.toFixed(2).padStart(6)} ${s.ip.toFixed(2).padStart(6)} ${(s.v_loop ?? 0).toFixed(2).padStart(6)} ${((s.v_loop ?? 0) * s.ip).toFixed(2).padStart(6)} ${s.p_input.toFixed(1).padStart(5)} ${d.p_sol.toFixed(1).padStart(6)} ${d.q_peak.toFixed(1).padStart(5)} ${d.q_interELM.toFixed(1).padStart(5)}   ${s.in_hmode ? 'H' : '-'}   ${f.neutron_rate.toExponential(1)} ${f.p_fus.toFixed(2).padStart(7)}`)
}
