import type { Diagnostics, DiagTone } from '../useDiagnostics'
import { sci } from '../useDiagnostics'

const CELLS = 20

/** Green / yellow / red as on the status grid; an unflagged bar reads green. */
const lamp = (t: DiagTone, idle = false) => (idle ? 'off' : t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : 'ok')

/** One text-mode bar: `QDIV [########............] 31.6 MW/m2 ATTACHED`. */
function Bar({ k, fill, tone, idle, v, u, word, wordTone }: {
  k: string; fill: number; tone: DiagTone; idle?: boolean; v: string; u: string; word: string; wordTone?: DiagTone
}) {
  const n = Math.round(Math.max(0, Math.min(1, fill)) * CELLS)
  return (
    <div className="dc-bar">
      <span>{k}</span>
      <span className="dc-bar-track">[<span data-lamp={lamp(tone, idle)}>{'#'.repeat(n)}</span>{'.'.repeat(CELLS - n)}]</span>
      <span className="dc-bar-v">{v}<span className="dc-bar-u">{u}</span></span>
      <span className="dc-bar-w" data-lamp={lamp(wordTone, word === '--' || word === 'IDLE')}>{word}</span>
    </div>
  )
}

/** The divertor and neutron bars at the foot of the green scalar block; the surface temperature only on tungsten. */
export default function DiagBars({ d }: { d: Diagnostics }) {
  const regime = d.regime === '—' ? '--' : d.regime
  const tWord = d.tTone === 'bad' ? 'RECRYST' : d.tTone === 'warn' ? 'HOT' : 'NOMINAL'
  return (
    <>
      <Bar k="QDIV" fill={d.qFill} tone={d.qTone} v={d.q.toFixed(1)} u="MW/m2" word={regime} wordTone={d.regimeTone} />
      {d.isW && <Bar k="TSRF" fill={d.tFill} tone={d.tTone} v={d.tSurf.toFixed(0)} u="°C" word={tWord} wordTone={d.tTone} />}
      <Bar k="NEUT" fill={d.nFill} tone={undefined} idle={!d.active} v={d.rate > 0 ? sci(d.rate).replace('E', 'e') : '--'} u="n/s" word={d.active ? 'ACTIVE' : 'IDLE'} />
    </>
  )
}
