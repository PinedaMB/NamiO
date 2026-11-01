const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
const source = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getSentReplies').getText(source).replace(/^export /, '')
async function backend(mode) {
  let searches = 0, writes = 0, cleared = 0, released = 0
  const context = {
    syncGeneration: 1, syncMeta: () => ({}),
    readMailboxes: () => [{ path: 'Enviados', specialUse: '\\Sent' }],
    readEnvelope: () => ({ messageId: '<inbox>', inReplyTo: '<root>', references: ['<root>'] }),
    relatedMessageUids: () => [7, 9], getMeta: () => mode === 'validity' ? '1' : '2', getMailboxMeta: () => null,
    clearMailbox: path => { assert.equal(path, 'Enviados'); cleared++ }, setMeta() {},
    fetchRange: async () => [], upsertEnvelopes: () => { writes++ },
    accountChangedError: () => new Error('Account changed'), classify: () => 'network', isOfflineError: code => code === 'network', describe: error => error.message,
    serial: async action => { if (mode === 'switch') context.syncGeneration++; return action() },
    ensureClient: async () => {
      if (mode === 'offline') throw new Error('Network down')
      return { mailbox: { uidValidity: 2 },
        getMailboxLock: async path => { assert.equal(path, 'Enviados'); return { release() { released++ } } },
        search: async (query, options) => {
          searches++; assert.equal(options.uid, true)
          assert.ok(query.or.some(item => item.header.References === '<root>'))
          assert.ok(query.or.some(item => item.header['Message-ID'] === '<inbox>'))
          return [7]
        }
      }
    }
  }
  const api = vm.runInNewContext(compile(`${fn};getSentReplies`), context)
  const result = await api('INBOX', [7], mode === 'cached')
  if (mode === 'switch') { assert.equal(result.ok, false); assert.equal(writes, 0); assert.equal(searches, 0); return }
  assert.equal(result.ok, true)
  assert.deepEqual(Array.from(result.data, item => [item.mailbox, item.uid]), mode === 'cached' || mode === 'offline' ? [['Enviados', 7], ['Enviados', 9]] : [['Enviados', 7]], 'online results exclude deleted cached messages')
  assert.equal(searches, mode === 'cached' || mode === 'offline' ? 0 : 1)
  assert.equal(cleared, mode === 'validity' ? 1 : 0, 'changed UIDVALIDITY cannot reuse stale bodies')
  if (searches) assert.equal(released, 1)
  if (mode === 'offline') assert.equal(result.meta.offline, true)
  assert.equal((await api('INBOX', ['7'], true)).ok, false, 'IPC rejects invalid UIDs')
}
const app = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect' && node.arguments[0]?.getText(app).includes('window.api.getSentReplies')) effect = node.arguments[0].getText(app)
  ts.forEachChild(node, visit)
}
visit(app)
let readerExpression
function findReader(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'readerThread') readerExpression = node.initializer.getText(app)
  ts.forEachChild(node, findReader)
}
findReader(app)
const combined = vm.runInNewContext(compile(`(${readerExpression})`), {
  selected: { id: 'live:7', messages: [{ id: 'live:7', messageId: '<incoming>', date: 1 }] },
  sentMessages: [{ id: 'sent:Sent:7', messageId: '<sent>', date: 2 }, { id: 'sent:Sent:8', messageId: '<incoming>', date: 1 }]
})
assert.deepEqual(Array.from(combined.messages, message => message.id), ['live:7', 'sent:Sent:7'], 'reader preserves chronology and deduplicates mailbox copies by Message-ID')
const flush = () => new Promise(resolve => setImmediate(resolve))
async function renderer(offline = false, stale = false) {
  const lookups = [], bodies = [], updates = []
  let release
  const context = {
    live: true, selected: { id: 'live:7', messageIds: [7] }, view: 'mailbox', folder: 'INBOX', locale: 'es', sentRepliesKey: 'one:INBOX:7',
    accountGeneration: { current: 1 }, folderRequest: { current: 1 }, navigator: { onLine: !offline }, uidOf: () => 7,
    detailToMessage: data => ({ id: `live:${data.uid}`, from: {}, to: [], body: ['Reply'] }),
    setLiveError: error => { throw new Error(JSON.stringify(error)) }, setToast: error => { throw new Error(error) }, t: key => key,
    setSentReplies: state => updates.push(state),
    window: { api: {
      getSentReplies: async (_path, _uids, cachedOnly) => {
        lookups.push(cachedOnly)
        if (stale) await new Promise(resolve => { release = resolve })
        return { ok: true, data: [{ mailbox: 'Enviados', uid: 7 }], meta: {} }
      },
      getMessage: async (mailbox, uid, cachedOnly) => { bodies.push([mailbox, uid, cachedOnly]); return { ok: true, data: { uid }, meta: { partial: cachedOnly } } }
    } }
  }
  const cleanup = vm.runInNewContext(compile(`(${effect})`), context)()
  if (stale) { context.accountGeneration.current++; release() }
  await flush(); await flush()
  if (stale) { assert.equal(updates.length, 0, 'account changes reject old sent replies'); return }
  assert.deepEqual(lookups, offline ? [true] : [true, false])
  assert.deepEqual(bodies[0], ['Enviados', 7, true], 'same UID in Inbox must not redirect a sent body')
  assert.equal(updates.at(-1).messages[0].id, 'sent:Enviados:7')
  assert.equal(updates.at(-1).messages[0].mailbox, 'Enviados')
  cleanup()
}
;(async () => {
  for (const mode of ['cached', 'online', 'offline', 'switch', 'validity']) await backend(mode)
  await renderer(); await renderer(true); await renderer(false, true)
  console.log('Sent replies: exact header search, cache/offline access, account and UID isolation, stale-result cancellation and reader locations passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
