const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const ts = require('typescript')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
async function main() {
  const source = await fs.readFile('src/main/imap.ts', 'utf8')
  const ast = ts.createSourceFile('imap.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'deleteMessage').getText(ast).replace(/^export /, '')
  for (const path of ['INBOX', 'Trash']) for (const success of [true, false]) {
    let removed = false
    const commands = []
    const client = {
      capabilities: new Set(['UIDPLUS', 'MOVE']),
      getMailboxLock: async () => ({ release() {} }),
      messageMove: async (_uid, target) => { commands.push(['move', target]); return success },
      messageDelete: async () => { commands.push(['delete']); return success }
    }
    const remove = vm.runInNewContext(ts.transpile(`${fn}; deleteMessage`, { target: ts.ScriptTarget.ES2022 }), {
      serial: async fn => fn(), ensureClient: async () => client, trashPath: () => 'Trash',
      syncMailboxes: async () => {}, deleteMessageRow: () => { removed = true; return { unread: true } },
      adjustMailboxUnseen() {}, notify() {}, describe: error => error.message, console
    })
    if (success) await remove(path, 1, path === 'Trash')
    else await assert.rejects(remove(path, 1, path === 'Trash'), /no confirmó/)
    assert.deepEqual(commands, path === 'Trash' ? [['delete']] : [['move', 'Trash']])
    assert.equal(removed, success, 'failed server operations must retain the cached message')
    if (path === 'Trash') await assert.rejects(remove(path, 1), /requiere confirmación/)
    client.capabilities.clear()
    commands.length = 0
    await assert.rejects(remove(path, 1, path === 'Trash'), /forma segura/)
    assert.equal(commands.length, 0)
  }
  const ipcSource = await fs.readFile('src/main/ipc.ts', 'utf8')
  const ipcAst = ts.createSourceFile('ipc.ts', ipcSource, ts.ScriptTarget.Latest, true)
  let handler
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ipcAst) === 'ipcMain.handle' && node.arguments[0]?.getText(ipcAst) === 'IPC.messageDelete') handler = node.arguments[1].getText(ipcAst)
    ts.forEachChild(node, visit)
  }
  visit(ipcAst)
  for (const response of [0, 1]) {
    let queued = 0
    const remove = vm.runInNewContext(ts.transpile(`(${handler})`, { target: ts.ScriptTarget.ES2022 }), {
      trashPath: () => 'Trash', readActiveAccount: async () => ({ id: 'one' }), readSettings: async () => ({ language: 'es' }),
      BrowserWindow: { fromWebContents: () => null }, dialog: { showMessageBox: async () => ({ response }) },
      deleteMessageAction: async () => { queued++; return { ok: true, queued: false } }
    })
    const result = await remove({ sender: {} }, 'Trash', 1)
    assert.equal(queued, response)
    assert.equal(result.canceled === true, response === 0)
    assert.equal((await remove({ sender: {} }, 'INBOX', -1)).ok, false)
  }
  const dir = await fs.mkdtemp(join(tmpdir(), 'namio-folder-delete-'))
  const db = {}
  try {
    vm.runInNewContext(ts.transpile(await fs.readFile('src/main/db.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), {
      exports: db, require: name => name === 'electron' ? { app: { getPath: () => dir } } : require(name)
    })
    db.initCache('test')
    const inbox = { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox', messages: 0, unseen: 0 }
    db.upsertMailboxes([inbox, { ...inbox, path: 'Old' }])
    db.upsertEnvelopes('Old', [{ uid: 1, subject: 'Old mail', from: null, date: '2026-10-27T00:00:00Z', size: 1, unread: true, flagged: false }])
    db.enqueueOutbox({ kind: 'delete', mailbox: 'Old', uid: 1 })
    db.replaceMailboxes([inbox])
    assert.equal(db.readMailboxes().length, 1)
    assert.equal(db.readEnvelopes('Old', 50).length, 0)
    assert.equal(db.listOutbox().length, 1, 'folder reconciliation preserves pending operations')
  } finally {
    db.closeCache?.()
    await fs.rm(dir, { recursive: true, force: true })
  }
  console.log('Delete and folders: trash moves, permanent deletion confirmation, rejected operations and folder reconciliation passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
