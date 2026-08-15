import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import type { TracePoint } from '../lib/types'
import type { PulseProgram } from '../lib/wasm'
import { getDevice } from '../lib/wasm'
import { computeTargetTraces, type TargetTraces } from '../lib/targetTraces'
import InfoPopup from './InfoPopup'
import { traceInfoContent } from './infoContent'
import { useSettings } from '../lib/settingsContext'

/* ─── Full trace catalogue ───────────────────────────────── */

interface TraceConfig {
  key: keyof TracePoint
  base: string      // base symbol (e.g. 'β', 'P', 'T')
  sub: string       // subscript text (e.g. 'N', 'fus', 'e,ped')
  unit: string
  color: string
  targetKey?: 'ip' | 'beta_n'
  clampToTarget?: boolean
  yMin?: number
  yMax?: number
}

const ALL_TRACES: TraceConfig[] = [
  { key: 'ip',               base: 'I',     sub: 'p',       unit: 'MA',       color: '#56B4E9', targetKey: 'ip' },
  { key: 'beta_n',           base: 'β',     sub: 'N',       unit: '',         color: '#E69F00', targetKey: 'beta_n' },
  { key: 'li',               base: 'l',     sub: 'i',       unit: '',         color: '#92C5DE', yMin: 0, yMax: 1.5 },
  { key: 'd_alpha',          base: 'D',     sub: 'α',       unit: 'a.u.',     color: '#D55E00' },
  { key: 'q95',              base: 'q',     sub: '95',      unit: '',         color: '#CC79A7', yMax: 10 },
  { key: 'h_factor',         base: 'H',     sub: '98',      unit: '',         color: '#009E73' },
  { key: 'f_greenwald',      base: 'f',     sub: 'GW',      unit: '',         color: '#0072B2' },
  { key: 'ne_bar',           base: 'n\u0305', sub: 'e',     unit: '10²⁰/m³', color: '#0072B2' },
  { key: 'ne_ped',           base: 'n',     sub: 'e,ped',   unit: '10²⁰/m³', color: '#56B4E9' },
  { key: 'te0',              base: 'T',     sub: 'e0',      unit: 'keV',      color: '#E69F00' },
  { key: 'te_ped',           base: 'T',     sub: 'e,ped',   unit: 'keV',      color: '#D55E00' },
  { key: 'ne_line',          base: 'n',     sub: 'e,line',  unit: '10²⁰/m³', color: '#56B4E9' },
  { key: 'w_th',             base: 'W',     sub: 'th',      unit: 'MJ',       color: '#009E73' },
  { key: 'p_input',          base: 'P',     sub: 'in',      unit: 'MW',       color: '#F0E442' },
  { key: 'p_rad',            base: 'P',     sub: 'rad',     unit: 'MW',       color: '#CC79A7' },
  { key: 'p_fus',            base: 'P',     sub: 'fus',     unit: 'MW',       color: '#009E73' },
  { key: 'p_loss',           base: 'P',     sub: 'loss',    unit: 'MW',       color: '#E69F00' },
  { key: 'v_loop',           base: 'V',     sub: 'loop',    unit: 'V',        color: '#92C5DE' },
  { key: 'impurity_fraction',base: 'f',     sub: 'imp',     unit: '%',        color: '#BBBBBB' },
  { key: 'disruption_risk',  base: 'D',     sub: 'risk',    unit: '',         color: '#c8553d' },
]

/** Render a label with proper subscript on canvas.
 *  Right-aligned at (x, y): base symbol at normal size, subscript smaller and lower. */
function drawLabel(ctx: CanvasRenderingContext2D, cfg: TraceConfig, x: number, y: number, isRetro: boolean) {
  const baseFont = isRetro ? '"VCR OSD Mono", "Courier New", monospace' : 'monospace'
  const subFont = isRetro ? `8px ${baseFont}` : `8px ${baseFont}`
  const mainFont = isRetro ? `11px ${baseFont}` : `bold 11px ${baseFont}`

  // Measure subscript width first to position everything right-aligned
  ctx.font = subFont
  const subW = ctx.measureText(cfg.sub).width
  ctx.font = mainFont
  const baseW = ctx.measureText(cfg.base).width
  const totalW = baseW + subW + 1 // 1px gap

  // Draw base symbol
  ctx.font = mainFont
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(cfg.base, x - totalW, y)

  // Draw subscript: smaller, shifted down 3px
  ctx.font = subFont
  ctx.fillText(cfg.sub, x - subW, y + 3)
}

// Default traces vary by device: ITER, SPARC and CENTAUR show P_fus (burning plasma),
// DIII-D and JET show stored energy W_th (more relevant for non-burning devices).
function defaultKeysForDevice(deviceId: string): Set<string> {
  if (deviceId === 'iter' || deviceId === 'centaur' || deviceId === 'sparc') {
    return new Set(['ip', 'beta_n', 'p_fus', 'd_alpha'])
  }
  return new Set(['ip', 'beta_n', 'w_th', 'd_alpha'])
}

const MARGIN_LEFT = 56
const MARGIN_RIGHT = 80
const MARGIN_TOP = 4
const MARGIN_BOTTOM = 2

/* ─── Component ──────────────────────────────────────────── */

interface Props {
  history: TracePoint[]
  programJson: string
  deviceId: string
  duration: number
  /**
   * Scrubbing is allowed whenever the simulation is not advancing — after the
   * pulse (finished) or while paused mid-pulse — so the operator can walk
   * back through the equilibrium and plasma state history at any stop.
   */
  scrubbable: boolean
  scrubTime: number | null
  onScrub: (time: number | null) => void
  elmActive: boolean
}

export default function UnifiedTracePanel({
  history,
  programJson,
  deviceId,
  duration,
  scrubbable,
  scrubTime,
  onScrub,
  elmActive,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => defaultKeysForDevice(deviceId))
  // Reset defaults when device changes
  const prevDeviceRef = useRef(deviceId)
  if (deviceId !== prevDeviceRef.current) {
    prevDeviceRef.current = deviceId
    setSelectedKeys(defaultKeysForDevice(deviceId))
  }
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { theme } = useSettings()
  const isRetro = theme === 'retro'

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  // Active traces based on selection
  const activeTraces = useMemo(() => {
    return ALL_TRACES.filter((t) => selectedKeys.has(t.key))
  }, [selectedKeys])

  const toggleTrace = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size > 1) next.delete(key) // keep at least 1
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  // Parse program & compute target traces (memoized)
  const targets = useMemo<TargetTraces | null>(() => {
    try {
      const program: PulseProgram = JSON.parse(programJson)
      const device = getDevice(deviceId)
      if (!device || !program.ip) return null
      return computeTargetTraces(program, device)
    } catch {
      return null
    }
  }, [programJson, deviceId])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = rect.width
    const H = rect.height
    const numTraces = activeTraces.length
    if (numTraces === 0) return
    const ROW_H = H / numTraces

    // Clear
    ctx.fillStyle = isRetro ? '#000000' : '#0e0f11'
    ctx.fillRect(0, 0, W, H)

    const plotW = W - MARGIN_LEFT - MARGIN_RIGHT
    const tMax = duration > 0 ? duration : 10
    const toX = (t: number) => MARGIN_LEFT + (t / tMax) * plotW

    // Find Dα row for ELM indicator
    const dAlphaRowIdx = activeTraces.findIndex((t) => t.key === 'd_alpha')

    for (let row = 0; row < numTraces; row++) {
      const cfg = activeTraces[row]
      const y0 = row * ROW_H + MARGIN_TOP
      const h = ROW_H - MARGIN_TOP - MARGIN_BOTTOM

      // Row background (subtle alternating charcoal)
      if (isRetro) {
        ctx.fillStyle = '#000000'
      } else {
        ctx.fillStyle = row % 2 === 0 ? '#111316' : '#15171b'
      }
      ctx.fillRect(0, row * ROW_H, W, ROW_H)

      // Row separator
      ctx.strokeStyle = isRetro ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(MARGIN_LEFT, (row + 1) * ROW_H)
      ctx.lineTo(W - MARGIN_RIGHT, (row + 1) * ROW_H)
      ctx.stroke()

      // Retro mode: white grid lines (like DIII-D control room oscilloscopes)
      if (isRetro) {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.lineWidth = 0.5
        // Vertical grid: ~6 divisions across the time axis
        const nVert = 6
        for (let g = 1; g < nVert; g++) {
          const gx = MARGIN_LEFT + (g / nVert) * plotW
          ctx.beginPath()
          ctx.moveTo(gx, row * ROW_H)
          ctx.lineTo(gx, (row + 1) * ROW_H)
          ctx.stroke()
        }
        // Horizontal grid: 4 divisions per row
        const nHoriz = 4
        for (let g = 1; g < nHoriz; g++) {
          const gy = row * ROW_H + (g / nHoriz) * ROW_H
          ctx.beginPath()
          ctx.moveTo(MARGIN_LEFT, gy)
          ctx.lineTo(MARGIN_LEFT + plotW, gy)
          ctx.stroke()
        }
      }

      // ── Compute Y range ──
      let vMin = Infinity
      let vMax = -Infinity

      // Scale impurity_fraction to % for display
      const isImpurityPct = cfg.key === 'impurity_fraction'
      const vals = history.map((pt) => {
        const v = pt[cfg.key] as number
        return isImpurityPct ? v * 100 : v
      })

      // Target data range
      let targetPts: [number, number][] | null = null
      if (cfg.targetKey && targets) {
        targetPts =
          cfg.targetKey === 'ip' ? targets.ipTarget : targets.betaNTarget
        if (targetPts.length > 0) {
          const tVals = targetPts.map((p) => p[1])
          vMin = Math.min(vMin, ...tVals)
          vMax = Math.max(vMax, ...tVals)
        }
      }

      // Include actual data in range only when NOT clamping to target
      if (!cfg.clampToTarget && vals.length > 0) {
        vMin = Math.min(vMin, ...vals)
        vMax = Math.max(vMax, ...vals)
      }

      // Fallback if no data yet
      if (!isFinite(vMin) || !isFinite(vMax)) {
        if (vals.length > 0) {
          vMin = Math.min(...vals)
          vMax = Math.max(...vals)
        } else {
          vMin = 0
          vMax = 1
        }
      }
      if (vMax - vMin < 1e-10) {
        vMin -= 0.5
        vMax += 0.5
      }
      // Apply hard y-axis floor/ceiling if configured
      if (cfg.yMin !== undefined) {
        vMin = cfg.yMin
      }
      if (cfg.yMax !== undefined) {
        vMax = cfg.yMax
      }
      // Add 10% padding (only on sides that don't have a hard limit)
      const range = vMax - vMin
      if (cfg.yMin === undefined) vMin -= range * 0.1
      if (cfg.yMax === undefined) vMax += range * 0.1

      const toY = (v: number) => y0 + h - ((v - vMin) / (vMax - vMin)) * h

      // ── Retro mode: remap trace colors to DIII-D control room palette ──
      // Mostly green, with yellow and blue accents for key traces
      const RETRO_COLORS: Record<string, string> = {
        ip: '#33ff33',           // green
        beta_n: '#ffff33',       // yellow
        li: '#33ff33',           // green
        d_alpha: '#33ff33',      // green
        q95: '#33ccff',          // blue
        h_factor: '#ffff33',     // yellow
        f_greenwald: '#ff6633',  // orange-red (warning trace)
        ne_bar: '#33ccff',       // blue
        ne_ped: '#3399ff',       // blue
        te0: '#ffff33',          // yellow
        te_ped: '#ffcc33',       // yellow
        ne_line: '#33ccff',      // blue
        w_th: '#33ff33',         // green
        p_input: '#ffff33',      // yellow
        p_rad: '#ff6633',        // orange-red
        p_loss: '#ffcc33',       // yellow
        v_loop: '#33ff33',       // green
        impurity_fraction: '#33ff33', // green
        disruption_risk: '#ff3333',   // red
      }
      const traceColor = isRetro ? (RETRO_COLORS[cfg.key] ?? '#33ff33') : cfg.color

      // ── Clip to row bounds so clamped traces don't bleed ──
      ctx.save()
      ctx.beginPath()
      ctx.rect(MARGIN_LEFT, row * ROW_H, plotW, ROW_H)
      ctx.clip()

      // ── Draw target trace (dashed, 50% opacity) ──
      if (targetPts && targetPts.length >= 2) {
        ctx.strokeStyle = traceColor
        ctx.lineWidth = 1.5
        ctx.globalAlpha = 0.35
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        for (let i = 0; i < targetPts.length; i++) {
          const x = toX(targetPts[i][0])
          const y = toY(targetPts[i][1])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }

      // ── Draw actual trace (solid) ──
      if (history.length >= 2) {
        ctx.strokeStyle = traceColor
        ctx.lineWidth = isRetro ? 1.5 : 2
        ctx.globalAlpha = 0.95

        // For D-alpha, detect ELM spikes and render them as perfectly vertical
        // lines (up and back down at the same x) so they appear as transient
        // events rather than triangular "tent poles".
        //
        // Pre-compute a local baseline for each point using a wider window
        // (±3 points, excluding the point itself and any spikes) so that
        // adjacent elevated points from ELM latching don't inflate the baseline.
        const isElmTrace = cfg.key === 'd_alpha'
        // For Dα, use the elm_active flag from the simulation to identify
        // ELM spikes directly — no heuristic threshold needed.
        // Deduplicate adjacent flagged points to render one vertical line per ELM.
        let isSpike: boolean[] | null = null
        if (isElmTrace && history.length > 2) {
          isSpike = new Array(history.length).fill(false)
          for (let i = 1; i < history.length - 1; i++) {
            if (history[i].elm_active) {
              isSpike[i] = true
            }
          }
          // Deduplicate: in each run of adjacent spikes, keep only the tallest
          for (let i = 1; i < history.length; i++) {
            if (isSpike[i] && isSpike[i - 1]) {
              if (vals[i] >= vals[i - 1]) {
                isSpike[i - 1] = false
              } else {
                isSpike[i] = false
              }
            }
          }
        }

        ctx.beginPath()
        for (let i = 0; i < history.length; i++) {
          const x = toX(history[i].t)
          const y = toY(vals[i])

          if (i === 0) {
            ctx.moveTo(x, y)
          } else if (isSpike && isSpike[i]) {
            // ELM spike: draw as vertical line at this x position
            // Find baseline from nearest non-ELM point
            let baseVal = vals[i - 1]
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              if (!history[j].elm_active) { baseVal = vals[j]; break }
            }
            const baseY = toY(baseVal)
            ctx.lineTo(x, baseY)  // continue baseline to spike x
            ctx.lineTo(x, y)      // vertical up to peak
            ctx.lineTo(x, baseY)  // vertical back down
          } else if (isSpike && history[i].elm_active) {
            // Adjacent ELM point (not the tallest) — render at baseline
            // to suppress tent pole shoulders from elevated latched Dα
            let baseVal = vals[i]
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              if (!history[j].elm_active) { baseVal = vals[j]; break }
            }
            ctx.lineTo(x, toY(baseVal))
          } else {
            ctx.lineTo(x, y)
          }
        }
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // ── End row clipping ──
      ctx.restore()

      // ── Label (base + subscript) ──
      ctx.fillStyle = traceColor
      drawLabel(ctx, cfg, MARGIN_LEFT - 8, y0 + h / 2, isRetro)

      // ── Current / scrubbed value readout ──
      // When scrubbing, binary search for closest time in history
      let displayIdx = history.length - 1
      if (scrubTime !== null && history.length > 0) {
        let lo = 0, hi = history.length - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (history[mid].t < scrubTime) lo = mid + 1
          else hi = mid
        }
        displayIdx = lo
        if (lo > 0 && Math.abs(history[lo - 1].t - scrubTime) < Math.abs(history[lo].t - scrubTime)) {
          displayIdx = lo - 1
        }
      }
      if (displayIdx >= 0 && displayIdx < history.length) {
        const val = vals[displayIdx]
        ctx.fillStyle = traceColor
        ctx.font = isRetro ? '11px "VCR OSD Mono", "Courier New", monospace' : '11px monospace'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        const unitStr = cfg.unit ? ` ${cfg.unit}` : ''
        ctx.fillText(
          `${val.toFixed(2)}${unitStr}`,
          W - MARGIN_RIGHT + 6,
          y0 + h / 2,
        )
      }
    }

    // ── ELM indicator on Dα row (if visible) ──
    if (elmActive && dAlphaRowIdx >= 0) {
      const elmY = dAlphaRowIdx * ROW_H + 14
      const elmX = W - MARGIN_RIGHT - 8
      ctx.fillStyle = '#fbbf24' // amber
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'alphabetic'
      ctx.globalAlpha = 0.9
      ctx.fillText('ELM', elmX, elmY)
      ctx.globalAlpha = 1
    }

    // ── ELM suppressed indicator on Dα row (if visible) ──
    const lastPt = history[history.length - 1]
    if (lastPt?.elm_suppressed && dAlphaRowIdx >= 0) {
      const elmY = dAlphaRowIdx * ROW_H + 14
      const elmX = W - MARGIN_RIGHT - 8
      ctx.fillStyle = '#86efac' // green
      ctx.font = 'bold 10px monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'alphabetic'
      ctx.globalAlpha = 0.9
      ctx.fillText('QCE', elmX, elmY)
      ctx.globalAlpha = 1
    }

    // ── "Now" line or scrub line ──
    const totalH = numTraces * ROW_H
    if (scrubTime !== null) {
      // Scrub cursor line — use time directly
      const sx = toX(scrubTime)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, totalH)
      ctx.stroke()
      ctx.globalAlpha = 1

      // Time label at top of scrub line
      ctx.fillStyle = '#ffffff'
      ctx.font = '10px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`${scrubTime.toFixed(2)}s`, sx, 12)
    } else if (history.length > 0) {
      // "Now" line (dashed white)
      const nowX = toX(history[history.length - 1].t)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.3
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(nowX, 0)
      ctx.lineTo(nowX, totalH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    // ── X-axis time labels at bottom ──
    ctx.fillStyle = '#6b7280'
    ctx.font = '9px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const nTicks = Math.min(Math.floor(tMax), 10)
    const tickStep = tMax / nTicks
    for (let i = 0; i <= nTicks; i++) {
      const t = i * tickStep
      const x = toX(t)
      ctx.fillText(`${t.toFixed(0)}`, x, totalH - 12)
    }
    // X-axis unit label — to the left of the first tick
    ctx.textAlign = 'right'
    ctx.fillStyle = '#4b5563'
    ctx.fillText('[sec]', toX(0) - 12, totalH - 12)
  }, [history, duration, targets, scrubTime, elmActive, activeTraces, isRetro])

  // Redraw on data changes
  useEffect(() => {
    draw()
  }, [draw, history.length])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  // ── Mouse scrub interaction ──
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!scrubbable || history.length === 0) return
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const plotW = rect.width - MARGIN_LEFT - MARGIN_RIGHT
      const tMax = duration > 0 ? duration : 10

      // Convert mouse X to time
      const t = ((mouseX - MARGIN_LEFT) / plotW) * tMax
      if (t < 0 || t > tMax) {
        onScrub(null)
        return
      }

      // Pass time directly — useSimulation handles snapshot lookup
      onScrub(t)
    },
    [scrubbable, history.length, duration, onScrub],
  )

  const handleMouseLeave = useCallback(() => {
    if (scrubbable) {
      onScrub(null)
    }
  }, [scrubbable, onScrub])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: scrubbable && history.length > 0 ? 'crosshair' : 'default' }}
      />
      {/* ── Trace selector dropdown ── */}
      <div ref={dropdownRef} className="absolute top-1 right-1 z-10 flex items-center gap-1">
        <InfoPopup title="Trace Reference" position="left">
          {traceInfoContent(ALL_TRACES)}
        </InfoPopup>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="px-2 py-0.5 text-[10px] font-mono rounded
                     bg-gray-800/80 text-gray-300 border border-gray-600/50
                     hover:bg-gray-700/80 hover:text-white transition-colors"
        >
          Traces ({selectedKeys.size})
        </button>
        {dropdownOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-48
                        bg-gray-900 border border-gray-700 rounded shadow-lg
                        max-h-60 overflow-y-auto"
          >
            {ALL_TRACES.map((t) => (
              <label
                key={t.key}
                className="flex items-center gap-2 px-2 py-1 hover:bg-gray-800 cursor-pointer text-[11px] font-mono"
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.has(t.key)}
                  onChange={() => toggleTrace(t.key)}
                  className="accent-cyan-500"
                />
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-gray-300">{t.base}<sub>{t.sub}</sub></span>
                {t.unit && (
                  <span className="text-gray-500 ml-auto">{t.unit}</span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
