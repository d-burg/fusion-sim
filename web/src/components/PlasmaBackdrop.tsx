import { useRef, useEffect } from 'react'

/** The warm hue of the Standard grammar (the separatrix's glow on the control room). */
const WARM = '240, 169, 138'

/**
 * The landing hero's picture: a large tokamak poloidal cross-section drawn
 * line-only on the flat field. Nested flux surfaces are white at low opacity;
 * the separatrix is the one bright line and carries the warm hue faintly, as
 * on the control room's equilibrium. No fill, no gradient, no bloom. It
 * breathes very slowly; still under reduced motion.
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
      // Breathing: a ~14 s cycle drives a tiny radius change; a slower harmonic adds a faint shimmer.
      const breathe = Math.sin((t * 2 * Math.PI) / 14)
      const breathe2 = Math.sin((t * 2 * Math.PI) / 22 + 1)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // The cross-section fills the band's height (the D's tips just touch the
      // edges) and sits at the right, clear of the wordmark.
      const a = h * 0.35 * (1 + 0.01 * breathe)
      const cx = w * 0.76
      const cy = h * 0.5
      const kappa = 1.55
      const delta = 0.45
      const N = 18
      const steps = 180

      const surface = (rho: number, s: number) => {
        const shift = a * 0.14 * Math.max(0, 1 - rho)
        ctx.beginPath()
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * Math.PI * 2
          const rr = rho * (1 + 0.004 * Math.sin(t * 0.4 + s * 0.55) * breathe2)
          const R = cx + shift + a * rr * Math.cos(th + delta * Math.sin(th))
          const Z = cy - a * rr * kappa * Math.sin(th)
          if (k === 0) ctx.moveTo(R, Z)
          else ctx.lineTo(R, Z)
        }
        ctx.closePath()
        ctx.stroke()
      }

      // Scrape-off layer: a few open surfaces outside the separatrix, fainter with distance.
      ctx.lineWidth = 1
      ;[1.05, 1.11, 1.18].forEach((rho, i) => {
        ctx.strokeStyle = `rgba(255,255,255,${(0.05 - 0.015 * i).toFixed(3)})`
        surface(rho, N + 1 + i)
      })

      // Closed flux surfaces, brighter toward the edge so the eye reads the boundary.
      for (let s = 1; s < N; s++) {
        const rho = s / N
        ctx.strokeStyle = `rgba(255,255,255,${(0.05 + 0.10 * rho).toFixed(3)})`
        surface(rho, s)
      }

      // Separatrix: the warmth underneath, then the one bright line.
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = `rgba(${WARM},0.10)`; ctx.lineWidth = 9; surface(1, N)
      ctx.strokeStyle = `rgba(${WARM},0.22)`; ctx.lineWidth = 3.5; surface(1, N)
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2; surface(1, N)

      // Magnetic axis as the control room's tiny square marker.
      const ax = Math.round(cx + a * 0.14)
      const ay = Math.round(cy)
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillRect(ax - 2, ay - 2, 4, 4)
    }

    const loop = (tMs: number) => {
      drawFrame(tMs)
      raf = requestAnimationFrame(loop)
    }
    const startLoop = () => { if (!reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) } }

    measure()
    // Synchronous first paint so a static image exists even when rAF is paused.
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
