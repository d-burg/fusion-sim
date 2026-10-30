import { useEffect, useMemo } from 'react'
import type { ControlRoomContext } from './types'
import type { TracePoint } from '../../lib/types'
import type { PulseProgram, WaveformPoint } from '../../lib/wasm'
import { getDevice } from '../../lib/wasm'
import { computeTargetTraces } from '../../lib/targetTraces'
import EquilibriumCanvas from '../../components/EquilibriumCanvas'
import PortView from '../../components/portview'
import StripChart, { type Series } from './diiid/StripChart'
import SevenSeg from './diiid/SevenSeg'
import StatusGrid from './diiid/StatusGrid'
import Console from './diiid/Console'
import DiagBars from './diiid/DiagBars'
import { useDiagnostics } from './useDiagnostics'
import { reconstructionValid } from '../../lib/pulseLog'
import { formatQ } from '../../lib/fusionPhysics'
import './diiid.css'

// The wall's primaries: chosen for separation on black, not for taste.
const GREEN = '#00ff00', YELLOW = '#ffff00', CYAN = '#00ffff', MAGENTA = '#ff40ff', RED = '#ff3030', WHITE = '#ffffff'

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

const SEV: Record<string, string> = { info: '#bbbbbb', ok: GREEN, minor: YELLOW, major: RED, invalid: MAGENTA }

const clock = (t: number) => Math.max(0, t).toFixed(2).padStart(6, ' ')

export default function Composition({ ctx }: { ctx: ControlRoomContext }) {
  // Black field for the shared canvases (equilibrium) while this layout is up.
  useEffect(() => {
    const el = document.documentElement
    const prev = el.getAttribute('data-theme')
    el.setAttribute('data-theme', 'diiid')
    return () => { if (prev === null) el.removeAttribute('data-theme'); else el.setAttribute('data-theme', prev) }
  }, [])

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
  const snap = ctx.displaySnapshot
  const fluxBudget = snap?.flux_budget ?? 0
  const charts: { title: string; unit?: string; series: Series[]; yMin?: number; yMax?: number }[] = useMemo(() => [
    { title: 'IP', unit: 'MA', series: [{ label: 'Ip', color: GREEN, pts: pick(h, 'ip'), ref: refs?.ip }], yMin: 0 },
    { title: 'DENSV2', unit: '1e20 m-3', series: [{ label: 'ne', color: CYAN, pts: pick(h, 'ne_bar'), ref: refs?.ne }], yMin: 0 },
    { title: 'WMHD', unit: 'MJ', series: [{ label: 'Wth', color: YELLOW, pts: pick(h, 'w_th') }], yMin: 0 },
    { title: 'BETAN', series: [{ label: 'bN', color: MAGENTA, pts: pick(h, 'beta_n'), ref: refs?.betaN }], yMin: 0 },
    { title: 'FS04 D-ALPHA', unit: 'a.u.', series: [{ label: 'Da', color: RED, pts: pick(h, 'd_alpha'), elm: h.map((p) => !!p.elm_active) }], yMin: 0 },
    { title: 'PINJ / PRAD', unit: 'MW', series: [
      { label: 'Pin', color: YELLOW, pts: pick(h, 'p_input'), ref: refs?.pin },
      { label: 'Prad', color: MAGENTA, pts: pick(h, 'p_rad') },
    ], yMin: 0 },
    { title: 'Q95', series: [{ label: 'q95', color: CYAN, pts: pick(h, 'q95') }], yMin: 0, yMax: 10 },
    { title: 'TE0 ECE', unit: 'keV', series: [{ label: 'Te0', color: GREEN, pts: pick(h, 'te0') }], yMin: 0 },
    { title: 'VLOOP', unit: 'V', series: [{ label: 'Vl', color: WHITE, pts: pick(h, 'v_loop') }] },
    { title: 'LI', series: [{ label: 'li', color: YELLOW, pts: pick(h, 'li') }], yMin: 0, yMax: 1.5 },
    { title: 'H98Y2', series: [{ label: 'H98', color: GREEN, pts: pick(h, 'h_factor') }], yMin: 0 },
    { title: 'PSI OH', unit: 'V·s', series: [{ label: 'psi', color: CYAN, pts: pick(h, 'psi_oh'), ref: fluxBudget > 0 ? [[0, fluxBudget], [T, fluxBudget]] : undefined }], yMin: 0 },
    { title: 'FGW', series: [{ label: 'fGW', color: YELLOW, pts: pick(h, 'f_greenwald'), ref: [[0, 1], [T, 1]] }], yMin: 0 },
    { title: 'TE PED', unit: 'keV', series: [{ label: 'Tped', color: MAGENTA, pts: pick(h, 'te_ped') }], yMin: 0 },
    { title: 'I NI', unit: 'MA', series: [{ label: 'Ini', color: GREEN, pts: pick(h, 'i_ni') }], yMin: 0 },
    { title: 'DISRUPT HAZARD', unit: '1/s', series: [{ label: 'h', color: RED, pts: pick(h, 'disruption_risk') }], yMin: 0 },
  // history is mutated in place by the simulation hook, so key the memo on its length and last time, not its identity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [h, h.length, h.length ? h[h.length - 1].t : 0, refs, fluxBudget, T])

  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const onScrub = ctx.finished ? ctx.controls.setScrubTime : undefined
  const pulse = ctx.pulseNumber === null ? '      ' : String(ctx.pulseNumber).padStart(6, ' ')
  const remaining = ctx.duration - ctx.time
  const lastEvents = ctx.events.slice(-4).reverse()
  // The green monospace scalar block under the status table, as on the wall's big screen.
  const f = (v: number | undefined, d = 2) => (v === undefined || !isFinite(v) ? '--' : v.toFixed(d))
  // Readouts that the wall already plots (NEBAR, WTH, TE0, LI) are left to the strip charts; the divertor and neutron
  // figures come from the shared diagnostics so they agree with every other look.
  const diag = useDiagnostics(snap, reconstructionValid(snap))
  const readout: [string, string, string][] = snap ? [
    ['Ip', f(snap.ip), 'MA'], ['Bt', f(snap.bt), 'T'],
    ['Pin', f(snap.p_input, 1), 'MW'], ['POH', f(snap.p_ohmic), 'MW'],
    ['Prad', f(snap.p_rad), 'MW'], ['Pα', f(snap.p_alpha, 3), 'MW'],
    ['βN', f(snap.beta_n), ''], ['q95', f(snap.q95), ''],
    ['Pfus', diag.pFus > 0.001 ? f(diag.pFus, diag.pFus < 10 ? 3 : 1) : '--', 'MW'], ['Q', diag.rate > 0 ? formatQ(diag.qPlasma) : '--', ''],
    ['λq', diag.valid ? f(diag.lambdaQ, 1) : '--', 'mm'], ['fdet', diag.valid ? f(diag.fDet) : '--', ''],
  ] : []
  // ELM activity is a transient flag: hold it for the last 0.3 s of history so the cell reads ELMING, not a flicker.
  let elming = false
  for (let i = h.length - 1; i >= 0 && h[i].t > ctx.time - 0.3; i--) if (h[i].elm_active) { elming = true; break }

  return (
    <div data-layout="diiid" className="dc-root">
      <div className="dc-wall">
        <div className="dc-tile dc-eq">
          <EquilibriumCanvas snapshot={snap} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
          <span className="dc-tile-title">EFIT01</span>
        </div>
        {charts.map((c) => (
          <StripChart
            key={c.title}
            title={c.title}
            unit={c.unit}
            series={c.series}
            tMax={T}
            yMin={c.yMin}
            yMax={c.yMax}
            scrubTime={ctx.scrubTime}
            liveTime={ctx.time}
            onScrub={onScrub}
          />
        ))}
      </div>

      <div className="dc-side">
        <div className="dc-clock">
          <div className="dc-clock-row">
            <span className="dc-clock-k">SHOT</span>
            <SevenSeg text={pulse} color={CYAN} size={44} />
          </div>
          <div className="dc-clock-row dc-clock-small">
            <span className="dc-clock-k">T+</span>
            <SevenSeg text={clock(ctx.time)} color={GREEN} size={26} />
            <span className="dc-clock-k">T−</span>
            <SevenSeg text={clock(remaining)} color={ctx.finished ? RED : YELLOW} size={26} />
            <span className="dc-clock-k dc-clock-dev">{dev?.name ?? ctx.activeDevice}</span>
          </div>
        </div>

        <StatusGrid snapshot={snap} running={ctx.running} fuel={ctx.fuelType} elming={elming} />

        <div className="dc-text">
          {readout.map(([k, v, u]) => (
            <div key={k} className="dc-text-row"><span>{k}</span><span>{v}</span><span>{u}</span></div>
          ))}
          {snap && <DiagBars d={diag} />}
        </div>

        <div className="dc-tile dc-cam">
          <PortView
            snapshot={ctx.plasmaSnapshot}
            limiterPoints={ctx.limiterPoints}
            deviceId={ctx.activeDevice}
            wallJson={ctx.wallJson}
            deviceR0={dev?.r0}
            deviceA={dev?.a}
          />
        </div>
      </div>

      <div className="dc-ticker">
        <span className="dc-ticker-k">{ctx.pulseNumber !== null ? `#${ctx.pulseNumber}` : '--'}</span>
        {ctx.finished && ctx.report
          ? ctx.report.slice(0, 8).map((r, i) => (
            <span key={i} className="dc-ev" style={{ color: r.status === 'major' ? RED : r.status === 'minor' ? YELLOW : '#bbbbbb' }}>
              {r.label} {r.achieved}{r.programmed ? ` / ${r.programmed}` : ''}
            </span>
          ))
          : lastEvents.map((e) => (
            <span key={e.id} className="dc-ev" style={{ color: SEV[e.severity] ?? '#bbbbbb' }}>
              {e.t.toFixed(3)} {e.text}
            </span>
          ))}
      </div>

      <Console ctx={ctx} />

      {ctx.plannerNode}
      {ctx.tutorialNode}
    </div>
  )
}
