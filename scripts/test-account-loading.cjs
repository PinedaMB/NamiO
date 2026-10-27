const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(ast), node.initializer.getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)
async function check(kind) {
  let loading = false, release
  const events = []
  const context = {
    useCallback: fn => fn, accountGeneration: { current: 1 },
    setLoadingFolder: value => { loading = value; events.push(value) },
    setLiveError() {}, setSync() {}, setMailboxes() {},
    loadFolder: async path => { assert.equal(path, 'INBOX'); assert.equal(loading, true) },
    window: { api: { listMailboxes: () => new Promise(resolve => { release = resolve }) } }
  }
  const load = vm.runInNewContext(ts.transpile(`(${declarations.get('loadMailboxes')})`, { target: ts.ScriptTarget.ES2022 }), context)
  const pending = load({ configured: true })
  assert.equal(loading, true, 'loading covers the folder query')
  if (kind === 'switch') context.accountGeneration.current++
  release(kind === 'error' ? { ok: false, code: 'network', detail: 'offline' } : {
    ok: true, data: kind === 'empty' ? [] : [{ path: 'INBOX' }], meta: { offline: false, syncedAt: 1 }
  })
  await pending
  assert.equal(loading, kind === 'switch', 'stale responses cannot clear the next account loading state')
  assert.equal(events[0], true)
}
;(async () => {
  for (const kind of ['inbox', 'empty', 'error', 'switch']) await check(kind)
  // Checking other accounts must not delay loading the selected account.
  const handle = declarations.get('handleSelectAccount')
  assert.ok(handle.includes('void refreshAccounts()'))
  assert.ok(!handle.includes('await refreshAccounts()'))
  console.log('Account loading: pending folders, inbox, empty mailbox, errors, account switch and independent background polling passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
