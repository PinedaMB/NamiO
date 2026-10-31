const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

/**
 * Las reglas no deben tocar correo histórico de un relleno completo, ni Spam,
 * Papelera, Borradores o Enviados; el repaso manual recorre más de 5.000.
 */
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-rules-safety-'))
  const db = {}, mailboxes = {}, rules = {}
  vm.runInNewContext(compile(await fs.readFile('src/shared/mailboxes.ts', 'utf8')), { exports: mailboxes })
  vm.runInNewContext(compile(await fs.readFile('src/main/db.ts', 'utf8')), {
    exports: db,
    require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
  })

  try {
    db.openAccountCache('one')
    db.upsertMailboxes([
      { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox', messages: 5005, unseen: 5005 },
      { path: 'Archive', name: 'Archive', specialUse: '\\Archive', messages: 1, unseen: 1 },
      { path: 'Trash', name: 'Trash', specialUse: '\\Trash', messages: 1, unseen: 1 },
      { path: 'Junk', name: 'Spam', specialUse: '\\Junk', messages: 1, unseen: 1 },
      { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts', messages: 1, unseen: 1 },
      { path: 'Sent', name: 'Sent', specialUse: '\\Sent', messages: 1, unseen: 1 }
    ])
    const envelope = (uid, subject = 'Boletín') => ({
      uid, subject, from: { name: 'Equipo', address: 'example@example.com' },
      date: new Date(2026, 0, 1, 12, 0, uid % 59).toISOString(), size: 1, unread: true, flagged: false
    })
    db.upsertEnvelopes('INBOX', Array.from({ length: 5005 }, (_, index) => envelope(index + 1)))
    for (const mailbox of ['Archive', 'Trash', 'Junk', 'Drafts', 'Sent']) db.upsertEnvelopes(mailbox, [envelope(1)])

    vm.runInNewContext(compile(await fs.readFile('src/main/rules.ts', 'utf8')), {
      exports: rules,
      require: id => id === './db' ? db : id === '@shared/mailboxes' ? mailboxes : require(id)
    })
    const saved = rules.saveRule({
      name: 'Archivar boletines', enabled: true, field: 'from', op: 'contains',
      value: 'example', action: 'archive', target: null
    })
    assert.equal(saved.length, 1)

    for (const mailbox of ['Trash', 'Junk', 'Drafts', 'Sent']) {
      assert.equal(rules.applyRulesToNew(mailbox, [1]), 0, `${mailbox} is not a target for automatic rules`)
    }
    assert.equal(rules.applyRulesToNew('INBOX', [1]), 1)

    for (const row of db.listOutbox()) db.deleteOutbox(row.id)
    assert.equal(rules.applyRulesToCache(), 5005, 'manual apply covers the whole cache, not only the first 5,000')
    assert.equal(db.listOutbox().length, 5005)

    console.log('Rules safety: destructive folders excluded, new mail only, and manual apply paginates beyond 5,000')
  } finally {
    db.closeCache()
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
