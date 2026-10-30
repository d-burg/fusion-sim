import type { Diagnostics, DiagTone } from '../useDiagnostics'
import { sci } from '../useDiagnostics'

const CELLS = 10

/** One text-mode bargraph line: label, ten block cells, the value, the state word. */
function Line({ k, fill, extra, v, vTone, word, tone }: {
  k: string; fill: number; extra?: string; v: string; vTone?: DiagTone; word: string; tone?: DiagTone
}) {
  const n = Math.round(Math.max(0, Math.min(1, fill)) * CELLS)
  return (
    <div className="ap-bar-row">
      <span>{k}</span>
      <span className="ap-bar-cells">{'█'.repeat(n)}<span className="ap-bar-off">{'░'.repeat(CELLS - n)}</span></span>
      <span className="ap-u">{extra}</span>
      <span className="ap-v" data-tone={vTone}>{v}</span>
      <span className="ap-bar-w" data-tone={tone}>{word}</span>
    </div>
  )
}

/** The divertor and neutron bargraphs at the foot of the telemetry CRT; the surface temperature only on tungsten. */
export default function DiagLines({ d }: { d: Diagnostics | null }) {
  if (!d) return null
  const tWord = d.tTone === 'bad' ? 'RECRYSTALLIZATION' : d.tTone === 'warn' ? 'HOT' : 'NOMINAL'
  return (
    <div className="ap-bars">
      <Line k="DIVERTOR HEAT FLUX" fill={d.qFill} v={`${d.q.toFixed(1)} MW/M2`} vTone={d.qTone} word={d.regime === '—' ? '----' : d.regime} tone={d.regimeTone} />
      {d.isW && <Line k="SURFACE TEMPERATURE" fill={d.tFill} v={`${d.tSurf.toFixed(0)} DEG C`} vTone={d.tTone} word={tWord} tone={d.tTone} />}
      <Line k="NEUTRONS" fill={d.nFill} v={`${d.rate > 0 ? sci(d.rate) : '-.--'} /S`} word={d.active ? 'ACTIVE' : 'IDLE'} tone={d.active ? 'ok' : undefined} />
    </div>
  )
}
