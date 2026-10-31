import type { Snapshot } from '../../../lib/types'

export type Waveform = [number, number][]

export function parseProgram(programJson: string): Record<string, Waveform> {
  try {
    const p = JSON.parse(programJson || '{}')
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

export function interpWaveform(w: Waveform | undefined, t: number): number | null {
  if (!w || w.length === 0) return null
  if (t <= w[0][0]) return w[0][1]
  const last = w[w.length - 1]
  if (t >= last[0]) return last[1]
  for (let i = 1; i < w.length; i++) {
    if (t <= w[i][0]) {
      const [t0, v0] = w[i - 1]
      const [t1, v1] = w[i]
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0
      return v0 + f * (v1 - v0)
    }
  }
  return last[1]
}

/** Flat-top window [start, end] of the programmed Ip, at 97 % of its peak. */
export function flatTopWindow(ip: Waveform | undefined): [number, number] | null {
  if (!ip || ip.length < 2) return null
  const peak = Math.max(...ip.map((p) => p[1]))
  if (peak <= 0) return null
  const thr = 0.97 * peak
  let start: number | null = null
  let end: number | null = null
  for (let i = 1; i < ip.length; i++) {
    const [t0, v0] = ip[i - 1]
    const [t1, v1] = ip[i]
    if (start === null && v0 < thr && v1 >= thr) start = t0 + ((thr - v0) / (v1 - v0)) * (t1 - t0)
    if (start === null && v0 >= thr) start = t0
    if (v0 >= thr && v1 < thr) end = t0 + ((v0 - thr) / (v0 - v1)) * (t1 - t0)
  }
  if (start === null) return null
  if (end === null) end = ip[ip.length - 1][0]
  return [start, end]
}

export type Phase = 'STANDBY' | 'RAMP-UP' | 'FLAT-TOP' | 'RAMP-DOWN' | 'END' | 'DISRUPTED'

export function pulsePhase(
  programJson: string,
  t: number,
  running: boolean,
  finished: boolean,
  snap: Snapshot | null,
  scrubbing: boolean,
): Phase {
  if (snap?.disrupted && (!scrubbing || snap.disruption_phase)) return 'DISRUPTED'
  if (!running && !finished && t <= 0) return 'STANDBY'
  const win = flatTopWindow(parseProgram(programJson).ip)
  if (finished && !scrubbing) return 'END'
  if (!win) return 'RAMP-UP'
  if (t < win[0]) return 'RAMP-UP'
  if (t <= win[1]) return 'FLAT-TOP'
  return 'RAMP-DOWN'
}

/** mm:ss.mmm, clamped at zero. */
export function clock(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rem = s - m * 60
  const whole = Math.floor(rem)
  const ms = Math.floor((rem - whole) * 1000)
  return `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

// The CRT has no subscripts: report symbols take the telemetry column's names, the words are in caps.
const CRT_SYM: Record<string, string> = { 'V_loop': 'Vloop', 'W_th': 'Wth', 'P_fus': 'Pfus', 'βN': 'βN', 'fGW': 'fGW', 'q95': 'q95', 'Ip': 'Ip' }

/** A report label as the CRT prints it, e.g. "Peak W_th" → "PEAK Wth". */
export const crtLabel = (label: string) => label.split(' ').map((w) => CRT_SYM[w] ?? w.toUpperCase()).join(' ')
