import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import DeviceSelect from './pages/DeviceSelect'
import ProgramPulse from './pages/ProgramPulse'
import ControlRoom from './pages/ControlRoom'
import Bibliography from './pages/Bibliography'

/** A new page starts at its top. On touch screens #root is what scrolls, and it outlives the route. */
function ScrollReset() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.getElementById('root')?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollReset />
      <Routes>
        <Route path="/" element={<DeviceSelect />} />
        <Route path="/program/:deviceId" element={<ProgramPulse />} />
        <Route path="/run/:deviceId" element={<ControlRoom />} />
        <Route path="/bibliography" element={<Bibliography />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  )
}
