const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const ast = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
let cacheEffect
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(ast), node.initializer.getText(ast))
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('onCacheChanged')) cacheEffect = node.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
const load = (name, context) => vm.runInNewContext(ts.transpile(`(${declarations.get(name)})`, { target: ts.ScriptTarget.ES2022 }), context)
const flush = () => new Promise(resolve => setImmediate(resolve))

async function check(fails = false, sameAccount = false) {
  let finishSwitch, finishSync, finishStar, error = 'old error', reloaded = 0, retries = 0, switching = false
  const context = {
    compose: null, busySwitch: { current: false }, accountGeneration: { current: 1 }, folderRequest: { current: 1 },
    live: true, folder: 'INBOX', manualSyncBusy: { current: false }, selected: { id: 'live:7', starred: false }, uidOf: () => 7,
    setLiveError: value => { error = value }, setManualSyncing() {}, setThreads() {}, setToast() {}, t: key => key,
    setSwitchingAccount: value => { switching = value }, setMessageOpen() {}, setComposeMinimized() {},
    refreshAccounts: async () => {}, refreshFromCache: async () => {},
    refreshAccount: async () => { reloaded++ }, setMessageRetry: update => { retries = update(retries) },
    applyAccount: () => { if (!sameAccount) { context.accountGeneration.current++; context.folderRequest.current++ } }, loadMailboxes: async () => {},
    window: { api: {
      selectAccount: () => new Promise(resolve => { finishSwitch = resolve }),
      syncMailbox: () => new Promise(resolve => { finishSync = resolve }),
      setFlagged: () => new Promise(resolve => { finishStar = resolve })
    } }
  }
  const sync = load('handleSync', context)()
  load('toggleStar', context)()
  const change = load('handleSelectAccount', context)('two')
  assert.equal(context.accountGeneration.current, 2, 'old requests expire before the core finishes switching')
  assert.equal(context.folderRequest.current, 2)
  assert.equal(error, null)
  assert.equal(switching, true)
  finishSync({ ok: false, code: 'unknown', detail: 'La cuenta activa cambió' })
  finishStar({ ok: false, code: 'network', detail: 'Old connection closed' })
  await sync; await flush()
  assert.equal(error, null, 'late errors cannot flash during the switch')
  finishSwitch(fails ? { ok: false } : { ok: true, data: { configured: true } })
  await change
  assert.equal(switching, false)
  assert.equal(context.busySwitch.current, false)
  assert.equal(reloaded, fails ? 1 : 0, 'failed switches reload the retained account')
  assert.equal(retries, fails || sameAccount ? 1 : 0, 'the retained account can resume reading after cancellation')
  const fresh = load('handleSync', context)()
  finishSync({ ok: false, code: 'auth', detail: 'Current account rejected' })
  await fresh
  assert.equal(error.detail, 'Current account rejected', 'real failures from the current account remain visible')
}
;(async () => {
  await check(); await check(true); await check(false, true)
  let callback, refreshes = 0
  const busySwitch = { current: true }
  vm.runInNewContext(ts.transpile(`(${cacheEffect})`, { target: ts.ScriptTarget.ES2022 }), {
    live: true, busySwitch, folder: 'INBOX', refreshFromCache: () => { refreshes++ },
    window: { api: { onCacheChanged: listener => { callback = listener } } }
  })()
  callback('*')
  assert.equal(refreshes, 0, 'cache events cannot start requests against a transitioning account')
  busySwitch.current = false
  callback('*')
  assert.equal(refreshes, 1, 'cache updates resume once switching completes')
  console.log('Account switching: immediate request invalidation, late sync/star errors ignored, failure recovery and current-account errors passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
