/**
 * iOS plays Web Audio on the ringer channel, so the silent switch mutes it
 * while the context reports `running`. The Audio Session API moves the page
 * to the media channel, but it may be missing in the WebKit view that Chrome
 * and other iOS browsers embed. There, a media element playing inside a user
 * gesture does the same for the whole page, so a silent loop runs while
 * sound is on.
 */
let silence: HTMLAudioElement | null = null

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** A short 8-bit mono WAV of silence at the context's rate, so the output does not switch rate. */
function silentWav(sampleRate: number): string {
  const samples = Math.round(sampleRate / 20)
  const bytes = new Uint8Array(44 + samples).fill(0x80)
  const view = new DataView(bytes.buffer)
  const tag = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
  tag(0, 'RIFF'); view.setUint32(4, 36 + samples, true); tag(8, 'WAVE')
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true)
  tag(36, 'data'); view.setUint32(40, samples, true)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:audio/wav;base64,${btoa(binary)}`
}

/** Call from a user gesture, repeatedly if need be: a play() outside one is refused and retried on the next. */
export function claimMediaChannel(sampleRate: number): void {
  if (!isIOS()) return
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) session.type = 'playback'
  } catch { /* not settable in this view: the silent loop covers it */ }
  if (!silence) {
    silence = document.createElement('audio')
    silence.setAttribute('x-webkit-airplay', 'deny')
    silence.setAttribute('playsinline', '')
    silence.loop = true
    silence.preload = 'auto'
    silence.src = silentWav(sampleRate)
  }
  if (silence.paused) silence.play().catch(() => {})
}

export function releaseMediaChannel(): void {
  silence?.pause()
}
