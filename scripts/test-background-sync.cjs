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
async function check(initial, switchAccount = false, fail = false, metadata = false) {
  const server = [7, 8, 1000, 9000, 20000]
  const cached = new Set(initial)
  const requests = []
  let releases = 0
  const resumed = []
  const context = {
    syncGeneration: 0, fullSyncRunning: false, pendingFullSync: new Set(['Archive']), ensureFullSync: path => resumed.push(path),
    serial: async fn => fn(),
    ensureClient: async () => ({
      search: async () => server.slice(),
      getMailboxLock: async () => ({ release: () => releases++ })
    }),
    missingEnvelopeMetadata: () => metadata ? initial : [],
    messagesByUids: (_path, uids) => uids.filter(uid => cached.has(uid)).map(uid => ({ uid })),
    fetchRange: async (_client, range, byUid) => {
      assert.equal(byUid, true)
      requests.push(range)
      if (fail) throw new Error('network down')
      if (switchAccount) context.syncGeneration++
      return range.split(',').map(Number).map(uid => ({ uid }))
    },
    upsertEnvelopes: (_path, envelopes) => envelopes.forEach(item => cached.add(item.uid)),
    countMessages: () => cached.size,
    publishProgress: () => {}, notify: () => {}, sleep: async () => {},
    describe: error => error.message, console: { error() {} }
  }
  const sync = vm.runInNewContext(ts.transpile(`${code}; fullSyncMailbox`, { target: ts.ScriptTarget.ES2022 }), context)
  await sync('INBOX', 2)
  assert.equal(context.fullSyncRunning, false)
  assert.ok(releases > 0)
  assert.deepEqual(resumed, ['Archive'], 'a waiting folder resumes after the current download')
  if (switchAccount || fail) {
    assert.deepEqual([...cached], initial, 'interrupted work cannot write into another account or discard cached mail')
  } else {
    assert.deepEqual([...cached].sort((a, b) => a - b), server)
    const fetched = requests.flatMap(range => range.split(',').map(Number))
    assert.ok(fetched.every(uid => metadata || !initial.includes(uid)), 'already cached messages are not fetched again')
    assert.equal(fetched.length, server.length - (metadata ? 0 : initial.length))
  }
}
(async () => {
  await check([20000])
  await check([])
  await check([20000], false, false, true)
  await check([20000], true)
  await check([20000], false, true)
  console.log('Background sync: sparse UIDs, empty cache, account switch and network failure passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
