import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Theme = 'classic' | 'modern'
export type Units = 'metric' | 'imperial'

interface Settings {
  theme: Theme
  units: Units
  setTheme: (t: Theme) => void
  setUnits: (u: Units) => void
}

const SettingsContext = createContext<Settings>({
  theme: 'classic',
  units: 'metric',
  setTheme: () => {},
  setUnits: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('tok-sym-theme') as Theme) || 'classic'
  })
  const [units, setUnits] = useState<Units>(() => {
    return (localStorage.getItem('tok-sym-units') as Units) || 'metric'
  })

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
    <SettingsContext.Provider value={{ theme, units, setTheme, setUnits }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
