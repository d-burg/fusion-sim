import type { ReactNode } from 'react'
import type { Snapshot } from '../../../lib/types'
import type { DeviceInfo } from '../types'
import { reconstructionValid } from '../../../lib/pulseLog'
import { formatQ } from '../../../lib/fusionPhysics'
import { useDiagnostics, type Diagnostics, type DiagTone } from '../useDiagnostics'

/* ─── Spreadsheet-style scalar / interlock table ──────────────────
   name | value | unit | state. The state cell is a coloured block the
   way JET's vacuum and interlock tables show OK in green; amber when a
   quantity approaches a limit, red when it is over one. No plasma means
   the state cell is blank gray (the readout has no meaning). */

type State = 'ok' | 'hi' | 'lo' | 'alarm' | 'off' | 'na'

interface Row {
  name: string
  value: string
  unit: string
  state: State
  /** Printed in the state cell; defaults by state. */
  word?: string
  /** 0–1: an Excel-style data bar behind the value, filled in the state colour. */
  bar?: number
}

const WORD: Record<State, string> = { ok: 'OK', hi: 'HIGH', lo: 'LOW', alarm: 'ALARM', off: 'OFF', na: '' }

/** How each row's signal name is set: symbols with real subscripts, the diagnostics written out. */
const LABEL: Record<string, ReactNode> = {
  Ip: <>I<sub>p</sub></>, Bt: <>B<sub>t</sub></>, ne: <>n<sub>e</sub></>, fGW: <>f<sub>GW</sub></>,
  tauE: <>τ<sub>E</sub></>, H98: <>H<sub>98</sub></>, betaN: <>β<sub>N</sub></>, q95: <>q<sub>95</sub></>, li: <>l<sub>i</sub></>,
  Pin: <>P<sub>in</sub></>, POH: <>P<sub>OH</sub></>, Prad: <>P<sub>rad</sub></>,
  q_perp: 'Divertor heat flux', T_surf: 'Surface temperature', Sn: 'Neutrons', Pfus: <>P<sub>fus</sub></>,
  Vloop: <>V<sub>loop</sub></>, PsiOH: <>Ψ<sub>OH</sub></>, Zeff: <>Z<sub>eff</sub></>, hazard: 'Hazard',
}

function f(v: number | undefined, d: number): string {
  return v === undefined || !isFinite(v) ? '---' : v.toFixed(d)
}

function band(v: number, warn: number, alarm: number, dir: 'hi' | 'lo' = 'hi'): State {
  if (dir === 'hi') return v >= alarm ? 'alarm' : v >= warn ? 'hi' : 'ok'
  return v <= alarm ? 'alarm' : v <= warn ? 'lo' : 'ok'
}

const toneState = (t: DiagTone): State => (t === 'bad' ? 'alarm' : t === 'warn' ? 'hi' : 'ok')

function buildRows(s: Snapshot | null, dev: DeviceInfo | undefined, d: Diagnostics): Row[] {
  const plasma = !!s && s.ip > 0.05 && !s.disrupted
  const na = (name: string, unit: string, value = '---'): Row => ({ name, value, unit, state: 'na' })
  if (!s) {
    return [
      na('Ip', 'MA'), na('Bt', 'T'), na('ne', '1e20 m-3'), na('fGW', ''),
      na('tauE', 's'), na('H98', ''), na('betaN', ''), na('q95', ''), na('li', ''),
      na('Pin', 'MW'), na('POH', 'MW'), na('Prad', 'MW'),
      na('q_perp', 'MW/m2'), ...(d.isW ? [na('T_surf', '°C')] : []), na('Sn', 'n/s'), na('Pfus', 'MW'), na('Q', ''),
      na('Vloop', 'V'), na('PsiOH', 'V·s'), na('Zeff', ''), na('hazard', '1/s'),
    ]
  }
  const ipMax = dev?.ip_max ?? Infinity
  const btMax = dev?.bt_max ?? Infinity
  const fluxBudget = s.flux_budget ?? dev?.flux_swing_vs
  const fluxUsed = s.flux_consumed ?? 0
  const fluxFrac = fluxBudget ? fluxUsed / fluxBudget : 0
  const vMax = dev?.v_loop_max
  const betaLim = 4 * Math.max(s.li, 0.5)
  const st = (x: State): State => (plasma ? x : 'na')
  /** Reconstructed quantities mean nothing without a plasma. */
  const fp = (v: number | undefined, d: number): string => (plasma ? f(v, d) : '---')
  return [
    { name: 'Ip', value: f(s.ip, 2), unit: 'MA', state: s.disrupted ? 'alarm' : s.ip > 0.05 ? band(s.ip / ipMax, 0.9, 1.0) : 'off' },
    { name: 'Bt', value: f(s.bt, 2), unit: 'T', state: s.bt > 0.05 ? band(s.bt / btMax, 0.95, 1.001) : 'off' },
    { name: 'ne', value: f(s.ne_bar, 2), unit: '1e20 m-3', state: st('ok') },
    { name: 'fGW', value: fp(s.f_greenwald, 2), unit: '', state: st(band(s.f_greenwald, 0.8, 1.0)) },
    { name: 'tauE', value: fp(s.tau_e, 3), unit: 's', state: st('ok') },
    { name: 'H98', value: fp(s.h_factor, 2), unit: '', state: st(s.h_factor < 0.6 ? 'lo' : 'ok') },
    { name: 'betaN', value: fp(s.beta_n, 2), unit: '', state: st(band(s.beta_n / betaLim, 0.8, 1.0)) },
    { name: 'q95', value: fp(s.q95, 2), unit: '', state: st(band(s.q95, 2.5, 2.0, 'lo')) },
    { name: 'li', value: fp(s.li, 2), unit: '', state: st(band(s.li, 1.2, 1.5)) },
    { name: 'Pin', value: f(s.p_input, 1), unit: 'MW', state: st('ok') },
    { name: 'POH', value: f(s.p_ohmic, 2), unit: 'MW', state: st('ok') },
    { name: 'Prad', value: f(s.p_rad, 1), unit: 'MW', state: st(s.p_input > 0 ? band(s.p_rad / s.p_input, 0.6, 0.9) : 'ok') },
    // Te0, Wth, Ploss and Palpha are left out for room: Te0 and Wth are always-OK rows the jScope already plots,
    // Pin and Prad bracket the power balance, and Pfus carries the fusion power.
    { name: 'q_perp', value: f(d.q, 1), unit: 'MW/m2', state: st(toneState(d.qTone)), bar: plasma ? d.qFill : undefined },
    ...(d.isW ? [{ name: 'T_surf', value: f(d.tSurf, 0), unit: '°C', state: st(toneState(d.tTone)), bar: plasma ? d.tFill : undefined }] : []),
    { name: 'Sn', value: d.rate > 0 ? d.rate.toExponential(2).replace('+', '') : '0', unit: 'n/s', state: st(d.active ? 'ok' : 'off'), word: plasma && !d.active ? 'IDLE' : undefined, bar: plasma ? d.nFill : undefined },
    { name: 'Pfus', value: f(d.pFus, d.pFus < 10 ? 3 : 1), unit: 'MW', state: st('ok') },
    { name: 'Q', value: d.rate > 0 ? formatQ(d.qPlasma) : '0', unit: '', state: st('ok') },
    { name: 'Vloop', value: f(s.v_loop, 2), unit: 'V', state: st(vMax ? band(Math.abs(s.v_loop ?? 0) / vMax, 0.9, 0.999) : 'ok'), word: s.oh_saturated ? 'SATURATED' : undefined },
    { name: 'PsiOH', value: fluxBudget ? `${fluxUsed.toFixed(1)}/${fluxBudget.toFixed(0)}` : f(fluxUsed, 1), unit: 'V·s', state: s.flux_exhausted ? 'alarm' : st(band(fluxFrac, 0.8, 0.95)), word: s.flux_exhausted ? 'EMPTY' : undefined },
    { name: 'Zeff', value: f(s.z_eff, 2), unit: '', state: st(band(s.z_eff ?? 1, 2.5, 4)) },
    { name: 'hazard', value: f(s.disruption_risk, 3), unit: '1/s', state: s.disrupted ? 'alarm' : st(band(s.disruption_risk, 0.05, 0.2)), word: s.disrupted ? 'DISRUPTED' : undefined },
  ]
}

export default function InterlockTable({ snapshot, device }: { snapshot: Snapshot | null; device: DeviceInfo | undefined }) {
  const diag = useDiagnostics(snapshot, reconstructionValid(snapshot))
  const rows = buildRows(snapshot, device, diag)
  return (
    <table className="jet-table">
      <thead>
        <tr>
          <th>Signal</th>
          <th className="num">Value</th>
          <th>Unit</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td className="sig">{LABEL[r.name] ?? r.name}</td>
            <td className="num">
              {r.bar === undefined ? r.value : (
                <span className="databar">
                  <span className={`databar-fill state-${r.state}`} style={{ width: `${Math.max(0, Math.min(1, r.bar)) * 100}%` }} />
                  <span className="databar-v">{r.value}</span>
                </span>
              )}
            </td>
            <td className="unit">{r.unit}</td>
            <td className={`state state-${r.state}`}>{r.word ?? WORD[r.state]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
