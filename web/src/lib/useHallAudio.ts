/**
 * Drives the hall audio from the control room's simulation state. The engine
 * is created inside a user gesture (the settings click, or the Start click
 * when a stored setting is already on), because browsers only let an audio
 * context run after one. Every published snapshot feeds the steady levels;
 * disruptions and ELMs are detected as edges here, so each fires once.
 */
import { useCallback, useEffect, useRef } from 'react'
import { HallAudio } from './hallAudio'
import { useSettings } from './settingsContext'
import type { SimState } from './useSimulation'
import type { Device } from './wasm'

export interface HallAudioControls {
  /** Call from the Start click: builds a deferred engine and resumes a suspended context. */
  prime: () => void
}

/** Whether the page has seen a user gesture yet (assumed where the API is missing). */
function hasActivation(): boolean {
  return navigator.userActivation?.hasBeenActive ?? true
}

export function useHallAudio(state: SimState, device: Device | null): HallAudioControls {
  const { sound, hallAudio: hallOn, dAlphaAudio: dAlphaOn, pulseAudio: pulseOn, audioVolume } = useSettings()
  // The SOUND setting (first-run card, settings menu) is the master switch; the
  // channel toggles only choose what plays while it is on.
  const on = sound === 'on'
  const hallAudio = on && hallOn
  const dAlphaAudio = on && dAlphaOn
  const pulseAudio = on && pulseOn
  const engineRef = useRef<HallAudio | null>(null)
  const prevRef = useRef({ disrupted: false, elmCount: 0 })
  const settingsRef = useRef({ hallAudio, dAlphaAudio, pulseAudio, audioVolume })
  settingsRef.current = { hallAudio, dAlphaAudio, pulseAudio, audioVolume }
  /** A stored "on" setting found before any gesture: build on the first click instead. */
  const deferredRef = useRef(false)
  const enabled = hallAudio || dAlphaAudio || pulseAudio

  const applySettings = useCallback(() => {
    const s = settingsRef.current
    engineRef.current ??= new HallAudio()
    engineRef.current.setVolume(s.audioVolume)
    engineRef.current.setEnabled(s.hallAudio, s.dAlphaAudio, s.pulseAudio)
  }, [])

  useEffect(() => {
    if (!enabled) {
      deferredRef.current = false
      engineRef.current?.setEnabled(false, false, false)
      return
    }
    if (!engineRef.current && !hasActivation()) {
      deferredRef.current = true
      return
    }
    deferredRef.current = false
    applySettings()
  }, [enabled, hallAudio, dAlphaAudio, pulseAudio, audioVolume, applySettings])

  useEffect(() => () => {
    engineRef.current?.dispose()
    engineRef.current = null
  }, [])

  const { snapshot, running, finished, elmCount } = state
  useEffect(() => {
    const engine = engineRef.current
    const prev = prevRef.current
    const disrupted = !!snapshot?.disrupted
    if (engine && enabled) {
      engine.update(snapshot, device, running && !finished, performance.now())
      // The thud is scaled against the pulse's own flat-top, so a disruption
      // at full current is the full thud on every machine.
      if (snapshot && disrupted && !prev.disrupted) {
        engine.disruption(snapshot.ip, snapshot.prog_ip_peak || device?.ip_max || 0)
      }
      if (snapshot && elmCount > prev.elmCount) engine.elm(snapshot.elm_energy_loss ?? 0, snapshot.w_th)
    }
    // Tracked even while disabled, so switching audio on mid-pulse does not
    // replay an old disruption or a backlog of ELMs.
    prev.disrupted = disrupted
    prev.elmCount = elmCount
  }, [snapshot, running, finished, elmCount, device, enabled])

  const prime = useCallback(() => {
    if (deferredRef.current) {
      deferredRef.current = false
      applySettings()
    }
    engineRef.current?.resume()
  }, [applySettings])

  return { prime }
}
