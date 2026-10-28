import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const ui = process.argv.includes('--ui')
const files = readdirSync(new URL('.', import.meta.url))
  .filter(name => /^test-.*\.(cjs|mjs)$/.test(name) && name.endsWith(ui ? '.mjs' : '.cjs'))
  .sort()
assert.ok(files.length, 'No se encontraron pruebas')

const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1', '--test-timeout=120000',
  ...files.map(name => `scripts/${name}`)
], { stdio: 'inherit', cwd: new URL('..', import.meta.url) })
if (result.error) console.error(result.error)
process.exitCode = result.status ?? 1
