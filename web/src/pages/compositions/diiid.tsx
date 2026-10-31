import { useEffect } from 'react'
import type { ControlRoomContext } from './types'
import EquilibriumCanvas from '../../components/EquilibriumCanvas'
import PortView from '../../components/portview'
import StripChart from './diiid/StripChart'
import SevenSeg from './diiid/SevenSeg'
import StatusGrid from './diiid/StatusGrid'
import Console from './diiid/Console'
import DiagBars from './diiid/DiagBars'
import Phone from './diiid/Phone'
import { useWallCharts, GREEN, YELLOW, CYAN, RED, MAGENTA } from './diiid/charts'
import { useDiagnostics } from './useDiagnostics'
import { usePhone } from './usePhone'
import { reconstructionValid } from '../../lib/pulseLog'
import { formatQ } from '../../lib/fusionPhysics'
import { q95Disp } from './Fixed'
import { reportLabel, disruptionFirst } from './reportLabel'
import './diiid.css'

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
  const phone = usePhone()
  return phone ? <Phone ctx={ctx} /> : <Desktop ctx={ctx} />
}

function Desktop({ ctx }: { ctx: ControlRoomContext }) {
  const { T, charts } = useWallCharts(ctx)
  const snap = ctx.displaySnapshot
  const h = ctx.history

  const dev = ctx.devices.find((d) => d.id === ctx.activeDevice)
  const onScrub = ctx.finished ? ctx.controls.setScrubTime : undefined
  const pulse = ctx.pulseNumber === null ? '      ' : String(ctx.pulseNumber).padStart(6, ' ')
  const remaining = ctx.duration - ctx.time
  const lastEvents = ctx.events.slice(-4).reverse()
  const report = ctx.finished && !!ctx.report
  // The green monospace scalar block under the status table, as on the wall's big screen.
  const f = (v: number | undefined, d = 2) => (v === undefined || !isFinite(v) ? '--' : v.toFixed(d))
  // Readouts that the wall already plots (NEBAR, WTH, TE0, LI) are left to the strip charts; the divertor and neutron
  // figures come from the shared diagnostics so they agree with every other look.
  const diag = useDiagnostics(snap, reconstructionValid(snap))
  const readout: [string, string, string][] = snap ? [
    ['Ip', f(snap.ip), 'MA'], ['Bt', f(snap.bt), 'T'],
    ['Pin', f(snap.p_input, 1), 'MW'], ['POH', f(snap.p_ohmic), 'MW'],
    ['Prad', f(snap.p_rad), 'MW'], ['Pα', f(snap.p_alpha, 3), 'MW'],
    ['βN', f(snap.beta_n), ''], ['q95', f(q95Disp(snap.q95)), ''],
    ['Pfus', diag.pFus > 0.001 ? f(diag.pFus, diag.pFus < 10 ? 3 : 1) : '--', 'MW'], ['Q', diag.rate > 0 ? formatQ(diag.qPlasma) : '--', ''],
    ['λq', diag.valid ? f(diag.lambdaQ, 1) : '--', 'mm'], ['fdet', diag.valid ? f(diag.fDet) : '--', ''],
  ] : []
  // ELM activity is a transient flag: hold it for the last 0.3 s of history so the cell reads ELMING, not a flicker.
  let elming = false
  for (let i = h.length - 1; i >= 0 && h[i].t > ctx.time - 0.3; i--) if (h[i].elm_active) { elming = true; break }

  return (
    <div data-layout="diiid" className="dc-root">
      <div className="dc-wall" data-tutorial="traces">
        <div className="dc-tile dc-eq" data-tutorial="equilibrium">
          <EquilibriumCanvas snapshot={snap} wallJson={ctx.wallJson} limiterPoints={ctx.limiterPoints} />
          <span className="dc-tile-title">EFIT01</span>
        </div>
        {charts.map((c) => (
          <StripChart
            key={c.id}
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

        <div className="dc-statusblock" data-tutorial="status">
          <StatusGrid snapshot={snap} running={ctx.running} fuel={ctx.fuelType} elming={elming} />

          <div className="dc-text">
            {readout.map(([k, v, u]) => (
              <div key={k} className="dc-text-row"><span>{k}</span><span>{v}</span><span>{u}</span></div>
            ))}
            {snap && <DiagBars d={diag} />}
          </div>
        </div>

        <div className="dc-tile dc-cam" data-tutorial="portview">
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

      {/* the report is longer than the line: it scrolls sideways in place (wheel or swipe) */}
      <div key={report ? 'report' : 'events'} className="dc-ticker" data-report={report || undefined} onWheel={report ? (e) => { e.currentTarget.scrollLeft += e.deltaY } : undefined}>
        <span className="dc-ticker-k">{ctx.pulseNumber !== null ? `#${ctx.pulseNumber}` : '--'}</span>
        {ctx.finished && ctx.report
          ? disruptionFirst(ctx.report).map((r, i) => (
            <span key={i} className="dc-ev" style={{ color: r.status === 'major' ? RED : r.status === 'minor' ? YELLOW : '#bbbbbb' }}>
              {reportLabel(r.label)} {r.achieved}{r.programmed ? ` / ${r.programmed}` : ''}
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
