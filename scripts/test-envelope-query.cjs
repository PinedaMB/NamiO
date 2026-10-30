const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-envelope-query-'))
const db = {}
const compile = source => ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
vm.runInNewContext(compile(fs.readFileSync('src/main/db.ts', 'utf8')), { exports: db, Buffer, require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id) })
try {
  db.openAccountCache('test')
  const rows = Array.from({ length: 2505 }, (_, index) => ({ uid: index + 1, priority: index === 0 ? 'high' : index === 1 ? 'low' : 'normal', date: new Date(1700000000000 + index * 60000).toISOString(), subject: `Message ${index + 1}`, from: null, unread: index < 55, flagged: false, size: 1 }))
  db.upsertEnvelopes('INBOX', rows)
  db.upsertEnvelopes('Other', [{ ...rows[0], uid: 9999 }])
  const ids = values => Array.from(values, row => row.uid)
  assert.equal(db.readEnvelopes('INBOX', 50)[0].uid, 2505)
  const unread = db.readEnvelopes('INBOX', 50, { filter: 'unread' })
  assert.equal(unread.length, 50)
  assert.equal(unread[0].uid, 55, 'finds unread mail beyond the first 50 newest messages')
  assert.ok(unread.every(row => row.unread))
  assert.equal(db.readEnvelopes('INBOX', 150, { filter: 'unread' }).length, 55)
  assert.deepEqual(ids(db.readEnvelopes('INBOX', 3, { oldestFirst: true })), [1, 2, 3], 'oldest mail comes from the whole cache')
  assert.deepEqual(ids(db.readEnvelopes('INBOX', 3, { filter: 'read', oldestFirst: true })), [56, 57, 58])
  assert.equal(db.readEnvelopes('INBOX', 3000).length, 2505, 'all cached matches remain accessible beyond 2000')
  assert.ok(db.readEnvelopes('INBOX', 50, { filter: 'read', oldestFirst: true, includeUid: 1 }).some(row => row.uid === 1), 'preserves open mail when read state changes')
  for (const options of [{}, { filter: 'read' }, { filter: 'unread' }, { oldestFirst: true }]) {
    const uid = options.oldestFirst ? 2505 : 1
    const refreshed = db.readEnvelopes('INBOX', 3, { ...options, includeUid: uid })
    assert.ok(refreshed.some(row => row.uid === uid), 'background refresh preserves an open search result outside the first page')
    assert.equal(new Set(ids(refreshed)).size, refreshed.length)
  }
  assert.equal(db.readEnvelopes('INBOX', 3, { includeUid: 9999 }).length, 3, 'cannot include a selection from another mailbox')
  assert.equal(db.readEnvelopes('INBOX', 3, { includeUid: 2505 }).length, 3, 'does not duplicate a selection already in the page')
  assert.equal(db.readEnvelope('INBOX',1).priority,'high')
  assert.equal(db.readEnvelope('INBOX',2).priority,'low')
  assert.equal(db.countMessages('INBOX'), 2505)
  assert.equal(db.countUnread('INBOX'), 55)
  assert.deepEqual(ids(db.readEnvelopes('Empty', 50, { filter: 'unread' })), [])
} finally { db.closeCache(); fs.rmSync(directory, { recursive: true, force: true }) }

const source = fs.readFileSync('src/main/ipc.ts', 'utf8')
const ast = ts.createSourceFile('ipc.ts', source, ts.ScriptTarget.Latest, true)
let handler
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.messagesList') handler = node.arguments[1].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
let called
const list = vm.runInNewContext(compile(`(${handler})`), { listEnvelopes: (...args) => { called = args; return { ok: true } } })
assert.equal(list(null, 'INBOX', 2505, false, { filter: 'unread', oldestFirst: true }).ok, true)
assert.equal(called[1], 2505)
for (const [limit, options] of [[NaN, {}], [-1, {}], [1.5, {}], [50, null], [50, { filter: 'sql' }], [50, { oldestFirst: 'ASC' }], [50, { includeUid: -2 }]]) {
  called = null
  assert.equal(list(null, 'INBOX', limit, false, options).ok, false)
  assert.equal(called, null)
}
console.log('Envelope queries: filter/order before LIMIT, cache >2000, counts, open selection, mailbox isolation and IPC validation verified')

const appAst = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let loadMoreCode
function findLoadMore(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === 'loadMore') loadMoreCode = node.initializer.getText(appAst)
  ts.forEachChild(node, findLoadMore)
}
findLoadMore(appAst)
async function checkPagination(fail, stale) {
  let limit = 2050, count = 0, calls = 0
  const context = {
    live: true, loadingFolder: false, loadingMoreRef: { current: false }, folder: 'INBOX', activeFolderRef: { current: 'INBOX' },
    folderRequest: { current: 1 }, accountGeneration: { current: 1 }, listLimit: limit, locale: 'es',
    listOptions: { current: { filter: 'unread', oldestFirst: true } }, useCallback: fn => fn,
    setListLimit: next => { limit = next }, setListCounts: value => { count = value.total },
    setThreads() {}, setSelectedId() {}, envelopesToThreads: value => value,
    window: { api: { listEnvelopes: async (folder, next, sync, options) => {
      calls++
      assert.equal(next, 2150, 'pagination continues beyond 2000')
      assert.equal(sync, false, 'pagination only queries cache')
      assert.equal(options.filter, 'unread')
      assert.equal(options.oldestFirst, true)
      if (stale) context.folderRequest.current++
      return fail ? { ok: false } : { ok: true, data: [], counts: { total: 2505, unread: 55 } }
    } } }
  }
  const more = vm.runInNewContext(compile(`(${loadMoreCode})`), context)
  await more()
  assert.equal(calls, 1)
  assert.equal(context.loadingMoreRef.current, false)
  assert.equal(limit, fail || stale ? 2050 : 2150, 'failed or obsolete query does not advance pagination')
  assert.equal(count, fail || stale ? 0 : 2505)
}
;(async () => {
  await checkPagination(false, false)
  await checkPagination(true, false)
  await checkPagination(false, true)
  console.log('Pagination: query forwarding, >2000, retry and obsolete filter/folder response verified')
})().catch(error => { console.error(error); process.exitCode = 1 })

let reloadQuery
function findReload(node) {
  if (ts.isCallExpression(node) && node.expression.getText(appAst) === 'useEffect' && node.arguments[0]?.getText(appAst).includes('const focusUid = filterFocusUid.current')) reloadQuery = node.arguments[0].getText(appAst)
  ts.forEachChild(node, findReload)
}
findReload(appAst)
for (const focusUid of [undefined, 42]) {
  const focus = { current: focusUid }
  let reloaded
  const reload = vm.runInNewContext(compile(`(${reloadQuery})`), {
    live: true, activeFolderRef: { current: 'Archive' }, filterFocusUid: focus,
    loadFolder: (...args) => { reloaded = args }
  })
  reload()
  assert.equal(reloaded[0], 'Archive')
  assert.equal(reloaded[1], focusUid, 'search or notification target survives a filter change')
  assert.equal(reloaded[2], false, 'filter/order changes do not request network sync')
  assert.equal(focus.current, undefined)
}
