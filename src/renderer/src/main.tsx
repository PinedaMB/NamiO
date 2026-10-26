import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Fuentes e iconos empaquetados: la app no pide nada a la red (CSP estricta).
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import 'material-symbols/outlined.css'

import './styles/tokens.css'
import './styles/app.css'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Falta el nodo #root en index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
