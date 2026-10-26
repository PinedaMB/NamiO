// Captura de pantalla por CDP. Sirve tanto para lanzar Edge headless como para
// engancharse a una instancia ya corriendo (por ejemplo, la app Electron con
// --remote-debugging-port=9333).
//
// Uso:  node scripts/shoot.mjs <url> <salida.png> [expresión JS previa]
// Adjuntar: CDP_ENDPOINT=http://127.0.0.1:9333 node scripts/shoot.mjs - out.png
import { spawn } from 'node:child_process'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url = 'http://127.0.0.1:4173/', out = '.cache/shot.png', expression = ''] = process.argv.slice(2)
const EDGE = process.env.EDGE_BIN ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? 9555)
const WIDTH = Number(process.env.SHOT_W ?? 1440)
const HEIGHT = Number(process.env.SHOT_H ?? 900)
const ATTACH = process.env.CDP_ENDPOINT ?? null
const ENDPOINT = ATTACH ?? `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForEndpoint(attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${ENDPOINT}/json/version`)
      if (res.ok) return
    } catch {
      /* todavía arrancando */
    }
    await sleep(150)
  }
  throw new Error(`No hay endpoint CDP en ${ENDPOINT}`)
}

let browser = null
if (!ATTACH) {
  const profile = await mkdtemp(join(tmpdir(), 'shoot-'))
  browser = spawn(
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
}

try {
  await waitForEndpoint()

  const target = ATTACH
    ? (await (await fetch(`${ENDPOINT}/json`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    : await (
        await fetch(`${ENDPOINT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
      ).json()

  if (!target) throw new Error('No hay ninguna página para capturar')

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

  if (ATTACH) {
    // La página ya está cargada: solo ajustamos la métrica para una captura estable.
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false
    })
  } else {
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false
    })
    await send('Page.navigate', { url })
  }

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
  if (browser) {
    browser.kill()
    await sleep(200)
  }
}
