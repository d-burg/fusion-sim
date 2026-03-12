import { useState, useRef, useEffect, useCallback } from 'react'

interface InfoPopupProps {
  children: React.ReactNode
  title?: string
  position?: 'left' | 'right'
}

export default function InfoPopup({ children, title, position = 'right' }: InfoPopupProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const toggle = useCallback(() => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const popupWidth = 320
      let left = position === 'right'
        ? rect.right + 6
        : rect.left - popupWidth - 6
      // Clamp to viewport
      if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8
      if (left < 8) left = 8
      let top = rect.top - 4
      setCoords({ top, left })
    }
    setOpen(v => !v)
  }, [open, position])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popupRef.current && !popupRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Re-clamp if viewport resizes while open
  useEffect(() => {
    if (!open) return
    const handler = () => {
      if (btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect()
        const popupWidth = 320
        let left = position === 'right'
          ? rect.right + 6
          : rect.left - popupWidth - 6
        if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8
        if (left < 8) left = 8
        let top = rect.top - 4
        setCoords({ top, left })
      }
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [open, position])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => toggle()}
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full
                    text-[8px] font-bold leading-none border transition-colors flex-shrink-0
                    ${open
                      ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10'
                      : 'border-gray-600 text-gray-500 hover:text-cyan-400 hover:border-cyan-500/50'
                    }`}
        title={title ? `Info: ${title}` : 'Info'}
      >
        i
      </button>

      {open && coords && (
        <div
          ref={popupRef}
          className="fixed w-80 max-h-[70vh] overflow-y-auto
                     bg-gray-950 border border-gray-700 rounded-lg shadow-2xl
                     p-3 font-mono text-xs z-[100]"
          style={{ top: coords.top, left: coords.left }}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            {title && (
              <h3 className="text-cyan-400 font-bold text-[11px] pr-4">{title}</h3>
            )}
            <button
              onClick={() => setOpen(false)}
              className="text-gray-500 hover:text-white text-sm leading-none flex-shrink-0 ml-auto"
            >
              x
            </button>
          </div>
          {/* Content */}
          <div className="text-gray-300 leading-relaxed space-y-2">
            {children}
          </div>
        </div>
      )}
    </>
  )
}
