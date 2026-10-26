/**
 * Control-room event log, disruption attribution and the end-of-pulse
 * report. Everything here is derived from consecutive snapshots: every
 * event is an edge (a state change or a threshold crossing), so the log
 * is append-only and reads like a machine's sequence record.
 */
import type { DisruptionCause, Snapshot, TracePoint } from './types'
import type { PulseProgram, WaveformPoint } from './wasm'

/* ─── Events ─────────────────────────────────────────────── */

/** EPICS/ISA-101 style severities. `info` is uncolored (nominal sequence),
 *  `ok` a favorable transition, `minor`/`major` alarms, `invalid` a
 *  readout that has stopped meaning anything. */
export type Severity = 'info' | 'ok' | 'minor' | 'major' | 'invalid'

export interface LogEvent {
  id: number
  /** Simulation time (s). */
  t: number
  severity: Severity
  text: string
  /** Optional second line: explanation or operator action. */
  detail?: string
}

/** Per-pulse latched state the edge detector needs. */
export interface LogContext {
  pulseNumber: number | null
  deviceName: string
  /** The programmed waveforms, for naming ramp targets. */
  program: PulseProgram | null
  started: boolean
  ipEstablished: boolean
  flatTop: boolean
  rampDown: boolean
  elmCount: number
  /** Sim time the disruption sequence started, once it has. */
  disruptionTime: number | null
  /** The cause label fixed at the trigger, from the pre-quench plasma. */
  disruptionLabel: string | null
  /** Whether the INVALID "plasma terminated" line has been written. */
  terminatedLogged: boolean
  /** Alarm keys currently raised (hysteresis). */
  alarms: Set<string>
  /** Sim time each alarm condition first became true, for the debounce. */
  alarmSince: Map<string, number>
  /** L-H dithering detection: time of the last regime change, how many
   *  came in quick succession, and whether a dithering line is open. */
  lastRegimeChange: number
  quickRegimeChanges: number
  dithering: boolean
  nextId: number
}

export function newLogContext(pulseNumber: number | null, deviceName: string, program: PulseProgram | null = null): LogContext {
  return {
    pulseNumber,
    deviceName,
    program,
    started: false,
    ipEstablished: false,
    flatTop: false,
    rampDown: false,
    elmCount: 0,
    disruptionTime: null,
    disruptionLabel: null,
    terminatedLogged: false,
    alarms: new Set(),
    alarmSince: new Map(),
    lastRegimeChange: -Infinity,
    quickRegimeChanges: 0,
    dithering: false,
    nextId: 1,
  }
}

/** Is there a plasma to reconstruct? Below 0.1 MA the engine itself falls
 *  back to placeholder profile quantities, and once the current quench has
 *  finished there is nothing left to measure. */
export function reconstructionValid(s: Snapshot | null | undefined): boolean {
  return !!s && s.ip >= 0.1 && s.disruption_phase !== 'complete'
}

interface AlarmDef {
  key: string
  severity: 'minor' | 'major'
  on: (s: Snapshot) => boolean
  off: (s: Snapshot) => boolean
  raise: (s: Snapshot) => string
  clear: string
}

const pradFrac = (s: Snapshot) => (s.p_input > 1 ? s.p_rad / s.p_input : 0)
const pct = (x: number) => (x * 100).toFixed(0)

/** Threshold alarms with hysteresis so a noisy signal cannot chatter. The
 *  "on" numbers match the color thresholds used on the status panel; the
 *  βN band is wide enough that a Type I ELM crash (5–13 % of W) does not
 *  toggle it. */
const ALARMS: AlarmDef[] = [
  {
    key: 'fgw_minor', severity: 'minor',
    on: (s) => s.f_greenwald > 0.8, off: (s) => s.f_greenwald < 0.75,
    raise: (s) => `fGW ${s.f_greenwald.toFixed(2)}, approaching the Greenwald density limit`,
    clear: 'fGW back below 0.8',
  },
  {
    key: 'fgw_major', severity: 'major',
    on: (s) => s.f_greenwald > 0.9, off: (s) => s.f_greenwald < 0.85,
    raise: (s) => `fGW ${s.f_greenwald.toFixed(2)}, at the Greenwald limit`,
    clear: 'fGW back below 0.9',
  },
  {
    key: 'betan_minor', severity: 'minor',
    on: (s) => s.beta_n > 2.5, off: (s) => s.beta_n < 2.2,
    raise: (s) => `βN ${s.beta_n.toFixed(2)}, approaching the no-wall β limit (2.8)`,
    clear: 'βN back below 2.5',
  },
  {
    key: 'betan_major', severity: 'major',
    on: (s) => s.beta_n > 2.8, off: (s) => s.beta_n < 2.5,
    raise: (s) => `βN ${s.beta_n.toFixed(2)}, above the no-wall β limit`,
    clear: 'βN back below 2.8',
  },
  {
    key: 'q95_minor', severity: 'minor',
    on: (s) => s.q95 < 2.5, off: (s) => s.q95 > 2.6,
    raise: (s) => `q95 ${s.q95.toFixed(2)}, approaching the kink limit`,
    clear: 'q95 back above 2.5',
  },
  {
    key: 'q95_major', severity: 'major',
    on: (s) => s.q95 < 2.0, off: (s) => s.q95 > 2.1,
    raise: (s) => `q95 ${s.q95.toFixed(2)}, below the kink limit`,
    clear: 'q95 back above 2.0',
  },
  {
    key: 'prad', severity: 'minor',
    on: (s) => pradFrac(s) > 0.7, off: (s) => pradFrac(s) < 0.6,
    raise: (s) => `P_rad/P_in ${pradFrac(s).toFixed(2)}, radiative collapse risk`,
    clear: 'P_rad/P_in back below 0.7',
  },
  {
    key: 'hazard_minor', severity: 'minor',
    on: (s) => s.disruption_risk > 0.3, off: (s) => s.disruption_risk < 0.25,
    raise: (s) => `Disruption hazard ${pct(s.disruption_risk)} %/s`,
    clear: 'Disruption hazard back below 30 %/s',
  },
  {
    key: 'hazard_major', severity: 'major',
    on: (s) => s.disruption_risk > 0.6, off: (s) => s.disruption_risk < 0.5,
    raise: (s) => `Disruption hazard ${pct(s.disruption_risk)} %/s`,
    clear: 'Disruption hazard back below 60 %/s',
  },
]

/** Heating systems whose on/off edges are logged. */
const HEATING: { key: 'prog_p_nbi' | 'prog_p_ech' | 'prog_p_ich'; wf: 'p_nbi' | 'p_ech' | 'p_ich'; name: string }[] = [
  { key: 'prog_p_nbi', wf: 'p_nbi', name: 'NBI' },
  { key: 'prog_p_ech', wf: 'p_ech', name: 'ECH' },
  { key: 'prog_p_ich', wf: 'p_ich', name: 'ICH' },
]
const HEAT_ON = 0.05 // MW
/** Seeding gas lines whose on/off edges are logged (10²⁰ atoms/s). */
const SEEDING: { key: 'n2_puff' | 'neon_puff' | 'argon_puff'; name: string }[] = [
  { key: 'n2_puff', name: 'Nitrogen seeding' },
  { key: 'neon_puff', name: 'Neon seeding' },
  { key: 'argon_puff', name: 'Argon seeding' },
]
const SEED_ON = 0.01

/** The level a programmed ramp starting at `t` is heading for: the value at
 *  the next breakpoint after `t`. Falls back to the current value. */
function rampTarget(waveform: WaveformPoint[] | undefined, t: number, current: number): number {
  if (!waveform) return current
  for (const [tb, v] of waveform) {
    if (tb > t + 1e-9) return v
  }
  return current
}

/** Time a regime must persist before dithering is considered over (s). */
const DITHER_WINDOW = 1.0
/** An alarm condition must hold this long before it is raised (s). The
 *  engine smooths its own hazard inputs over 100 ms for the same reason:
 *  a 30 ms radiation-fraction blip when the beams switch off is not an
 *  alarm, and neither is a single ELM crash. */
const ALARM_DEBOUNCE = 0.1

/**
 * Append the events implied by the step `prev` → `next` to `out`.
 * `prev` is null on the first snapshot of a pulse.
 */
export function deriveEvents(prev: Snapshot | null, next: Snapshot, ctx: LogContext, out: LogEvent[]): void {
  const push = (severity: Severity, text: string, detail?: string) => {
    out.push({ id: ctx.nextId++, t: next.time, severity, text, detail })
  }

  if (!ctx.started) {
    ctx.started = true
    const n = ctx.pulseNumber !== null ? `Pulse ${ctx.pulseNumber}` : 'Pulse'
    push('info', `${n} started on ${ctx.deviceName}, programmed ${next.duration.toFixed(1)} s`)
  }

  // ── Plasma current sequence ──
  if (!ctx.ipEstablished && next.ip >= 0.1) {
    ctx.ipEstablished = true
    push('info', `Plasma current established, Ip ${next.ip.toFixed(2)} MA`)
  }
  const ipPeak = next.prog_ip_peak ?? 0
  if (!ctx.flatTop && ipPeak > 0 && next.prog_ip >= 0.98 * ipPeak) {
    ctx.flatTop = true
    push('info', `Ip flat-top, ${ipPeak.toFixed(2)} MA programmed`)
  }
  // Ramp-down as the engine defines it (prog_ip under 90 % of the peak once
  // the peak is above 0.5 MA), re-evaluated every step; logged once.
  const inRampDown = ipPeak > 0.5 && next.prog_ip < 0.9 * ipPeak
  if (inRampDown && !ctx.rampDown && !next.disrupted) push('info', 'Ip ramp-down')
  ctx.rampDown = inRampDown

  // ── Heating systems ──
  for (const h of HEATING) {
    const was = (prev?.[h.key] ?? 0) >= HEAT_ON
    const now = next[h.key] >= HEAT_ON
    if (now && !was) {
      const target = rampTarget(ctx.program?.[h.wf], next.time, next[h.key])
      const ramping = target > next[h.key] * 1.2
      push('info', `${h.name} on${ramping ? `, ramping to ${target.toFixed(1)} MW` : `, ${next[h.key].toFixed(1)} MW`}`)
    }
    else if (was && now && prev && Math.abs(next[h.key] - prev[h.key]) > Math.max(1.0, 0.2 * prev[h.key])) {
      // A programmed step in power: more than a megawatt and a fifth of the
      // level in one step. Ramps move far less than that per step.
      push('info', `${h.name} ${next[h.key] > prev[h.key] ? 'up' : 'down'} to ${next[h.key].toFixed(1)} MW`)
    }
    else if (was && !now && !next.disrupted) push('info', `${h.name} off`)
  }

  // ── Seeding gas lines ──
  for (const g of SEEDING) {
    const was = (prev?.[g.key] ?? 0) >= SEED_ON
    const level = next[g.key] ?? 0
    const now = level >= SEED_ON
    if (now && !was) {
      const target = rampTarget(ctx.program?.[g.key], next.time, level)
      push('info', `${g.name} on${target > level * 1.2 ? `, ramping to ${target.toFixed(2)}` : `, ${level.toFixed(2)}`} ×10²⁰/s`)
    } else if (was && !now && !next.disrupted) push('info', `${g.name} off`)
  }

  // ── Confinement regime ──
  if (prev) {
    const pNet = next.p_input - next.p_rad
    const pLh = next.p_lh ?? 0
    const changed = next.in_hmode !== prev.in_hmode
    if (changed) {
      // Repeated transitions within a second of each other are one
      // phenomenon, dithering at the threshold, and get one line.
      ctx.quickRegimeChanges = next.time - ctx.lastRegimeChange < DITHER_WINDOW ? ctx.quickRegimeChanges + 1 : 0
      ctx.lastRegimeChange = next.time
      if (ctx.dithering) {
        /* already reported */
      } else if (ctx.quickRegimeChanges >= 2) {
        ctx.dithering = true
        push('minor', `Dithering at the L-H threshold, P_net ${pNet.toFixed(1)} MW near P_LH ${pLh.toFixed(1)} MW`)
      } else if (next.in_hmode) {
        push('ok', `L-H transition, P_net ${pNet.toFixed(1)} MW crossed P_LH ${pLh.toFixed(1)} MW`)
      } else if (!next.disrupted) {
        const why = next.q95 < 2.0 ? `q95 ${next.q95.toFixed(2)}` : `P_net ${pNet.toFixed(1)} MW below 0.8 P_LH (${(0.8 * pLh).toFixed(1)} MW)`
        push('minor', `H-L back-transition, ${why}`)
      }
    } else if (ctx.dithering && next.time - ctx.lastRegimeChange >= DITHER_WINDOW) {
      ctx.dithering = false
      ctx.quickRegimeChanges = 0
      push(next.in_hmode ? 'ok' : 'info', next.in_hmode ? 'Settled in H-mode' : 'Settled in L-mode')
    }
    if (next.elm_active && !prev.elm_active) {
      ctx.elmCount += 1
      if (ctx.elmCount === 1) {
        const dw = (next.elm_energy_loss ?? 0) * 1000
        push('info', dw >= 1 ? `First ELM, ΔW ${dw.toFixed(0)} kJ` : 'First ELM')
      }
    }
    if (next.elm_suppressed && !prev.elm_suppressed) push('ok', 'ELMs suppressed (QCE regime)')
    else if (!next.elm_suppressed && prev.elm_suppressed && next.in_hmode) push('info', 'ELMs return')
  }

  // ── Threshold alarms ──
  // Armed like the engine's hazard: Ip above 5 % of the programmed peak (and
  // 0.1 MA), so ITER's first 50 ms of breakdown, where fGW reads 1.5 at
  // 70 kA, raise nothing. Nothing is raised during the programmed ramp-down
  // either: fGW and P_rad/P_in climb there as Ip and heating fall, which the
  // engine treats as normal termination and disarms its trigger for.
  const armed = next.ip >= Math.max(0.1, 0.05 * ipPeak) && !next.disrupted && !ctx.rampDown
  if (armed || ctx.alarms.size > 0) {
    for (const a of ALARMS) {
      const raised = ctx.alarms.has(a.key)
      if (!raised && !armed) { ctx.alarmSince.delete(a.key); continue }
      if (!raised) {
        if (a.on(next)) {
          const since = ctx.alarmSince.get(a.key) ?? next.time
          ctx.alarmSince.set(a.key, since)
          if (next.time - since >= ALARM_DEBOUNCE) {
            ctx.alarms.add(a.key)
            ctx.alarmSince.delete(a.key)
            push(a.severity, a.raise(next))
          }
        } else {
          ctx.alarmSince.delete(a.key)
        }
      } else if (a.off(next)) {
        ctx.alarms.delete(a.key)
        push('info', a.clear)
      }
    }
  }

  // ── Disruption sequence ──
  const phasePrev = prev?.disruption_phase ?? ''
  const phase = next.disruption_phase ?? ''
  if (phase !== phasePrev) {
    if (phase === 'precursor') {
      ctx.disruptionTime = next.time
      // Numbers from the plasma that tripped, not from the quench.
      const at = prev ?? next
      const why = explainDisruption(next.disruption_cause ?? '', at)
      ctx.disruptionLabel = why.label
      // A low hazard means the stochastic trigger fired while this term
      // merely led the others; say so rather than claim a limit was hit.
      const hazard = at.disruption_risk
      const lowHazard = hazard < 0.1 && next.disruption_cause !== 'wall_contact'
      const detail = lowHazard
        ? `The hazard was only ${(hazard * 100).toFixed(1)} %/s; the trigger is stochastic and this term led the others. ${why.action}`
        : `${why.detail} ${why.action}`
      push('major', `DISRUPTION: ${why.label}${lowHazard ? ' (low hazard)' : ''}`, detail)
    } else if (phase === 'thermal_quench') {
      push('major', `Thermal quench, Te0 ${(prev ?? next).te0.toFixed(1)} keV collapsing`)
    } else if (phase === 'current_quench') {
      push('major', `Current quench from ${next.ip.toFixed(2)} MA`)
    } else if (phase === 'complete' && !ctx.terminatedLogged) {
      ctx.terminatedLogged = true
      push('invalid', 'Plasma terminated; equilibrium readouts invalid')
    }
  }

  // ── End of pulse ──
  if (prev && next.status !== prev.status) {
    if (next.status === 'Complete') push('ok', `Pulse complete at ${next.time.toFixed(2)} s`)
    else if (next.status === 'Disrupted') {
      // Small-current disruptions decay below the engine's 10 kA floor before
      // the quench timer runs out, so the terminal line may not have fired.
      if (!ctx.terminatedLogged) {
        ctx.terminatedLogged = true
        push('invalid', 'Plasma terminated; equilibrium readouts invalid')
      }
      // The collapsed strip shows only this last line, so it carries the
      // cause, with the numbers fixed at the trigger.
      const why = explainDisruption(next.disruption_cause ?? '', next)
      const label = ctx.disruptionLabel ?? why.label
      push('major', `Pulse ended by disruption at ${next.time.toFixed(2)} s: ${label}`, why.action || undefined)
    }
  }
}

/* ─── Why did it disrupt ─────────────────────────────────── */

export interface DisruptionExplanation {
  /** Short cause with the number that mattered, e.g. "Density limit, fGW 1.02". */
  label: string
  /** One sentence of physics. */
  detail: string
  /** What an operator would change next pulse. */
  action: string
}

export function explainDisruption(cause: DisruptionCause, s: Snapshot): DisruptionExplanation {
  switch (cause) {
    case 'density_limit':
      return {
        label: `density limit, fGW ${s.f_greenwald.toFixed(2)}`,
        detail: 'The line-averaged density reached the Greenwald limit n_GW = Ip/(πa²); the edge cooled and the current channel contracted until it went MHD unstable.',
        action: 'Reduce the gas puff, or raise Ip before ramping density.',
      }
    case 'beta_limit':
      return {
        label: `β limit, βN ${s.beta_n.toFixed(2)}`,
        detail: 'The plasma pressure exceeded the no-wall Troyon limit (βN ≈ 2.8) and a pressure-driven kink mode grew.',
        action: 'Cut heating power, or raise Ip and Bt to lift the limit.',
      }
    case 'kink_limit':
      return {
        label: `kink limit, q95 ${s.q95.toFixed(2)}`,
        detail: 'q95 fell toward 2, where the external kink mode is unstable.',
        action: 'Reduce Ip or raise Bt so q95 stays above 2.5.',
      }
    case 'radiative_collapse':
      return {
        label: `radiative collapse, P_rad/P_in ${pradFrac(s).toFixed(2)}`,
        detail: 'Radiation took most of the heating power; the edge cooled and the current profile contracted.',
        action: 'Reduce the impurity (neon) puff or add heating power.',
      }
    case 'locked_mode':
      return {
        label: 'locked mode',
        detail: 'A tearing mode grew and locked to the wall. Its baseline rate is small but rises near every operating limit.',
        action: 'Keep more margin to the density, β and q limits.',
      }
    case 'wall_contact':
      return {
        label: 'wall contact',
        detail: 'The last closed flux surface crossed the first wall.',
        action: 'Check the shape program: reduce elongation or triangularity, or keep the gaps larger.',
      }
    default:
      return {
        label: 'cause not recorded',
        detail: '',
        action: '',
      }
  }
}

/** Plain name of a cause for tables and the report. */
export function causeName(cause: DisruptionCause | undefined): string {
  switch (cause) {
    case 'density_limit': return 'density limit'
    case 'beta_limit': return 'β limit'
    case 'kink_limit': return 'kink limit'
    case 'radiative_collapse': return 'radiative collapse'
    case 'locked_mode': return 'locked mode'
    case 'wall_contact': return 'wall contact'
    default: return ''
  }
}

/* ─── Pulse number ───────────────────────────────────────── */

const PULSE_KEY = 'tok-sym-pulse-number'

/** The last pulse number issued on this browser, or 0. */
export function lastPulseNumber(): number {
  try {
    const n = parseInt(localStorage.getItem(PULSE_KEY) ?? '0', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Issue the next pulse number and persist it. */
export function nextPulseNumber(): number {
  const n = lastPulseNumber() + 1
  try {
    localStorage.setItem(PULSE_KEY, String(n))
  } catch {
    /* private mode: the number still counts within this session */
  }
  return n
}

/* ─── End-of-pulse report ────────────────────────────────── */

export interface ReportRow {
  label: string
  programmed?: string
  achieved: string
  /** Color hint: a limit was approached (minor) or exceeded (major). */
  status?: 'ok' | 'minor' | 'major'
}

function interp(waveform: WaveformPoint[] | undefined, t: number): number {
  if (!waveform || waveform.length === 0) return 0
  if (t <= waveform[0][0]) return waveform[0][1]
  const last = waveform[waveform.length - 1]
  if (t >= last[0]) return last[1]
  for (let i = 0; i < waveform.length - 1; i++) {
    const [t0, v0] = waveform[i]
    const [t1, v1] = waveform[i + 1]
    if (t >= t0 && t <= t1) {
      return t1 > t0 ? v0 + ((t - t0) / (t1 - t0)) * (v1 - v0) : v1
    }
  }
  return last[1]
}

export interface ReportInput {
  history: TracePoint[]
  programJson: string
  disrupted: boolean
  cause: DisruptionCause | undefined
  disruptionTime: number | null
  elmCount: number
}

/** Achieved-versus-programmed summary of a finished pulse. */
export function buildReport(input: ReportInput): ReportRow[] {
  const { history, programJson, disrupted, cause, disruptionTime, elmCount } = input
  if (history.length === 0) return []
  let program: PulseProgram | null = null
  try {
    program = JSON.parse(programJson) as PulseProgram
  } catch {
    program = null
  }
  const tEnd = history[history.length - 1].t
  const duration = program?.duration ?? tEnd
  const ipProg = program?.ip ?? []
  const ipPeakProg = ipProg.reduce((m, p) => Math.max(m, p[1]), 0)

  // Time-weighted statistics over the recorded trace.
  const dtOf = (i: number) => (i > 0 ? history[i].t - history[i - 1].t : 0)
  let flatIpSum = 0, flatT = 0
  let tH = 0
  let wMax = 0, betaMax = 0, fgwMax = 0, q95Min = Infinity, pFusMax = 0, qMax = 0
  for (let i = 0; i < history.length; i++) {
    const p = history[i]
    const dt = dtOf(i)
    if (ipPeakProg > 0 && interp(ipProg, p.t) >= 0.98 * ipPeakProg) {
      flatIpSum += p.ip * dt
      flatT += dt
    }
    if (p.in_hmode) tH += dt
    wMax = Math.max(wMax, p.w_th)
    pFusMax = Math.max(pFusMax, p.p_fus)
    if (p.p_input > 0.5) qMax = Math.max(qMax, p.p_fus / p.p_input)
    // Normalised limit quantities are only meaningful with a real current:
    // fGW and βN go to infinity as Ip → 0 at the ends of the pulse.
    if (p.ip >= Math.max(0.1, 0.5 * ipPeakProg)) {
      betaMax = Math.max(betaMax, p.beta_n)
      fgwMax = Math.max(fgwMax, p.f_greenwald)
      q95Min = Math.min(q95Min, p.q95)
    }
  }
  // Without a flat-top, report the highest current the plasma held before any
  // disruption (the thermal-quench spike is not a held current).
  const heldBefore = disruptionTime !== null ? history.filter((p) => p.t < disruptionTime) : history
  const ipFlat = flatT > 0 ? flatIpSum / flatT : heldBefore.reduce((m, p) => Math.max(m, p.ip), 0)

  const rows: ReportRow[] = []
  rows.push({
    label: 'Pulse length',
    programmed: `${duration.toFixed(1)} s`,
    achieved: `${tEnd.toFixed(2)} s`,
    status: disrupted ? 'major' : 'ok',
  })
  rows.push({
    label: 'Ip flat-top',
    programmed: ipPeakProg > 0 ? `${ipPeakProg.toFixed(2)} MA` : undefined,
    achieved: `${ipFlat.toFixed(2)} MA`,
    status: ipPeakProg > 0 && Math.abs(ipFlat - ipPeakProg) > 0.05 * ipPeakProg ? 'minor' : 'ok',
  })
  rows.push({ label: 'Peak W_th', achieved: `${wMax.toFixed(2)} MJ` })
  rows.push({
    label: 'Peak βN',
    achieved: betaMax.toFixed(2),
    status: betaMax > 2.8 ? 'major' : betaMax > 2.5 ? 'minor' : 'ok',
  })
  rows.push({
    label: 'Max fGW',
    achieved: fgwMax.toFixed(2),
    status: fgwMax > 0.95 ? 'major' : fgwMax > 0.8 ? 'minor' : 'ok',
  })
  rows.push({
    label: 'Min q95',
    achieved: Number.isFinite(q95Min) ? q95Min.toFixed(2) : '—',
    status: q95Min < 2.0 ? 'major' : q95Min < 2.5 ? 'minor' : 'ok',
  })
  rows.push({
    label: 'Time in H-mode',
    achieved: tH > 0 ? `${tH.toFixed(2)} s (${pct(tH / Math.max(tEnd, 1e-9))} %)` : 'none',
  })
  rows.push({
    label: 'ELMs',
    achieved: elmCount > 0 ? `${elmCount}${tH > 0 ? `, ${(elmCount / tH).toFixed(elmCount / tH < 10 ? 1 : 0)} Hz` : ''}` : 'none',
  })
  rows.push({
    label: 'Peak P_fus',
    achieved: pFusMax >= 0.001
      ? `${pFusMax >= 1 ? pFusMax.toFixed(1) + ' MW' : (pFusMax * 1000).toFixed(0) + ' kW'}, Q ${qMax >= 0.01 ? qMax.toFixed(2) : '< 0.01'}`
      : '—',
  })
  rows.push({
    label: 'Disruption',
    achieved: disrupted
      ? `${causeName(cause) || 'yes'}${disruptionTime !== null ? ` at ${disruptionTime.toFixed(2)} s` : ''}`
      : 'none',
    status: disrupted ? 'major' : 'ok',
  })
  return rows
}
