// Inspecciona un .asar sin dependencias: el header es un pickle con JSON.
const { readFileSync } = require('node:fs')

const file = process.argv[2]
const buffer = readFileSync(file)

const headerSize = buffer.readUInt32LE(4) // tamaño del pickle
const jsonSize = buffer.readUInt32LE(12) // tamaño del JSON real
const json = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString('utf8'))

const paths = []
const walk = (node, prefix) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = `${prefix}/${name}`
    if (entry.files) walk(entry, path)
    else paths.push({ path, size: entry.size ?? 0 })
  }
}
walk(json, '')

const total = paths.reduce((sum, entry) => sum + entry.size, 0)
console.log(`asar: ${(buffer.length / 1024 / 1024).toFixed(2)} MB · ${paths.length} archivos · header ${headerSize} B`)

const deps = [...new Set(paths.filter((e) => e.path.startsWith('/node_modules/')).map((e) => e.path.split('/')[2]))]
console.log('deps incluidas:', deps.sort().join(', ') || '(ninguna)')

const fonts = paths.filter((e) => e.path.endsWith('.woff2'))
console.log('fuentes woff2:', fonts.length, `(${(fonts.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB)`)
console.log('renderer js:', paths.some((e) => /^\/out\/renderer\/assets\/index-.*\.js$/.test(e.path)))
console.log('renderer css:', paths.some((e) => /^\/out\/renderer\/assets\/index-.*\.css$/.test(e.path)))
console.log('main:', paths.some((e) => e.path === '/out/main/index.js'))
console.log('preload:', paths.some((e) => e.path === '/out/preload/index.js'))
console.log('package.json:', paths.some((e) => e.path === '/package.json'))

const biggest = [...paths].sort((a, b) => b.size - a.size).slice(0, 6)
console.log('más grandes:')
for (const entry of biggest) console.log(`  ${(entry.size / 1024 / 1024).toFixed(2)} MB  ${entry.path}`)
