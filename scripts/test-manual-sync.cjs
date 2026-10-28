const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
function load(file, name, context) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let code
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(ast).replace(/^export /, '')
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) code = `const ${name} = ${node.initializer.getText(ast)}`
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(code)
  return vm.runInNewContext(ts.transpile(`${code}; ${name}`, { target: ts.ScriptTarget.ES2022 }), context)
}
async function main() {
  const calls = []
  const context = {
    syncGeneration: 0, serial: async fn => fn(),
    syncMailboxes: async () => calls.push('folders'),
    syncMessages: async (path, limit) => calls.push([path, limit]),
    notify: path => calls.push(path),
    classify: () => 'network', describe: error => error.message
  }
  const sync = load('src/main/imap.ts', 'syncMailbox', context)
  assert.equal((await sync('Archive')).ok, true)
  assert.deepEqual(calls, ['folders', ['Archive', 50], '*'])
  context.syncMessages = async () => { throw new Error('network failed') }
  assert.equal((await sync('INBOX')).detail, 'network failed')

  let finish
  let requests = 0
  let refreshed = 0
  let busy = false
  let error = null
  const ui = {
    live: true, manualSyncBusy: { current: false }, accountGeneration: { current: 0 }, folderRequest: { current: 0 }, folder: 'Archive',
    setManualSyncing: value => { busy = value }, setLiveError: value => { error = value },
    refreshFromCache: async () => { refreshed++ }, refreshAccounts: async () => {},
    window: { api: { syncMailbox: path => {
      requests++
      assert.equal(path, 'Archive')
      return new Promise(resolve => { finish = resolve })
    } } }
  }
  const click = load('src/renderer/src/App.tsx', 'handleSync', ui)
  const pending = click()
  assert.equal(busy, true)
  await click()
  assert.equal(requests, 1, 'duplicate clicks cannot enqueue another synchronization')
  finish({ ok: true, data: true })
  await pending
  assert.equal(refreshed, 1)
  assert.equal(busy, false)
  const failure = click()
  finish({ ok: false, code: 'network', detail: 'offline' })
  await failure
  assert.equal(error.detail, 'offline')
  assert.equal(busy, false)
  error = null
  const stale = click()
  ui.accountGeneration.current++
  finish({ ok: false, code: 'network', detail: 'old account' })
  await stale
  assert.equal(error, null, 'results from the previous account are ignored')
  assert.equal(refreshed, 1)
  ui.window.api.syncMailbox = async path => { assert.equal(path, 'Other'); return {ok:true,data:true} }
  await click('Other')
  assert.equal(refreshed, 1, 'syncing another folder must not replace the displayed messages')
  ui.live = false
  await click()
  assert.equal(requests, 3, 'demo mode does not synchronize')
  console.log('Manual sync: server update, errors, loading, duplicate clicks and account changes passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
