import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync, readdirSync, createReadStream } from 'node:fs'
import type { Plugin } from 'vite'

/** Recursos locales de PDF.js: el visor no necesita CDN ni permisos de red. */
export function pdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const files = new Map<string, string>([['pdf.worker.min.mjs', join(root, 'build/pdf.worker.min.mjs')]])
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const name of readdirSync(join(root, directory))) {
      if (directory === 'wasm' && !name.endsWith('_nowasm_fallback.js') && !name.startsWith('LICENSE')) continue
      files.set(`${directory}/${name}`, join(root, directory, name))
    }
  }
  return {
    name: 'namio-pdf-assets',
    generateBundle() {
      for (const [name, path] of files) this.emitFile({ type: 'asset', fileName: `pdfjs/${name}`, source: readFileSync(path) })
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = files.get((request.url ?? '').split('?')[0]?.replace(/^\/pdfjs\//, '') ?? '')
        if (!request.url?.startsWith('/pdfjs/') || !path) { next(); return }
        response.setHeader('Content-Type', /\.(mjs|js)$/.test(path) ? 'application/javascript' : 'application/octet-stream')
        createReadStream(path).on('error', () => { response.statusCode = 500; response.end() }).pipe(response)
      })
    }
  }
}
