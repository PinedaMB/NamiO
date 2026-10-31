const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const { DatabaseSync } = require('node:sqlite')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const declarations = file => {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node.getText(ast)]))
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-outbox-identity-'))
  const file = path.join(directory, 'cache-one.db')
  const db = {}, addresses = {}
  vm.runInNewContext(compile(fs.readFileSync('src/shared/mailAddresses.ts', 'utf8')), { exports: addresses })
  vm.runInNewContext(compile(fs.readFileSync('src/main/db.ts', 'utf8')), {
    exports: db,
    require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
  })

  try {
    db.openAccountCache('one')
    db.upsertMailboxes([
      { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox', messages: 1, unseen: 1 },
      { path: 'Spam', name: 'Spam', specialUse: '\\Junk', messages: 0, unseen: 0 },
      { path: 'Archive', name: 'Archive', specialUse: '\\Archive', messages: 0, unseen: 0 }
    ])
    db.saveMailboxSync('INBOX', { uidValidity: 7, uidNext: 2, messages: 1, unseen: 1 })
    db.upsertEnvelopes('INBOX', [{ uid: 1, subject: 'Mover', from: null, date: new Date().toISOString(), size: 1, unread: true, flagged: false }])

    const moved = [], deleted = [], seen = []
    const mail = {}
    vm.runInNewContext(compile(fs.readFileSync('src/main/mail.ts', 'utf8')), {
      exports: mail, console, Buffer, setTimeout: () => 0,
      require: id => {
        if (id === './db') return db
        if (id === '@shared/mailAddresses') return addresses
        if (id === './drafts') return {}
        if (id === './settings') return { readActiveAccount: async () => ({ id: 'one' }) }
        if (id === 'electron') return { BrowserWindow: {}, dialog: {} }
        if (id === './imap') return {
          moveMessage: async (...args) => { moved.push(args) },
          deleteMessage: async (...args) => { deleted.push(args) },
          setSeen: async (...args) => { seen.push(args); return { ok: true, data: true } },
          getCredentials: async () => ({ account: { user: 'a@b.c', smtp: { host: 'h', port: 465, secure: true } }, password: 'x' }),
          appendToSent: async () => {},
          deleteMessageBatch: async () => {},
          archivePath: () => 'Archive',
          trashPath: () => 'Trash',
          syncInbox: async () => {}
        }
        return require(id)
      }
    })

    // Una tarea de otra cuenta no se ejecuta en esta caché.
    const wrongAccount = db.enqueueOutbox({
      kind: 'move', mailbox: 'INBOX', uid: 1, accountId: 'two', uidValidity: '7',
      payload: { target: 'Spam', uidValidity: '7' }
    })
    await mail.processOutbox()
    assert.equal(moved.length, 0, 'a task from another account is not replayed in the active one')
    assert.equal(db.listOutbox().find(row => row.id === wrongAccount).status, 'queued')

    const raw = new DatabaseSync(file)
    raw.prepare("UPDATE outbox SET account_id = 'one' WHERE id = ?").run(wrongAccount)
    raw.close()
    await mail.processOutbox()
    assert.deepEqual(moved, [['INBOX', 1, 'Spam', '7', 'one']], 'the task keeps its account and folder identity')
    assert.equal(db.listOutbox().length, 0)

    // El borrado toma la identidad de la carpeta al encolar y la revalida.
    db.enqueueOutbox({ kind: 'delete', mailbox: 'INBOX', uid: 1, accountId: 'one', uidValidity: '7', payload: { permanent: false } })
    await mail.processOutbox()
    assert.equal(deleted.length, 1)
    assert.deepEqual(deleted[0].slice(0, 3), ['INBOX', 1, false])
    assert.equal(deleted[0][3].accountId, 'one')
    assert.equal(deleted[0][3].uidValidity, '7')

    // Una fila heredada sin cuenta se asigna a la caché que la abre.
    db.closeCache()
    const legacy = new DatabaseSync(file)
    legacy.exec("INSERT INTO outbox (id, kind, mailbox, uid, payload, status, attempts, created_at) VALUES ('legacy','seen','INBOX',1,'{}','queued',0,1)")
    legacy.close()
    db.openAccountCache('one')
    assert.equal(db.listOutbox().find(row => row.id === 'legacy').accountId, 'one', 'legacy rows are adopted by their cache')
    await mail.processOutbox()
    assert.deepEqual(seen, [['INBOX', 1, true, 'one']])

    // selectAccount cierra la sesión y reapunta la caché dentro de la cadena
    // serial: ninguna tarea puede colarse entre ambos pasos.
    let insideSerial = false
    const order = []
    const select = vm.runInNewContext(compile(`${declarations('src/main/imap.ts').get('selectAccount').replace(/^export /, '')}; selectAccount`), {
      syncGeneration: 0, pendingFullSync: new Set(), publishProgress() {},
      readAccounts: async () => ({ active: 'one' }),
      pendingSyncs: new Set(),
      setActiveAccount: async () => true,
      serial: async fn => { insideSerial = true; try { return await fn() } finally { insideSerial = false } },
      closeSession: async () => { assert.equal(insideSerial, true, 'closing the session is serialized'); order.push('close') },
      openAccountCache: id => { assert.equal(insideSerial, true, 'switching the cache is serialized with the session'); order.push(`open:${id}`) },
      notify() {}, getAccountState: async () => ({ configured: true }),
      classify: () => 'unknown', describe: error => error.message
    })
    const result = await select('two')
    assert.equal(result.ok, true)
    assert.deepEqual(order, ['close', 'open:two'])

    console.log('Outbox identity: account isolation, folder UIDVALIDITY, legacy adoption and serialized account switch verified')
  } finally {
    db.closeCache()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
