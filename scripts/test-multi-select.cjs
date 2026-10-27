const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let expression
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'bulkAction') expression = node.initializer.getText(ast)
  ts.forEachChild(node, find)
}
find(ast)
async function check(action, behavior = 'success') {
  const calls = []
  const context = {
    live: behavior !== 'demo', checkedIds: ['live:1', 'live:2'], threads: [{ id: 'live:1', unread: true }, { id: 'live:2', unread: true }],
    setPendingDelete() {}, bulkRunning: { current: false }, deletingMessage: { current: false }, accountGeneration: { current: 0 }, folderRequest: { current: 0 }, folder: 'INBOX',
    uidOf: id => Number(id.slice(5)), t: key => key, refreshOutbox: async () => {},
    setBulkBusy() {}, setToast() {},
    setThreads: update => { context.threads = update(context.threads) },
    setCheckedIds: update => { context.checkedIds = update(context.checkedIds) }
  }
  const invoke = async (_path, uid) => {
    calls.push(uid)
    if (behavior === 'cancel') return { ok: true, queued: false, canceled: true }
    if (behavior === 'switch') context.accountGeneration.current++
    if (behavior === 'error' && uid === 2) return { ok: false, error: 'server rejected', detail: 'server rejected' }
    return { ok: true, queued: behavior === 'queued', data: true }
  }
  context.window = { api: { setSeen: invoke, archiveMessage: invoke, deleteMessage: invoke } }
  const run = vm.runInNewContext(ts.transpile(`(${expression})`, { target: ts.ScriptTarget.ES2022 }), context)
  await run(action)
  assert.equal(context.bulkRunning.current, false)
  if (behavior === 'cancel' || behavior === 'switch') {
    assert.equal(calls.length, 1)
    assert.equal(context.threads.length, 2)
    assert.equal(context.checkedIds.length, 2)
  } else if (behavior === 'error') {
    assert.equal(context.checkedIds.length, 1)
    assert.equal(context.checkedIds[0], 'live:2')
  } else {
    assert.equal(calls.length, behavior === 'demo' ? 0 : 2)
    assert.equal(context.checkedIds.length, 0)
    if (behavior === 'queued') assert.equal(context.threads.length, 2)
    else if (action === 'read') assert.ok(context.threads.every(thread => !thread.unread))
    else assert.equal(context.threads.length, 0)
  }
}
(async () => {
  for (const action of ['read', 'archive', 'delete']) await check(action)
  await check('delete', 'cancel')
  await check('delete', 'switch')
  await check('delete', 'queued')
  await check('read', 'error')
  await check('read', 'demo')
  console.log('Multiple selection: read/archive/delete, cancellation, queued operations, partial failures and account switch passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
