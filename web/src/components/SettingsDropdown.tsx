import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings, type Theme, type Units } from '../lib/settingsContext'

export default function SettingsDropdown({ onRestartTutorial }: { onRestartTutorial?: () => void } = {}) {
  const { theme, units, setTheme, setUnits } = useSettings()
  const navigate = useNavigate()
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
        <div className="settings-panel absolute right-0 top-full mt-1 w-60 z-50
                        rounded-md shadow-xl border p-3 space-y-3
                        bg-gray-900 border-gray-700">
          {/* Header */}
          <div className="settings-heading text-sm font-medium text-gray-300">
            Settings
          </div>

          {/* Theme toggle */}
          <div>
            <div className="text-sm text-gray-400 mb-1.5">Theme</div>
            <div className="flex rounded overflow-hidden border border-gray-700">
              {(['signature', 'retro'] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 px-2 py-1 text-sm font-medium transition-colors cursor-pointer capitalize
                    ${
                      theme === t
                        ? 'theme-toggle-active'
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
            <div className="text-sm text-gray-400 mb-1.5">Units</div>
            <div className="flex rounded overflow-hidden border border-gray-700">
              {(['metric', 'imperial'] as Units[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnits(u)}
                  className={`flex-1 px-2 py-1 text-sm font-medium transition-colors cursor-pointer capitalize
                    ${
                      units === u
                        ? 'theme-toggle-active'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                >
                  {u}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {units === 'metric' ? 'SI: m, T, keV, MA' : 'CGS: cm, kG, keV, kA'}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700/50" />

          {/* Restart tutorial */}
          {onRestartTutorial && (
            <button
              onClick={() => {
                setOpen(false)
                onRestartTutorial()
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-gray-400
                         hover:bg-gray-800 hover:text-gray-200 transition-colors cursor-pointer text-left"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
              </svg>
              Restart tutorial
            </button>
          )}

          {/* Bibliography link */}
          <button
            onClick={() => {
              setOpen(false)
              navigate('/bibliography')
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-gray-400
                       hover:bg-gray-800 hover:text-gray-200 transition-colors cursor-pointer text-left"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            Physics bibliography
          </button>

          {/* Version */}
          <div className="mt-1.5 pt-1.5 border-t border-gray-800 px-2 font-mono text-xs text-gray-500">
            v{__APP_VERSION__}
          </div>
        </div>
      )}
    </div>
  )
}
