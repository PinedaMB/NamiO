const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

/** La poda no puede depender del límite de variables de SQLite ni de un SEARCH ALL. */
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-prune-batch-'))
  const db = {}
  vm.runInNewContext(compile(await fs.readFile('src/main/db.ts', 'utf8')), {
    exports: db,
    require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
  })
  try {
    db.openAccountCache('one')
    const envelope = uid => ({
      uid, subject: `Asunto ${uid}`, from: { name: 'Equipo', address: 'equipo@example.com' },
      date: '2026-10-30T12:00:00Z', size: 1, unread: true, flagged: false
    })
    db.upsertEnvelopes('INBOX', Array.from({ length: 1200 }, (_, index) => envelope(index + 1)))
    const all = db.cachedUids('INBOX')
    assert.equal(all.length, 1200)
    db.pruneExcept('INBOX', all.filter(uid => uid !== 400))
    assert.equal(db.countMessages('INBOX'), 1199, 'pruning a large mailbox removes the missing UID')
    assert.equal(db.readEnvelope('INBOX', 400), null)
    db.pruneExcept('INBOX', db.cachedUids('INBOX'))
    assert.equal(db.countMessages('INBOX'), 1199, 'keeping every UID does not delete anything')
    db.pruneExcept('INBOX', [])
    assert.equal(db.countMessages('INBOX'), 0, 'an empty keep-set clears the folder')

    const imap = await fs.readFile('src/main/imap.ts', 'utf8')
    assert.match(imap, /cached\.length <= 2000/, 'small caches use one bounded reconciliation')
    assert.match(imap, /offset \+= 1000/, 'large caches reconcile in bounded UID batches')
    console.log('Prune/reconcile: large UID sets delete in batches and reconciliation is bounded')
  } finally {
    db.closeCache()
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
