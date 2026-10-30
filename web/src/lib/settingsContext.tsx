/* eslint-disable react-refresh/only-export-components -- the settings hook, its provider and the LOOKS table share one module by design */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Theme = 'signature' | 'retro'
export type Units = 'metric' | 'imperial'
/** Control-room audio. Stored under `tok-sym-sound`; off until the user turns it on. */
export type Sound = 'on' | 'off'
/** Control-room look: which composition renders /run/:device. */
export type Look = 'kaldera' | 'diiid' | 'apollo' | 'jet'
export const LOOKS: { id: Look; label: string }[] = [
  { id: 'kaldera', label: 'Modern' },
  { id: 'diiid', label: 'DIII-D' },
  { id: 'apollo', label: 'Apollo' },
  { id: 'jet', label: 'JET' },
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
  sound: Sound
  setTheme: (t: Theme) => void
  setUnits: (u: Units) => void
  setLook: (l: Look) => void
  setSound: (s: Sound) => void
}

const SettingsContext = createContext<Settings>({
  theme: 'signature',
  units: 'metric',
  look: 'kaldera',
  sound: 'off',
  setTheme: () => {},
  setUnits: () => {},
  setLook: () => {},
  setSound: () => {},
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
  const [sound, setSound] = useState<Sound>(() => (localStorage.getItem('tok-sym-sound') === 'on' ? 'on' : 'off'))
  useEffect(() => {
    localStorage.setItem('tok-sym-sound', sound)
  }, [sound])

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
    <SettingsContext.Provider value={{ theme, units, look, sound, setTheme, setUnits, setLook, setSound }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
