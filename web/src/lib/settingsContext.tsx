import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Theme = 'signature' | 'retro'
export type Units = 'metric' | 'imperial'

/** Map any legacy/unknown stored theme to a current one. */
function normalizeTheme(stored: string | null): Theme {
  return stored === 'retro' ? 'retro' : 'signature'
}

const DEFAULT_VOLUME = 0.5

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === 'on' } catch { return false }
}
function readVolume(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    const v = Number(raw)
    return raw !== null && Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME
  } catch { return DEFAULT_VOLUME }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode or quota: the setting lasts the session */ }
}

interface Settings {
  theme: Theme
  units: Units
  /** Machine sounds from the torus hall. Off by default; the plasma is silent. */
  hallAudio: boolean
  /** A click per ELM on a separately labeled channel. Off by default. */
  dAlphaAudio: boolean
  /** The pulse made audible: current ramp, divertor, neutron detector. Off by default. */
  pulseAudio: boolean
  /** Master volume for every channel, 0–1. */
  audioVolume: number
  setTheme: (t: Theme) => void
  setUnits: (u: Units) => void
  setHallAudio: (on: boolean) => void
  setDAlphaAudio: (on: boolean) => void
  setPulseAudio: (on: boolean) => void
  setAudioVolume: (v: number) => void
}

const SettingsContext = createContext<Settings>({
  theme: 'signature',
  units: 'metric',
  hallAudio: false,
  dAlphaAudio: false,
  pulseAudio: false,
  audioVolume: DEFAULT_VOLUME,
  setTheme: () => {},
  setUnits: () => {},
  setHallAudio: () => {},
  setDAlphaAudio: () => {},
  setPulseAudio: () => {},
  setAudioVolume: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return normalizeTheme(localStorage.getItem('tok-sym-theme'))
  })
  const [units, setUnits] = useState<Units>(() => {
    return (localStorage.getItem('tok-sym-units') as Units) || 'metric'
  })
  const [hallAudio, setHallAudio] = useState(() => readFlag('tok-sym-hall-audio'))
  const [dAlphaAudio, setDAlphaAudio] = useState(() => readFlag('tok-sym-dalpha-audio'))
  const [pulseAudio, setPulseAudio] = useState(() => readFlag('tok-sym-pulse-audio'))
  const [audioVolume, setAudioVolume] = useState(() => readVolume('tok-sym-audio-volume'))

  // Sync theme to DOM and localStorage
  useEffect(() => {
    localStorage.setItem('tok-sym-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Sync units to localStorage
  useEffect(() => {
    localStorage.setItem('tok-sym-units', units)
  }, [units])

  useEffect(() => { store('tok-sym-hall-audio', hallAudio ? 'on' : 'off') }, [hallAudio])
  useEffect(() => { store('tok-sym-dalpha-audio', dAlphaAudio ? 'on' : 'off') }, [dAlphaAudio])
  useEffect(() => { store('tok-sym-pulse-audio', pulseAudio ? 'on' : 'off') }, [pulseAudio])
  useEffect(() => { store('tok-sym-audio-volume', String(audioVolume)) }, [audioVolume])

  // Set initial theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  return (
    <SettingsContext.Provider
      value={{ theme, units, hallAudio, dAlphaAudio, pulseAudio, audioVolume, setTheme, setUnits, setHallAudio, setDAlphaAudio, setPulseAudio, setAudioVolume }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
