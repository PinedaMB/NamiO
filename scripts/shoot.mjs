// Captura de pantalla por CDP sin Electron: sirve para revisar la UI en un
// navegador headless, incluyendo estados que requieren interacción.
//
// Uso: node scripts/shoot.mjs <url> <salida.png> [expresión JS previa]
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url = 'http://127.0.0.1:4173/', out = '.cache/shot.png', expression = ''] = process.argv.slice(2)
const EDGE = process.env.EDGE_BIN ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? 9555)
const WIDTH = Number(process.env.SHOT_W ?? 1440)
const HEIGHT = Number(process.env.SHOT_H ?? 900)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForEndpoint(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return true
    } catch {
      /* todavía arrancando */
    }
    await sleep(120)
  }
  throw new Error('El navegador no expuso el endpoint de CDP')
}

const profile = await mkdtemp(join(tmpdir(), 'shoot-'))
const browser = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
)

try {
  await waitForEndpoint()

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  ).json()

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false
  })
  await send('Page.navigate', { url })
  await sleep(1200)
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })

  if (expression) {
    await send('Runtime.evaluate', { expression, awaitPromise: true })
    await sleep(450)
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(out, Buffer.from(shot.data, 'base64'))
  console.log(`ok ${out} (${WIDTH}x${HEIGHT})`)
  socket.close()
} finally {
  browser.kill()
  await sleep(200)
}
