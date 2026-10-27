import { useRef, useEffect } from 'react'

/* Inferno colormap (perceptually uniform) — the same ramp as the equilibrium
   panel, so the backdrop previews the real physics the tool computes. */
const INFERNO: [number, number, number][] = [
  [0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96],
  [207, 68, 70], [237, 105, 37], [251, 154, 6], [247, 208, 60], [252, 255, 164],
]
function inferno(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (INFERNO.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = INFERNO[i]
  const b = INFERNO[Math.min(i + 1, INFERNO.length - 1)]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}


/**
 * Atmospheric hero backdrop: a large, faint tokamak poloidal cross-section
 * (nested magnetic flux surfaces with a Shafranov shift, fading edge to core)
 * positioned to bleed off the right edge. It breathes very slowly and each
 * surface carries a faint ripple; still under reduced motion.
 */
export default function PlasmaBackdrop({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let dims = { w: 0, h: 0, dpr: 1 }

    const measure = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      dims = { w: rect.width, h: rect.height, dpr }
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
    }

    const drawFrame = (tMs: number) => {
      const { w, h, dpr } = dims
      if (!(w > 0 && h > 0)) return
      const t = tMs / 1000
      // Breathing: a very slow ~14s cycle drives a faint alpha pulse and a tiny
      // radius expansion; a slower harmonic adds gentle organic shimmer.
      const breathe = Math.sin((t * 2 * Math.PI) / 14)
      const breathe2 = Math.sin((t * 2 * Math.PI) / 22 + 1)
      const pulse = 0.5 + 0.5 * breathe // 0..1

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Large plasma, axis pushed right so it bleeds off the right edge.
      const a = h * 0.85 * (1 + 0.01 * breathe) // ±1% radius breathing
      const cx = w * 0.80
      const cy = h * 0.5
      const kappa = 1.55
      const delta = 0.45
      const N = 20

      // Warm core bloom, faintly pulsing (published 0.14 → 0.19, here a third lower
      // so it reads as part of the picture rather than a background gradient).
      const bloomA = (0.14 + 0.05 * pulse) * (2 / 3)
      const bloom = ctx.createRadialGradient(cx + a * 0.12, cy, 0, cx + a * 0.12, cy, a * 1.5)
      bloom.addColorStop(0, `rgba(252, 178, 98, ${bloomA})`)
      bloom.addColorStop(0.4, `rgba(210, 92, 48, ${bloomA * 0.32})`)
      bloom.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = bloom
      ctx.fillRect(0, 0, w, h)

      // Nested flux surfaces (edge → core), fading in toward the core.
      ctx.lineWidth = 1.1
      const steps = 160
      for (let s = N; s >= 1; s--) {
        const rho = s / N
        const shift = a * 0.14 * (1 - rho)
        const [r, g, b] = inferno(1 - rho)
        const alpha = (0.09 + 0.5 * Math.pow(1 - rho, 1.4)) * (0.95 + 0.05 * pulse)
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
        ctx.beginPath()
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * Math.PI * 2
          // Per-surface ripple for a faint living-plasma shimmer.
          const rr = rho * (1 + 0.005 * Math.sin(t * 0.4 + s * 0.55) * breathe2)
          const R = cx + shift + a * rr * Math.cos(th + delta * Math.sin(th))
          const Z = cy - a * rr * kappa * Math.sin(th)
          if (k === 0) ctx.moveTo(R, Z)
          else ctx.lineTo(R, Z)
        }
        ctx.closePath()
        ctx.stroke()
      }
    }

    // Single animation loop (the only place that schedules rAF).
    const loop = (tMs: number) => {
      drawFrame(tMs)
      raf = requestAnimationFrame(loop)
    }
    const startLoop = () => { if (!reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) } }

    measure()
    // Synchronous first paint — guarantees a static image even when rAF is
    // paused (background/headless tab); the loop animates once visible.
    drawFrame(0)
    startLoop()

    const ro = new ResizeObserver(() => { measure(); drawFrame(0) })
    ro.observe(parent)
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else startLoop()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
