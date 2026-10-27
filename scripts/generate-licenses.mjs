import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const project = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Estas dependencias de desarrollo se incluyen en el renderer y sus assets.
const renderer = ['react', 'react-dom', 'dompurify', '@tiptap/pm', '@tiptap/react', '@tiptap/starter-kit',
  '@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono', 'material-symbols']
// Paquetes que declaran licencia pero no incluyen archivo de licencia en su tarball.
const withoutLicenseFile = new Set(['lazy-val'])
const packages = new Map()
function locate(name, from) {
  for (let directory = from; ; directory = dirname(directory)) {
    const target = join(directory, 'node_modules', name)
    if (existsSync(join(target, 'package.json'))) return realpathSync(target)
    if (directory === dirname(directory)) return null
  }
}
function collect(name, from, optional = false) {
  const directory = locate(name, from)
  if (!directory && optional) return
  assert.ok(directory, `Dependencia no instalada: ${name}`)
  if (packages.has(directory)) return
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  assert.equal(typeof metadata.license, 'string', `Falta licencia declarada: ${metadata.name}`)
  let notices = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(licen[sc]e|notice|copying|ofl|third.?party.*(?:licen[sc]e|notice))/i.test(entry.name))
    .map(entry => ({ name: entry.name, text: readFileSync(join(directory, entry.name), 'utf8').trim() }))
  if (!notices.length && withoutLicenseFile.has(metadata.name)) {
    const author = typeof metadata.author === 'string' ? metadata.author : metadata.author?.name
    notices = [{ name: 'package.json', text: `Licencia declarada: ${metadata.license}\nAutor: ${author}\nRepositorio: ${metadata.repository}` }]
  }
  assert.ok(notices.length, `Falta texto de licencia: ${metadata.name}@${metadata.version}`)
  packages.set(directory, { metadata, notices })
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {
    collect(dependency, directory, dependency in (metadata.optionalDependencies ?? {}))
  }
  for (const dependency of Object.keys({ ...metadata.optionalDependencies, ...metadata.peerDependencies })) {
    collect(dependency, directory, true)
  }
}
for (const name of [...Object.keys(project.dependencies), ...renderer]) collect(name, root)

const entries = [...packages.values()].sort((a, b) => `${a.metadata.name}@${a.metadata.version}`.localeCompare(`${b.metadata.name}@${b.metadata.version}`, 'en'))
const output = ['# Avisos y licencias de terceros', '',
  'Generado a partir de las dependencias instaladas de NamiO. Conserva los textos originales de sus titulares.', '',
  'Incluye dependencias de ejecución y del renderer, con sus dependencias instaladas. Algunas pueden no utilizarse en todas las plataformas.', '',
  'La licencia MIT de NamiO no sustituye las licencias de estos componentes. DOMPurify se distribuye bajo su opción Apache-2.0; @zone-eu/mailsplit, bajo su opción MIT.', '',
  'Electron y sus componentes conservan los archivos LICENSE.electron.txt y LICENSES.chromium.html que electron-builder incluye con la aplicación.', '',
  '| Componente | Versión | Licencia declarada |', '| --- | --- | --- |',
  ...entries.map(({ metadata: m }) => `| ${m.name} | ${m.version} | ${typeof m.license === 'string' ? m.license : JSON.stringify(m.license)} |`), '']
for (const { metadata, notices } of entries) {
  output.push(`## ${metadata.name} ${metadata.version}`, '')
  for (const notice of notices) output.push(`### ${notice.name}`, '', '````text', notice.text, '````', '')
}
const text = output.join('\n')
assert.ok(text.includes('SIL OPEN FONT LICENSE'))
assert.ok(text.includes('Apache License'))
assert.ok(entries.some(({ metadata }) => metadata.name === 'nodemailer'))
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), text)
console.log(`Licencias de ${entries.length} componentes generadas en THIRD_PARTY_NOTICES.md`)
