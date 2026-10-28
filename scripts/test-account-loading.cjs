const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
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
async function focusOldMessage(failure = false) {
  let selected, threads, error, loading = false, releaseMessage
  const context = {
    useCallback: fn => fn, locale: 'es', accountGeneration: { current: 1 }, folderRequest: { current: 0 },
    activeFolderRef: { current: null }, userNavigated: { current: false }, PAGE_SIZE: 50,
    setThreads: value => { threads = value }, setSelectedId: value => { selected = value },
    listOptions: { current: {} }, setListCounts() {}, setIndividualMessageId() {}, setLoadingFolder: value => { loading = value }, setFolder() {}, setListLimit() {}, setLocalDrafts() {}, setSync() {},
    setLiveError: value => { error = value },
    envelopesToThreads: envelopes => envelopes.map(envelope => ({ id: `live:${envelope.uid}` })),
    window: { api: {
      listEnvelopes: async () => ({ ok: true, data: [{ uid: 99 }], meta: {} }), listDrafts: async () => [],
      getMessage: async (path, uid) => { assert.equal(path, 'INBOX'); assert.equal(uid, 5); await new Promise(resolve => { releaseMessage = resolve }); return failure ? { ok: false, code: 'unknown', detail: 'Gone' } : { ok: true, data: { uid: 5 } } }
    } }
  }
  const load = vm.runInNewContext(ts.transpile(`(${declarations.get('loadFolder')})`, { target: ts.ScriptTarget.ES2022 }), context)
  const pending = load('INBOX', 5)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(loading, true, 'loading must continue while an older search result is fetched')
  assert.equal(selected, null)
  releaseMessage()
  await pending
  assert.equal(loading, false, 'loading ends after the result or error is ready')
  if (failure) {
    assert.equal(threads.length, 0, 'an expired notification must not open a different message')
    assert.equal(error.detail, 'Gone')
  } else {
    assert.equal(selected, 'live:5')
    assert.ok(threads.some(thread => thread.id === selected), 'notification can open mail outside the latest page')
  }
}
;(async () => {
  await focusOldMessage()
  await focusOldMessage(true)
  for (const kind of ['inbox', 'empty', 'error', 'switch']) await check(kind)
  // Checking other accounts must not delay loading the selected account.
  const handle = declarations.get('handleSelectAccount')
  assert.ok(handle.includes('void refreshAccounts()'))
  assert.ok(!handle.includes('await refreshAccounts()'))
  console.log('Account loading: pending folders, inbox, empty mailbox, errors, account switch and independent background polling passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
