// Lanzador de desarrollo. Detecta si Chromium puede inicializar su sandbox en
// este contexto y se adapta solo, para que `pnpm dev` funcione en cualquier
// terminal (normal o restringida) sin que tengas que acordarte de nada.
//
// En una terminal normal NO se desactiva nada: el sandbox queda activo.
// Uso: pnpm dev [--force-unsandboxed]
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)

let electronPath
try {
  electronPath = require('electron')
} catch {
  console.error('[dev] no encuentro el binario de Electron. Corré `pnpm install` primero.')
  process.exit(1)
}

const forceUnsandboxed = process.argv.includes('--force-unsandboxed')

const env = { ...process.env }
// DSH (y otros runners) exportan esto para usar Electron como Node; heredarlo
// haría que la app corra como Node puro y muera con un TypeError engañoso.
delete env['ELECTRON_RUN_AS_NODE']

// Perfil dentro del proyecto: evita depender de %APPDATA% (que puede estar
// bloqueado) y permite resetear el estado borrando una carpeta.
const userData = resolve('.cache/userdata')
mkdirSync(userData, { recursive: true })
env['CORREO_USER_DATA_DIR'] = userData

/**
 * `electron --version` es la sonda más barata: no necesita perfil ni ventana,
 * y falla exactamente cuando Chromium no puede crear su sandbox (Job Objects
 * restrictivos → __debugbreak → STATUS_BREAKPOINT).
 */
function sandboxWorks() {
  try {
    const probe = spawnSync(electronPath, ['--version'], {
      env,
      encoding: 'utf8',
      timeout: 10000
    })
    return probe.status === 0
  } catch {
    return false
  }
}

const works = forceUnsandboxed ? false : sandboxWorks()

if (works) {
  console.log('[dev] sandbox de Chromium OK')
} else {
  env['ELECTRON_DISABLE_SANDBOX'] = '1'
  console.log('[dev] sandbox de Chromium no disponible en este entorno: se desactiva solo en desarrollo')
}

console.log(`[dev] perfil: ${userData}`)

// Se invoca el CLI con el propio Node: evita `shell: true` (deprecado y
// dependiente del shell del sistema) y funciona igual en Windows y Linux.
const electronViteBin = resolve('node_modules/electron-vite/bin/electron-vite.js')

const child = spawn(process.execPath, [electronViteBin, 'dev'], {
  stdio: 'inherit',
  env
})

child.on('exit', (code) => process.exit(code ?? 0))
