const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-clear-cache-'))
  const db = {}
  const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  vm.runInNewContext(compile(await fs.readFile('src/main/db.ts', 'utf8')), { exports: db,
    require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id) })
  try {
    db.openAccountCache('one')
    db.upsertEnvelopes('INBOX', [{ uid: 1, subject: 'Keep envelope', from: null, date: new Date().toISOString(), size: 1, unread: true, flagged: true }])
    db.saveBody('INBOX', 1, { text: 'cachedword '.repeat(100000), html: '<p>Cached body</p>', to: [], cc: [], attachments: [{name:'file.pdf',size:1,type:'application/pdf'}] })
    db.saveDraft({ to: 'person@example.com', cc: '', subject: 'Draft', body: 'Keep draft', updatedAt: 1 })
    const { DatabaseSync } = require('node:sqlite')
    const file = path.join(directory, 'cache-one.db')
    const snapshot = new DatabaseSync(file)
    db.insertRule({ name: 'Keep rule', enabled: true, field: 'from', op: 'contains', value: 'example', action: 'archive', target: null })
    snapshot.exec("INSERT INTO outbox(id,kind,mailbox,uid,payload,status,created_at) VALUES ('pending','seen','INBOX',1,'{}','queued',1)")
    const beforeDraft = snapshot.prepare('SELECT * FROM drafts').all()
    const beforeRules = snapshot.prepare('SELECT * FROM rules').all()
    const beforeOutbox = snapshot.prepare('SELECT * FROM outbox').all()
    const sizeBefore = (await fs.stat(file)).size + (await fs.stat(file+'-wal')).size
    await db.clearAccountCache('one')
    assert.equal(db.readBody('INBOX', 1).fetched, false)
    assert.equal(db.readBody('INBOX', 1).attachments.length, 0)
    assert.equal(db.readEnvelope('INBOX', 1).subject, 'Keep envelope')
    assert.equal(db.readEnvelope('INBOX', 1).unread, true)
    assert.equal(db.readEnvelope('INBOX', 1).flagged, true)
    assert.deepEqual(snapshot.prepare('SELECT * FROM drafts').all(), beforeDraft)
    assert.deepEqual(snapshot.prepare('SELECT * FROM rules').all(), beforeRules)
    assert.deepEqual(snapshot.prepare('SELECT * FROM outbox').all(), beforeOutbox)
    assert.equal(db.searchMessages('cachedword', 10).length, 0)
    assert.ok((await fs.stat(file)).size < sizeBefore)
    snapshot.close()
    await db.clearAccountCache('missing')
    await assert.rejects(fs.stat(path.join(directory, 'cache-missing.db')), { code: 'ENOENT' })

    const source = await fs.readFile('src/main/ipc.ts', 'utf8')
    const ast = ts.createSourceFile('ipc.ts', source, ts.ScriptTarget.Latest, true)
    let handler
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.cacheClear') handler = node.arguments[1].getText(ast)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    let response = 0, cleared = null
    const clear = vm.runInNewContext(compile(`(${handler})`), {
      Error, readAccounts: async () => ({ accounts: [{ id: 'one', user: 'person@example.com' }] }), readSettings: async () => ({ language: 'es' }),
      BrowserWindow: { fromWebContents: () => null }, dialog: { showMessageBox: async () => ({ response }) },
      clearCachedMail: async id => { cleared = id }
    })
    assert.equal((await clear({ sender: null }, 'one')).canceled, true)
    assert.equal(cleared, null)
    response = 1
    await clear({ sender: null }, 'one')
    assert.equal(cleared, 'one')
    await assert.rejects(clear({ sender: null }, '../../other'), /Cuenta inválida/)
    console.log('Clear cache: bodies removed, disk compacted, drafts/rules/envelopes preserved, cancellation and account validation passed')
  } finally { db.closeCache(); await fs.rm(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
