/**
 * Theme tokens for canvas code.
 *
 * The chrome is styled through the `--c-*` custom properties in index.css
 * (and the lookbook theme blocks), but canvases paint with literal colours,
 * so a light theme used to leave dark islands where the plots are. This
 * reads the live token values from the document so canvases follow the
 * theme too. Values are cached per `data-theme` value; the attribute is the
 * only thing that changes them.
 */
export interface ThemeColors {
  base: string
  surface: string
  raised: string
  line: string
  lineStrong: string
  ink: string
  inkDim: string
  inkFaint: string
  accent: string
  ok: string
  warn: string
  bad: string
  /** true when --c-base is light (luminance > 0.5): plots invert their neutrals */
  light: boolean
  /** a hairline grid colour appropriate to the field: white-ish on dark, black-ish on light */
  grid: (alpha: number) => string
}

const TOKENS: Array<[keyof Omit<ThemeColors, 'light' | 'grid'>, string]> = [
  ['base', '--c-base'],
  ['surface', '--c-surface'],
  ['raised', '--c-raised'],
  ['line', '--c-line'],
  ['lineStrong', '--c-line-strong'],
  ['ink', '--c-ink'],
  ['inkDim', '--c-ink-dim'],
  ['inkFaint', '--c-ink-faint'],
  ['accent', '--c-accent'],
  ['ok', '--c-ok'],
  ['warn', '--c-warn'],
  ['bad', '--c-bad'],
]

// Signature defaults, used before the stylesheet is applied or outside a DOM.
const FALLBACK: Record<string, string> = {
  base: '#0e0f11', surface: '#16181b', raised: '#1e2125', line: '#2a2e33', lineStrong: '#3b4047',
  ink: '#e7e8ea', inkDim: '#9aa0a6', inkFaint: '#8a9096', accent: '#e0a23a',
  ok: '#57a773', warn: '#d8a23a', bad: '#c8553d',
}

function relativeLuminance(hex: string): number {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return 0
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

let cacheKey: string | null = null
let cache: ThemeColors | null = null

export function themeColors(): ThemeColors {
  if (typeof document === 'undefined') return build(FALLBACK)
  const key = document.documentElement.getAttribute('data-theme') ?? ''
  if (cache && cacheKey === key) return cache
  const cs = getComputedStyle(document.documentElement)
  const vals: Record<string, string> = {}
  for (const [k, prop] of TOKENS) {
    const v = cs.getPropertyValue(prop).trim()
    vals[k] = v || FALLBACK[k]
  }
  cacheKey = key
  cache = build(vals)
  return cache
}

function build(v: Record<string, string>): ThemeColors {
  const light = relativeLuminance(v.base) > 0.5
  return {
    base: v.base, surface: v.surface, raised: v.raised, line: v.line, lineStrong: v.lineStrong,
    ink: v.ink, inkDim: v.inkDim, inkFaint: v.inkFaint, accent: v.accent,
    ok: v.ok, warn: v.warn, bad: v.bad,
    light,
    grid: (alpha) => (light ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`),
  }
}
