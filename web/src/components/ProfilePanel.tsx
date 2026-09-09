import { useEffect, useRef } from 'react'
import type { ProcessedProfile } from '../lib/types'

interface Props {
  profiles: ProcessedProfile[] | null
  currentIndex: number
  teMax: number
  neMax: number
  pMax: number
  showThomson: boolean
  showPressure: boolean
}

const MARGIN = { top: 12, right: 8, bottom: 20, left: 40 }

export default function ProfilePanel({
  profiles,
  currentIndex,
  teMax,
  neMax,
  pMax,
  showThomson,
  showPressure,
}: Props) {
  const teCanvasRef = useRef<HTMLCanvasElement>(null)
  const neCanvasRef = useRef<HTMLCanvasElement>(null)
  const pCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const teCanvas = teCanvasRef.current
    const neCanvas = neCanvasRef.current
    const pCanvas = pCanvasRef.current
    if (!container || !teCanvas || !neCanvas || !profiles || profiles.length === 0) return

    const profile = profiles[Math.min(currentIndex, profiles.length - 1)]
    if (!profile) return

    const te = profile.te_profile
    const ne = profile.ne_profile
    const nRho = te.length

    // Size canvases: side-by-side tiles
    const rect = container.getBoundingClientRect()
    const numCanvases = showPressure ? 3 : 2
    const tileW = Math.floor(rect.width / numCanvases)
    const H = Math.floor(rect.height)
    const dpr = window.devicePixelRatio || 1

    const canvases = showPressure && pCanvas
      ? [teCanvas, neCanvas, pCanvas]
      : [teCanvas, neCanvas]

    for (const canvas of canvases) {
      canvas.width = tileW * dpr
      canvas.height = H * dpr
      canvas.style.width = `${tileW}px`
      canvas.style.height = `${H}px`
    }

    // Draw Te canvas
    drawProfileCanvas(teCanvas, {
      W: tileW,
      H,
      dpr,
      rhoData: te,
      nRho,
      yMax: teMax,
      lineColor: '#ef4444',
      label: 'Te (keV)',
      labelColor: '#ef4444',
      thomsonPoints: showThomson ? profile.te_thomson : null,
      scatterColor: '#fca5a5',
      hmodeLabel: profile.in_hmode ? 'H' : 'L',
    })

    // Draw ne canvas
    drawProfileCanvas(neCanvas, {
      W: tileW,
      H,
      dpr,
      rhoData: ne,
      nRho,
      yMax: neMax,
      lineColor: '#3b82f6',
      label: 'ne (10²⁰/m³)',
      labelColor: '#3b82f6',
      thomsonPoints: showThomson ? profile.ne_thomson : null,
      scatterColor: '#93c5fd',
      hmodeLabel: null,
    })

    // Draw Pressure canvas (separate tile)
    if (showPressure && pCanvas) {
      const pressure = te.map((t, i) => 2 * ne[i] * t)
      drawProfileCanvas(pCanvas, {
        W: tileW,
        H,
        dpr,
        rhoData: pressure,
        nRho,
        yMax: pMax,
        lineColor: '#22c55e',
        label: 'P (keV·10²⁰/m³)',
        labelColor: '#22c55e',
        thomsonPoints: null,
        scatterColor: '',
        hmodeLabel: null,
      })
    }
  }, [profiles, currentIndex, teMax, neMax, pMax, showThomson, showPressure])

  if (!profiles || profiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Profile data available after pulse
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-row">
      <canvas ref={teCanvasRef} className="block flex-1 h-full" />
      <canvas ref={neCanvasRef} className="block flex-1 h-full" />
      {showPressure && <canvas ref={pCanvasRef} className="block flex-1 h-full" />}
    </div>
  )
}

interface DrawOpts {
  W: number
  H: number
  dpr: number
  rhoData: number[]
  nRho: number
  yMax: number
  lineColor: string
  label: string
  labelColor: string
  thomsonPoints: { rho: number; val: number }[] | null
  scatterColor: string
  hmodeLabel: string | null
}

function drawProfileCanvas(canvas: HTMLCanvasElement, opts: DrawOpts) {
  const {
    W,
    H,
    dpr,
    rhoData,
    nRho,
    yMax,
    lineColor,
    label,
    labelColor,
    thomsonPoints,
    scatterColor,
    hmodeLabel,
  } = opts

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // Clear
  ctx.fillStyle = '#111827'
  ctx.fillRect(0, 0, W, H)

  const plotW = W - MARGIN.left - MARGIN.right
  const plotH = H - MARGIN.top - MARGIN.bottom
  if (plotW < 20 || plotH < 20) return

  // Helpers
  const xOf = (rho: number) => MARGIN.left + rho * plotW
  const yOf = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH

  // Grid
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = MARGIN.top + (plotH * i) / 4
    ctx.beginPath()
    ctx.moveTo(MARGIN.left, y)
    ctx.lineTo(MARGIN.left + plotW, y)
    ctx.stroke()
  }
  for (let i = 0; i <= 5; i++) {
    const x = MARGIN.left + (plotW * i) / 5
    ctx.beginPath()
    ctx.moveTo(x, MARGIN.top)
    ctx.lineTo(x, MARGIN.top + plotH)
    ctx.stroke()
  }

  // Left Y-axis ticks
  ctx.font = '8px monospace'
  ctx.textAlign = 'right'
  ctx.fillStyle = labelColor
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4
    ctx.fillText(v.toFixed(yMax < 1 ? 2 : 1), MARGIN.left - 3, yOf(v) + 3)
  }

  // Left axis label (rotated)
  ctx.save()
  ctx.translate(7, MARGIN.top + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = labelColor
  ctx.font = '8px monospace'
  ctx.fillText(label, 0, 0)
  ctx.restore()

  // X-axis labels (every tile gets its own)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#6b7280'
  ctx.font = '8px monospace'
  ctx.fillText('ρ', MARGIN.left + plotW / 2, H - 1)
  for (let i = 0; i <= 5; i++) {
    const rho = i / 5
    ctx.fillText(rho.toFixed(1), xOf(rho), H - 8)
  }

  // Profile line (thicker)
  ctx.beginPath()
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 2.5
  for (let i = 0; i < nRho; i++) {
    const rho = i / (nRho - 1)
    const x = xOf(rho)
    const y = yOf(rhoData[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Thomson scatter points
  if (thomsonPoints) {
    ctx.strokeStyle = scatterColor
    ctx.lineWidth = 1
    for (const pt of thomsonPoints) {
      ctx.beginPath()
      ctx.arc(xOf(pt.rho), yOf(Math.max(pt.val, 0)), 2.5, 0, 2 * Math.PI)
      ctx.stroke()
    }
  }

  // Legend
  const legendX = MARGIN.left + 6
  let legendY = MARGIN.top + 10
  ctx.font = '8px monospace'
  ctx.textAlign = 'left'

  ctx.fillStyle = lineColor
  ctx.fillText(`\u2014 ${label.split(' ')[0]}`, legendX, legendY)

  if (thomsonPoints) {
    legendY += 10
    ctx.fillStyle = scatterColor
    ctx.fillText('\u25cb Thomson', legendX, legendY)
  }

  // H-mode / L-mode badge
  if (hmodeLabel) {
    const badgeX = MARGIN.left + plotW - 16
    const badgeY = MARGIN.top + 10
    ctx.font = 'bold 8px monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = hmodeLabel === 'H' ? '#06b6d4' : '#9ca3af'
    ctx.fillText(`${hmodeLabel}-mode`, badgeX, badgeY)
  }
}
