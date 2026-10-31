/**
 * Temporary on-device readout for the iOS scroll and audio reports: open any
 * page with ?diag=1 and it stays on for the tab. Remove before merging.
 */
const contexts: AudioContext[] = []

function probe(css: string): number {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;${css}`
  document.body.appendChild(el)
  const h = el.getBoundingClientRect().height
  el.remove()
  return Math.round(h)
}

const nameOf = (e: Element) =>
  (e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '')).slice(0, 26)

function report(): string {
  const de = document.documentElement
  const root = document.getElementById('root')!
  const vv = window.visualViewport
  const offset = root.scrollTop + window.scrollY
  const rows: { b: number; r: number; n: string; ink: boolean }[] = []
  for (const e of document.querySelectorAll('#root *')) {
    const c = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    if (c.display === 'none' || c.position === 'fixed' || (!r.width && !r.height)) continue
    const ink = e.tagName === 'CANVAS' || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
    rows.push({ b: Math.round(r.bottom + offset), r: Math.round(r.right), n: nameOf(e) + (c.visibility === 'hidden' ? ' HID' : ''), ink })
  }
  const low = [...rows].sort((a, x) => x.b - a.b)
  const lastInk = low.find((x) => x.ink)
  const wide = [...rows].sort((a, x) => x.r - a.r).slice(0, 2)
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  return [
    `${location.pathname} dpr ${devicePixelRatio} ${/CriOS/.test(navigator.userAgent) ? 'Chrome' : /Safari/.test(navigator.userAgent) ? 'Safari' : 'other'}`,
    `inner ${innerWidth}x${innerHeight} screen ${screen.width}x${screen.height}`,
    `vv ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} s${vv.scale.toFixed(2)} top${Math.round(vv.offsetTop)}` : 'none'}`,
    `100vh ${probe('height:100vh')} dvh ${probe('height:100dvh')} svh ${probe('height:100svh')} safeB ${probe('height:env(safe-area-inset-bottom)')}`,
    `doc ${de.scrollWidth}x${de.scrollHeight} cli ${de.clientHeight} y${Math.round(scrollY)}`,
    `body h${Math.round(document.body.getBoundingClientRect().height)} pos ${getComputedStyle(document.body).position}`,
    `root sh${root.scrollHeight} ch${root.clientHeight} y${Math.round(root.scrollTop)}`,
    `lastInk ${lastInk?.b} ${lastInk?.n}`,
    ...low.slice(0, 3).map((x) => `low ${x.b} ${x.n}`),
    ...wide.map((x) => `wide ${x.r} ${x.n}`),
    `audio ctx ${contexts.map((c) => c.state).join(',') || 'none'} session ${session ? session.type : 'none'}`,
  ].join('\n')
}

export function installDiag(): void {
  let on = false
  try {
    if (location.search.includes('diag=1')) sessionStorage.setItem('tok-sym-diag', '1')
    on = sessionStorage.getItem('tok-sym-diag') === '1'
  } catch { on = location.search.includes('diag=1') }
  if (!on) return
  const Real = window.AudioContext
  window.AudioContext = class extends Real {
    constructor(options?: AudioContextOptions) { super(options); contexts.push(this) }
  }
  const box = document.createElement('pre')
  box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;margin:0;padding:4px 6px;font:10px/1.25 monospace;color:#0f0;background:rgba(0,0,0,.82);pointer-events:none;white-space:pre-wrap'
  const tick = () => {
    if (!box.isConnected) document.body.appendChild(box)
    box.textContent = report()
  }
  setInterval(tick, 700)
}
