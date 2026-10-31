import type { ReactNode } from 'react'
import type { Snapshot } from '../../../lib/types'
import { formatQ } from '../../../lib/fusionPhysics'
import { divertorInfo, neutronDiagnosticInfo } from '../../../components/infoContent'
import { fmtPfus, sci, useDiagnostics, type DiagTone } from '../useDiagnostics'
import InfoHint from './InfoHint'
import { FIT, Fx, N_WORDS, REGIME_WORDS, T_WORDS } from '../Fixed'
import { G } from './shared'

export type Tone = DiagTone

/** One bar: a hairline track with a thin fill, the label at left and the values at right. */
function Bar({ label, fill, tone, right, detail }: { label: ReactNode; fill: number; tone?: Tone; right: ReactNode; detail?: ReactNode }) {
  return (
    <div className="kd-bar">
      <div className="kd-bar-row">
        <span className="kd-bar-l">{label}</span>
        <span className="kd-bar-r">{right}</span>
      </div>
      <div className="kd-bar-track"><div className="kd-bar-fill" data-tone={tone} style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} /></div>
      {detail && <div className="kd-bar-detail">{detail}</div>}
    </div>
  )
}

/**
 * The divertor and neutron rows of the current status panel, in this
 * grammar: hairline bars under the scalar grid. State is a word, never a dot.
 * The surface-temperature bar appears only on tungsten machines.
 */
export default function Diagnostics({ snapshot, valid, compact }: { snapshot: Snapshot | null; valid: boolean; compact?: boolean }) {
  const d = useDiagnostics(snapshot, valid)

  // Every figure and state word sits in a fixed slot (../Fixed): the separators between them never move.
  // A figure opening a line (phone detail rows) is left-aligned in its slot; after a label (desktop), right-aligned.
  const lead = compact ? 'start' : 'end'
  const qV = <Fx fit={FIT.q} align={lead}>{Math.min(d.q, 99.9).toFixed(1)}</Fx>
  const lqV = <Fx fit={FIT.lambdaQ}>{valid ? d.lambdaQ.toFixed(1) : '—'}</Fx>
  const fdV = <Fx fit={FIT.fDet}>{valid ? d.fDet.toFixed(2) : '—'}</Fx>
  const regimeW = <Fx fit={REGIME_WORDS} data-tone={d.regimeTone}>{d.regime}</Fx>
  const divDetail = <>{qV} <G>MW/m²</G> . <G>λ</G><sub>q</sub> {lqV} <G>mm</G> . <G>f</G><sub>det</sub> {fdV}</>
  const divRight = <>{divDetail} . {regimeW}</>
  const tWord = d.tTone === 'bad' ? 'RECRYSTALLIZATION' : d.tTone === 'warn' ? 'HOT' : 'NOMINAL'
  const tWordW = <Fx fit={T_WORDS} data-tone={d.tTone}>{tWord}</Fx>
  const tV = <Fx fit={FIT.tSurf} align={lead}>{d.tSurf.toFixed(0)}</Fx>
  const tRight = <>{tV} °C . W . {tWordW}</>
  const pFusStr = d.pFus > 0.001 ? fmtPfus(d.pFus) : '— MW'
  const nWordW = <Fx fit={N_WORDS} data-tone={d.active ? 'ok' : undefined}>{d.active ? 'ACTIVE' : 'IDLE'}</Fx>
  const neuDetail = <><Fx fit={FIT.sci} align={lead}>{sci(d.rate)}</Fx> <G>n/s</G> . Q <Fx fit={FIT.Q} data-tone={d.qPlasma >= 1 ? 'ok' : undefined}>{d.rate > 0 ? formatQ(d.qPlasma).toUpperCase() : '—'}</Fx> . P<sub>fus</sub> <Fx fit={['888.8 MW', '888 kW']} align="start" className="kd-g">{pFusStr}</Fx></>
  const neuRight = <>{neuDetail} . {nWordW}</>

  // Phone: the state word sits at the right of the label, the figures on their own line under the bar.
  if (compact) {
    return (
      <div className="kd-bars" data-compact="true">
        <Bar
          label={<InfoHint title="Divertor thermal loading" content={divertorInfo}><G>q</G>⊥ DIVERTOR</InfoHint>}
          fill={d.qFill}
          tone={d.qTone}
          right={regimeW}
          detail={divDetail}
        />
        {d.isW && (
          <Bar
            label={<InfoHint title="Divertor thermal loading" content={divertorInfo}>SURFACE TEMPERATURE</InfoHint>}
            fill={d.tFill}
            tone={d.tTone}
            right={tWordW}
            detail={<>{tV} °C . W</>}
          />
        )}
        <Bar
          label={<InfoHint title="Neutron diagnostic" content={neutronDiagnosticInfo}>NEUTRONS</InfoHint>}
          fill={d.nFill}
          tone={d.active ? 'ok' : undefined}
          right={nWordW}
          detail={neuDetail}
        />
      </div>
    )
  }

  return (
    <div className="kd-bars">
      <Bar
        label={<InfoHint title="Divertor thermal loading" content={divertorInfo}><G>q</G>⊥ DIVERTOR</InfoHint>}
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
