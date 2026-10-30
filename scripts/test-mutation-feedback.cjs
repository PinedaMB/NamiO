const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const ast = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const code = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast).replace(/^export /, '')]))
async function check(kind, accepted = true, failRefresh = false) {
  const events = [], removed = []
  let finishRefresh, refreshStarted = false, completed = false
  const path = kind === 'permanent' || kind === 'batch' ? 'Trash' : 'INBOX'
  const context = {
    syncGeneration: 1, serial: async fn => fn(),
    ensureClient: async () => ({ mailbox: { uidValidity: 7n }, capabilities: new Set(['MOVE', 'UIDPLUS']),
      getMailboxLock: async () => ({ release() {} }), messageMove: async () => accepted, messageDelete: async () => accepted }),
    trashPath: () => 'Trash', readMailboxes: () => [{ path: 'Trash' }], isSpamMailbox: () => false,
    deleteMessageRow: (_path, uid) => { removed.push(uid); return { unread: true } }, adjustMailboxUnseen() {},
    notify: mailbox => events.push(mailbox), describe: error => error.message, console: { error() {} },
    syncMailboxes: () => { refreshStarted = true; return new Promise((resolve, reject) => { finishRefresh = () => failRefresh ? reject(new Error('Slow status failed')) : resolve() }) }
  }
  const name = kind === 'move' ? 'moveMessage' : kind === 'batch' ? 'deleteMessageBatch' : 'deleteMessage'
  const fn = vm.runInNewContext(ts.transpile(`${code.get(name)}; ${name}`, { target: ts.ScriptTarget.ES2022 }), context)
  const operation = kind === 'move' ? fn(path, 1, 'Spam', '7') : kind === 'batch' ? fn(path, [1, 2], true, '7') : fn(path, 1, kind === 'permanent')
  // Attach rejection handling before yielding to the event loop.
  const done = operation.then(() => { completed = true }, error => { throw error })
  if (!accepted) {
    await assert.rejects(done, /no confirmó/)
    assert.equal(removed.length, 0); assert.equal(events.length, 0); assert.equal(refreshStarted, false)
    return
  }
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(refreshStarted)
  assert.equal(completed, false, 'the folder status request is still pending')
  assert.deepEqual(removed, kind === 'batch' ? [1, 2] : [1])
  assert.deepEqual(events, [path], 'confirmed cache changes reach the reader before slow folder status completes')
  finishRefresh(); await done
  assert.deepEqual(events, [path, '*'], 'folder counters are refreshed separately, including after status failure')
}
;(async () => {
  for (const kind of ['move', 'delete', 'permanent', 'batch']) {
    await check(kind); await check(kind, false); await check(kind, true, true)
  }
  console.log('Mutation feedback: moves, trash, permanent and batch deletion update the reader before slow folder status; refusals preserve cache and status failures remain safe')
})().catch(error => { console.error(error); process.exitCode = 1 })
