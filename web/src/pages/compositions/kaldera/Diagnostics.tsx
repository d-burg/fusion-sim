import type { ReactNode } from 'react'
import type { Snapshot } from '../../../lib/types'
import { formatQ } from '../../../lib/fusionPhysics'
import { divertorInfo, neutronDiagnosticInfo } from '../../../components/infoContent'
import { fmtPfus, sci, useDiagnostics, type DiagTone } from '../useDiagnostics'
import InfoHint from './InfoHint'

export type Tone = DiagTone

/** One bar: a hairline track with a thin fill, the label at left and the values at right. */
function Bar({ label, fill, tone, right }: { label: ReactNode; fill: number; tone?: Tone; right: ReactNode }) {
  return (
    <div className="kd-bar">
      <div className="kd-bar-row">
        <span className="kd-bar-l">{label}</span>
        <span className="kd-bar-r">{right}</span>
      </div>
      <div className="kd-bar-track"><div className="kd-bar-fill" data-tone={tone} style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} /></div>
    </div>
  )
}

/**
 * The divertor and neutron rows of the current status panel, in this
 * grammar: hairline bars under the scalar grid. State is a word, never a dot.
 * The surface-temperature bar appears only on tungsten machines.
 */
export default function Diagnostics({ snapshot, valid }: { snapshot: Snapshot | null; valid: boolean }) {
  const d = useDiagnostics(snapshot, valid)

  const divRight = <>{d.q.toFixed(1)} MW/M² . <span className="kd-g">λ</span><sub>Q</sub> {valid ? d.lambdaQ.toFixed(1) : '—'} MM . F<sub>DET</sub> {valid ? d.fDet.toFixed(2) : '—'} . <span data-tone={d.regimeTone}>{d.regime}</span></>
  const tWord = d.tTone === 'bad' ? 'RECRYSTALLIZATION' : d.tTone === 'warn' ? 'HOT' : 'NOMINAL'
  const tRight = <>{d.tSurf.toFixed(0)} °C . W . <span data-tone={d.tTone}>{tWord}</span></>
  const pFusStr = d.pFus > 0.001 ? fmtPfus(d.pFus).toUpperCase() : '— MW'
  const neuRight = <>{sci(d.rate)} N/S . Q <span data-tone={d.qPlasma >= 1 ? 'ok' : undefined}>{d.rate > 0 ? formatQ(d.qPlasma).toUpperCase() : '—'}</span> . P<sub>FUS</sub> {pFusStr} . <span data-tone={d.active ? 'ok' : undefined}>{d.active ? 'ACTIVE' : 'IDLE'}</span></>

  return (
    <div className="kd-bars">
      <Bar
        label={<InfoHint title="Divertor thermal loading" content={divertorInfo}>Q⊥ DIVERTOR</InfoHint>}
        fill={d.qFill}
        tone={d.qTone}
        right={divRight}
      />
      {d.isW && (
        <Bar
          label={<InfoHint title="Divertor thermal loading" content={divertorInfo}>SURFACE TEMPERATURE</InfoHint>}
          fill={d.tFill}
          tone={d.tTone}
          right={tRight}
        />
      )}
      <Bar
        label={<InfoHint title="Neutron diagnostic" content={neutronDiagnosticInfo}>NEUTRONS</InfoHint>}
        fill={d.nFill}
        tone={d.active ? 'ok' : undefined}
        right={neuRight}
      />
    </div>
  )
}
