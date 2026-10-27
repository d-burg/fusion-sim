export type Lamp = 'off' | 'white' | 'green' | 'amber' | 'red'

interface Props {
  /** One or two short caption lines, engraved on the key cap. */
  caption: string
  lamp: Lamp
  onClick?: () => void
  disabled?: boolean
  /** Key width in grid columns of the console it sits in. */
  wide?: boolean
}

/**
 * A square lamp key as on the MOCR consoles: a dark cap that lights amber,
 * white, green or red behind an engraved caption. Status keys have no
 * handler; control keys do.
 */
export default function LampKey({ caption, lamp, onClick, disabled, wide }: Props) {
  const lines = caption.split('\n')
  const cls = `ap-key ap-key-${lamp}${wide ? ' ap-key-wide' : ''}${onClick ? ' ap-key-btn' : ''}`
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} disabled={disabled}>
        {lines.map((l, i) => <span key={i}>{l}</span>)}
      </button>
    )
  }
  return (
    <div className={cls}>
      {lines.map((l, i) => <span key={i}>{l}</span>)}
    </div>
  )
}
