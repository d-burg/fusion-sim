import type { Snapshot } from '../../../lib/types'
import { statusCells } from './statusCells'

interface Props { snapshot: Snapshot | null; running: boolean; fuel: string; elming: boolean }

/** The tabular status block: named cells whose background carries the state. */
export default function StatusGrid({ snapshot, running, fuel, elming }: Props) {
  return (
    <div className="dc-status">
      {statusCells(snapshot, running, fuel, elming).map((c) => (
        <div key={c.k} className="dc-cell" data-lamp={c.lamp}>
          <span className="dc-cell-k">{c.k}</span>
          <span className="dc-cell-v">{c.v}</span>
        </div>
      ))}
    </div>
  )
}
