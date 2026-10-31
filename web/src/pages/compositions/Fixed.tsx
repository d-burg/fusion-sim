/* eslint-disable react-refresh/only-export-components -- the slot and the templates it is sized by belong together */
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

// Live values in fixed slots. A figure that changes width as it goes from one digit to two (5.3 → 31.7)
// shoves everything after it on the line, every frame. Each live value therefore sits in a slot as wide
// as the widest text it is expected to show: the slot stacks invisible copies of those template strings
// and the value in one grid cell, so its min-width is exactly the template's width in the slot's own
// font, case and letter-spacing (a `ch` min-width ignores tracking, and the Modern caps are proportional).
// Figures are tabular, so any digit string of the template's length fits.

const OUTER: CSSProperties = { display: 'inline-grid', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const GHOST: CSSProperties = { gridArea: '1 / 1', visibility: 'hidden', userSelect: 'none', pointerEvents: 'none' }
const VALUE: Record<'start' | 'end' | 'center', CSSProperties> = {
  start: { gridArea: '1 / 1', justifySelf: 'start' },
  end: { gridArea: '1 / 1', justifySelf: 'end' },
  center: { gridArea: '1 / 1', justifySelf: 'center' },
}

type FxProps = {
  /** The widest text(s) the slot must hold, e.g. '888.8' (digits as 8s) or every member of a word set. */
  fit: string | readonly string[]
  /** Right-aligned ('end') for figures after their label; 'start' where the idiom puts the value first. */
  align?: 'start' | 'end' | 'center'
  children: ReactNode
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>

/** A live value in a slot as wide as the widest of `fit`, so nothing beside it moves as it changes. */
export function Fx({ fit, align = 'end', children, style, ...rest }: FxProps) {
  const ghosts = typeof fit === 'string' ? [fit] : fit
  return (
    <span {...rest} style={style ? { ...OUTER, ...style } : OUTER}>
      {ghosts.map((g) => <span key={g} aria-hidden="true" style={GHOST}>{g}</span>)}
      <span style={VALUE[align]}>{children}</span>
    </span>
  )
}

/** Digit template of a formatted string: every figure becomes an 8 (a clock's own width, say). */
export const digits8 = (s: string) => s.replace(/\d/g, '8')

/** q95 for display: the engine reports absurd values at start-up; the readouts hold 99 at most. */
export const q95Disp = (v: number | undefined) => (v === undefined || !isFinite(v) ? v : Math.min(v, 99))

// Templates by quantity (widest realistic text of each), shared by the four looks.
export const FIT = {
  /** Divertor heat flux, MW/m², one decimal; the display clamps at 99.9 so ELM spikes do not widen the slot. */
  q: '88.8',
  /** λ_q in mm, one decimal. */
  lambdaQ: '8.8',
  /** Detachment fraction 0.00–1.00. */
  fDet: '8.88',
  /** Divertor surface temperature, °C, whole degrees. */
  tSurf: '8888',
  /** Neutron rate, mantissa + exponent. */
  sci: '8.8E88',
  /** Every form formatQ() produces: 2E-6, 1.2E-3, 0.051, 1.23, 12.3, 123. */
  Q: ['8.8E-8', '0.888', '888'] as readonly string[],
  /** Kaldera hazardPct(), two significant figures: sized down to 0.0010 %/s (the flat-top range); the rarer
   *  0.00012 and "< 0.0001" of a cold start run one or two figures past it. */
  hazardPct: '0.0088',
} as const

export const REGIME_WORDS = ['ATTACHED', 'PARTIAL', 'DETACHED', '—'] as const
export const T_WORDS = ['NOMINAL', 'HOT', 'RECRYSTALLIZATION'] as const
export const N_WORDS = ['ACTIVE', 'IDLE'] as const
