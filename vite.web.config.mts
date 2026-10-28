import { pdfAssets } from './scripts/pdf-assets'
// Servidor de desarrollo solo para el renderer: Vite con HMR, sin Electron.
// Útil cuando el sandbox de Chromium no puede inicializar (contenedores, CI,
// terminales embebidas) o para trabajar solo en la UI.
//
// Uso: pnpm dev:web
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  plugins: [react(), pdfAssets()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  server: {
    port: 5173,
    open: false
  }
})
