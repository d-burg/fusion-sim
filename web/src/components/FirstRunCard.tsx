import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings, LOOKS, type Look, type Sound } from '../lib/settingsContext'
import { markFirstRunDone } from '../lib/firstRun'

interface Props {
  /** The card has been dismissed (BEGIN, Escape, or the tour). */
  onClose: () => void
  /** Dismiss and start the tutorial overlay. */
  onStartTour: () => void
  /** Transient preview while a look name is hovered; null clears it. Never persisted. */
  onPreview: (l: Look | null) => void
}

/**
 * The one card a first visit sees, over whichever room is rendering: sound,
 * look and tour, then BEGIN. In the Modern grammar: a hairline-bordered
 * card on a flat mask, tracked caps, the active choice as a white square.
 * Hovering a look previews it behind the card (render-only, nothing stored);
 * clicking commits it through setLook.
 */
export default function FirstRunCard({ onClose, onStartTour, onPreview }: Props) {
  const { sound, setSound, look, setLook } = useSettings()
  const [hovered, setHovered] = useState<Look | null>(null)
  const beginRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const preview = useCallback((l: Look | null) => { setHovered(l); onPreview(l) }, [onPreview])

  const close = useCallback(() => {
    onPreview(null)
    markFirstRunDone()
    onClose()
  }, [onClose, onPreview])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [close])

  // Focus the card itself (not a control, so no ring shows on open): Tab then walks the choices.
  useEffect(() => { cardRef.current?.focus({ preventScroll: true }) }, [])

  const pickSound = (s: Sound) => setSound(s)
  const commitLook = (id: Look) => { setLook(id); preview(null) }

  return (
    <div className="fr-root" role="dialog" aria-modal="true" aria-labelledby="fr-title">
      <style>{FR_CSS}</style>
      <div className="fr-mask" />
      <div ref={cardRef} className="fr-card" tabIndex={-1}>
        <div className="fr-head">
          <span className="fr-title" id="fr-title">CONTROL ROOM . FIRST RUN</span>
        </div>

        <div className="fr-row">
          <div className="fr-cap"><span className="fr-num">01</span> . SOUND</div>
          <div className="fr-choices">
            {(['on', 'off'] as const).map((s) => (
              <button key={s} type="button" className="fr-choice" data-on={sound === s} onClick={() => pickSound(s)}>
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="fr-row">
          <div className="fr-cap"><span className="fr-num">02</span> . LOOK</div>
          <div className="fr-looks" onPointerLeave={() => preview(null)}>
            {LOOKS.map((l) => (
              <div key={l.id} className="fr-look">
                <button
                  type="button"
                  className="fr-choice"
                  data-on={look === l.id}
                  data-preview={hovered === l.id && look !== l.id}
                  onPointerEnter={() => preview(l.id)}
                  onPointerLeave={() => preview(null)}
                  onFocus={() => preview(l.id)}
                  onBlur={() => preview(null)}
                  onClick={() => commitLook(l.id)}
                >
                  {l.label.toUpperCase()}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="fr-row">
          <div className="fr-cap"><span className="fr-num">03</span> . TOUR</div>
          <div className="fr-choices">
            <button type="button" className="fr-choice" onClick={() => { close(); onStartTour() }}>BEGIN TOUR</button>
            <button type="button" className="fr-choice" data-on="true" onClick={() => beginRef.current?.focus()}>SKIP</button>
          </div>
        </div>

        <div className="fr-foot">
          <button ref={beginRef} type="button" className="fr-begin" onClick={close}>BEGIN</button>
        </div>
      </div>
    </div>
  )
}

/* Scoped styles: the card sits outside the composition, so the Modern tokens
   (--kd-*) are not inherited and the type is named outright. */
const FR_CSS = `
.fr-root { position: fixed; inset: 0; z-index: 260; display: flex; align-items: center; justify-content: center; padding: 16px; }
.fr-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.55); }
.fr-card {
  position: relative; box-sizing: border-box; width: 600px; max-width: 100%; max-height: calc(100vh - 32px); overflow-y: auto;
  background: #0c1018; border: 1px solid rgba(255,255,255,0.22); color: rgba(255,255,255,0.82);
  border-radius: 0; box-shadow: none;
  font-family: 'Mona Sans', system-ui, sans-serif; font-stretch: 100%; font-weight: 400;
  font-size: 13.5px; line-height: 1.55; letter-spacing: 0; text-transform: none;
}
.fr-head, .fr-cap, .fr-choice, .fr-foot, .fr-begin {
  font-family: 'Mona Sans', sans-serif; font-weight: 400; font-stretch: 125%;
  letter-spacing: 0.12em; text-transform: uppercase;
}
.fr-head { padding: 14px 20px 9px; border-bottom: 1px solid rgba(255,255,255,0.12); font-size: 9px; }
.fr-title { color: #fff; }
.fr-row { display: grid; grid-template-columns: 96px 1fr; column-gap: 16px; align-items: baseline; padding: 14px 20px; border-top: 1px solid rgba(255,255,255,0.08); }
.fr-head + .fr-row { border-top: 0; }
.fr-cap { font-size: 9px; color: rgba(255,255,255,0.7); white-space: nowrap; }
.fr-num { color: rgba(255,255,255,0.4); }
.fr-choices { display: flex; flex-wrap: wrap; gap: 18px; }
.fr-choice {
  background: none; border: 0; border-radius: 0; margin: 0; padding: 3px 4px; line-height: 1;
  font-size: 10px; color: rgba(255,255,255,0.78); cursor: pointer; white-space: nowrap;
}
.fr-card:focus { outline: none; }
.fr-choice:hover { color: var(--kd-warm, #f0a98a); }
.fr-choice:focus-visible, .fr-begin:focus-visible { outline: 1px solid var(--kd-warm, #f0a98a); outline-offset: 2px; }
.fr-choice[data-on="true"] { background: #fff; color: #0a0d14; }
.fr-choice[data-preview="true"] { color: var(--kd-warm, #f0a98a); }
.fr-looks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.fr-look { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.fr-foot {
  display: flex; align-items: baseline; justify-content: flex-end;
  padding: 10px 20px 14px; border-top: 1px solid rgba(255,255,255,0.12); font-size: 9px;
}
.fr-begin {
  background: none; border: 0; border-bottom: 1px dotted rgba(255,255,255,0.45); border-radius: 0;
  padding: 2px 0; margin: 0; font-size: 10px; color: rgba(255,255,255,0.9); cursor: pointer;
}
.fr-begin:hover { color: #fff; border-bottom-color: #fff; }
@media (max-width: 560px) {
  .fr-row { grid-template-columns: 1fr; row-gap: 10px; }
  .fr-looks { grid-template-columns: repeat(2, 1fr); }
}
`
