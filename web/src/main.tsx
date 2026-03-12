import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
