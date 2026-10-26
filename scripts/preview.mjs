// Servidor estático mínimo para previsualizar el renderer sin Electron.
// Uso: node scripts/preview.mjs [directorio] [puerto]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'out/renderer')
const port = Number(process.argv[3] ?? process.env.PORT ?? 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json'
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  let filePath = join(root, decodeURIComponent(url.pathname))

  if (url.pathname === '/' || !extname(filePath)) {
    filePath = join(filePath, 'index.html')
  }

  try {
    const data = await readFile(filePath)
    response.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    response.end(data)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('404')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${port} (root: ${root})`)
})
