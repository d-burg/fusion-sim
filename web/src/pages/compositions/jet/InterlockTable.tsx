import { useState, type ReactNode } from 'react'
import type { Snapshot } from '../../../lib/types'
import type { DeviceInfo } from '../types'
import { reconstructionValid } from '../../../lib/pulseLog'
import { formatQ } from '../../../lib/fusionPhysics'
import { q95Disp } from '../Fixed'
import { betaLimit, BETA_WARN_FRAC, fmtHazard, hazardPct, HAZARD_BAD, HAZARD_WARN, useDiagnostics, type Diagnostics, type DiagTone } from '../useDiagnostics'

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
  q_perp: 'Divertor heat flux', lambdaQ: <>λ<sub>q</sub></>, fDet: <>f<sub>det</sub></>, T_surf: 'Surface temperature', Sn: 'Neutrons', Pfus: <>P<sub>fus</sub></>,
  Wth: <>W<sub>th</sub></>, Vloop: <>V<sub>loop</sub></>, PsiOH: <>Ψ<sub>OH</sub></>, Zeff: <>Z<sub>eff</sub></>, hazard: 'Hazard',
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
      na('q_perp', 'MW/m2'), na('lambdaQ', 'mm'), na('fDet', ''), ...(d.isW ? [na('T_surf', '°C')] : []), na('Sn', 'n/s'), na('Pfus', 'MW'), na('Q', ''),
      na('Vloop', 'V'), na('PsiOH', 'V·s'), na('Zeff', ''), na('hazard', '%/s'),
    ]
  }
  const ipMax = dev?.ip_max ?? Infinity
  const btMax = dev?.bt_max ?? Infinity
  // Ip against this pulse's programmed flat-top (the device maximum when there is none): HIGH from 1.0 of it
  // only where that is past 1.02 of the machine maximum, ALARM only past 1.02 of the maximum. The presets run
  // at ip_max and bt_max by design, which is not an interlock condition.
  const ipProg = (s.prog_ip_peak ?? 0) > 0 ? (s.prog_ip_peak as number) : ipMax
  // ALARM above the machine maximum; HIGH when the current overshoots its program by 2 %.
  const ipState = (ip: number): State => (ip > 1.02 * ipMax ? 'alarm' : ip > 1.02 * ipProg ? 'hi' : 'ok')
  const fluxBudget = s.flux_budget ?? dev?.flux_swing_vs
  const fluxUsed = s.flux_consumed ?? 0
  const fluxFrac = fluxBudget ? fluxUsed / fluxBudget : 0
  const vMax = dev?.v_loop_max
  const betaLim = betaLimit(s)
  const st = (x: State): State => (plasma ? x : 'na')
  /** Reconstructed quantities mean nothing without a plasma. */
  const fp = (v: number | undefined, d: number): string => (plasma ? f(v, d) : '---')
  return [
    { name: 'Ip', value: f(s.ip, 2), unit: 'MA', state: s.disrupted ? 'alarm' : s.ip > 0.05 ? ipState(s.ip) : 'off' },
    { name: 'Bt', value: f(s.bt, 2), unit: 'T', state: s.bt > 0.05 ? (s.bt > 1.02 * btMax ? 'hi' : 'ok') : 'off' },
    { name: 'ne', value: f(s.ne_bar, 2), unit: '1e20 m-3', state: st('ok') },
    { name: 'fGW', value: fp(s.f_greenwald, 2), unit: '', state: st(band(s.f_greenwald, 0.8, 1.0)) },
    { name: 'tauE', value: fp(s.tau_e, 3), unit: 's', state: st('ok') },
    { name: 'H98', value: fp(s.h_factor, 2), unit: '', state: st(s.h_factor < 0.6 ? 'lo' : 'ok') },
    { name: 'betaN', value: fp(s.beta_n, 2), unit: '', state: st(band(s.beta_n / betaLim, BETA_WARN_FRAC, 1.0)) },
    { name: 'q95', value: fp(q95Disp(s.q95), 2), unit: '', state: st(band(s.q95, 2.5, 2.0, 'lo')) },
    { name: 'li', value: fp(s.li, 2), unit: '', state: st(band(s.li, 1.2, 1.5)) },
    { name: 'Pin', value: f(s.p_input, 1), unit: 'MW', state: st('ok') },
    { name: 'POH', value: f(s.p_ohmic, 2), unit: 'MW', state: st('ok') },
    { name: 'Prad', value: f(s.p_rad, 1), unit: 'MW', state: st(s.p_input > 0 ? band(s.p_rad / s.p_input, 0.6, 0.9) : 'ok') },
    // Te0, Wth, Ploss and Palpha are left out for room: Te0 and Wth are always-OK rows the jScope already plots,
    // Pin and Prad bracket the power balance, and Pfus carries the fusion power.
    // the divertor rows name their regime in the state cell, as the other looks do
    { name: 'q_perp', value: f(d.q, 1), unit: 'MW/m2', state: st(toneState(d.qTone)), bar: plasma ? d.qFill : undefined, word: plasma && d.regime !== '—' ? d.regime : undefined },
    { name: 'lambdaQ', value: plasma && d.valid ? f(d.lambdaQ, 1) : '---', unit: 'mm', state: st('ok') },
    { name: 'fDet', value: plasma && d.valid ? f(d.fDet, 2) : '---', unit: '', state: st(toneState(d.regimeTone)) },
    ...(d.isW ? [{ name: 'T_surf', value: f(d.tSurf, 0), unit: '°C', state: st(toneState(d.tTone)), bar: plasma ? d.tFill : undefined, word: plasma ? d.tWord : undefined }] : []),
    { name: 'Sn', value: d.rate > 0 ? d.rate.toExponential(2).replace('+', '') : '0', unit: 'n/s', state: st(d.active ? 'ok' : 'off'), word: plasma && !d.active ? d.nWord : undefined, bar: plasma ? d.nFill : undefined },
    { name: 'Pfus', value: f(d.pFus, d.pFus < 10 ? 3 : 1), unit: 'MW', state: st('ok') },
    { name: 'Q', value: d.qPlasma === null ? '---' : d.rate > 0 ? formatQ(d.qPlasma) : '0', unit: '', state: st('ok') },
    { name: 'Vloop', value: f(s.v_loop, 2), unit: 'V', state: st(vMax ? band(Math.abs(s.v_loop ?? 0) / vMax, 0.9, 0.999) : 'ok'), word: s.oh_saturated ? 'SATURATED' : undefined },
    { name: 'PsiOH', value: fluxBudget ? `${fluxUsed.toFixed(1)}/${fluxBudget.toFixed(0)}` : f(fluxUsed, 1), unit: 'V·s', state: s.flux_exhausted ? 'alarm' : st(band(fluxFrac, 0.8, 0.95)), word: s.flux_exhausted ? 'FLUX EXHAUSTED' : undefined },
    { name: 'Zeff', value: f(s.z_eff, 2), unit: '', state: st(band(s.z_eff ?? 1, 2.5, 4)) },
    { name: 'hazard', value: fmtHazard(s.disruption_risk, '---'), unit: '%/s', state: s.disrupted ? 'alarm' : st(band(hazardPct(s.disruption_risk), HAZARD_WARN, HAZARD_BAD)), word: s.disrupted ? 'DISRUPTED' : undefined },
  ]
}

function Cells({ r }: { r: Row }) {
  return (
    <>
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
      <td className={`state state-${r.state}${(r.word ?? '').length > 10 ? ' state-long' : ''}`}>{r.word ?? WORD[r.state]}</td>
    </>
  )
}

/** Phone order: the three diagnostics rows and the divertor/fusion rows first, then the six essential scalars. */
const PHONE_TOP = ['q_perp', 'T_surf', 'Sn', 'lambdaQ', 'fDet', 'Pfus', 'Q', 'hazard', 'Ip', 'ne', 'Wth', 'betaN', 'q95', 'fGW']
const DIAG = new Set(['q_perp', 'T_surf', 'Sn'])

/** The compact table for phones: essential rows, then a MORE row that expands the rest. */
export function PhoneInterlockTable({ snapshot, device, extra }: { snapshot: Snapshot | null; device: DeviceInfo | undefined; extra?: ReactNode }) {
  const [more, setMore] = useState(false)
  const diag = useDiagnostics(snapshot, reconstructionValid(snapshot))
  const s = snapshot
  const plasma = !!s && s.ip > 0.05 && !s.disrupted
  const all = buildRows(s, device, diag)
  all.push({ name: 'Wth', value: s ? f(s.w_th, 2) : '---', unit: 'MJ', state: s ? (plasma ? 'ok' : 'na') : 'na' })
  const by = new Map(all.map((r) => [r.name, r]))
  const top = PHONE_TOP.map((n) => by.get(n)).filter((r): r is Row => !!r)
  const rest = all.filter((r) => !PHONE_TOP.includes(r.name))
  return (
    <table className="jet-table jet-table-phone">
      <colgroup><col className="c-sig" /><col className="c-val" /><col className="c-unit" /><col className="c-state" /></colgroup>
      <thead>
        <tr>
          <th>Signal</th>
          <th className="num">Value</th>
          <th>Unit</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => <tr key={r.name} className={DIAG.has(r.name) ? 'diag' : undefined}><Cells r={r} /></tr>)}
        <tr className="jet-more-row">
          <td colSpan={4}>
            <span className="jet-more-in">
              {extra}
              <span className="jet-grow" />
              <button className="jet-btn jet-pbtn" aria-expanded={more} onClick={() => setMore(!more)}>
                {more ? 'Less' : `More (${rest.length})`}
              </button>
            </span>
          </td>
        </tr>
        {more && rest.map((r) => <tr key={r.name}><Cells r={r} /></tr>)}
      </tbody>
    </table>
  )
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
        {rows.map((r) => <tr key={r.name}><Cells r={r} /></tr>)}
      </tbody>
    </table>
  )
}
