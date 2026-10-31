import { useEffect, useState } from 'react'

/** Portrait phones by width; landscape phones by their short height. */
const QUERY = '(max-width: 767px), ((max-height: 500px) and (orientation: landscape))'

/** True on phone viewports in either orientation; follows the media query live. */
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
