const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/main/imap.ts', 'utf8')
const ast = ts.createSourceFile('imap.ts', source, ts.ScriptTarget.Latest, true)
let code
for (const node of ast.statements) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'fullSyncMailbox') code = node.getText(ast)
}
async function check(initial, switchAccount = false, fail = false, metadata = false, disableDuringDownload = false) {
  const server = [7, 8, 1000, 9000, 20000]
  const cached = new Set(initial)
  const pendingMetadata = new Set(metadata ? initial : [])
  const progress = []
  const bodies = new Set(initial)
  const bodyRequests = []
  const requests = []
  let releases = 0
  const resumed = []
  let enabled = true
  const context = { readSettings: async () => ({ offlineDownload: enabled }),
    syncGeneration: 0, fullSyncRunning: false, pendingFullSync: new Set(['Archive']), ensureFullSync: path => resumed.push(path),
    MAX_OFFLINE_MESSAGE_BYTES: 30 * 1024 * 1024,
    serial: async fn => fn(),
    ensureClient: async () => ({
      search: async () => server.slice(),
      getMailboxLock: async () => ({ release: () => releases++ })
    }),
    missingBodyUids: () => server.filter(uid=>!bodies.has(uid)),
    readEnvelope: (_path, uid) => cached.has(uid) ? { uid } : null,
    readBody: (_path, uid) => ({ fetched: bodies.has(uid) }), countBodies: () => bodies.size,
    cacheMessageBody: async (_path, uid) => { bodyRequests.push(uid); bodies.add(uid); if (disableDuringDownload) enabled = false },
    classify: () => 'network', isOfflineError: () => true,
    missingEnvelopeMetadata: () => [...pendingMetadata],
    messagesByUids: (_path, uids) => uids.filter(uid => cached.has(uid)).map(uid => ({ uid })),
    fetchRange: async (_client, range, byUid) => {
      assert.equal(byUid, true)
      requests.push(range)
      if (fail) throw new Error('network down')
      if (switchAccount) context.syncGeneration++
      return range.split(',').map(Number).map(uid => ({ uid }))
    },
    upsertEnvelopes: (_path, envelopes) => envelopes.forEach(item => { cached.add(item.uid); pendingMetadata.delete(item.uid) }),
    countMessages: () => cached.size,
    publishProgress: value => progress.push(value), notify: () => {}, sleep: async () => {},
    describe: error => error.message, console: { error() {} }
  }
  const sync = vm.runInNewContext(ts.transpile(`${code}; fullSyncMailbox`, { target: ts.ScriptTarget.ES2022 }), context)
  await sync('INBOX', 2)
  assert.equal(context.fullSyncRunning, false)
  if (!switchAccount) assert.equal(progress.at(-1), null, 'completion always clears the progress indicator')
  if (metadata && initial.length === server.length) {
    const headers = progress.filter(item => item?.phase === 'headers')
    assert.deepEqual(headers.map(item => item.cached), [2, 4, 5], 'metadata backfill reports completed headers rather than total cached rows')
  }
  assert.ok(releases > 0)
  assert.deepEqual(resumed, ['Archive'], 'a waiting folder resumes after the current download')
  if (switchAccount || fail) {
    assert.deepEqual([...cached], initial, 'interrupted work cannot write into another account or discard cached mail')
  } else {
    assert.deepEqual([...cached].sort((a, b) => a - b), server)
    const fetched = requests.flatMap(range => range.split(',').map(Number))
    assert.ok(fetched.every(uid => metadata || !initial.includes(uid)), 'already cached messages are not fetched again')
    assert.equal(fetched.length, server.length - (metadata ? 0 : initial.length))
    if (disableDuringDownload) {
      assert.equal(bodyRequests.length,1,'disabling during a pass stops further body downloads')
      assert.ok(bodies.has(initial[0]),'previously saved content remains available')
      return
    }
    assert.deepEqual([...bodies].sort((a,b)=>a-b),server,'background synchronization saves missing bodies too')
    assert.ok(bodyRequests.every(uid=>!initial.includes(uid)),'saved bodies are not fetched again')
  }
}
(async () => {
  await check([7, 8, 1000, 9000, 20000], false, false, true)
  await check([20000])
  await check([20000], false, false, false, true)
  await check([])
  await check([20000], false, false, true)
  await check([20000], true)
  await check([20000], false, true)
  console.log('Background sync: sparse UIDs, empty cache, account switch and network failure passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
