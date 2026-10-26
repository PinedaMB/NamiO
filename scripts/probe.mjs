// Evalúa una expresión en la página y devuelve el resultado por stdout.
// Uso: node scripts/probe.mjs "<expresión JS>" [url]
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [expression = 'document.title', url = 'http://127.0.0.1:4173/'] = process.argv.slice(2)
const EDGE = process.env.EDGE_BIN ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? 9566)
const ATTACH = process.env.CDP_ENDPOINT ?? null
const ENDPOINT = ATTACH ?? `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let browser = null
if (!ATTACH) {
  const profile = await mkdtemp(join(tmpdir(), 'probe-'))
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
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${ENDPOINT}/json/version`)
      if (res.ok) break
    } catch {
      /* arrancando */
    }
    await sleep(120)
  }

  const target = ATTACH
    ? (await (await fetch(`${ENDPOINT}/json`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    : await (
        await fetch(`${ENDPOINT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
      ).json()

  if (!target) throw new Error('No hay ninguna página para inspeccionar')

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  // En modo attach se evalúa la página TAL COMO ESTÁ: navegarla cambiaría la app
  // que estamos inspeccionando (nos pasó: la ventana terminaba en el preview).
  if (!ATTACH) {
    await send('Page.navigate', { url })
    await sleep(1200)
  }

  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })

  if (result.exceptionDetails) {
    console.error('EXCEPCIÓN:', JSON.stringify(result.exceptionDetails, null, 2))
    process.exitCode = 1
  } else {
    console.log(typeof result.result.value === 'string' ? result.result.value : JSON.stringify(result.result.value, null, 2))
  }

  socket.close()
} finally {
  if (browser) {
    browser.kill()
    await sleep(200)
  }
}
