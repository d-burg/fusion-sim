import { useEffect, useState } from 'react'

const QUERY = '(max-width: 767px)'

/** True on narrow (phone) viewports; follows the media query live. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = (e: MediaQueryListEvent) => setPhone(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}
