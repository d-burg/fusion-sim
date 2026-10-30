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

const PHONE_CELLS = 16

/** Phone bargraph: the label and its state word on one line, the cells and the value under them. */
function PhoneLine({ k, fill, v, vTone, word, tone }: {
  k: string; fill: number; v: string; vTone?: DiagTone; word: string; tone?: DiagTone
}) {
  const n = Math.round(Math.max(0, Math.min(1, fill)) * PHONE_CELLS)
  return (
    <div className="app-bar">
      <div className="app-bar-top"><span>{k}</span><span className="ap-bar-w" data-tone={tone}>{word}</span></div>
      <div className="app-bar-bot">
        <span className="ap-bar-cells">{'█'.repeat(n)}<span className="ap-bar-off">{'░'.repeat(PHONE_CELLS - n)}</span></span>
        <span className="ap-v" data-tone={vTone}>{v}</span>
      </div>
    </div>
  )
}

/** The three bargraphs on a phone, full width, two lines each; dashes until there is a plasma. */
export function PhoneDiagLines({ d, live }: { d: Diagnostics; live: boolean }) {
  const tWord = d.tTone === 'bad' ? 'RECRYSTALLIZATION' : d.tTone === 'warn' ? 'HOT' : 'NOMINAL'
  return (
    <div className="app-bars">
      <PhoneLine k="DIVERTOR HEAT FLUX" fill={live ? d.qFill : 0} v={live ? `${d.q.toFixed(1)} MW/M2` : '-.- MW/M2'} vTone={live ? d.qTone : undefined}
        word={!live || d.regime === '—' ? '----' : d.regime} tone={live ? d.regimeTone : undefined} />
      {d.isW && <PhoneLine k="SURFACE TEMPERATURE" fill={live ? d.tFill : 0} v={live ? `${d.tSurf.toFixed(0)} DEG C` : '--- DEG C'} vTone={live ? d.tTone : undefined}
        word={live ? tWord : '----'} tone={live ? d.tTone : undefined} />}
      <PhoneLine k="NEUTRONS" fill={live ? d.nFill : 0} v={`${live && d.rate > 0 ? sci(d.rate) : '-.--'} /S`} word={live && d.active ? 'ACTIVE' : 'IDLE'} tone={live && d.active ? 'ok' : undefined} />
    </div>
  )
}
