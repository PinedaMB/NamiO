const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = source => ts.transpile(source, { target: ts.ScriptTarget.ES2022 })
function functions(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast).replace(/^export /, '')]))
}
async function main() {
  const declarations = functions('src/main/imap.ts')
  const commands = [], removed = []
  let releases = 0, accepted = true
  const client = {
    mailbox: { uidValidity: 7n }, capabilities: new Set(['UIDPLUS', 'MOVE']),
    getMailboxLock: async () => ({ release() { releases++ } }),
    search: async () => [1, 5000, 9000],
    messageDelete: async range => { commands.push(['delete', range]); return accepted },
    messageMove: async (range, target) => { commands.push(['move', range, target]); return accepted }
  }
  const context = {
    syncGeneration: 0, serial: fn => fn(), ensureClient: async () => client,
    trashPath: () => 'Trash', readMailboxes: () => [{ path: 'Spam', name: 'Spam' }],
    isSpamMailbox: box => box.path === 'Spam', deleteMessageRow: (_path, uid) => { removed.push(uid); return null },
    adjustMailboxUnseen() {}, syncMailboxes: async () => {}, notify() {}, console
  }
  const load = name => vm.runInNewContext(compile(`(${declarations.get(name)})`), context)
  const snapshot = await load('mailboxDeletionSnapshot')('Spam')
  assert.equal(snapshot.uidValidity, '7')
  assert.deepEqual(Array.from(snapshot.uids), [1, 5000, 9000], 'empty-folder enumerates the server, including uncached messages')
  const remove = load('deleteMessageBatch')
  const uids = Array.from({ length: 205 }, (_, index) => index + 1)
  const progress = []
  await remove('Spam', uids, true, '7', completed => progress.push(completed))
  assert.deepEqual(progress, [100, 200, 205], 'progress advances only after confirmed server batches')
  assert.equal(commands.length, 3, 'large deletions are split into bounded IMAP requests')
  assert.deepEqual(removed, uids)
  assert.ok(commands.every(command => command[0] === 'delete' && !command[1].includes('*')), 'new arrivals are never included by a wildcard')
  commands.length = 0
  await remove('INBOX', [4, 9], false, '7')
  assert.deepEqual(commands, [['move', '4,9', 'Trash']])
  commands.length = 0
  await assert.rejects(remove('Spam', [4], true, '8'), /identidad/)
  await assert.rejects(remove('INBOX', [4], true, '7'), /inválido/)
  assert.equal(commands.length, 0, 'wrong UIDVALIDITY and permanent deletion outside Spam/Trash cannot mutate the server')
  client.capabilities.clear()
  await assert.rejects(remove('Spam', [4], true, '7'), /segura/)
  assert.equal(commands.length, 0, 'no broad expunge without UIDPLUS')
  client.capabilities.add('UIDPLUS')
  accepted = false
  const before = removed.length
  await assert.rejects(remove('Trash', [4], true, '7'), /confirmó/)
  assert.equal(removed.length, before, 'failed server operations preserve the cache')
  assert.ok(releases >= 6, 'mailbox locks are released on failures too')

  const file = 'src/main/ipc.ts'
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let handler
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.messagesDelete') handler = node.arguments[1].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const response of [0, 1]) for (const empty of [false, true]) {
    const queued = []
    let accountId = 'one', changeAccount = false, confirmations = 0
    const ipcContext = {
      readActiveAccount: async () => ({ id: accountId, user: 'test@example.test' }), cacheAccountId: () => accountId,
      readMailboxes: () => [{ path: 'Spam', name: 'Spam' }, { path: 'Trash', name: 'Trash' }],
      trashPath: () => 'Trash', isSpamMailbox: box => box.path === 'Spam', getMailboxMeta: () => ({ uidValidity: 7 }),
      mailboxDeletionSnapshot: async () => snapshot, readSettings: async () => ({ language: 'es' }),
      BrowserWindow: { fromWebContents: () => null }, dialog: { showMessageBox: async options => {
        confirmations++
        assert.equal(options.defaultId, 0)
        assert.equal(options.cancelId, 0)
        assert.match(options.detail, empty ? /definitivamente/ : /Papelera/)
        if (changeAccount) accountId = 'two'
        return { response }
      } },
      enqueueOutbox: entry => { queued.push(entry); return 'job' },
      processOutbox: () => new Promise(() => {})
    }
    const invoke = vm.runInNewContext(compile(`(${handler})`), ipcContext)
    const result = await invoke({ sender: {} }, 'Spam', empty ? undefined : [1, 2, 2])
    assert.equal(queued.length, response, 'nothing is queued before explicit confirmation')
    assert.equal(result.canceled === true, response === 0)
    assert.equal(confirmations, 1, 'one confirmation per batch')
    if (response) {
      assert.equal(result.queued, true, 'IPC returns while background processing is still pending')
      assert.equal(queued[0].kind, 'delete-many')
      assert.equal(queued[0].payload.permanent, empty)
      assert.equal(queued[0].payload.uidValidity, '7')
      assert.deepEqual(Array.from(queued[0].payload.uids), empty ? [1, 5000, 9000] : [1, 2])
    }
    assert.equal((await invoke({ sender: {} }, 'INBOX')).ok, false, 'empty-folder rejects regular mailboxes')
    assert.equal((await invoke({ sender: {} }, 'Spam', [-1])).ok, false)
    queued.length = 0
    changeAccount = true
    await invoke({ sender: {} }, 'Spam', empty ? undefined : [1])
    assert.equal(queued.length, 0, 'changing account during confirmation cannot enqueue against another account')
  }
  console.log('Background deletion: server snapshots, bounded UID batches, cache safety, UIDVALIDITY, cancellation, account isolation and immediate queuing passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
