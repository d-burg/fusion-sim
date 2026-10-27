import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  content: ReactNode
  children: ReactNode
  className?: string
}

const WIDTH = 320
const HOVER_MS = 250

/**
 * The label itself is the trigger: a dotted hairline under it is the whole
 * affordance. Opens on hover after a short delay, or on click/focus (touch
 * and keyboard), and closes on leave, outside click and Escape. The popover
 * is a portal on the page's own field with a hairline border and no shadow.
 */
export default function InfoHint({ title, content, children, className }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const trigRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const inPop = useRef(false)

  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } }
  const show = useCallback(() => { clear(); setOpen(true) }, [])
  const hide = useCallback(() => { clear(); setOpen(false) }, [])
  const hoverIn = () => { clear(); timer.current = window.setTimeout(() => setOpen(true), HOVER_MS) }
  const hoverOut = () => { clear(); timer.current = window.setTimeout(() => { if (!inPop.current) setOpen(false) }, 120) }

  // Place below the label, left-aligned; flip above when it would not fit.
  useLayoutEffect(() => {
    if (!open || !trigRef.current) return
    const r = trigRef.current.getBoundingClientRect()
    const h = popRef.current?.offsetHeight ?? 240
    let left = r.left
    if (left + WIDTH > window.innerWidth - 8) left = window.innerWidth - WIDTH - 8
    if (left < 8) left = 8
    let top = r.bottom + 8
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 8 - h)
    setPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || trigRef.current?.contains(t)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  useEffect(() => clear, [])

  return (
    <>
      <span
        ref={trigRef}
        className={`kd-hint${className ? ` ${className}` : ''}`}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
        onClick={(e) => { e.stopPropagation(); if (open) hide(); else show() }}
        onFocus={show}
        onBlur={() => { if (!inPop.current) hide() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open) hide(); else show() } }}
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          className="kd-pop"
          data-layout="kaldera"
          role="dialog"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
          onMouseEnter={() => { inPop.current = true; clear() }}
          onMouseLeave={() => { inPop.current = false; hoverOut() }}
        >
          <div className="kd-pop-head">
            <span className="kd-pop-title">{title}</span>
            <button className="kd-pop-x" onClick={hide} aria-label="Close">×</button>
          </div>
          <div className="kd-pop-body">{content}</div>
        </div>,
        document.body,
      )}
    </>
  )
}
