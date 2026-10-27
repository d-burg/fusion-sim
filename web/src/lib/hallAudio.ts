/**
 * Hall audio: the sound of the machine, not the plasma. A plasma in vacuum is
 * silent. What a control room hears over the torus-hall microphones is the
 * plant around it: the converters and copper coils humming at mains
 * harmonics, the flywheel motor-generators sagging in pitch under load, the
 * beam lines, the cryoplant on a superconducting machine, and the vessel
 * taking the hit of a disruption. Everything here is synthesized with Web
 * Audio from the live simulation state. There are no recordings and nothing
 * is tuned to sound dramatic; the aim is the steady, slightly boring drone of
 * a real hall, with the pulse audible as changes in it.
 *
 * Off by default and opt-in from Settings. The level model (`hallLevels`,
 * `plantLoad`, `generatorLoad`, `thumpAmplitude`, `elmClickAmplitude`) is
 * pure so it can be tested without a browser; `HallAudio` owns the graph.
 */
import type { Device } from './wasm'
import type { Snapshot } from './types'

/** What the pulsed-power plant of a device sounds like. */
export interface Plant {
  /** Grid frequency where the machine stands: the hum's fundamental. */
  mains: 50 | 60
  /** Pulsed power from flywheel motor-generator sets, whose pitch sags under load. */
  flywheel: boolean
  /** Superconducting TF coils are silent; the cryoplant's compressors are not. */
  superconducting: boolean
  /** Installed auxiliary heating (MW) that converter and beam-line levels are measured against. */
  auxRef: number
}

export const PLANTS: Record<string, Plant> = {
  // San Diego grid; two motor-generator sets feed the coils and beams.
  diiid:   { mains: 60, flywheel: true,  superconducting: false, auxRef: 23 },
  // Culham: two 400 MVA flywheel generators plus the grid.
  jet:     { mains: 50, flywheel: true,  superconducting: false, auxRef: 40 },
  // Cadarache: superconducting coils fed from the grid through converters.
  iter:    { mains: 50, flywheel: false, superconducting: true,  auxRef: 73 },
  // Conceptual compact high-field machine, taken as US-sited and grid-fed.
  centaur: { mains: 60, flywheel: false, superconducting: true,  auxRef: 30 },
}
export const DEFAULT_PLANT: Plant = { mains: 50, flywheel: false, superconducting: false, auxRef: 20 }

export function plantFor(deviceId: string | null | undefined): Plant {
  return (deviceId && PLANTS[deviceId]) || DEFAULT_PLANT
}

/** Ventilation and bearing whine of a motor-generator set at no load (Hz). */
export const GENERATOR_HZ = 180
/** Fractional pitch drop at full load. The AUG flywheel sets sag about 23 %. */
export const GENERATOR_SAG = 0.23
/** Rotor inertia: the time constant (s) with which the pitch follows the load. */
export const LOAD_TAU = 1.5
/** No update for this long (tab hidden, pulse paused) and the hall goes quiet. */
export const STALE_MS = 400

export interface HallLevels {
  /** Converter and coil hum, 0–1, and its fundamental (Hz). */
  hum: number
  humHz: number
  /** Cryoplant bed on a superconducting machine, 0–1. */
  plant: number
  /** Motor-generator whine, 0–1, and its pitch (Hz). */
  generator: number
  generatorHz: number
  /** Beam-line noise, 0–1. */
  beam: number
}

export const SILENT: HallLevels = { hum: 0, humHz: 50, plant: 0, generator: 0, generatorHz: GENERATOR_HZ, beam: 0 }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const auxPower = (s: Snapshot) => Math.max(0, s.prog_p_nbi) + Math.max(0, s.prog_p_ech) + Math.max(0, s.prog_p_ich)

/** Electrical load fraction (0–1) the pulsed-power plant is carrying right now. */
export function plantLoad(s: Snapshot, device: Device, plant: Plant = plantFor(device.id)): number {
  const aux = plant.auxRef > 0 ? auxPower(s) / plant.auxRef : 0
  const ipFrac = device.ip_max > 0 ? Math.max(0, s.ip) / device.ip_max : 0
  return clamp(0.6 * aux + 0.4 * ipFrac * ipFrac, 0, 1)
}

/** First-order lag of the load the generator pitch follows, over a wall-clock step `dt` (s). */
export function generatorLoad(prev: number, target: number, dt: number): number {
  const a = 1 - Math.exp(-Math.max(0, dt) / LOAD_TAU)
  return prev + (clamp(target, 0, 1) - prev) * a
}

/**
 * Steady levels for the current state. `running` is the control room's
 * running flag: a paused or finished pulse is a quiet hall. `load` is the
 * lagged plant load from `generatorLoad`.
 */
export function hallLevels(s: Snapshot | null, device: Device | null, running: boolean, load: number): HallLevels {
  const plant = plantFor(device?.id)
  if (!s || !device || !running) return { ...SILENT, humHz: plant.mains }
  const btFrac = device.bt_max > 0 ? Math.abs(s.bt) / device.bt_max : 0
  const ipFrac = device.ip_max > 0 ? Math.max(0, s.ip) / device.ip_max : 0
  const auxFrac = plant.auxRef > 0 ? clamp(auxPower(s) / plant.auxRef, 0, 1) : 0
  // Copper coils hum with the field (magnetostriction, at twice mains); the
  // converters feeding the poloidal coils and the heating hum with their load.
  const coil = plant.superconducting ? 0 : btFrac * btFrac
  const converters = 0.5 * ipFrac + 0.5 * auxFrac
  const nbiFrac = plant.auxRef > 0 ? clamp(Math.max(0, s.prog_p_nbi) / plant.auxRef, 0, 1) : 0
  return {
    hum: clamp(0.6 * coil + 0.5 * converters, 0, 1),
    humHz: plant.mains,
    plant: plant.superconducting ? 1 : 0,
    generator: plant.flywheel ? 1 : 0,
    generatorHz: GENERATOR_HZ * (1 - GENERATOR_SAG * clamp(load, 0, 1)),
    // A few megawatts of beam is already a loud beam line; the square root
    // keeps DIII-D's 5 MW audible against JET's and ITER's tens.
    beam: Math.sqrt(nbiFrac),
  }
}

/** The disruption thump scales with the force on the vessel, taken as Ip². A small plasma still thuds. */
export function thumpAmplitude(ip: number, ipMax: number): number {
  const f = ipMax > 0 ? Math.max(0, ip) / ipMax : 0
  return clamp(f * f, 0.15, 1)
}

/** One click per ELM; a crash that takes a larger share of the stored energy clicks harder. */
export function elmClickAmplitude(energyLossMJ: number, wThMJ: number): number {
  const frac = wThMJ > 1e-3 ? Math.max(0, energyLossMJ) / wThMJ : 0
  return clamp(0.3 + 5 * frac, 0.3, 1)
}

// ── Audio graph ───────────────────────────────────────────────────────

/** Relative loudness of each source at level 1 (the hum is the reference). */
const HUM_GAIN = 0.12
const PLANT_GAIN = 0.05
const GENERATOR_GAIN = 0.035
const BEAM_GAIN = 0.07
const THUMP_GAIN = 0.6
const CLICK_GAIN = 0.35
/** Smoothing on every steady level so the pulse never clicks or steps. */
const LEVEL_TAU = 0.08
/** Mains harmonics of the hum and their weights: magnetostriction at 2f dominates, 6f is converter ripple. */
const HUM_HARMONICS: [number, number][] = [[1, 0.25], [2, 1.0], [3, 0.35], [4, 0.2], [6, 0.3]]

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function loopedNoise(ctx: AudioContext, buffer: AudioBuffer, filter: BiquadFilterNode, out: GainNode): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.connect(filter)
  filter.connect(out)
  src.start()
  return src
}

interface Graph {
  ctx: AudioContext
  master: GainNode
  hall: GainNode
  dAlpha: GainNode
  hum: GainNode
  humOscs: OscillatorNode[]
  plant: GainNode
  generator: GainNode
  generatorOsc: OscillatorNode
  beam: GainNode
  noise: AudioBuffer
  sources: AudioScheduledSourceNode[]
}

/** The hall's audio graph. Construct lazily, in a user gesture. */
export class HallAudio {
  private graph: Graph | null = null
  private volume = 0.5
  private hallOn = false
  private dAlphaOn = false
  private load = 0
  private lastUpdate = 0
  private lastWall = 0
  private watchdog: ReturnType<typeof setInterval> | null = null

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof AudioContext !== 'undefined'
  }

  /** Switch the two channels. Building the graph needs a user gesture, which the settings click is. */
  setEnabled(hall: boolean, dAlpha: boolean): void {
    this.hallOn = hall
    this.dAlphaOn = dAlpha
    if (!hall && !dAlpha) {
      void this.graph?.ctx.suspend()
      return
    }
    const g = this.ensureGraph()
    if (!g) return
    const now = g.ctx.currentTime
    g.hall.gain.setTargetAtTime(hall ? 1 : 0, now, LEVEL_TAU)
    g.dAlpha.gain.setTargetAtTime(dAlpha ? 1 : 0, now, LEVEL_TAU)
    void g.ctx.resume()
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1)
    const g = this.graph
    if (g) g.master.gain.setTargetAtTime(this.volume, g.ctx.currentTime, LEVEL_TAU)
  }

  /** Call from the Start click: browsers only let a context run after a gesture. */
  resume(): void {
    if (this.graph && (this.hallOn || this.dAlphaOn)) void this.graph.ctx.resume()
  }

  /** Steady levels from the live state. `wallMs` is performance.now(). */
  update(s: Snapshot | null, device: Device | null, running: boolean, wallMs: number): void {
    const g = this.graph
    if (!g) return
    const dt = this.lastWall > 0 ? (wallMs - this.lastWall) / 1000 : 0
    this.lastWall = wallMs
    this.lastUpdate = wallMs
    const target = s && device && running ? plantLoad(s, device) : 0
    this.load = generatorLoad(this.load, target, dt)
    this.apply(hallLevels(s, device, running, this.load))
  }

  /** The vessel takes the disruption: a low thud and a short burst, scaled with Ip². */
  disruption(ip: number, ipMax: number): void {
    const g = this.graph
    if (!g || !this.hallOn) return
    const a = thumpAmplitude(ip, ipMax)
    const t = g.ctx.currentTime
    const osc = g.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(48, t)
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.5)
    const og = g.ctx.createGain()
    og.gain.setValueAtTime(THUMP_GAIN * a, t)
    og.gain.exponentialRampToValueAtTime(1e-4, t + 0.6)
    osc.connect(og).connect(g.hall)
    osc.start(t)
    osc.stop(t + 0.65)
    const burst = g.ctx.createBufferSource()
    burst.buffer = g.noise
    const lp = g.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 260
    const bg = g.ctx.createGain()
    bg.gain.setValueAtTime(THUMP_GAIN * 0.5 * a, t)
    bg.gain.exponentialRampToValueAtTime(1e-4, t + 0.3)
    burst.connect(lp).connect(bg).connect(g.hall)
    burst.start(t)
    burst.stop(t + 0.35)
  }

  /** One click on the sonified D-alpha channel. */
  elm(energyLossMJ: number, wThMJ: number): void {
    const g = this.graph
    if (!g || !this.dAlphaOn) return
    const a = elmClickAmplitude(energyLossMJ, wThMJ)
    const t = g.ctx.currentTime
    const click = g.ctx.createBufferSource()
    click.buffer = g.noise
    const bp = g.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2600
    bp.Q.value = 1.5
    const cg = g.ctx.createGain()
    cg.gain.setValueAtTime(CLICK_GAIN * a, t)
    cg.gain.exponentialRampToValueAtTime(1e-4, t + 0.012)
    click.connect(bp).connect(cg).connect(g.dAlpha)
    click.start(t)
    click.stop(t + 0.02)
  }

  dispose(): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    const g = this.graph
    this.graph = null
    if (!g) return
    for (const src of g.sources) {
      try { src.stop() } catch { /* already stopped */ }
    }
    void g.ctx.close()
  }

  private ensureGraph(): Graph | null {
    if (this.graph) return this.graph
    if (!HallAudio.supported()) return null
    const ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = this.volume
    master.connect(ctx.destination)
    const hall = ctx.createGain()
    hall.gain.value = 0
    hall.connect(master)
    const dAlpha = ctx.createGain()
    dAlpha.gain.value = 0
    dAlpha.connect(master)
    const sources: AudioScheduledSourceNode[] = []

    // Hum: a short harmonic stack of the mains frequency.
    const hum = ctx.createGain()
    hum.gain.value = 0
    hum.connect(hall)
    const humOscs = HUM_HARMONICS.map(([, weight]) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const w = ctx.createGain()
      w.gain.value = weight * HUM_GAIN
      osc.connect(w).connect(hum)
      osc.start()
      sources.push(osc)
      return osc
    })

    const noise = noiseBuffer(ctx, 2)

    // Cryoplant: a steady low rumble.
    const plant = ctx.createGain()
    plant.gain.value = 0
    plant.connect(hall)
    const plantFilter = ctx.createBiquadFilter()
    plantFilter.type = 'lowpass'
    plantFilter.frequency.value = 140
    sources.push(loopedNoise(ctx, noise, plantFilter, plant))

    // Motor-generator: a rounded sawtooth whose pitch sags with load.
    const generator = ctx.createGain()
    generator.gain.value = 0
    generator.connect(hall)
    const generatorOsc = ctx.createOscillator()
    generatorOsc.type = 'sawtooth'
    generatorOsc.frequency.value = GENERATOR_HZ
    const generatorFilter = ctx.createBiquadFilter()
    generatorFilter.type = 'lowpass'
    generatorFilter.frequency.value = 700
    generatorOsc.connect(generatorFilter).connect(generator)
    generatorOsc.start()
    sources.push(generatorOsc)

    // Beam line: broadband mechanical noise, rolled off.
    const beam = ctx.createGain()
    beam.gain.value = 0
    beam.connect(hall)
    const beamFilter = ctx.createBiquadFilter()
    beamFilter.type = 'lowpass'
    beamFilter.frequency.value = 900
    sources.push(loopedNoise(ctx, noise, beamFilter, beam))

    this.graph = { ctx, master, hall, dAlpha, hum, humOscs, plant, generator, generatorOsc, beam, noise, sources }
    this.setHumFrequency(DEFAULT_PLANT.mains)
    this.lastUpdate = performance.now()
    // A hidden tab stops the animation loop that feeds `update`; without
    // this the last levels would drone on indefinitely.
    this.watchdog = setInterval(() => {
      if (performance.now() - this.lastUpdate > STALE_MS) this.apply({ ...SILENT })
    }, 100)
    return this.graph
  }

  private setHumFrequency(mains: number): void {
    const g = this.graph
    if (!g) return
    HUM_HARMONICS.forEach(([n], i) => {
      if (g.humOscs[i].frequency.value !== n * mains) g.humOscs[i].frequency.value = n * mains
    })
  }

  private apply(l: HallLevels): void {
    const g = this.graph
    if (!g) return
    const t = g.ctx.currentTime
    this.setHumFrequency(l.humHz)
    g.hum.gain.setTargetAtTime(l.hum, t, LEVEL_TAU)
    g.plant.gain.setTargetAtTime(l.plant * PLANT_GAIN, t, LEVEL_TAU)
    g.generator.gain.setTargetAtTime(l.generator * GENERATOR_GAIN, t, LEVEL_TAU)
    g.generatorOsc.frequency.setTargetAtTime(l.generatorHz, t, LEVEL_TAU)
    g.beam.gain.setTargetAtTime(l.beam * BEAM_GAIN, t, LEVEL_TAU)
  }
}
