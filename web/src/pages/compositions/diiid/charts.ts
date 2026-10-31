import { useMemo } from 'react'
import type { ControlRoomContext } from '../types'
import type { TracePoint } from '../../../lib/types'
import type { PulseProgram, WaveformPoint } from '../../../lib/wasm'
import { getDevice } from '../../../lib/wasm'
import { computeTargetTraces } from '../../../lib/targetTraces'
import type { Series } from './StripChart'

// The wall's primaries: chosen for separation on black, not for taste.
export const GREEN = '#00ff00', YELLOW = '#ffff00', CYAN = '#00ffff', MAGENTA = '#ff40ff', RED = '#ff3030', WHITE = '#ffffff'

export interface WallChart { id: string; title: string; unit?: string; series: Series[]; yMin?: number; yMax?: number }

const pick = (h: TracePoint[], k: keyof TracePoint): [number, number][] =>
  h.map((p) => [p.t, Number(p[k])] as [number, number])

function sumWaveforms(ws: (WaveformPoint[] | undefined)[], T: number): [number, number][] {
  const ts = new Set<number>([0, T])
  for (const w of ws) if (w) for (const [t] of w) ts.add(t)
  const times = [...ts].sort((a, b) => a - b)
  const at = (w: WaveformPoint[] | undefined, t: number) => {
    if (!w || !w.length) return 0
    if (t <= w[0][0]) return w[0][1]
    if (t >= w[w.length - 1][0]) return w[w.length - 1][1]
    for (let i = 0; i < w.length - 1; i++) {
      const [t0, v0] = w[i], [t1, v1] = w[i + 1]
      if (t >= t0 && t <= t1) return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)
    }
    return w[w.length - 1][1]
  }
  return times.map((t) => [t, ws.reduce((s, w) => s + at(w, t), 0)])
}

/**
 * Phone trace channels, keyed as stored in `phoneTraces` (TracePoint field of the
 * primary signal). The order is the order of the + TRACES list.
 */
export const PHONE_CHANNELS: { key: string; label: string }[] = [
  { key: 'ip', label: 'IP' },
  { key: 'w_th', label: 'WMHD' },
  { key: 'd_alpha', label: 'D-ALPHA' },
  { key: 'ne_bar', label: 'DENSV2 / FGW' },
  { key: 'p_input', label: 'PINJ / PRAD' },
  { key: 'beta_n', label: 'BETAN' },
  { key: 'q95', label: 'Q95' },
  { key: 'v_loop', label: 'VLOOP' },
  { key: 'te0', label: 'TE0 ECE' },
  { key: 'tau_e', label: 'TAUE' },
  { key: 'h_factor', label: 'H98Y2' },
  { key: 'psi_oh', label: 'PSI OH' },
  { key: 'disruption_risk', label: 'HAZARD' },
  { key: 'li', label: 'LI' },
  { key: 'te_ped', label: 'TE PED' },
  { key: 'i_ni', label: 'I NI' },
]

/** The wall's strip charts (desktop order) and the phone channels built from the same series. */
export function useWallCharts(ctx: ControlRoomContext) {
  const T = ctx.duration > 0 ? ctx.duration : 10
  const refs = useMemo(() => {
    try {
      const p: PulseProgram = JSON.parse(ctx.programJson)
      if (!p.ip) return null
      const dev = getDevice(ctx.activeDevice)
      const tt = dev ? computeTargetTraces(p, dev) : null
      return {
        ip: p.ip, ne: p.ne_target, pin: sumWaveforms([p.p_nbi, p.p_ech, p.p_ich], p.duration || T),
        betaN: tt?.betaNTarget ?? undefined,
      }
    } catch { return null }
  }, [ctx.programJson, ctx.activeDevice, T])

  const h = ctx.history
  const fluxBudget = ctx.displaySnapshot?.flux_budget ?? 0
  const charts: WallChart[] = useMemo(() => [
    { id: 'ip', title: 'IP', unit: 'MA', series: [{ label: 'Ip', color: GREEN, pts: pick(h, 'ip'), ref: refs?.ip }], yMin: 0 },
    { id: 'ne', title: 'DENSV2', unit: '1e20 m-3', series: [{ label: 'ne', color: CYAN, pts: pick(h, 'ne_bar'), ref: refs?.ne }], yMin: 0 },
    { id: 'w_th', title: 'WMHD', unit: 'MJ', series: [{ label: 'Wth', color: YELLOW, pts: pick(h, 'w_th') }], yMin: 0 },
    { id: 'beta_n', title: 'BETAN', series: [{ label: 'bN', color: MAGENTA, pts: pick(h, 'beta_n'), ref: refs?.betaN }], yMin: 0 },
    { id: 'd_alpha', title: 'FS04 D-ALPHA', unit: 'a.u.', series: [{ label: 'Da', color: RED, pts: pick(h, 'd_alpha'), elm: h.map((p) => !!p.elm_active) }], yMin: 0 },
    { id: 'p_input', title: 'PINJ / PRAD', unit: 'MW', series: [
      { label: 'Pin', color: YELLOW, pts: pick(h, 'p_input'), ref: refs?.pin },
      { label: 'Prad', color: MAGENTA, pts: pick(h, 'p_rad') },
    ], yMin: 0 },
    { id: 'q95', title: 'Q95', series: [{ label: 'q95', color: CYAN, pts: pick(h, 'q95') }], yMin: 0, yMax: 10 },
    { id: 'te0', title: 'TE0 ECE', unit: 'keV', series: [{ label: 'Te0', color: GREEN, pts: pick(h, 'te0') }], yMin: 0 },
    { id: 'v_loop', title: 'VLOOP', unit: 'V', series: [{ label: 'Vl', color: WHITE, pts: pick(h, 'v_loop') }] },
    { id: 'li', title: 'LI', series: [{ label: 'li', color: YELLOW, pts: pick(h, 'li') }], yMin: 0, yMax: 1.5 },
    { id: 'h_factor', title: 'H98Y2', series: [{ label: 'H98', color: GREEN, pts: pick(h, 'h_factor') }], yMin: 0 },
    { id: 'psi_oh', title: 'PSI OH', unit: 'V·s', series: [{ label: 'psi', color: CYAN, pts: pick(h, 'psi_oh'), ref: fluxBudget > 0 ? [[0, fluxBudget], [T, fluxBudget]] : undefined }], yMin: 0 },
    { id: 'fgw', title: 'FGW', series: [{ label: 'fGW', color: YELLOW, pts: pick(h, 'f_greenwald'), ref: [[0, 1], [T, 1]] }], yMin: 0 },
    { id: 'te_ped', title: 'TE PED', unit: 'keV', series: [{ label: 'Tped', color: MAGENTA, pts: pick(h, 'te_ped') }], yMin: 0 },
    { id: 'i_ni', title: 'I NI', unit: 'MA', series: [{ label: 'Ini', color: GREEN, pts: pick(h, 'i_ni') }], yMin: 0 },
    { id: 'disruption_risk', title: 'HAZARD', unit: '%/s', series: [{ label: 'h', color: RED, pts: h.map((p) => [p.t, p.disruption_risk * 100] as [number, number]) }], yMin: 0 },
  // history is mutated in place by the simulation hook, so key the memo on its length and last time, not its identity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [h, h.length, h.length ? h[h.length - 1].t : 0, refs, fluxBudget, T])

  /** Phone channels: the wall's charts by key, plus the two the phone pairs or derives. */
  const phone: Record<string, WallChart> = useMemo(() => {
    const byId: Record<string, WallChart> = {}
    for (const c of charts) byId[c.id] = c
    byId.ne_bar = { id: 'ne_bar', title: 'DENSV2 / FGW', series: [
      { label: 'ne', color: CYAN, pts: pick(h, 'ne_bar'), ref: refs?.ne },
      { label: 'fGW', color: YELLOW, pts: pick(h, 'f_greenwald') },
    ], yMin: 0 }
    byId.tau_e = { id: 'tau_e', title: 'TAUE', unit: 's', series: [
      { label: 'tauE', color: GREEN, pts: h.map((p) => [p.t, p.p_loss > 0.01 ? p.w_th / p.p_loss : 0] as [number, number]) },
    ], yMin: 0 }
    return byId
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charts])

  return { T, charts, phone }
}
