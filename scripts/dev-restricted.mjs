// Lanza la app en entornos donde el sandbox de Chromium no puede inicializar
// (Job Objects restrictivos: contenedores, CI, terminales embebidas).
//
// En una terminal normal de Windows/Linux NO hace falta: usá `pnpm dev`.
//
// Uso: pnpm dev:restricted
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const userData = resolve('.cache/userdata')
mkdirSync(userData, { recursive: true })

const env = {
  ...process.env,
  // Chromium llama a __debugbreak() si no puede crear su sandbox: sin esto,
  // el proceso muere con STATUS_BREAKPOINT (0x80000003) antes de ejecutar JS.
  ELECTRON_DISABLE_SANDBOX: '1',
  // Sin un perfil escribible, Chromium muere con ACCESS_VIOLATION (0xc0000005).
  CORREO_USER_DATA_DIR: userData
}

delete env['ELECTRON_RUN_AS_NODE']

console.log('[dev:restricted] sandbox de Chromium desactivado (solo desarrollo)')
console.log(`[dev:restricted] perfil: ${userData}`)

const child = spawn('pnpm', ['exec', 'electron-vite', 'dev'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
})

child.on('exit', (code) => process.exit(code ?? 0))
