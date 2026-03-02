import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // wasm-pack output will be linked as a local dependency
  optimizeDeps: {
    exclude: ['tok-sym-core'],
  },
})
