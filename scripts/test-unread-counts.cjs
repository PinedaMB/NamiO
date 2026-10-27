const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const vm = require('node:vm')
const ts = require('typescript')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
async function main() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'namio-unread-'))
  const exports = {}
  try {
    vm.runInNewContext(ts.transpile(await fs.readFile('src/main/db.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), {
      exports, require: name => name === 'electron' ? { app: { getPath: () => dir } } : require(name)
    })
    exports.initCache('test')
    exports.upsertMailboxes([{ path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox', messages: 500, unseen: 300 }])
    exports.upsertEnvelopes('INBOX', [{ uid: 1, subject: 'Test', from: null, date: '2026-10-27T00:00:00Z', size: 1, unread: true, flagged: false }])
    exports.setUnread('INBOX', 1, false)
    assert.equal(exports.readMailboxes()[0].unseen, 299)
    exports.setUnread('INBOX', 1, false)
    assert.equal(exports.readMailboxes()[0].unseen, 299, 'repeated actions cannot decrement twice')
    exports.setUnread('INBOX', 1, true)
    assert.equal(exports.readMailboxes()[0].unseen, 300)
    exports.setUnread('INBOX', 999, false)
    assert.equal(exports.readMailboxes()[0].unseen, 300, 'uncached messages do not invent a count delta')
  } finally {
    exports.closeCache?.()
    await fs.rm(dir, { recursive: true, force: true })
  }
  const source = await fs.readFile('src/main/imap.ts', 'utf8')
  const ast = ts.createSourceFile('imap.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncMessages')
  for (const unseen of [0, 42]) {
    let saved
    const sync = vm.runInNewContext(ts.transpile(`${declaration.getText(ast)}; syncMessages`, { target: ts.ScriptTarget.ES2022 }), {
      ensureClient: async () => ({
        status: async (_path, query) => { assert.equal(query.unseen, true); return { messages: 500, unseen, uidNext: 501, uidValidity: 1 } },
        getMailboxLock: async () => ({ release() {} }), fetch: async function* () {}
      }),
      getMailboxMeta: () => ({ uidValidity: 1, uidNext: 501, unseen: 300 }), countMessages: () => 500,
      countUnread: () => 1, saveMailboxSync: (_path, meta) => { saved = meta }, setMeta() {}, ensureFullSync() {}, updateFlags() {}
    })
    await sync('INBOX', 50)
    assert.equal(saved.unseen, unseen, 'large mailboxes use the fresh server count, including zero')
  }
  const sidebarSource = await fs.readFile('src/renderer/src/components/Sidebar.tsx', 'utf8')
  const sidebar = ts.createSourceFile('Sidebar.tsx', sidebarSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let unseenOfSource
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sidebar) === 'unseenOf') unseenOfSource = node.initializer.getText(sidebar)
    ts.forEachChild(node, find)
  }
  find(sidebar)
  for (const count of [0, 5]) {
    const unseenOf = vm.runInNewContext(ts.transpile(`(${unseenOfSource})`, { target: ts.ScriptTarget.ES2022 }), {
      accounts: [{ id: 'active', active: true }], folders: [{ id: 'INBOX', icon: 'inbox', count }],
      activity: [{ id: 'active', unseen: 99 }, { id: 'other', unseen: 7 }]
    })
    assert.equal(unseenOf('active'), count)
    assert.equal(unseenOf('other'), 7)
  }
  console.log('Unread counts: read/unread, idempotency, partial caches and fresh server totals passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
