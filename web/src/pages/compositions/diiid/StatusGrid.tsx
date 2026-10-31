import type { DisruptionCause, Snapshot } from '../../../lib/types'
import { statusCells } from './statusCells'
import { Fx } from '../Fixed'

interface Props { snapshot: Snapshot | null; running: boolean; fuel: string; elming: boolean; cause: DisruptionCause }

/** The tabular status block: named cells whose background carries the state. */
export default function StatusGrid({ snapshot, running, fuel, elming, cause }: Props) {
  return (
    <div className="dc-status">
      {statusCells(snapshot, running, fuel, elming, cause).map((c) => (
        <div key={c.k} className="dc-cell" data-lamp={c.lamp}>
          <span className="dc-cell-k">{c.k}</span>
          <span className="dc-cell-v">{c.fit ? <Fx fit={c.fit}>{c.v}</Fx> : c.v}</span>
        </div>
      ))}
    </div>
  )
}
