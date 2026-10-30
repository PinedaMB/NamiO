const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = code => ts.transpile(code, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
function declarations(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const result = new Map()
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) result.set(node.name.text, node.getText(ast).replace(/^export /, ''))
    if (ts.isVariableDeclaration(node) && node.initializer) result.set(node.name.getText(ast), node.initializer.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return result
}
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-move-'))
  const db = {}, addresses = {}, moved = []
  vm.runInNewContext(compile(fs.readFileSync('src/shared/mailAddresses.ts', 'utf8')), { exports: addresses })
  vm.runInNewContext(compile(fs.readFileSync('src/main/db.ts', 'utf8')), { exports: db, require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id) })
  const loadMail = () => {
    const mail = {}
    vm.runInNewContext(compile(fs.readFileSync('src/main/mail.ts', 'utf8')), { exports: mail, console, Buffer, require: id => {
      if (id === './db') return db
      if (id === '@shared/mailAddresses') return addresses
      if (id === './drafts') return {}
      if (id === './settings') return { readActiveAccount: async () => ({ id: 'one' }) }
      if (id === 'electron') return { BrowserWindow: {}, dialog: {} }
      if (id === './imap') return { moveMessage: async (...args) => { moved.push(args); db.deleteMessageRow(args[0], args[1]) } }
      return require(id)
    } })
    return mail
  }
  try {
    db.openAccountCache('one')
    db.upsertMailboxes(['INBOX', 'Archive', 'Spam'].map(name => ({ path: name, name, specialUse: null, messages: 1, unseen: 1 })))
    db.saveMailboxSync('INBOX', { uidValidity: 7, uidNext: 2, messages: 1, unseen: 1 })
    db.upsertEnvelopes('INBOX', [{ uid: 1, subject: 'Move me', from: null, date: new Date().toISOString(), unread: true, flagged: false, size: 1 }])
    let mail = loadMail()
    await mail.pauseOutbox()
    for (const args of [['INBOX', 0, 'Spam'], ['INBOX', 1.2, 'Spam'], ['INBOX', 1, 'INBOX'], ['INBOX', 1, 'Missing'], ['Missing', 1, 'Spam'], ['INBOX', 2, 'Spam'], [null, 1, 'Spam']]) {
      assert.equal((await mail.moveMessageAction(...args)).ok, false)
    }
    assert.equal(db.listOutbox().length, 0, 'invalid moves never reach the persistent queue')
    const pending = await mail.moveMessageAction('INBOX', 1, 'Spam')
    assert.equal(pending.ok, true); assert.equal(pending.queued, true)
    assert.ok(db.readEnvelope('INBOX', 1), 'queued moves retain the cached message')
    assert.equal((await mail.moveMessageAction('INBOX', 1, 'Archive')).ok, false, 'a second destination cannot duplicate an in-flight move')
    assert.equal(db.listOutbox().length, 1)
    db.closeCache(); db.openAccountCache('one')
    assert.equal(JSON.parse(db.listOutbox()[0].payload).uidValidity, '7', 'mailbox identity survives restart')
    db.openAccountCache('two'); mail = loadMail(); await mail.processOutbox()
    assert.equal(moved.length, 0, 'another account cannot replay this move')
    db.openAccountCache('one'); mail = loadMail(); await mail.processOutbox()
    assert.deepEqual(moved, [['INBOX', 1, 'Spam', '7']])
    assert.equal(db.listOutbox().length, 0)
    assert.equal(db.readEnvelope('INBOX', 1), null)
  } finally { db.closeCache(); fs.rmSync(directory, { recursive: true, force: true }) }

  const imap = declarations('src/main/imap.ts')
  const client = { mailbox: { uidValidity: 7n }, capabilities: new Set(['MOVE']), getMailboxLock: async () => ({ release() {} }), messageMove: async () => true }
  let removed = 0, failRefresh = false
  const notifications = []
  const move = vm.runInNewContext(compile(`${imap.get('moveMessage')}; moveMessage`), {
    serial: async fn => fn(), ensureClient: async () => client, deleteMessageRow: () => { removed++; return { unread: true } }, adjustMailboxUnseen() {}, notify: mailbox => notifications.push(mailbox),
    syncMailboxes: async () => { if (failRefresh) throw new Error('Offline after move') }, describe: error => error.message, console: { error() {} }
  })
  await assert.rejects(move('INBOX', 1, 'Spam', '8'), /identidad/)
  assert.equal(removed, 0, 'changed UIDVALIDITY cannot move another message with a reused UID')
  client.messageMove = async () => false
  await assert.rejects(move('INBOX', 1, 'Spam', '7'), /no confirmó/)
  assert.equal(removed, 0, 'server refusal preserves the cached message')
  client.messageMove = async () => true
  client.capabilities.clear()
  await assert.rejects(move('INBOX', 1, 'Spam', '7'), /forma segura/)
  assert.equal(removed, 0)
  client.capabilities.add('MOVE'); await move('INBOX', 1, 'Spam', '7'); assert.equal(removed, 1)
  assert.equal(notifications.at(-1), '*', 'folder counts are refreshed after moving')
  failRefresh = true
  await move('INBOX', 2, 'Spam', '7')
  assert.equal(removed, 2, 'a failed folder refresh cannot turn an accepted move into another queued move')

  const app = declarations('src/renderer/src/App.tsx')
  for (const outcome of ['success', 'queued', 'failure', 'ipc', 'account', 'folder']) {
    let finish, removed = false, busy = false, moving = null, calls = 0
    const context = { live: true, selected: { id: 'live:1' }, folder: 'INBOX', mailboxes: [{ path: 'Spam' }], uidOf: () => 1,
      bulkRunning: { current: false }, deletingMessage: { current: false }, accountGeneration: { current: 1 }, folderRequest: { current: 1 },
      setBulkBusy: value => { busy = value }, setMovingId: value => { moving = value }, setMoveOpen() {}, setToast() {}, t: key => key, refreshOutbox() {},
      setThreads: fn => { removed = fn([{ id: 'live:1' }]).length === 0 },
      window: { api: { moveMessage: () => { calls++; return new Promise((resolve, reject) => { finish = () => outcome === 'ipc' ? reject(new Error('IPC')) : resolve({ ok: outcome !== 'failure', queued: outcome === 'queued' }) }) } } }
    }
    const moveSelected = vm.runInNewContext(compile(`(${app.get('moveSelected')})`), context)
    moveSelected('Spam'); moveSelected('Spam')
    assert.equal(calls, 1); assert.ok(busy); assert.equal(moving, 'live:1'); assert.equal(removed, false)
    if (outcome === 'account') context.accountGeneration.current++
    if (outcome === 'folder') context.folderRequest.current++
    finish(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(removed, outcome === 'success', 'failure, queued and stale results cannot remove the visible message')
    assert.equal(busy, false); assert.equal(moving, null)
  }
  console.log('Moves: IPC boundary validation, persistent queue, restart/account isolation, deduplication, UIDVALIDITY, server refusal and renderer feedback passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
