/**
 * Seven-segment digits drawn as SVG polygons. Unlit segments are drawn as
 * ghosts, as on a real display. Characters: 0-9, '-', ' ', ':', '.'.
 */
const SEG: Record<string, number> = {
  '0': 0b0111111, '1': 0b0000110, '2': 0b1011011, '3': 0b1001111, '4': 0b1100110,
  '5': 0b1101101, '6': 0b1111101, '7': 0b0000111, '8': 0b1111111, '9': 0b1101111,
  '-': 0b1000000, ' ': 0,
}

// segment geometry in a 10 x 18 cell: a b c d e f g (a top, going clockwise, g middle)
const S = 1.6 // thickness
const W = 10, H = 18
const SEGS: string[] = [
  `M${S / 2},0 L${W - S / 2},0 L${W - S},${S} L${S},${S} Z`,                                    // a
  `M${W},${S / 2} L${W},${H / 2 - S / 2} L${W - S},${H / 2 - S} L${W - S},${S} Z`,              // b
  `M${W},${H / 2 + S / 2} L${W},${H - S / 2} L${W - S},${H - S} L${W - S},${H / 2 + S} Z`,      // c
  `M${S / 2},${H} L${W - S / 2},${H} L${W - S},${H - S} L${S},${H - S} Z`,                      // d
  `M0,${H / 2 + S / 2} L0,${H - S / 2} L${S},${H - S} L${S},${H / 2 + S} Z`,                    // e
  `M0,${S / 2} L0,${H / 2 - S / 2} L${S},${H / 2 - S} L${S},${S} Z`,                            // f
  `M${S / 2},${H / 2} L${S},${H / 2 - S / 2} L${W - S},${H / 2 - S / 2} L${W - S / 2},${H / 2} L${W - S},${H / 2 + S / 2} L${S},${H / 2 + S / 2} Z`, // g
]

interface Props {
  text: string
  color: string
  /** Height of a digit in px. */
  size?: number
  ghost?: number
}

export default function SevenSeg({ text, color, size = 36, ghost = 0.12 }: Props) {
  const k = size / H
  const gap = 3
  const cells: { x: number; w: number; node: React.ReactNode }[] = []
  let x = 0
  const chars = text.split('')
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === ':') {
      cells.push({ x, w: 3, node: (
        <g key={i} transform={`translate(${x},0)`} fill={color}>
          <rect x={0.6} y={H * 0.3} width={S} height={S} />
          <rect x={0.6} y={H * 0.65} width={S} height={S} />
        </g>
      ) })
      x += 3 + gap
      continue
    }
    if (c === '.') {
      cells.push({ x, w: 2, node: <rect key={i} x={x} y={H - S} width={S} height={S} fill={color} /> })
      x += 2 + gap
      continue
    }
    const mask = SEG[c] ?? 0
    cells.push({ x, w: W, node: (
      <g key={i} transform={`translate(${x},0) skewX(-6)`}>
        {SEGS.map((d, s) => (
          <path key={s} d={d} fill={color} opacity={mask & (1 << s) ? 1 : ghost} />
        ))}
      </g>
    ) })
    x += W + gap
  }
  const totalW = x - gap + 3
  return (
    <svg width={totalW * k} height={size} viewBox={`-1 0 ${totalW} ${H}`} style={{ display: 'block' }}>
      {cells.map((c) => c.node)}
    </svg>
  )
}
