/**
 * Pulse sonification: the pulse made audible, as distinct from the hall
 * audio, which is the sound the building makes. Nothing here claims to be a
 * sound a plasma makes. Each voice is a labeled mapping from one quantity of
 * the model onto one sound, chosen so a listener can follow the pulse with
 * their eyes closed:
 *
 *   drive   Ohmic drive power |V_loop·Ip| sets the level of a converter
 *           whine whose pitch follows Ip, so the ramp climbs and settles.
 *   sol     power crossing the separatrix sets a sub-100 Hz rumble.
 *   roar    divertor peak heat flux sets the level and brightness of a
 *           broadband roar, which surges when the divertor lights up at the
 *           L-H transition and pulses with ELMs.
 *   events  the neutron rate sets the mean rate of a detector-like Poisson
 *           process; every event gates the whole layer for a few tens of
 *           milliseconds and ticks, so a DD pulse ticks sparsely and a DT
 *           burn becomes a crackling, gated roar.
 *   hiss    fusion power sets a high band of noise under the gating.
 *
 * The level model (`pulseLevels`, `eventRate`, `poissonCount`) is pure and
 * tested without a browser; `PulseVoice` owns the audio nodes and takes the
 * audio context from the hall engine, so it also renders offline.
 */
import type { Device } from './wasm'
import type { Snapshot } from './types'
import { computeDivertorHeatFlux, computeFusion } from './fusionPhysics'
import { plantFor } from './hallAudio'

export interface PulseLevels {
  /** Converter whine level, 0–1, and its pitch (Hz). */
  drive: number
  driveHz: number
  /** Scrape-off-layer rumble, 0–1. */
  sol: number
  /** Divertor roar level, 0–1, and its low-pass cutoff (Hz). */
  roar: number
  roarHz: number
  /** Mean neutron-detector event rate (events/s). */
  events: number
  /** Fusion hiss, 0–1. */
  hiss: number
}

export const PULSE_SILENT: PulseLevels = { drive: 0, driveHz: 180, sol: 0, roar: 0, roarHz: 120, events: 0, hiss: 0 }

/** Pitch of the whine at zero and at full programmed current (Hz). */
export const DRIVE_HZ_MIN = 180
export const DRIVE_HZ_MAX = 600
/** Drive power at which the whine is full: this fraction of the supply's V_max·Ip_peak. */
export const DRIVE_REF_FRACTION = 0.35
/** Divertor heat flux (MW/m²) at which the roar is full. */
export const ROAR_REF = 15
/** Roar low-pass cutoff at zero and at full level (Hz). */
export const ROAR_HZ_MIN = 120
export const ROAR_HZ_MAX = 900
/** Neutron rate (n/s) below which the detector is silent, and the rate law above it. */
export const EVENT_FLOOR = 1e12
export const EVENT_SCALE = 1.2
export const EVENT_POWER = 1.5
/** Fusion power (MW) at which the hiss is full. */
export const HISS_REF = 100
/** Detector dead time (s): events closer than this are dropped, which also bounds the gate rate. */
export const DEAD_TIME = 0.03
/** Gate shape: time to close, time held closed, time to reopen (s), and the closed level. */
export const GATE_ATTACK = 0.004
export const GATE_HOLD = 0.022
export const GATE_RELEASE = 0.012
export const GATE_FLOOR = 0.03

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Mean detector event rate (events/s) for a neutron rate (n/s), logarithmic above the floor. */
export function eventRate(neutronRate: number): number {
  if (!(neutronRate > EVENT_FLOOR)) return 0
  const decades = Math.log10(neutronRate / EVENT_FLOOR)
  return EVENT_SCALE * Math.pow(decades, EVENT_POWER)
}

/** Number of events in an interval with expectation `mean` (Knuth's method, `rand` in [0,1)). */
export function poissonCount(mean: number, rand: () => number = Math.random): number {
  if (!(mean > 0)) return 0
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * (rand() + rand() + rand() - 1.5) * 2))
  const limit = Math.exp(-mean)
  let k = 0
  let p = 1
  do { k++; p *= rand() } while (p > limit)
  return k - 1
}

/** Pulse levels for the current state; a paused, finished or missing pulse is silent. */
export function pulseLevels(s: Snapshot | null, device: Device | null, running: boolean): PulseLevels {
  if (!s || !device || !running || s.disrupted) return { ...PULSE_SILENT }
  // The fuel comes from the snapshot: a DT override on a DD machine changes the neutron rate.
  const dev = s.mass_number != null && s.mass_number !== device.mass_number ? { ...device, mass_number: s.mass_number } : device
  const ipPeak = s.prog_ip_peak || device.ip_max
  const ip = Math.max(0, s.ip)
  const ipFrac = ipPeak > 0 ? clamp(ip / ipPeak, 0, 1) : 0
  const vMax = device.v_loop_max ?? 10
  const driveRef = DRIVE_REF_FRACTION * vMax * ipPeak
  const drivePower = Math.abs(s.v_loop ?? 0) * ip
  const divertor = computeDivertorHeatFlux(s, dev)
  const fusion = computeFusion(s, dev)
  const plant = plantFor(device.id)
  const roar = Math.sqrt(clamp(divertor.q_peak / ROAR_REF, 0, 1))
  return {
    // A plasma with current always whines a little; the ramp pushes it to full.
    drive: ip > 0.01 * ipPeak ? clamp(0.3 + 0.7 * Math.sqrt(driveRef > 0 ? drivePower / driveRef : 0), 0, 1) : 0,
    driveHz: DRIVE_HZ_MIN + (DRIVE_HZ_MAX - DRIVE_HZ_MIN) * ipFrac,
    sol: Math.sqrt(clamp(plant.auxRef > 0 ? divertor.p_sol / plant.auxRef : 0, 0, 1)),
    roar,
    roarHz: ROAR_HZ_MIN + (ROAR_HZ_MAX - ROAR_HZ_MIN) * roar,
    events: eventRate(fusion.neutron_rate),
    hiss: Math.sqrt(clamp(fusion.p_fus / HISS_REF, 0, 1)),
  }
}

// ── Audio nodes ───────────────────────────────────────────────────────

const DRIVE_OSC_GAIN = 0.035
const DRIVE_NOISE_GAIN = 0.12
const SOL_OSC_GAIN = 0.22
const SOL_NOISE_GAIN = 0.5
const ROAR_GAIN = 0.3
const HISS_GAIN = 0.05
const TICK_GAIN = 0.18
const SOL_HZ = 43
const LEVEL_TAU = 0.08
const PITCH_TAU = 0.15

function noiseThrough(ctx: BaseAudioContext, noise: AudioBuffer, filter: BiquadFilterNode, gain: number, out: AudioNode): GainNode {
  const src = ctx.createBufferSource()
  src.buffer = noise
  src.loop = true
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(out)
  src.start()
  return g
}

/** The sonification's nodes on a context the hall engine owns. */
export class PulseVoice {
  private readonly ctx: BaseAudioContext
  private readonly noise: AudioBuffer
  private readonly out: AudioNode
  private readonly gate: GainNode
  private readonly drive: GainNode
  private readonly driveOsc: OscillatorNode
  private readonly driveLow: BiquadFilterNode
  private readonly driveBand: BiquadFilterNode
  private readonly sol: GainNode
  private readonly roar: GainNode
  private readonly roarLow: BiquadFilterNode
  private readonly hiss: GainNode
  private nextFree = 0
  private readonly rand: () => number

  constructor(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, rand: () => number = Math.random) {
    this.ctx = ctx
    this.noise = noise
    this.out = out
    this.rand = rand
    this.gate = ctx.createGain()
    this.gate.gain.value = 1
    this.gate.connect(out)

    // Converter whine: a rounded sawtooth and a band of noise at the same pitch.
    this.drive = ctx.createGain()
    this.drive.gain.value = 0
    this.drive.connect(this.gate)
    this.driveOsc = ctx.createOscillator()
    this.driveOsc.type = 'sawtooth'
    this.driveOsc.frequency.value = DRIVE_HZ_MIN
    this.driveLow = ctx.createBiquadFilter()
    this.driveLow.type = 'lowpass'
    this.driveLow.frequency.value = 2 * DRIVE_HZ_MIN
    const og = ctx.createGain()
    og.gain.value = DRIVE_OSC_GAIN
    this.driveOsc.connect(this.driveLow).connect(og).connect(this.drive)
    this.driveOsc.start()
    this.driveBand = ctx.createBiquadFilter()
    this.driveBand.type = 'bandpass'
    this.driveBand.frequency.value = DRIVE_HZ_MIN
    this.driveBand.Q.value = 2
    noiseThrough(ctx, noise, this.driveBand, DRIVE_NOISE_GAIN, this.drive)

    // Scrape-off-layer rumble: a low sine under low-passed noise.
    this.sol = ctx.createGain()
    this.sol.gain.value = 0
    this.sol.connect(this.gate)
    const solOsc = ctx.createOscillator()
    solOsc.type = 'sine'
    solOsc.frequency.value = SOL_HZ
    const sg = ctx.createGain()
    sg.gain.value = SOL_OSC_GAIN
    solOsc.connect(sg).connect(this.sol)
    solOsc.start()
    const solLow = ctx.createBiquadFilter()
    solLow.type = 'lowpass'
    solLow.frequency.value = 90
    noiseThrough(ctx, noise, solLow, SOL_NOISE_GAIN, this.sol)

    // Divertor roar: low-passed noise that opens up with the heat flux.
    this.roar = ctx.createGain()
    this.roar.gain.value = 0
    this.roar.connect(this.gate)
    this.roarLow = ctx.createBiquadFilter()
    this.roarLow.type = 'lowpass'
    this.roarLow.frequency.value = ROAR_HZ_MIN
    noiseThrough(ctx, noise, this.roarLow, ROAR_GAIN, this.roar)

    // Fusion hiss: a high band of noise.
    this.hiss = ctx.createGain()
    this.hiss.gain.value = 0
    this.hiss.connect(this.gate)
    const hissBand = ctx.createBiquadFilter()
    hissBand.type = 'bandpass'
    hissBand.frequency.value = 3500
    hissBand.Q.value = 0.7
    noiseThrough(ctx, noise, hissBand, HISS_GAIN, this.hiss)
  }

  /**
   * Steady levels at audio time `t`, and the detector events for the
   * interval [t, t + dt). Events are scheduled ahead, so the gates and ticks
   * fall at sample-accurate times between updates.
   */
  apply(l: PulseLevels, t: number, dt: number): void {
    this.drive.gain.setTargetAtTime(l.drive, t, LEVEL_TAU)
    this.driveOsc.frequency.setTargetAtTime(l.driveHz, t, PITCH_TAU)
    this.driveLow.frequency.setTargetAtTime(2 * l.driveHz, t, PITCH_TAU)
    this.driveBand.frequency.setTargetAtTime(l.driveHz, t, PITCH_TAU)
    this.sol.gain.setTargetAtTime(l.sol, t, LEVEL_TAU)
    this.roar.gain.setTargetAtTime(l.roar, t, LEVEL_TAU)
    this.roarLow.frequency.setTargetAtTime(l.roarHz, t, PITCH_TAU)
    this.hiss.gain.setTargetAtTime(l.hiss, t, LEVEL_TAU)
    if (!(dt > 0) || !(l.events > 0)) return
    const n = poissonCount(l.events * dt, this.rand)
    const times: number[] = []
    for (let i = 0; i < n; i++) times.push(t + this.rand() * dt)
    times.sort((a, b) => a - b)
    for (const te of times) {
      if (te < this.nextFree) continue
      this.event(te)
      this.nextFree = te + GATE_ATTACK + GATE_HOLD + GATE_RELEASE + DEAD_TIME
    }
  }

  /** One detector event: the layer drops out for a moment and the counter ticks. */
  private event(te: number): void {
    const g = this.gate.gain
    g.setValueAtTime(1, te)
    g.linearRampToValueAtTime(GATE_FLOOR, te + GATE_ATTACK)
    g.setValueAtTime(GATE_FLOOR, te + GATE_ATTACK + GATE_HOLD)
    g.linearRampToValueAtTime(1, te + GATE_ATTACK + GATE_HOLD + GATE_RELEASE)
    const tick = this.ctx.createBufferSource()
    tick.buffer = this.noise
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 3200
    bp.Q.value = 4
    const tg = this.ctx.createGain()
    tg.gain.setValueAtTime(TICK_GAIN, te)
    tg.gain.exponentialRampToValueAtTime(1e-4, te + 0.008)
    tick.connect(bp).connect(tg).connect(this.out)
    tick.start(te)
    tick.stop(te + 0.012)
  }
}
