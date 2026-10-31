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

export type Phase = 'STANDBY' | 'RAMP-UP' | 'FLAT-TOP' | 'RAMP-DOWN' | 'END' | 'DISRUPT'

export function pulsePhase(win: [number, number] | null, t: number, running: boolean, finished: boolean, snap: Snapshot | null, scrubbing: boolean): Phase {
  if (snap?.disrupted && (!scrubbing || snap.disruption_phase)) return 'DISRUPT'
  if (!running && !finished && t <= 0) return 'STANDBY'
  if (finished && !scrubbing) return 'END'
  if (!win) return 'RAMP-UP'
  if (t < win[0]) return 'RAMP-UP'
  if (t <= win[1]) return 'FLAT-TOP'
  return 'RAMP-DOWN'
}
