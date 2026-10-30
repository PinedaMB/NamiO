// Smoke test de la cáscara: comprueba que el renderer monta y que el puente IPC
// responde. Se ejecuta contra una instancia de la app lanzada con
// --remote-debugging-port. Sirve tanto para desarrollo como para el paquete final.
const PORT = process.env.SMOKE_PORT ?? '9333'

async function getPage(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('No apareció ninguna página con DevTools remoto')
}

function evaluate(ws, id, expression) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (msg.result?.exceptionDetails) reject(new Error(JSON.stringify(msg.result.exceptionDetails)))
      else resolve(msg.result?.result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      })
    )
  })
}

const page = await getPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let bridgeReady = false
for (let attempt = 0; attempt < 40; attempt++) {
  if (await evaluate(ws, 100 + attempt, "typeof window.api?.getCoreStatus === 'function' && Boolean(document.querySelector('.rail__wordmark'))")) { bridgeReady = true; break }
  await new Promise(resolve => setTimeout(resolve, 250))
}
if (!bridgeReady) { ws.close(); throw new Error('No se montó la aplicación con su puente IPC') }

const probe = `(async () => {
  const status = await window.api.getCoreStatus();
  return JSON.stringify({
    wordmark: document.querySelector('.rail__wordmark')?.textContent ?? null,
    list: Boolean(document.querySelector('.thread-list, .list')),
    welcome: Boolean(document.querySelector('#mail-welcome-title')),
    threads: document.querySelectorAll('.thread').length,
    subject: document.querySelector('.letter__subject')?.textContent ?? null,
    legend: document.querySelectorAll('.statusbar .kbd').length,
    bridge: typeof window.api?.getCoreStatus,
    nodeLeaked: typeof window.require,
    status
  });
})()`

const raw = await evaluate(ws, 1, probe)
ws.close()

const result = JSON.parse(raw)
const checks = [
  ['monta la identidad NamiO', result.wordmark === 'NamiO'],
  ['monta la lista de correo, aunque esté vacía', result.list],
  ['muestra el lector o su bienvenida', Boolean(result.subject) || result.welcome],
  ['la barra de estado muestra atajos', result.legend > 0],
  ['el puente IPC existe', result.bridge === 'function'],
  ['Node no está expuesto a la UI', result.nodeLeaked === 'undefined'],
  ['el núcleo responde por IPC', ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'].includes(result.status?.stage)]
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed++
}
console.log('estado del núcleo:', JSON.stringify(result.status))
process.exit(failed === 0 ? 0 : 1)
