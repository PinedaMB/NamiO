const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-unlink-'))
  const db = {}
  vm.runInNewContext(compile(await fs.readFile('src/main/db.ts', 'utf8')), {
    exports: db, require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
  })
  try {
    for (const id of ['one', 'two']) {
      db.openAccountCache(id)
      db.saveDraft({ to: 'person@example.com', cc: '', subject: id, body: 'Local draft', updatedAt: 1 })
    }
    db.openAccountCache('one')
    await db.deleteAccountCache('one')
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      await assert.rejects(fs.stat(path.join(directory, 'cache-one.db' + suffix)), { code: 'ENOENT' })
    }
    db.openAccountCache('two')
    assert.equal(db.listDrafts()[0].subject, 'two')
    await assert.rejects(db.deleteAccountCache('../two'), /Cuenta inválida/)
    assert.equal(db.listDrafts().length, 1)
    await db.deleteAccountCache('one')
    db.openAccountCache('one')
    assert.equal(db.listDrafts().length, 0)

    const source = await fs.readFile('src/main/ipc.ts', 'utf8')
    const ast = ts.createSourceFile('ipc.ts', source, ts.ScriptTarget.Latest, true)
    let handler
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.accountDisconnect') handler = node.arguments[1].getText(ast)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    let active = 'one', response = 0, removed = null, resumed = 0, detail = '', switchDuringDialog = false, switchDuringPause = false
    const unlink = vm.runInNewContext(compile(`let disconnecting = false; (${handler})`), {
      Error, readActiveAccount: async () => ({ id: active, user: 'person@example.com' }), cacheAccountId: () => active,
      pauseOutbox: async () => { if (switchDuringPause) active = 'two' }, resumeOutbox: () => resumed++,
      listDrafts: () => [{ updatedAt: 2, syncedAt: 1, server: {} }], outboxItems: () => [{}],
      readSettings: async () => ({ language: 'es' }), BrowserWindow: { fromWebContents: () => null },
      dialog: { showMessageBox: async options => { detail = options.detail; if (switchDuringDialog) active = 'two'; return { response } } },
      disconnectAccount: async id => { removed = id }
    })
    assert.equal(await unlink({ sender: null }), false)
    assert.equal(removed, null)
    assert.match(detail, /Borradores sin sincronizar: 1/)
    assert.match(detail, /Operaciones pendientes: 1/)
    response = 1
    assert.equal(await unlink({ sender: null }), true)
    assert.equal(removed, 'one')
    removed = null
    switchDuringDialog = true
    await assert.rejects(unlink({ sender: null }), /cuenta activa cambió/)
    assert.equal(removed, null)
    active = 'one'; switchDuringDialog = false; switchDuringPause = true
    await assert.rejects(unlink({ sender: null }), /cuenta activa cambió/)
    assert.equal(removed, null)
    assert.equal(resumed, 4)
    const imapSource = await fs.readFile('src/main/imap.ts', 'utf8')
    const imapAst = ts.createSourceFile('imap.ts', imapSource, ts.ScriptTarget.Latest, true)
    const disconnect = imapAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'disconnectAccount')
    let current = 'one', deletionFails = false, settingsFail = false, opened = null
    const calls = []
    const disconnectAccount = vm.runInNewContext(compile(`let syncGeneration = 0; (${disconnect.getText(imapAst).replace(/^export /, '')})`), {
      Error, pendingFullSync: new Set(), publishProgress: () => {}, serial: fn => fn(),
      readAccounts: async () => ({ active: current }), closeSession: async () => {},
      deleteAccountCache: async id => { calls.push('delete:' + id); if (deletionFails) throw new Error('disk failure') },
      removeAccount: async id => { calls.push('remove:' + id); if (settingsFail) throw new Error('settings failure'); current = 'two'; return { active: current } },
      openAccountCache: id => { opened = id }, writeSettings: async () => {}, notify: () => {}
    })
    await assert.rejects(disconnectAccount('two'), /cuenta activa cambió/)
    assert.deepEqual(calls, [])
    deletionFails = true
    await assert.rejects(disconnectAccount('one'), /disk failure/)
    assert.equal(opened, 'one')
    assert.deepEqual(calls, ['delete:one'])
    deletionFails = false; settingsFail = true
    await assert.rejects(disconnectAccount('one'), /settings failure/)
    assert.equal(opened, 'one')
    settingsFail = false; calls.length = 0
    await disconnectAccount('one')
    assert.deepEqual(calls, ['delete:one', 'remove:one'])
    assert.equal(opened, 'two')
    console.log('Unlink: complete account cache deletion, other account preserved, cancel, pending warning and account-switch protection passed')
  } finally {
    db.closeCache()
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
