import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Theme = 'signature' | 'retro'
export type Units = 'metric' | 'imperial'
/** Control-room look: which composition renders /run/:device. */
export type Look = 'kaldera' | 'diiid' | 'apollo' | 'jet'
export const LOOKS: { id: Look; label: string; blurb: string }[] = [
  { id: 'kaldera', label: 'Standard', blurb: 'Sparse, cinematic; the default' },
  { id: 'diiid', label: 'DIII-D', blurb: 'Wall of strip charts, status grid' },
  { id: 'apollo', label: 'Apollo', blurb: 'Mission-control board and console' },
  { id: 'jet', label: 'JET', blurb: 'White jScope panels and tables' },
]
function normalizeLook(stored: string | null): Look {
  return LOOKS.some((l) => l.id === stored) ? (stored as Look) : 'kaldera'
}

/** Map any legacy/unknown stored theme to a current one. */
function normalizeTheme(stored: string | null): Theme {
  return stored === 'retro' ? 'retro' : 'signature'
}

interface Settings {
  theme: Theme
  units: Units
  look: Look
  setTheme: (t: Theme) => void
  setUnits: (u: Units) => void
  setLook: (l: Look) => void
}

const SettingsContext = createContext<Settings>({
  theme: 'signature',
  units: 'metric',
  look: 'kaldera',
  setTheme: () => {},
  setUnits: () => {},
  setLook: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return normalizeTheme(localStorage.getItem('tok-sym-theme'))
  })
  const [units, setUnits] = useState<Units>(() => {
    return (localStorage.getItem('tok-sym-units') as Units) || 'metric'
  })
  const [look, setLook] = useState<Look>(() => normalizeLook(localStorage.getItem('tok-sym-look')))
  useEffect(() => {
    localStorage.setItem('tok-sym-look', look)
  }, [look])

  // Sync theme to DOM and localStorage
  useEffect(() => {
    localStorage.setItem('tok-sym-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Sync units to localStorage
  useEffect(() => {
    localStorage.setItem('tok-sym-units', units)
  }, [units])

  // Set initial theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  return (
    <SettingsContext.Provider value={{ theme, units, look, setTheme, setUnits, setLook }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
