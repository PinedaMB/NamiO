// Smoke test de M0: comprueba que el renderer monta y que el puente IPC responde.
// Se ejecuta contra una instancia de la app lanzada con --remote-debugging-port.
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

const probe = `(async () => {
  const status = await window.api.getCoreStatus();
  return JSON.stringify({
    title: document.title,
    heading: document.querySelector('h1')?.textContent ?? null,
    bridge: typeof window.api?.getCoreStatus,
    nodeLeaked: typeof window.require,
    status
  });
})()`

const raw = await evaluate(ws, 1, probe)
ws.close()

const result = JSON.parse(raw)
const checks = [
  ['el renderer montó React', result.heading === 'Base lista para hablar IMAP'],
  ['el puente IPC existe', result.bridge === 'function'],
  ['Node no está expuesto a la UI', result.nodeLeaked === 'undefined'],
  ['el núcleo responde por IPC', result.status?.stage === 'M0' && result.status?.accountCount === 0]
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed++
}
console.log('estado del núcleo:', JSON.stringify(result.status))
process.exit(failed === 0 ? 0 : 1)
