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
    syncGeneration: 1, offline: true, syncMeta: () => ({ offline: context.offline }),
    readMailboxes: () => [{ path: 'Enviados', specialUse: '\\Sent' }],
    readEnvelope: () => ({ messageId: '<inbox>', inReplyTo: '<root>', references: mode === 'large-query' ? ['<root>', ...Array.from({length:30},(_,index)=>`<ancestor-${index}>`)] : ['<root>'] }),
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
          if (query.uid) return mode === 'index-lag' ? [7] : []
          assert.ok(query.or.length <= 30, 'header searches are bounded even for long conversations')
          if (!['refusal', 'undefined', 'large-query'].includes(mode)) {
            assert.ok(query.or.some(item => item.header.References === '<root>'))
            assert.ok(query.or.some(item => item.header['Message-ID'] === '<inbox>'))
          }
          if (mode === 'refusal' && query.or.length > 3) return false
          if (mode === 'undefined' && query.or.length > 3) return undefined
          return mode === 'index-lag' ? [] : [7]
        }
      }
    }
  }
  const api = vm.runInNewContext(compile(`${fn};getSentReplies`), context)
  const result = await api('INBOX', [7], mode === 'cached')
  if (mode === 'switch') { assert.equal(result.ok, false); assert.equal(writes, 0); assert.equal(searches, 0); return }
  assert.equal(result.ok, true)
  assert.deepEqual(Array.from(result.data, item => [item.mailbox, item.uid]), mode === 'cached' || mode === 'offline' ? [['Enviados', 7], ['Enviados', 9]] : [['Enviados', 7]], 'online results exclude deleted cached messages')
  assert.equal(searches, mode === 'cached' || mode === 'offline' ? 0 : mode === 'large-query' ? 5 : ['refusal', 'undefined'].includes(mode) ? 4 : 2)
  assert.equal(cleared, mode === 'validity' ? 1 : 0, 'changed UIDVALIDITY cannot reuse stale bodies')
  if (searches) {
    assert.equal(released, 1)
    assert.equal(result.meta.offline, false, 'a successful sent-folder request clears a stale disconnection')
  }
  if (mode === 'offline') assert.equal(result.meta.offline, true)
  assert.equal((await api('INBOX', ['7'], true)).ok, false, 'IPC rejects invalid UIDs')
}
const app = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect, listEffect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect' && node.arguments[0]?.getText(app).includes('window.api.getSentReplies')) {
    if (node.arguments[0].getText(app).includes('const conversations =')) listEffect = node.arguments[0].getText(app)
    else effect = node.arguments[0].getText(app)
  }
  ts.forEachChild(node, visit)
}
visit(app)
let readerExpression, sentKeyExpression
function findReader(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'sentRepliesKey') sentKeyExpression = node.initializer.getText(app)
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'readerThread') readerExpression = node.initializer.getText(app)
  ts.forEachChild(node, findReader)
}
findReader(app)
const keyFor = (id, identity = 'one', folder = 'INBOX') => vm.runInNewContext(compile(`(${sentKeyExpression})`), {
  selected: { id, messageIds: [7, 8] }, accountIdentity: { current: identity }, folder,
  conversationKey: thread => thread.messageIds.join(',')
})
assert.equal(keyFor('live:7'), keyFor('live:8'), 'members of the same conversation share their sent cache')
assert.notEqual(keyFor('live:7'), keyFor('live:7', 'two'), 'sent cache remains isolated between accounts')
assert.notEqual(keyFor('live:7'), keyFor('live:7', 'one', 'Archive'), 'UIDs remain scoped to their mailbox')
const combined = vm.runInNewContext(compile(`(${readerExpression})`), {
  selected: { id: 'live:7', messages: [{ id: 'live:7', messageId: '<incoming>', date: 1 }] },
  sentMessages: [{ id: 'sent:Sent:7', messageId: '<sent>', date: 2 }, { id: 'sent:Sent:8', messageId: '<incoming>', date: 1 }]
})
assert.deepEqual(Array.from(combined.messages, message => message.id), ['live:7', 'sent:Sent:7'], 'reader preserves chronology and deduplicates mailbox copies by Message-ID')
const flush = () => new Promise(resolve => setImmediate(resolve))
async function renderer(offline = false, stale = false, preserveFull = false, staleOffline = false, slow = false) {
  const lookups = [], bodies = [], updates = []
  let release
  let state = preserveFull ? { 'one:INBOX:7': [{ id: 'sent:Enviados:7', mailbox: 'Enviados', uid: 7, body: ['Full reply'], partial: false }] } : {}
  const context = {
    live: true, selected: { id: 'live:7', messageIds: [7] }, view: 'mailbox', folder: 'INBOX', locale: 'es', sentRepliesKey: 'one:INBOX:7',
    accountGeneration: { current: 1 }, folderRequest: { current: 1 }, navigator: { onLine: !offline }, uidOf: () => 7,
    detailToMessage: (data, _locale, partial) => ({ partial, id: `live:${data.uid}`, from: {}, to: [], body: ['Reply'] }),
    setLiveError: error => { throw new Error(JSON.stringify(error)) }, setToast: error => { throw new Error(error) }, t: key => key,
    setSentReplies: update => { state = update(state); updates.push(state) },
    window: { api: {
      getSentReplies: async (_path, _uids, cachedOnly) => {
        lookups.push(cachedOnly)
        if (stale) await new Promise(resolve => { release = resolve })
        return { ok: true, data: [{ mailbox: 'Enviados', uid: 7 }, ...(slow ? [{ mailbox: 'Enviados', uid: 8 }] : [])], meta: { offline: staleOffline } }
      },
      getMessage: async (mailbox, uid, cachedOnly) => {
        bodies.push([mailbox, uid, cachedOnly])
        if (slow && uid === 8 && !cachedOnly) await new Promise(resolve => { release = resolve })
        return { ok: true, data: { uid }, meta: { partial: cachedOnly } }
      }
    } }
  }
  const cleanup = vm.runInNewContext(compile(`(${effect})`), context)()
  if (stale) { context.accountGeneration.current++; release() }
  await flush(); await flush()
  if (slow) {
    const messages = state['one:INBOX:7']
    assert.equal(messages.find(message => message.uid === 7).partial, false, 'ready sent messages render while another download is still waiting')
    assert.equal(messages.find(message => message.uid === 8).partial, true)
    release(); await flush(); await flush()
    assert.ok(state['one:INBOX:7'].every(message => !message.partial))
    cleanup(); return
  }
  if (stale) { assert.equal(updates.length, 0, 'account changes reject old sent replies'); return }
  assert.deepEqual(lookups, offline ? [true] : [true, false])
  assert.deepEqual(bodies[0], ['Enviados', 7, true], 'same UID in Inbox must not redirect a sent body')
  if (!offline) {
    assert.deepEqual(bodies[1], ['Enviados', 7, false], 'a stale offline flag cannot prevent a foreground body download')
    assert.equal(updates.at(-1)['one:INBOX:7'][0].partial, false, 'a downloaded body replaces the cache placeholder')
  }
  assert.equal(updates.at(-1)['one:INBOX:7'][0].id, 'sent:Enviados:7')
  assert.equal(updates.at(-1)['one:INBOX:7'][0].mailbox, 'Enviados')
  if (preserveFull) assert.equal(updates[0]['one:INBOX:7'][0].body[0], 'Full reply', 'cached partial bodies cannot replace a complete reply')
  cleanup()
}
async function prefetch(stale = false) {
  let state = {}, release
  const queries = []
  const context = {
    live: true, loadingFolder: false, draftsFolder: false, view: 'mailbox', sentListKey: '1,2', folder: 'INBOX', locale: 'es', PAGE_SIZE: 50,
    listedThreads: [{ id: 'live:1', messageIds: [1] }, { id: 'live:2', messageIds: [2] }],
    collapseConversations: threads => threads, conversationKey: thread => thread.messageIds.join(','), uidOf: id => Number(id.slice(5)),
    accountIdentity: { current: 'one' }, accountGeneration: { current: 1 }, folderRequest: { current: 1 }, navigator: { onLine: true },
    setSentReplies: update => { state = update(state) }, detailToMessage: (detail, _locale, partial) => ({ from: detail.from, partial }),
    setLiveError: error => { throw new Error(JSON.stringify(error)) }, setToast: error => { throw new Error(error) }, t: key => key,
    window: { api: { getSentReplies: async (folder, uids, cachedOnly) => {
      queries.push([folder, uids, cachedOnly])
      if (stale) await new Promise(resolve => { release = resolve })
      return { ok: true, data: [{ mailbox: 'Sent', uid: 7, sourceUids: [2], envelope: { from: { name: 'Me' } } }], meta: {} }
    }, getMessage() { throw new Error('List prefetch must not download message bodies') } } }
  }
  const cleanup = vm.runInNewContext(compile(`(${listEffect})`), context)()
  if (stale) { context.accountGeneration.current++; release() }
  await flush(); await flush()
  cleanup()
  if (stale) { assert.equal(Object.keys(state).length, 0, 'account switches reject background replies'); return }
  assert.equal(queries.length, 2, 'one cached batch and one server batch for both unopened conversations')
  assert.deepEqual(Array.from(queries[0][1]), [1, 2])
  assert.equal(state[JSON.stringify(['one', 'INBOX', '1'])].length, 0)
  const replies = state[JSON.stringify(['one', 'INBOX', '2'])]
  assert.equal(replies[0].id, 'sent:Sent:7', 'unopened conversation already includes its outgoing row')
  assert.equal(replies[0].partial, true, 'list discovery uses only envelope metadata')
}
;(async () => {
  await prefetch(); await prefetch(true)
  for (const mode of ['cached', 'online', 'offline', 'switch', 'validity', 'index-lag', 'large-query', 'refusal', 'undefined']) await backend(mode)
  await renderer(); await renderer(true); await renderer(false, true); await renderer(true, false, true)
  await renderer(false, false, false, true)
  await renderer(false, false, false, false, true)
  console.log('Sent replies: exact header search, cache/offline access, account and UID isolation, stale-result cancellation and reader locations passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
