const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX })
function provider(file, name) {
  const state = [], writes = [], local = []
  let index = 0, fail = false
  const exports = {}
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), {
    exports, Error, navigator: { language: 'es' },
    window: { localStorage: { getItem: () => null, setItem: (...args) => local.push(args) }, api: { setSettings: async patch => {
      writes.push(patch)
      if (fail) throw new Error('Disk full')
    } } },
    require: id => {
      if (id === 'react') return { ...React,
        createContext: () => ({ Provider: 'provider' }), useEffect() {}, useCallback: fn => fn, useMemo: fn => fn(),
        useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = value }] }
      }
      if (id === './shortcuts') return { defaultShortcutModifier: () => 'ctrl', DEFAULT_BINDINGS: { reply: 'r' }, normalizeBindings: () => ({}) }
      if (id === './es') return { es: {} }
      if (id === './en') return { en: {} }
      return require(id)
    }
  })
  return { render() { index = 0; return exports[name]({ children: null }).props.value }, fail(value) { fail = value }, writes, local }
}
async function checkPreferences() {
  for (const [file, name, setter, field, value] of [
    ['src/renderer/src/settings/PreferencesProvider.tsx', 'PreferencesProvider', 'setTimeFormat', 'timeFormat', '12h'],
    ['src/renderer/src/settings/PreferencesProvider.tsx', 'PreferencesProvider', 'setBodyTheme', 'bodyTheme', 'dark'],
    ['src/renderer/src/settings/PreferencesProvider.tsx', 'PreferencesProvider', 'setRemoteImages', 'remoteImages', 'allow'],
    ['src/renderer/src/settings/ShortcutsProvider.tsx', 'ShortcutsProvider', 'save', 'bindings', { reply: 'x' }],
    ['src/renderer/src/settings/ShortcutsProvider.tsx', 'ShortcutsProvider', 'setModifier', 'modifier', 'command'],
    ['src/renderer/src/i18n/index.tsx', 'I18nProvider', 'setLocale', 'locale', 'en']
  ]) {
    const subject = provider(file, name)
    const previous = subject.render()[field]
    subject.fail(true)
    await subject.render()[setter](value)
    assert.equal(subject.render()[field], previous)
    assert.equal(subject.render().saveError, 'Disk full')
    assert.equal(subject.local.length, 0, 'failed language writes do not change the local cache')
    subject.fail(false)
    await subject.render()[setter](value)
    assert.equal(subject.render()[field], value)
    if (field === 'modifier') assert.equal(subject.writes.at(-1).shortcutModifier, 'command')
    assert.equal(subject.render().saveError, null)
  }
}
async function checkRules() {
  const source = fs.readFileSync('src/renderer/src/components/RulesSection.tsx', 'utf8')
  const ast = ts.createSourceFile('RulesSection.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(ast), node.initializer.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const action of ['remove', 'toggle', 'applyToCache', 'reload']) {
    let error, busy, status, changed = false
    const reject = async () => { throw new Error('Rule operation failed') }
    const context = { Error, busy: false, t: key => key,
      setError: value => { error = value }, setBusy: value => { busy = value }, setStatus: value => { status = value },
      setRules: () => { changed = true }, setMailboxes() {}, useCallback: fn => fn,
      window: { api: { deleteRule: reject, saveRule: reject, applyRules: reject, rules: reject } }, reload: async () => {}
    }
    const fn = vm.runInNewContext(compile(`(${declarations.get(action)})`), context)
    await fn(action === 'toggle' ? { id: 1, enabled: true } : 1)
    assert.equal(error, 'Rule operation failed')
    assert.equal(changed, false)
    if (action !== 'reload') { assert.equal(busy, false); assert.equal(status, null) }
  }
}
async function checkTimeFormatIpc() {
  const ast = ts.createSourceFile('ipc.ts', fs.readFileSync('src/main/ipc.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  let handler
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.settingsSet') handler = node.arguments[1].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const writes = []
  const save = vm.runInNewContext(compile(`(${handler})`), { Error, writeSettings: async patch => writes.push(patch), setBackgroundMode() {} })
  for (const timeFormat of ['12h', '24h']) await save(null, { timeFormat })
  assert.equal(writes.length, 2)
  for (const timeFormat of ['12', 'auto', null, true, 24]) await assert.rejects(save(null, { timeFormat }), /Invalid time format/)
  assert.equal(writes.length, 2, 'invalid formats cannot reach settings storage')
}
;(async () => {
  await checkTimeFormatIpc()
  await checkPreferences()
  await checkRules()
  assert.match(fs.readFileSync('src/renderer/src/components/Settings.tsx', 'utf8'), /<RulesSection key=\{accountKey\}/)
  assert.match(fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), /accountKey=\{accountIdentity.current/)
  console.log('Settings failures: preferences preserve saved values, report failures, recover on retry; rule failures are visible and account keys reset rules')
})().catch(error => { console.error(error); process.exitCode = 1 })
