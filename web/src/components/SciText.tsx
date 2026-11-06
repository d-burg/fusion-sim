import type { ReactNode } from 'react'

/**
 * Typeset a label or unit that carries Unicode super- and subscripts.
 *
 * The planner and the drawers keep their units as plain strings ('10²⁰ m⁻³',
 * 'Iₚ flat-top') so that canvases and JSON see one spelling; in the DOM those
 * glyphs come from whichever fallback font has them, sit at odd heights and,
 * in an uppercased look, turn 'm⁻³' into 'M⁻³'. This renders each run of
 * superscript or subscript characters as a real <sup>/<sub> with the ASCII
 * digit or letter, and leaves the rest of the string as it is.
 */
const SUP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁻': '−', '⁺': '+',
}
const SUB: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₋': '−', '₊': '+',
  'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o',
  'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x',
}

/** The string as React nodes: plain runs, <sup> runs and <sub> runs. */
export function sci(text: string): ReactNode {
  const out: ReactNode[] = []
  let run = ''
  let kind: 'plain' | 'sup' | 'sub' = 'plain'
  const flush = () => {
    if (!run) return
    const k = out.length
    out.push(kind === 'sup' ? <sup key={k}>{run}</sup> : kind === 'sub' ? <sub key={k}>{run}</sub> : run)
    run = ''
  }
  for (const ch of text) {
    const next: typeof kind = ch in SUP ? 'sup' : ch in SUB ? 'sub' : 'plain'
    if (next !== kind) { flush(); kind = next }
    run += next === 'sup' ? SUP[ch] : next === 'sub' ? SUB[ch] : ch
  }
  flush()
  return out.length === 1 && typeof out[0] === 'string' ? out[0] : out
}

/**
 * `unit` marks a unit: it keeps its case under an uppercasing look (m, not M)
 * and never wraps.
 */
export default function SciText({ text, unit, className }: { text: string; unit?: boolean; className?: string }) {
  return <span className={`sci${unit ? ' sci-unit' : ''}${className ? ` ${className}` : ''}`}>{sci(text)}</span>
}
