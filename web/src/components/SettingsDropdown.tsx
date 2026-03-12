import { useState, useRef, useEffect } from 'react'
import { useSettings, type Theme, type Units } from '../lib/settingsContext'

export default function SettingsDropdown() {
  const { theme, units, setTheme, setUnits } = useSettings()
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="settings-btn px-1.5 py-1 rounded text-gray-400 hover:text-gray-200
                   transition-colors cursor-pointer flex items-center gap-1"
        title="Settings"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
          />
        </svg>
      </button>

      {open && (
        <div className="settings-panel absolute right-0 top-full mt-1 w-52 z-50
                        rounded-md shadow-xl border p-3 space-y-3
                        bg-gray-900 border-gray-700">
          {/* Header */}
          <div className="settings-heading text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            Settings
          </div>

          {/* Theme toggle */}
          <div>
            <div className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide">View</div>
            <div className="flex rounded overflow-hidden border border-gray-700">
              {(['classic', 'modern'] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer capitalize
                    ${
                      theme === t
                        ? 'bg-cyan-700 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Units toggle */}
          <div>
            <div className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide">Units</div>
            <div className="flex rounded overflow-hidden border border-gray-700">
              {(['metric', 'imperial'] as Units[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnits(u)}
                  className={`flex-1 px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer capitalize
                    ${
                      units === u
                        ? 'bg-cyan-700 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                >
                  {u}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-gray-600 mt-1">
              {units === 'metric' ? 'SI: m, T, keV, MA' : 'CGS: cm, kG, keV, kA'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
