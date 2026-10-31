const assert = require('node:assert/strict')
const fs = require('node:fs')

/**
 * La ventana no debe aceptar navegaciones fuera del bundle y soltar archivos no
 * debe convertir la app en una página local con acceso al preload.
 */
const main = fs.readFileSync('src/main/index.ts', 'utf8')
assert.match(main, /pathToFileURL/)
assert.match(main, /candidate\.protocol === 'file:' && candidate\.pathname === new URL\(indexUrl\)\.pathname/)
assert.doesNotMatch(main, /url\.startsWith\('file:\/\/'\)/, 'any file:// URL must not be considered valid')
assert.match(main, /webContents\.on\('will-navigate'/)
assert.match(main, /new URL\(url\)\.protocol === 'https:'/, 'window.open only forwards https')
assert.match(main, /devTools: isDev/, 'DevTools only exist in development')
assert.match(main, /Menu\.setApplicationMenu\(process\.platform === 'darwin'/)
assert.match(main, /role: 'appMenu'/, 'macOS keeps the standard application menu')

const renderer = fs.readFileSync('src/renderer/src/main.tsx', 'utf8')
assert.match(renderer, /addEventListener\('dragover', \(event\) => event\.preventDefault\(\)\)/)
assert.match(renderer, /addEventListener\('drop', \(event\) => event\.preventDefault\(\)\)/)

const body = fs.readFileSync('src/renderer/src/components/EmailBody.tsx', 'utf8')
assert.match(body, /const blockDrop = \(event: Event\): void => event\.preventDefault\(\)/)
assert.match(body, /inner\.addEventListener\('drop', blockDrop\)/)

console.log('Navigation guard: app-only file URLs, https-only window.open, drop blocked and no DevTools/menu in production')
