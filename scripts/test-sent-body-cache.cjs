const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const { simpleParser } = require('mailparser')
const ast = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const code = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['appendToSent', 'toAddress'].includes(node.name?.text))
  .map(node => node.getText(ast).replace(/^export /, '')).join('\n')
const raw = Buffer.from('Message-ID: <local@example.test>\r\nFrom: Author <author@example.test>\r\nTo: Reader <reader@example.test>\r\nCc: Copy <copy@example.test>\r\nSubject: Local body\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p><strong>Saved locally</strong></p>')

async function check(mode) {
  const envelopes = [], bodies = []
  let searches = 0, appends = 0, released = 0, notified = 0
  const client = {
    mailbox: { uidValidity: 12n },
    append: async () => { appends++; return mode === 'append-fails' ? false : mode === 'uidplus' ? { uid: 9, uidValidity: 12n } : {} },
    getMailboxLock: async () => ({ release: () => released++ }),
    search: async () => { searches++; if (mode === 'switch') context.syncGeneration++; return mode === 'index-lag' ? [] : [9, 10] }
  }
  const context = {
    Buffer, simpleParser, syncGeneration: 1, MAX_MESSAGE_BYTES: 50 * 1024 * 1024,
    serial: action => action(), cacheAccountId: () => 'one', ensureClient: async () => client,
    readMailboxes: () => [{ path: 'Sent', specialUse: '\\Sent' }],
    accountChangedError: () => Object.assign(new Error('Account changed'), { code: 'ACCOUNT_CHANGED' }),
    getMeta: () => '12', getMailboxMeta: () => null, setMeta() {}, clearMailbox() { throw new Error('Same mailbox must retain existing content') },
    upsertEnvelopes: (path, rows) => envelopes.push(...rows), saveBody: (path, uid, body) => bodies.push({ path, uid, body }), notify: () => notified++
  }
  const append = vm.runInNewContext(ts.transpile(`${code};appendToSent`, { target: ts.ScriptTarget.ES2022 }), context)
  await assert.rejects(append(raw, 'other'), { code: 'ACCOUNT_CHANGED' })
  assert.equal(appends, 0, 'another account cannot receive the sent copy or body')
  if (mode === 'switch' || mode === 'append-fails') {
    await assert.rejects(append(raw, 'one'))
    assert.equal(bodies.length, 0, 'failed append and account changes cannot write a body')
    return
  }
  await append(raw, 'one')
  assert.equal(appends, 1, 'local caching never appends an additional copy')
  assert.equal(released, 1)
  if (mode === 'index-lag') { assert.equal(bodies.length, 0, 'an unknown UID is never invented'); return }
  assert.equal(searches, mode === 'uidplus' ? 0 : 1, 'APPENDUID avoids a potentially delayed header index')
  assert.equal(bodies.length, mode === 'uidplus' ? 1 : 2)
  assert.equal(notified, 1)
  assert.equal(envelopes[0].messageId, '<local@example.test>')
  assert.equal(envelopes[0].unread, false)
  assert.equal(bodies[0].body.to[0].address, 'reader@example.test')
  assert.equal(bodies[0].body.cc[0].address, 'copy@example.test')
  assert.ok(bodies[0].body.html.includes('<strong>Saved locally</strong>'))
}
;(async () => {
  for (const mode of ['uidplus', 'search', 'index-lag', 'switch', 'append-fails']) await check(mode)
  console.log('Sent body cache: local HTML, recipients, APPENDUID, search fallback, account isolation and failed-copy safety passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
