import { Fragment, type ComponentType, type ReactNode } from 'react'

// The symbols in lib/pulseLog's report labels, as the readouts set them: real subscripts, each symbol in its own case.
const SYM: Record<string, ReactNode> = {
  'V_loop': <>V<sub>loop</sub></>, 'W_th': <>W<sub>th</sub></>, 'βN': <>β<sub>N</sub></>,
  'fGW': <>f<sub>GW</sub></>, 'q95': <>q<sub>95</sub></>, 'P_fus': <>P<sub>fus</sub></>, 'Ip': <>I<sub>p</sub></>,
}

/** A report label with its symbols set; `Sym` wraps each symbol, so a caps look can exempt it from its transform. */
export function reportLabel(label: string, Sym?: ComponentType<{ children: ReactNode }>): ReactNode {
  return label.split(' ').map((w, i) => <Fragment key={i}>{i > 0 ? ' ' : ''}{SYM[w] && Sym ? <Sym>{SYM[w]}</Sym> : (SYM[w] ?? w)}</Fragment>)
}

/**
 * Report rows with the Disruption row first. For the boxes that show only
 * their first rows until scrolled (the DIII-D ticker, Apollo's CRT), the one
 * row a postmortem is read for must not be the one that is hidden.
 */
export function disruptionFirst<T extends { label: string }>(rows: T[]): T[] {
  const i = rows.findIndex((r) => /^disruption$/i.test(r.label))
  return i > 0 ? [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)] : rows
}
