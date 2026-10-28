const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const { EventEmitter } = require('node:events')
const compile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
async function background(failTray = false) {
  const app = new EventEmitter(), window = new EventEmitter()
  let hidden = 0, opened = 0, tray
  app.getLocale = () => 'es'
  app.quit = () => app.emit('before-quit')
  window.hide = () => hidden++
  class Tray extends EventEmitter {
    constructor() { super(); if (failTray) throw new Error('No tray'); tray = this }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu }
    destroy() { this.destroyed = true }
  }
  const exports = {}
  vm.runInNewContext(compile(fs.readFileSync('src/main/background.ts', 'utf8')), {
    exports, console: { warn() {} }, require(id) {
      if (id === 'electron') return { app, Tray, Menu: { buildFromTemplate: items => items }, nativeImage: { createFromPath: () => ({ resize: () => 'icon' }) } }
      if (id.endsWith('?asset')) return { default: '/icon.png' }
      if (id === './settings') return { readSettings: async () => ({ keepInBackground: false }) }
      throw new Error(id)
    }
  })
  await exports.setupBackground(() => window, () => opened++)
  const close = () => { let prevented = false; window.emit('close', { preventDefault() { prevented = true } }); return prevented }
  assert.equal(close(), false, 'default close behavior is preserved')
  exports.setBackgroundMode(true)
  assert.equal(close(), !failTray)
  assert.equal(hidden, failTray ? 0 : 1)
  if (!failTray) {
    tray.menu[0].click()
    assert.equal(opened, 1)
    tray.emit('click')
    assert.equal(opened, 2)
    tray.menu[2].click()
    assert.equal(close(), false, 'explicit quit bypasses hiding')
    app.emit('will-quit')
    assert.equal(tray.destroyed, true)
  }
}
async function opening() {
  const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('if (!notificationTarget || switchingAccount')) effect = node.arguments[0].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(effect)
  for (const scenario of ['same', 'other', 'compose', 'switching', 'failure']) {
    const target = { accountId: 'b', identity: 'b', path: 'INBOX', uid: 42 }
    let pending = target, opened = [], switched = 0
    const context = {
      listOptions: { current: { filter: 'unread' } }, filterFocusUid: { current: undefined }, notificationTarget: target, switchingAccount: scenario === 'switching', openingNotification: false,
      compose: scenario === 'compose' ? {} : null,
      accountIdentity: { current: scenario === 'same' ? 'b' : 'a' },
      setOpeningNotification() {}, setNotificationTarget(fn) { pending = fn(pending) },
      async handleSelectAccount(id) { assert.equal(id, 'b'); switched++; if (scenario !== 'failure') context.accountIdentity.current = 'b' },
      setView() {}, setFilter() {}, setQuery() {}, setMessageOpen() {},
      async loadFolder(path, uid) { opened.push([path, uid]) }
    }
    vm.runInNewContext(compile(`(${effect})()`), context)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(opened.length, ['same', 'other'].includes(scenario) ? 1 : 0, scenario)
    if (opened.length) assert.deepEqual(opened[0], ['INBOX', 42])
    if (['compose', 'switching'].includes(scenario)) {
      assert.equal(switched, 0)
      assert.equal(pending, target, 'deferred notification remains pending')
    } else assert.equal(pending, null)
  }
}
;(async () => {
  await background()
  await background(true)
  await opening()
  console.log('Background: tray actions, close preference, explicit quit, unavailable tray and notification account switching passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
