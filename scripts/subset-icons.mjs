#!/usr/bin/env node
/**
 * Escanea los iconos de Material Symbols usados en `src/renderer/src` y, si
 * `pyftsubset` (fonttools) está disponible en el sistema, recorta
 * `material-symbols-outlined.woff2` para reducir su peso (~4 MB -> ~30 KB).
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const SRC_DIR = resolve('src/renderer/src')
const FONT_PATH = require.resolve('material-symbols/material-symbols-outlined.woff2')
const OUTPUT_PATH = resolve('src/renderer/src/assets/material-symbols-subset.woff2')

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, files)
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full)
  }
  return files
}

const names = new Set()
const patterns = [
  /<Icon\b[^>]*\bname=["']([a-z0-9_]+)["']/g,
  /\bicon:\s*["']([a-z0-9_]+)["']/g,
  /['"]([a-z]+_[a-z0-9_]+)['"]/g
]

for (const file of walk(SRC_DIR)) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) names.add(match[1])
    }
  }
}

const sorted = [...names].sort()
const chars = [...new Set(sorted.join(''))].sort().join('')
const beforeKB = Math.round(statSync(FONT_PATH).size / 1024)
console.log(`Iconos detectados en NamiO: ${sorted.length} (${FONT_PATH}, actual: ${beforeKB} KB)`)

try {
  execFileSync('pyftsubset', [
    FONT_PATH,
    `--output-file=${OUTPUT_PATH}`,
    '--flavor=woff2',
    `--text=${chars}`,
    '--layout-features=liga,rlig',
    '--desubroutinize'
  ], { stdio: 'inherit' })
  const afterKB = Math.round(statSync(OUTPUT_PATH).size / 1024)
  console.log(`Fuente recortada con éxito: ${beforeKB} KB -> ${afterKB} KB (${OUTPUT_PATH})`)
} catch {
  console.log('pyftsubset (fonttools) no está instalado en este entorno.')
  console.log('Para recortar la fuente localmente o en CI: pip install fonttools brotli && node scripts/subset-icons.mjs')
}
