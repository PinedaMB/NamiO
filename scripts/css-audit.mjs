// Auditoría de integridad del CSS: variables, clases, URLs y fuentes.
// Uso: node scripts/css-audit.mjs [--verbose]
//
// No requiere dependencias: parsea llaves a mano y cruza el CSS con el JSX.
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const verbose = process.argv.includes('--verbose')
const root = process.cwd()
const stylesDir = join(root, 'src', 'renderer', 'src', 'styles')
const rendererDir = join(root, 'src', 'renderer', 'src')

const problems = []
const notes = []

/* ---------------------------------------------------------------------------
   CSS
   ------------------------------------------------------------------------- */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Devuelve [{ selector, body }] para reglas normales (ignora @keyframes internos). */
function parseRules(css) {
  const rules = []
  const frames = []
  let buffer = ''

  for (const char of stripComments(css)) {
    if (char === '{') {
      frames.push({ prelude: buffer.trim(), body: '' })
      buffer = ''
    } else if (char === '}') {
      const frame = frames.pop()
      if (frame) {
        frame.body = buffer
        const prelude = frame.prelude
        const skip =
          prelude.startsWith('@keyframes') ||
          prelude.startsWith('@media') ||
          prelude.startsWith('@supports')
        if (!skip && prelude !== '' && !prelude.startsWith('@')) {
          rules.push({ selector: prelude, body: frame.body })
        }
        if (prelude.startsWith('@font-face')) {
          rules.push({ selector: '@font-face', body: frame.body })
        }
      }
      buffer = ''
    } else {
      buffer += char
      if (frames.length > 0) frames[frames.length - 1].body += char
    }
  }

  return rules
}

const classOfSelector = (selector) => [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1])

async function readCssFiles() {
  const names = (await readdir(stylesDir)).filter((name) => name.endsWith('.css'))
  const files = []
  for (const name of names) {
    const path = join(stylesDir, name)
    files.push({ path, css: await readFile(path, 'utf8') })
  }
  return files
}

/* ---------------------------------------------------------------------------
   JSX
   ------------------------------------------------------------------------- */

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path, out)
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** Extrae el contenido balanceado desde `start` (que apunta a la apertura). */
function balanced(text, start, open, close) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return text.slice(start + 1, index)
    }
  }
  return null
}

const literalTokens = (text) =>
  [...text.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)]
    .flatMap((match) => [match[1], match[2], match[3]].filter((value) => value !== undefined))
    .flatMap((value) => value.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/))
    .filter((token) => /^[a-zA-Z][\w-]*$/.test(token) && !token.endsWith('--'))

/** Los literales en comparaciones (`variant === 'error'`) son valores, no clases. */
const stripComparisons = (text) => text.replace(/(===|!==|==|!=)\s*(['"`])(?:(?!\2).)*\2/g, ' ')

function usedClasses(source) {
  const used = new Set()
  const dynamic = new Set()

  const collect = (expression) => {
    const clean = stripComparisons(expression)
    for (const token of literalTokens(clean)) used.add(token)
    for (const part of clean.matchAll(/([a-zA-Z][\w-]*--?)\$\{/g)) dynamic.add(part[1])
  }

  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
    if (match[1] !== undefined) {
      for (const token of match[1].split(/\s+/)) if (token) used.add(token)
      continue
    }
    const expression = balanced(source, match.index + match[0].length - 1, '{', '}')
    if (expression) collect(expression)
  }

  for (const match of source.matchAll(/\bcx\(/g)) {
    const expression = balanced(source, match.index + match[0].length - 1, '(', ')')
    if (expression) collect(expression)
  }

  return { used, dynamic }
}

/* ---------------------------------------------------------------------------
   Informe
   ------------------------------------------------------------------------- */

const cssFiles = await readCssFiles()

/* 0. Llaves balanceadas: un `}` de más rompe la regla siguiente en silencio. */
for (const file of cssFiles) {
  const clean = stripComments(file.css)
  let depth = 0
  let firstExtra = null
  let line = 1
  for (const char of clean) {
    if (char === '\n') line += 1
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth < 0 && firstExtra === null) firstExtra = line
    }
  }
  if (firstExtra !== null) problems.push(`${file.path.split(/[\\/]/).pop()}: llave de cierre de más en la línea ${firstExtra}`)
  else if (depth !== 0) problems.push(`${file.path.split(/[\\/]/).pop()}: ${depth} llave(s) sin cerrar`)
}

const definedClasses = new Map()
const definedVars = new Map()
const usedVars = new Map()
const urlRefs = []

for (const file of cssFiles) {
  const rules = parseRules(file.css)
  for (const rule of rules) {
    if (rule.selector === '@font-face') {
      for (const match of rule.body.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
        urlRefs.push({ file: file.path, url: match[2] })
      }
      continue
    }

    for (const name of classOfSelector(rule.selector)) {
      definedClasses.set(name, (definedClasses.get(name) ?? 0) + 1)
    }

    for (const match of rule.body.matchAll(/(--[\w-]+)\s*:/g)) definedVars.set(match[1], file.path)
    for (const match of rule.body.matchAll(/var\(\s*(--[\w-]+)/g)) {
      usedVars.set(match[1], (usedVars.get(match[1]) ?? 0) + 1)
    }
    for (const match of rule.body.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      urlRefs.push({ file: file.path, url: match[2] })
    }
  }
}

const files = await walk(rendererDir)
const used = new Set()
const dynamicPrefixes = new Set()

for (const path of files) {
  const source = await readFile(path, 'utf8')
  const result = usedClasses(source)
  for (const token of result.used) used.add(token)
  for (const prefix of result.dynamic) dynamicPrefixes.add(prefix)
}

/* 1. Variables usadas y no definidas (bug real: el valor no resuelve). */
const undefinedVars = [...usedVars.keys()].filter((name) => !definedVars.has(name))

/* 2. Variables definidas y nunca usadas (peso muerto). */
const unusedVars = [...definedVars.keys()].filter((name) => !usedVars.has(name))

/* 3. Clases usadas en JSX sin regla CSS. */
const missingClasses = [...used].filter((name) => !definedClasses.has(name))

/* 4. Clases definidas y no usadas en JSX (posible código muerto). */
const unusedClasses = [...definedClasses.keys()].filter(
  (name) => !used.has(name) && ![...dynamicPrefixes].some((prefix) => name.startsWith(prefix))
)

/* 5. URLs relativas que no existen. */
const brokenUrls = urlRefs.filter(({ file, url }) => {
  if (/^(https?:|data:|#)/.test(url)) return false
  return !existsSync(resolve(dirname(file), url))
})

/* 6. Bundle construido: fuentes y assets referenciados. */
const assetsDir = join(root, 'out', 'renderer', 'assets')
let bundle = null
if (existsSync(assetsDir)) {
  const cssName = (await readdir(assetsDir)).find((name) => name.endsWith('.css'))
  if (cssName) {
    const css = await readFile(join(assetsDir, cssName), 'utf8')
    const refs = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((match) => match[2]).filter((url) => !/^data:/.test(url))
    const missing = refs.filter((url) => !existsSync(resolve(assetsDir, url.replace(/^\.\//, ''))))
    bundle = { name: cssName, bytes: (await stat(join(assetsDir, cssName))).size, refs: refs.length, missing }
  }
}

/* ------------------------------- salida --------------------------------- */

const cap = (list, n = 12) => (verbose ? list : list.slice(0, n))
const more = (list, n = 12) => (list.length > n && !verbose ? ` (+${list.length - n} más)` : '')

const report = []
report.push(`CSS fuente: ${cssFiles.map((file) => `${file.path.split(/[\\/]/).pop()} (${(file.css.length / 1024).toFixed(1)} kB)`).join(', ')}`)
report.push(`Clases definidas: ${definedClasses.size} · usadas en JSX: ${used.size} · variables: ${definedVars.size} definidas / ${usedVars.size} usadas`)
report.push('')

if (undefinedVars.length > 0) {
  problems.push(`Variables usadas sin definir: ${undefinedVars.join(', ')}`)
} else {
  report.push('✅ Variables: todas las usadas están definidas')
}

if (missingClasses.length > 0) {
  problems.push(`Clases en JSX sin CSS: ${missingClasses.join(', ')}${more(missingClasses)}`)
} else {
  report.push('✅ Clases: toda clase usada en JSX tiene al menos una regla')
}

if (brokenUrls.length > 0) {
  problems.push(`url() sin archivo: ${brokenUrls.map((item) => `${item.url} (${item.file})`).join(', ')}`)
} else {
  report.push('✅ URLs: no hay referencias locales rotas')
}

if (unusedVars.length > 0) notes.push(`Variables sin usar (${unusedVars.length}): ${cap(unusedVars).join(', ')}${more(unusedVars)}`)
if (unusedClasses.length > 0) notes.push(`Clases sin uso en JSX (${unusedClasses.length}): ${cap(unusedClasses).join(', ')}${more(unusedClasses)}`)
if (bundle) {
  const bundleLine = `Bundle: ${bundle.name} · ${(bundle.bytes / 1024).toFixed(1)} kB · ${bundle.refs} url()`
  report.push(bundle.missing.length === 0 ? `✅ ${bundleLine} y todos sus assets existen` : `❌ ${bundleLine} · faltan ${bundle.missing.join(', ')}`)
}

for (const problem of problems) report.push(`❌ ${problem}`)
for (const note of notes) report.push(`· ${note}`)

console.log(report.join('\n'))
process.exitCode = problems.length === 0 ? 0 : 1
