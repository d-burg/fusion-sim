/* eslint-disable react-refresh/only-export-components -- the settings hook, its provider and the LOOKS table share one module by design */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { safeGet, safeSet } from './safeStorage'

export type Theme = 'signature' | 'retro'
export type Units = 'metric' | 'imperial'
/** Control-room audio. Stored under `tok-sym-sound`; off until the user turns it on. */
export type Sound = 'on' | 'off'
/** Trace channels shown on the phone layouts; stored under `tok-sym-phone-traces`. */
export const DEFAULT_PHONE_TRACES = ['ip', 'w_th', 'd_alpha']
function readPhoneTraces(): string[] {
  try {
    const raw = safeGet('tok-sym-phone-traces')
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) && arr.every((k) => typeof k === 'string') && arr.length > 0 ? arr : DEFAULT_PHONE_TRACES
  } catch { return DEFAULT_PHONE_TRACES }
}
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
  phoneTraces: string[]
  setTheme: (t: Theme) => void
  setUnits: (u: Units) => void
  setLook: (l: Look) => void
  setSound: (s: Sound) => void
  setPhoneTraces: (keys: string[]) => void
}

const SettingsContext = createContext<Settings>({
  theme: 'signature',
  units: 'metric',
  look: 'kaldera',
  sound: 'off',
  phoneTraces: DEFAULT_PHONE_TRACES,
  setTheme: () => {},
  setUnits: () => {},
  setLook: () => {},
  setSound: () => {},
  setPhoneTraces: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Every setting is read once on mount and written only when the user changes
  // it, so an untouched setting stays unstored and follows the shipped default.
  const [theme, setThemeState] = useState<Theme>(() => normalizeTheme(safeGet('tok-sym-theme')))
  const [units, setUnitsState] = useState<Units>(() => (safeGet('tok-sym-units') === 'imperial' ? 'imperial' : 'metric'))
  const [look, setLookState] = useState<Look>(() => normalizeLook(safeGet('tok-sym-look')))
  const [sound, setSoundState] = useState<Sound>(() => (safeGet('tok-sym-sound') === 'on' ? 'on' : 'off'))
  const [phoneTraces, setPhoneTracesState] = useState<string[]>(readPhoneTraces)

  const setTheme = useCallback((t: Theme) => { setThemeState(t); safeSet('tok-sym-theme', t) }, [])
  const setUnits = useCallback((u: Units) => { setUnitsState(u); safeSet('tok-sym-units', u) }, [])
  const setLook = useCallback((l: Look) => { setLookState(l); safeSet('tok-sym-look', l) }, [])
  const setSound = useCallback((v: Sound) => { setSoundState(v); safeSet('tok-sym-sound', v) }, [])
  const setPhoneTraces = useCallback((keys: string[]) => {
    setPhoneTracesState(keys)
    safeSet('tok-sym-phone-traces', JSON.stringify(keys))
  }, [])

  // Sync theme to the DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <SettingsContext.Provider value={{ theme, units, look, sound, phoneTraces, setTheme, setUnits, setLook, setSound, setPhoneTraces }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
