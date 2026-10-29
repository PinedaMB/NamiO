const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = ts.transpile(fs.readFileSync('src/renderer/src/components/UpdateNotice.tsx', 'utf8'), { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX })
function render(state, detailed = true) {
  const exported = {}
  vm.runInNewContext(source, { exports: exported, require(id) {
    if (id === 'react') return { ...React, useEffect() {}, useState: () => [state, () => {}] }
    if (id === '../i18n') return { useI18n: () => ({ locale: 'es', t: (key, values = {}) => `${key} ${Object.values(values).join(' ')}`.trim() }) }
    if (id === '../lib/dates') return { formatMessageDateTime: value => String(value) }
    if (id === './Icon') return { Icon: () => null }
    return require(id)
  } })
  return renderToStaticMarkup(exported.UpdateNotice({ detailed }))
}
assert.equal(render(null), '')
assert.ok(render({ phase: 'idle' }).includes('update.unchecked'))
assert.ok(!render({ phase: 'idle' }).includes('update.latest'))
const latest = render({ phase: 'idle', checkedAt: 123, version: '0.4.6', releaseDate: '2026-10-29' })
for (const text of ['update.latest', '0.4.6', 'update.checked', 'update.published', 'update.notes']) assert.ok(latest.includes(text), text)
const download = render({ phase: 'downloading', version: '0.4.7', percent: 42, transferred: 42 * 1024 ** 2, total: 100 * 1024 ** 2, bytesPerSecond: 2 * 1024 ** 2 })
assert.ok(download.includes('aria-valuenow="42"'))
assert.ok(download.includes('update.downloadSize 42 100'))
assert.ok(download.includes('update.speed 2'))
assert.ok(!download.includes('update.latest'))
assert.ok(!download.includes('update-notice__button'))
assert.ok(!render({ phase: 'error' }).includes('update.latest'))
assert.ok(render({ phase: 'ready', version: '0.4.7' }).includes('update.install 0.4.7'))
const compact = render({ phase: 'downloading', percent: 42 }, false)
assert.ok(compact.includes('aria-valuenow="42"'))
assert.ok(!compact.includes('update-notice__details'))
console.log('Update notice: unchecked/latest, release details, download metrics, ready/error and compact mode passed')
