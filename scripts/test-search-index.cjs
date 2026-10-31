const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const { DatabaseSync } = require('node:sqlite')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

/**
 * Invariantes del índice de búsqueda:
 * - cada mensaje tiene una identidad estable en `search_ids`;
 * - borrar un mensaje retira su fila FTS (sin huérfanos);
 * - vaciar una carpeta retira sus filas;
 * - limpiar la caché conserva asuntos y elimina los cuerpos del índice;
 * - una caché con el layout anterior se migra una vez y sigue buscando.
 */
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-search-index-'))
  const file = path.join(directory, 'cache-one.db')
  const open = () => {
    const db = {}
    vm.runInNewContext(compile(fs.readFileSync('src/main/db.ts', 'utf8')), {
      exports: db,
      require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
    })
    return db
  }
  let db = open()
  const envelope = uid => ({
    uid, subject: `Asunto ${uid}`, from: { name: 'Equipo', address: 'equipo@example.com' },
    date: '2026-10-30T12:00:00Z', size: 1, unread: true, flagged: false
  })
  const counts = () => {
    const probe = new DatabaseSync(file)
    try {
      return {
        search: probe.prepare('SELECT COUNT(*) AS c FROM search').get().c,
        ids: probe.prepare('SELECT COUNT(*) AS c FROM search_ids').get().c
      }
    } finally {
      probe.close()
    }
  }

  try {
    db.openAccountCache('one')
    db.upsertEnvelopes('INBOX', Array.from({ length: 50 }, (_, index) => envelope(index + 1)))
    db.saveBody('INBOX', 10, { text: 'palabra secreta', html: '', to: [], cc: [], attachments: [] })
    assert.deepEqual(counts(), { search: 50, ids: 50 })
    assert.equal(db.searchMessages('secreta', 10).length, 1)

    db.deleteMessageRow('INBOX', 10)
    assert.deepEqual(counts(), { search: 49, ids: 49 }, 'deleting a message removes its FTS row and identity')
    assert.equal(db.searchMessages('secreta', 10).length, 0)

    db.clearMailbox('INBOX')
    assert.deepEqual(counts(), { search: 0, ids: 0 }, 'clearing a folder removes its index rows')

    db.upsertEnvelopes('INBOX', Array.from({ length: 20 }, (_, index) => envelope(index + 1)))
    db.saveBody('INBOX', 5, { text: 'cuerpo temporal', html: '', to: [], cc: [], attachments: [] })
    await db.clearAccountCache('one')
    assert.deepEqual(counts(), { search: 20, ids: 20 }, 'clearing the cache keeps one index row per message')
    assert.equal(db.searchMessages('asunto', 100).length, 20, 'subjects remain searchable after clearing bodies')
    assert.equal(db.searchMessages('temporal', 10).length, 0, 'cleared bodies leave the index')

    // Simula una caché anterior: sin meta de layout y con rowids arbitrarios.
    db.closeCache()
    const legacy = new DatabaseSync(file)
    legacy.exec("DELETE FROM meta WHERE key = 'fts_rowid_layout'")
    legacy.exec('DELETE FROM search')
    legacy.exec('DELETE FROM search_ids')
    legacy.prepare('INSERT INTO search (subject, peers, body, mailbox, uid) SELECT subject, from_name, body_text, mailbox, uid FROM messages').run()
    assert.equal(legacy.prepare('SELECT COUNT(*) AS c FROM search').get().c, 20)
    legacy.close()

    db = open()
    db.openAccountCache('one')
    assert.deepEqual(counts(), { search: 20, ids: 20 }, 'the migration rebuilds the index with stable ids')
    assert.equal(db.searchMessages('asunto', 100).length, 20, 'search works after the migration')

    console.log('Search index: stable ids, deletion has no FTS orphans, clear cache keeps subjects, and legacy layout migrates once')
  } finally {
    db.closeCache()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
