/**
 * Magnetics diagnostic panel — synthetic Mirnov coil signal and spectrogram.
 *
 * ─── What this is ───────────────────────────────────────────────────────────
 * A **synthetic** magnetics diagnostic. The 0D transport model does not compute
 * edge MHD, so nothing here is predicted — the signal is reconstructed from the
 * simulated regime using published mode parameters, in the same spirit as the
 * Dα and divertor-thermal traces elsewhere in this simulator.
 *
 * ─── Why it earns its place ─────────────────────────────────────────────────
 * Magnetics are how these regimes are actually *identified*. An EDA H-mode or a
 * QCE discharge does not announce itself; you see a quasi-coherent mode (QCM)
 * appear in the Mirnov spectrum at the pedestal, and the ELM spikes stop.
 * Reproducing that gives the ELM-free claim something observable behind it.
 *
 * ─── Time base ──────────────────────────────────────────────────────────────
 * Everything is a pure function of SIMULATION time, not wall-clock time:
 *   • the spectrogram is rendered from the trace history over the 12 s window
 *     ending at the displayed snapshot's time,
 *   • the Mirnov trace and all noise are seeded from the same sim time.
 * Consequences, by construction rather than by special-casing: pausing the sim
 * freezes the panel, and after the pulse (or while paused) the spectrogram
 * scrolls with the trace-panel scrub bar exactly like every other trace.
 *
 * ─── Published mode parameters ──────────────────────────────────────────────
 * Alcator C-Mod, EDA H-mode (Greenwald et al.; Golfinopoulos et al.):
 *   f ≈ 50–150 kHz (commonly quoted "of order 100 kHz"), n ≈ 17,
 *   k_θ ≈ 5 cm⁻¹, localised in the pedestal density-gradient region.
 *
 * ASDEX Upgrade, EDA H-mode and QCE (Nucl. Fusion 64, 10.1088/1741-4326/ad0d32):
 *   f ≈ 15–35 kHz, ρ_pol = 0.993 ± 0.007, harmonics to n = 10, and the
 *   frequency scaling f_QCM·R₀/c_s ∝ 1/β_pol².
 *   Crucially: **Δf_QCM < 10 kHz indicates EDA H-mode; a broader band is QCE.**
 *
 * SPARC is anchored near the C-Mod value — high field, compact, ICRF-heated,
 * and the explicit basis for SPARC's EDA candidacy.
 */
import { useEffect, useRef } from 'react'
import type { Snapshot, TracePoint } from '../lib/types'
import {
  deriveMode,
  specColor,
  hash2,
  historyIndexAt,
  F_MAX_KHZ,
  SPEC_COLS,
  SPEC_ROWS,
  WINDOW_S,
  TRACE_SAMPLES,
  type Regime,
} from '../lib/magnetics'

interface Props {
  snapshot: Snapshot | null
  /** Only SPARC ships this panel today; other devices show the placeholder. */
  deviceId: string
  /** Trace history from useSimulation — the spectrogram is rendered from it. */
  history: TracePoint[]
}

export default function MagneticsPanel({ snapshot, deviceId, history }: Props) {
  const traceRef = useRef<HTMLCanvasElement>(null)
  const specRef = useRef<HTMLCanvasElement>(null)
  /** Scratch canvas for the spectrogram bitmap, allocated once. */
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)

  const mode = deriveMode(snapshot)
  const tEnd = snapshot?.time ?? 0

  // Redraw whenever the displayed snapshot changes (each running frame, each
  // scrub step). Everything below is a pure function of sim time + history,
  // so a paused simulation renders a byte-identical — frozen — panel.
  useEffect(() => {
    const traceCanvas = traceRef.current
    const specCanvas = specRef.current
    if (!traceCanvas || !specCanvas) return
    const tctx = traceCanvas.getContext('2d')
    const sctx = specCanvas.getContext('2d')
    if (!tctx || !sctx) return

    const dtCol = WINDOW_S / SPEC_COLS

    /* ── Mirnov coil trace ────────────────────────────────── */
    const { regime, fQcm, bandwidth, amplitude, broadband } = mode
    // Recent ELM within the trace window → broadband spike burst
    const idxNow = historyIndexAt(history, tEnd)
    let recentElm = false
    for (let k = idxNow; k >= 0 && history[k].t > tEnd - 0.08; k--) {
      if (history[k].elm_active) { recentElm = true; break }
    }

    const tw = traceCanvas.width
    const th = traceCanvas.height
    tctx.fillStyle = '#0a0e14'
    tctx.fillRect(0, 0, tw, th)

    if (regime !== 'none') {
      tctx.strokeStyle = regime === 'qce' || regime === 'eda' ? '#22d3ee' : '#64748b'
      tctx.lineWidth = 1
      tctx.beginPath()
      // Seed the noise from quantised sim time: the trace evolves while the
      // sim runs and freezes when it pauses.
      const seed = Math.round(tEnd * 499)
      for (let i = 0; i < TRACE_SAMPLES; i++) {
        const frac = i / TRACE_SAMPLES
        // A Mirnov coil is genuinely noisy — the coherent mode is buried in
        // broadband turbulence and only becomes obvious in the transform.
        let v = (hash2(seed, i) - 0.5) * 2 * (0.62 * broadband + 0.10)
        // Low-frequency wander (mimics unresolved MHD + pickup)
        v += 0.22 * broadband * Math.sin(frac * 23.0 + tEnd * 2.7)
          * (0.5 + hash2(seed, i + 7000))
        // Occasional larger excursions — intermittent filaments
        if (hash2(seed, i + 14000) > 0.985) {
          v += (hash2(seed, i + 21000) - 0.5) * 2.2 * broadband
        }
        if (amplitude > 0 && fQcm > 0) {
          // Coherent QCM: amplitude-jittered sinusoid; the finite bandwidth
          // appears as phase noise scaled by Δf.
          const phaseJitter = (hash2(seed, i + 28000) - 0.5) * bandwidth * 0.05
          const ampJitter = 0.75 + 0.5 * hash2(Math.round(tEnd * 61), i >> 4)
          const phase = 2 * Math.PI * (i * fQcm) / (F_MAX_KHZ * 3.2) + tEnd * 37.0
          v += amplitude * 0.40 * ampJitter * Math.sin(phase + phaseJitter)
          v += amplitude * 0.12 * Math.sin(2 * phase + phaseJitter * 1.7)
        }
        if (recentElm) v += (hash2(seed, i + 35000) - 0.5) * 2.6
        const x = frac * tw
        const y = th / 2 - Math.max(-1.4, Math.min(1.4, v)) * th * 0.34
        if (i === 0) tctx.moveTo(x, y)
        else tctx.lineTo(x, y)
      }
      tctx.stroke()
    }

    /* ── Spectrogram: rendered from history over [tEnd − 12 s, tEnd] ────── */
    const img = sctx.createImageData(SPEC_COLS, SPEC_ROWS)
    for (let c = 0; c < SPEC_COLS; c++) {
      const tCol = tEnd - (SPEC_COLS - 1 - c) * dtCol
      // Global column index — the noise key, invariant under scrubbing
      const gCol = Math.round(tCol / dtCol)
      const idx = tCol >= 0 ? historyIndexAt(history, tCol) : -1
      const pt = idx >= 0 ? history[idx] : null
      const colMode = deriveMode(pt)
      // ELM burst if any history sample inside this column's bin crashed
      let elm = 0
      if (pt) {
        for (let k = idx; k >= 0 && history[k].t > tCol - dtCol; k--) {
          if (history[k].elm_active) { elm = 1; break }
        }
      }

      for (let r = 0; r < SPEC_ROWS; r++) {
        const f = ((SPEC_ROWS - 1 - r) / (SPEC_ROWS - 1)) * F_MAX_KHZ
        let p = colMode.regime === 'none'
          ? 0
          : colMode.broadband * 0.46 * Math.exp(-f / 90) + 0.02
        if (colMode.amplitude > 0 && colMode.fQcm > 0) {
          const w = Math.max(colMode.bandwidth, 2)
          p += colMode.amplitude * Math.exp(-((f - colMode.fQcm) ** 2) / (2 * w * w))
          p += colMode.amplitude * 0.3
            * Math.exp(-((f - 2 * colMode.fQcm) ** 2) / (2 * (w * 1.5) ** 2))
        }
        if (elm > 0) p += 0.9 * Math.exp(-f / 160)
        // Heavy multiplicative speckle — real spectrograms are grainy
        p *= 0.55 + 0.9 * hash2(gCol, r)
        const [rr, gg, bb] = specColor(p)
        const o = (r * SPEC_COLS + c) * 4
        img.data[o] = rr
        img.data[o + 1] = gg
        img.data[o + 2] = bb
        img.data[o + 3] = 255
      }
    }

    // Draw at native size then scale up, so the bitmap stays crisp.
    sctx.imageSmoothingEnabled = false
    if (!offscreenRef.current) {
      const c = document.createElement('canvas')
      c.width = SPEC_COLS
      c.height = SPEC_ROWS
      offscreenRef.current = c
    }
    offscreenRef.current.getContext('2d')?.putImageData(img, 0, 0)
    sctx.drawImage(offscreenRef.current, 0, 0, specCanvas.width, specCanvas.height)
  }, [snapshot, mode, history, tEnd])

  if (deviceId !== 'sparc') {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 font-mono text-[11px] px-4 text-center">
        Magnetics diagnostic is only modelled for SPARC
      </div>
    )
  }

  const regimeLabel: Record<Regime, string> = {
    none: '—',
    lmode: 'L-mode · broadband only',
    elmy: 'grassy ELMs · bursts',
    qce: 'QCE · broad QCM',
    eda: 'EDA · coherent QCM',
  }
  const regimeColor: Record<Regime, string> = {
    none: 'text-gray-600',
    lmode: 'text-gray-400',
    elmy: 'text-amber-400',
    qce: 'text-cyan-400',
    eda: 'text-emerald-400',
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* pr-28 keeps the header clear of the Port/Magnetics tab group, which
          the ControlRoom positions over the top-right corner of this cell. */}
      <div className="flex flex-col px-3 pt-2 pb-1 shrink-0 pr-28">
        <div className="panel-title">
          <span className="panel-num">05 · </span>Magnetics
        </div>
        <div className={`font-mono text-[10px] tabular-nums mt-0.5 ${regimeColor[mode.regime]}`}>
          {regimeLabel[mode.regime]}
          {mode.fQcm > 0 && (
            <span className="ml-2 text-gray-500">
              f<sub>QCM</sub> ≈ {mode.fQcm.toFixed(0)} kHz · Δf {mode.bandwidth.toFixed(0)} kHz
            </span>
          )}
        </div>
      </div>

      {/* Mirnov coil trace */}
      <div className="px-3 shrink-0">
        <div className="font-mono text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">
          Mirnov coil · dB<sub>θ</sub>/dt
        </div>
        <canvas ref={traceRef} width={640} height={54} className="w-full h-[54px] rounded-sm" />
      </div>

      {/* Spectrogram */}
      <div className="px-3 pt-2 pb-2 flex-1 min-h-0 flex flex-col">
        <div className="font-mono text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">
          Spectrogram · 0–{F_MAX_KHZ} kHz
        </div>
        <div className="relative flex-1 min-h-0">
          <canvas ref={specRef} width={640} height={220} className="w-full h-full rounded-sm" />
          {/* Frequency axis ticks */}
          <div className="absolute inset-y-0 left-0 flex flex-col justify-between pointer-events-none
                          font-mono text-[8px] text-gray-500 py-0.5 pl-0.5">
            <span>{F_MAX_KHZ}</span>
            <span>{F_MAX_KHZ / 2}</span>
            <span>0</span>
          </div>
        </div>
        {/* Time axis — the window scrubs with the trace panel */}
        <div className="flex justify-between font-mono text-[8px] text-gray-600 mt-0.5">
          <span>t − {WINDOW_S} s</span>
          <span>t = {tEnd.toFixed(2)} s</span>
        </div>
        <div className="font-mono text-[8px] text-gray-600 mt-1 leading-tight">
          Synthetic diagnostic — reconstructed from the simulated regime using published QCM
          parameters (C-Mod ≈50–150 kHz; AUG Δf&lt;10 kHz ⇒ EDA, broader ⇒ QCE). Not a prediction.
        </div>
      </div>
    </div>
  )
}
