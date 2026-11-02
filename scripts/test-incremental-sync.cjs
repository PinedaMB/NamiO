const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = code => ts.transpile(code, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const ast = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const code = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncMessages').getText(ast)
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-incremental-'))
const db = {}
vm.runInNewContext(compile(fs.readFileSync('src/main/db.ts', 'utf8')), { exports: db, require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id) })
const envelope = uid => ({ uid, subject: `Mail ${uid}`, from: null, date: '2026-10-30T12:00:00Z', unread: true, flagged: false, size: 1, hasAttachments: false, priority: 'normal' })
async function check(scenario) {
  db.openAccountCache(scenario)
  const initial = scenario === 'sparse-new-mail' ? [1000, 5000, 9000] : [1, 2, 3]
  db.upsertMailboxes([{ path: 'INBOX', name: 'INBOX', specialUse: null, messages: 3, unseen: 3 }])
  db.saveMailboxSync('INBOX', { uidValidity: 7, uidNext: scenario === 'sparse-new-mail' ? 9001 : 4, messages: 3, unseen: 3 })
  db.upsertEnvelopes('INBOX', initial.map(envelope))
  for (const uid of initial) db.saveBody('INBOX', uid, { text: `Saved body ${uid}`, html: '', to: [], cc: [], attachments: [] })
  if (scenario === 'empty-first' || scenario === 'empty-queued') db.clearMailbox('INBOX')
  let server = scenario.startsWith('empty-') && scenario !== 'empty-queued' ? [] : scenario === 'sparse-new-mail' ? [...initial, 10000] : scenario === 'deleted' || scenario === 'search-failed' ? [1, 3] : scenario === 'new-mail' ? [1, 2, 3, 4] : [1, 2, 3]
  const uidValidity = ['identity-changed', 'empty-reset'].includes(scenario) ? 8 : 7
  const uidNext = scenario === 'empty-incremental' ? 5 : scenario === 'sparse-new-mail' ? 10001 : scenario === 'uid-reset' || scenario === 'stale-fallback' || scenario === 'partial-status' ? 3 : scenario === 'new-mail' ? 5 : 4
  let cleared = false, released = false, searches = 0, ruleCalls = 0
  const requests = []
  const client = {
    mailbox: { path: 'Another folder', uidValidity: 999n, uidNext: 999n, exists: 0 },
    status: async () => {
      if (['fallback', 'missing-status', 'stale-fallback'].includes(scenario)) throw new Error('STATUS unavailable')
      if (scenario === 'partial-status') return { messages: server.length }
      return { messages: server.length, uidValidity, uidNext, unseen: server.length }
    },
    getMailboxLock: async folder => {
      assert.equal(folder, 'INBOX')
      client.mailbox = scenario === 'missing-status' ? false : { path: folder, uidValidity: BigInt(uidValidity), uidNext: BigInt(uidNext), exists: server.length }
      return { release() { released = true } }
    },
    search: async () => { searches++; return scenario === 'search-failed' ? false : server }
  }
  const context = { ...db, ensureClient: async () => client, readActiveAccount: async () => null, ensureFullSync() {}, isDraftMailbox: () => false,
    clearMailbox: folder => { cleared = true; db.clearMailbox(folder) }, applyRulesToNew: () => { ruleCalls++; return 0 },
    fetchRange: async (_client, range, byUid) => {
      requests.push({ range, byUid })
      const [first, last] = range.split(':')
      const from = Number(first)
      if (!byUid) assert.ok(from >= 1 && from <= server.length && (last === '*' || Number(last) <= server.length), `Invalid messageset: ${range}`)
      return (byUid ? server.filter(uid => uid >= from) : server.slice(from - 1, last === '*' ? undefined : Number(last))).map(envelope)
    }
  }
  const sync = vm.runInNewContext(compile(`${code}; syncMessages`), context)
  if (scenario === 'missing-status' || scenario === 'search-failed') await assert.rejects(sync('INBOX', 50), /estado|comprobar/)
  else if (scenario === 'empty-queued') {
    const serialCode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'serial').getText(ast)
    const serial = vm.runInNewContext(compile(`const operations=[];let operationRunning=false;${serialCode};serial`), {})
    let release
    const previous = serial(() => new Promise(resolve => { release = resolve }))
    const queued = serial(() => sync('INBOX', 50), 'background')
    await new Promise(resolve => setImmediate(resolve))
    server = []
    release()
    await Promise.all([previous, queued])
  } else await sync('INBOX', 50)
  assert.ok(released, 'folder locks release even if status or reconciliation fails')
  const reset = ['identity-changed', 'uid-reset', 'empty-first', 'empty-reset', 'empty-queued'].includes(scenario)
  assert.equal(cleared, reset, 'only confirmed identity/UID resets invalidate the cache')
  if (reset) assert.equal(ruleCalls, 0, 'historical refill is never fed to automatic rules')
  else if (scenario === 'new-mail' || scenario === 'sparse-new-mail') assert.equal(ruleCalls, 1, 'only the newly arrived message reaches the rules')
  for (const uid of [initial[0], initial[2]]) assert.equal(db.readBody('INBOX', uid).text, reset || scenario.startsWith('empty-') ? null : `Saved body ${uid}`, 'unchanged message bodies survive reconnect and deletion reconciliation')
  if (scenario === 'deleted') { assert.equal(db.readEnvelope('INBOX', 2), null); assert.equal(searches, 1) }
  if (scenario === 'search-failed') assert.ok(db.readEnvelope('INBOX', 2), 'failed UID search cannot prune the cache')
  if (scenario === 'new-mail') {
    assert.ok(requests.some(request => request.byUid && request.range === '4:*'))
    assert.ok(requests.some(request => !request.byUid && request.range === '1:3'), 'the visible window is not downloaded twice')
    assert.equal(requests.filter(request => request.range === '1:*').length, 0)
    assert.ok(db.readEnvelope('INBOX', 4))
  }
  if (scenario.startsWith('empty-')) {
    assert.equal(requests.length, 0, 'an empty folder never sends FETCH 1:*')
    assert.equal(db.countMessages('INBOX'), 0)
    assert.equal(db.getMailboxMeta('INBOX').messages, 0)
  } else if (reset) assert.equal(requests.length, 1, 'a full sync downloads the window once')
  if (scenario === 'sparse-new-mail') {
    assert.ok(requests.some(request => request.byUid && request.range === '9001:*'))
    assert.ok(requests.some(request => !request.byUid && request.range === '1:3'), 'UID gaps cannot become out-of-bounds sequence ranges')
  }
  if (scenario === 'stale-fallback' || scenario === 'partial-status') assert.equal(db.getMailboxMeta('INBOX').uidNext, 4, 'stale selected-folder metadata cannot rewind the cached UID cursor')
  db.closeCache()
}
;(async () => {
  try {
    for (const scenario of ['empty-first', 'empty-reset', 'empty-queued', 'empty-incremental', 'sparse-new-mail', 'unchanged', 'new-mail', 'deleted', 'fallback', 'stale-fallback', 'partial-status', 'missing-status', 'search-failed', 'identity-changed', 'uid-reset']) await check(scenario)
    console.log('Incremental sync: cached bodies survive reconnect, deletion and STATUS fallback; new UIDs, failed searches and genuine identity resets verified')
  } finally { db.closeCache(); fs.rmSync(directory, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
