import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Body/UI font (IBM Plex Sans) + data/numbers font (IBM Plex Mono)
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import App from './App.tsx'
import { initWasm } from './lib/wasm'
import { SettingsProvider } from './lib/settingsContext'

// Initialize WASM before mounting React
initWasm().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </StrictMode>,
  )
})
