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
  db.upsertMailboxes([{ path: 'INBOX', name: 'INBOX', specialUse: null, messages: 3, unseen: 3 }])
  db.saveMailboxSync('INBOX', { uidValidity: 7, uidNext: 4, messages: 3, unseen: 3 })
  db.upsertEnvelopes('INBOX', [1, 2, 3].map(envelope))
  for (const uid of [1, 2, 3]) db.saveBody('INBOX', uid, { text: `Saved body ${uid}`, html: '', to: [], cc: [], attachments: [] })
  let server = scenario === 'deleted' || scenario === 'search-failed' ? [1, 3] : scenario === 'new-mail' ? [1, 2, 3, 4] : [1, 2, 3]
  const uidValidity = scenario === 'identity-changed' ? 8 : 7
  const uidNext = scenario === 'uid-reset' || scenario === 'stale-fallback' || scenario === 'partial-status' ? 3 : scenario === 'new-mail' ? 5 : 4
  let cleared = false, released = false, searches = 0
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
    clearMailbox: folder => { cleared = true; db.clearMailbox(folder) }, applyRulesToNew: () => 0,
    fetchRange: async (_client, range, byUid) => {
      requests.push({ range, byUid })
      const from = Number(range.split(':')[0])
      return (byUid ? server.filter(uid => uid >= from) : server.slice(from - 1)).map(envelope)
    }
  }
  const sync = vm.runInNewContext(compile(`${code}; syncMessages`), context)
  if (scenario === 'missing-status' || scenario === 'search-failed') await assert.rejects(sync('INBOX', 50), /estado|comprobar/)
  else await sync('INBOX', 50)
  assert.ok(released, 'folder locks release even if status or reconciliation fails')
  const reset = scenario === 'identity-changed' || scenario === 'uid-reset'
  assert.equal(cleared, reset, 'only confirmed identity/UID resets invalidate the cache')
  for (const uid of [1, 3]) assert.equal(db.readBody('INBOX', uid).text, reset ? null : `Saved body ${uid}`, 'unchanged message bodies survive reconnect and deletion reconciliation')
  if (scenario === 'deleted') { assert.equal(db.readEnvelope('INBOX', 2), null); assert.equal(searches, 1) }
  if (scenario === 'search-failed') assert.ok(db.readEnvelope('INBOX', 2), 'failed UID search cannot prune the cache')
  if (scenario === 'new-mail') { assert.ok(requests.some(request => request.byUid && request.range === '4:*')); assert.ok(db.readEnvelope('INBOX', 4)) }
  if (scenario === 'stale-fallback' || scenario === 'partial-status') assert.equal(db.getMailboxMeta('INBOX').uidNext, 4, 'stale selected-folder metadata cannot rewind the cached UID cursor')
  db.closeCache()
}
;(async () => {
  try {
    for (const scenario of ['unchanged', 'new-mail', 'deleted', 'fallback', 'stale-fallback', 'partial-status', 'missing-status', 'search-failed', 'identity-changed', 'uid-reset']) await check(scenario)
    console.log('Incremental sync: cached bodies survive reconnect, deletion and STATUS fallback; new UIDs, failed searches and genuine identity resets verified')
  } finally { db.closeCache(); fs.rmSync(directory, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
