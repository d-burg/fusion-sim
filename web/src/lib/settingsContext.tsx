/* eslint-disable react-refresh/only-export-components -- the settings hook, its provider and the LOOKS table share one module by design */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { safeGet, safeSet } from './safeStorage'

export type Theme = 'signature' | 'retro'
export type Units = 'metric' | 'imperial'
/** Control-room audio. Stored under `tok-sym-sound`; off until the user turns it on. */
export type Sound = 'on' | 'off'
/** Master volume for every audio channel, 0–1; stored under `tok-sym-audio-volume`. */
const DEFAULT_VOLUME = 0.5
function readVolume(): number {
  const raw = safeGet('tok-sym-audio-volume')
  const v = Number(raw)
  return raw !== null && Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME
}
/** An audio channel is on unless the user has turned it off; `sound` gates all of them. */
function readChannel(key: string): boolean {
  return safeGet(key) !== 'off'
}
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
  /** Machine sounds from the torus hall: coils, converters, generators, beams, the disruption thud. */
  hallAudio: boolean
  /** A click per ELM on a separately labeled channel. */
  dAlphaAudio: boolean
  /** The pulse made audible: current ramp, divertor, neutron detector. */
  pulseAudio: boolean
  /** Master volume for every channel, 0–1. */
  audioVolume: number
  phoneTraces: string[]
  setTheme: (t: Theme) => void
  setUnits: (u: Units) => void
  setLook: (l: Look) => void
  setSound: (s: Sound) => void
  setHallAudio: (on: boolean) => void
  setDAlphaAudio: (on: boolean) => void
  setPulseAudio: (on: boolean) => void
  setAudioVolume: (v: number) => void
  setPhoneTraces: (keys: string[]) => void
}

const SettingsContext = createContext<Settings>({
  theme: 'signature',
  units: 'metric',
  look: 'kaldera',
  sound: 'off',
  hallAudio: true,
  dAlphaAudio: true,
  pulseAudio: true,
  audioVolume: DEFAULT_VOLUME,
  phoneTraces: DEFAULT_PHONE_TRACES,
  setTheme: () => {},
  setUnits: () => {},
  setLook: () => {},
  setSound: () => {},
  setHallAudio: () => {},
  setDAlphaAudio: () => {},
  setPulseAudio: () => {},
  setAudioVolume: () => {},
  setPhoneTraces: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Every setting is read once on mount and written only when the user changes
  // it, so an untouched setting stays unstored and follows the shipped default.
  const [theme, setThemeState] = useState<Theme>(() => normalizeTheme(safeGet('tok-sym-theme')))
  const [units, setUnitsState] = useState<Units>(() => (safeGet('tok-sym-units') === 'imperial' ? 'imperial' : 'metric'))
  const [look, setLookState] = useState<Look>(() => normalizeLook(safeGet('tok-sym-look')))
  const [sound, setSoundState] = useState<Sound>(() => (safeGet('tok-sym-sound') === 'on' ? 'on' : 'off'))
  const [hallAudio, setHallAudioState] = useState(() => readChannel('tok-sym-hall-audio'))
  const [dAlphaAudio, setDAlphaAudioState] = useState(() => readChannel('tok-sym-dalpha-audio'))
  const [pulseAudio, setPulseAudioState] = useState(() => readChannel('tok-sym-pulse-audio'))
  const [audioVolume, setAudioVolumeState] = useState(readVolume)
  const [phoneTraces, setPhoneTracesState] = useState<string[]>(readPhoneTraces)

  const setTheme = useCallback((t: Theme) => { setThemeState(t); safeSet('tok-sym-theme', t) }, [])
  const setUnits = useCallback((u: Units) => { setUnitsState(u); safeSet('tok-sym-units', u) }, [])
  const setLook = useCallback((l: Look) => { setLookState(l); safeSet('tok-sym-look', l) }, [])
  const setSound = useCallback((v: Sound) => { setSoundState(v); safeSet('tok-sym-sound', v) }, [])
  const setHallAudio = useCallback((on: boolean) => { setHallAudioState(on); safeSet('tok-sym-hall-audio', on ? 'on' : 'off') }, [])
  const setDAlphaAudio = useCallback((on: boolean) => { setDAlphaAudioState(on); safeSet('tok-sym-dalpha-audio', on ? 'on' : 'off') }, [])
  const setPulseAudio = useCallback((on: boolean) => { setPulseAudioState(on); safeSet('tok-sym-pulse-audio', on ? 'on' : 'off') }, [])
  const setAudioVolume = useCallback((v: number) => { setAudioVolumeState(v); safeSet('tok-sym-audio-volume', String(v)) }, [])
  const setPhoneTraces = useCallback((keys: string[]) => {
    setPhoneTracesState(keys)
    safeSet('tok-sym-phone-traces', JSON.stringify(keys))
  }, [])

  // Sync theme to the DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <SettingsContext.Provider
      value={{
        theme, units, look, sound, hallAudio, dAlphaAudio, pulseAudio, audioVolume, phoneTraces,
        setTheme, setUnits, setLook, setSound, setHallAudio, setDAlphaAudio, setPulseAudio, setAudioVolume, setPhoneTraces,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
