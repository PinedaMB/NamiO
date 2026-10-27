const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const compile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
const account = { id: 'a', host: 'mail.test', port: 993, user: 'me@test', label: 'Work' }
let registered = [account]
let settings = {}, selected = account, shown = [], sent = [], sounds = []
const platform = { platform: 'linux' }
class Notification extends EventEmitter {
  static isSupported() { return true }
  constructor(options) { super(); this.options = options; shown.push(this) }
  show() { this.emit('show') }
}
const exportsObject = {}
vm.runInNewContext(compile(fs.readFileSync('src/main/notifications.ts', 'utf8')), {
  exports: exportsObject, process: platform, console,
  require(id) {
    if (id === 'node:child_process') return { execFile: (...args) => { sounds.push(args); args[3](null) } }
    if (id === 'electron') return { Notification, app: { getLocale: () => 'es' } }
    if (id === '@shared/ipc') return { IPC: { notificationOpen: 'open' } }
    if (id === './settings') return { readSettings: async () => settings, readAccounts: async () => ({ accounts: registered, active: selected.id }) }
    throw new Error(id)
  }
})
const window = { isDestroyed: () => false, isMinimized: () => true, restore() {}, show() {}, focus() {}, webContents: { send: (...args) => sent.push(args) } }
const message = { uid: 10, unread: true, subject: 'Private subject', from: { name: 'Sender', address: 'sender@test' } }
async function main() {
  await exportsObject.showNewMail(account, 'INBOX', [message], () => window)
  assert.equal(shown.length, 1)
  assert.equal(sounds.length, 1, 'Linux explicitly plays the desktop mail sound')
  assert.equal(sounds[0][0], 'canberra-gtk-play')
  assert.equal(sounds[0][1][1], 'message-new-email')
  assert.equal(shown[0].options.silent, true, 'avoid a second sound from the notification server')
  assert.equal(shown[0].options.body, 'Tienes correo nuevo')
  shown[0].emit('click')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent[0][1].uid, 10)
  settings = { notificationPrivate: false, notificationSound: false }
  await exportsObject.showNewMail(account, 'INBOX', [message], () => window)
  assert.ok(shown[1].options.body.includes('Private subject'))
  assert.equal(shown[1].options.silent, true)
  assert.equal(sounds.length, 1, 'sound disabled also suppresses Linux playback')
  await exportsObject.showNewMail(account, 'INBOX', [message, { ...message, uid: 11 }], () => window)
  assert.equal(shown[2].options.body, '2 correos nuevos')
  settings.notifications = false
  await exportsObject.showNewMail(account, 'INBOX', [message], () => window)
  assert.equal(shown.length, 3)
  selected = { ...account, id: 'b' }
  registered = [account, selected]
  shown[1].emit('click')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 2)
  assert.equal(sent[1][1].accountId, 'a', 'inactive notification targets its own account')
  settings = {}
  await exportsObject.showNewMail(account, 'INBOX', [message], () => window)
  assert.equal(shown.length, 4, 'inactive accounts can show notifications')
  registered = [selected]
  shown[3].emit('click')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 2, 'removed accounts cannot open old notifications')
  await exportsObject.showNewMail(account, 'INBOX', [message], () => window)
  assert.equal(shown.length, 4, 'removed accounts cannot show notifications')
  await exportsObject.testNotification()
  assert.equal(shown.length, 5)

  platform.platform = 'win32'
  await exportsObject.testNotification()
  assert.equal(shown.at(-1).options.silent, false, 'Windows retains native sound')
  assert.equal(sounds.length, 3, 'other platforms do not run the Linux player')

  let cursorSettings = {}
  const cursorModule = {}
  vm.runInNewContext(compile(fs.readFileSync('src/main/notificationCursor.ts', 'utf8')), {
    exports: cursorModule, require: () => ({
      readSettings: async () => cursorSettings,
      writeSettings: async patch => { cursorSettings = { ...cursorSettings, ...(typeof patch === 'function' ? patch(cursorSettings) : patch) } }
    })
  })
  const { trackNewMail } = cursorModule

  const source = fs.readFileSync('src/main/imap.ts', 'utf8')
  const ast = ts.createSourceFile('imap.ts', source, ts.ScriptTarget.Latest, true)
  const sync = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncMessages').getText(ast)
  for (const scenario of ['new', 'initial', 'validity', 'historical', 'read', 'archive', 'duplicate']) {
    cursorSettings = {}
    let cached = scenario === 'initial' ? null : { uidNext: 10, uidValidity: scenario === 'validity' ? 2 : 1 }
    const incoming = { ...message, uid: scenario === 'historical' ? 5 : 10, unread: scenario !== 'read' }
    let notices = 0, inserted = false
    const context = {
      trackNewMail,
      ensureClient: async () => ({ status: async () => ({ messages: 1, unseen: 1, uidNext: 11, uidValidity: 1 }), getMailboxLock: async () => ({ release() {} }) }),
      readActiveAccount: async () => account, getMailboxMeta: () => cached, countMessages: () => 1,
      clearMailbox() {}, fetchRange: async () => [incoming],
      upsertEnvelopes: () => { if (inserted) return []; inserted = true; return [incoming.uid] },
      pruneExcept() {}, saveMailboxSync: (path, meta) => { cached = meta }, setMeta() {}, countUnread: () => 1,
      ensureFullSync() {}, offline: false, readEnvelope: () => incoming,
      newMailListener: () => { notices++ }, readMailboxes: () => [], applyRulesToNew: () => 0, rulesListener: null
    }
    const run = vm.runInNewContext(compile(`${sync}; syncMessages`), context)
    const path = scenario === 'archive' ? 'Archive' : 'INBOX'
    await run(path, 50)
    if (scenario === 'duplicate') await run(path, 50)
    assert.equal(notices, ['new', 'duplicate'].includes(scenario) ? 1 : 0, scenario)
  }
  cursorSettings = {}
  let next = 11, notices = []
  const poll = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'pollAccountsActivity').getText(ast)
  const inactive = { ...account, id: 'inactive' }
  const context = {
    readAccounts: async () => ({ accounts: [account, inactive], active: account.id }),
    readMailboxes: () => [], authFor: async () => ({ password: 'test' }),
    createClient: target => {
      assert.equal(target.id, inactive.id)
      return { connect: async () => {}, logout: async () => {},
        status: async () => ({ unseen: 1, uidValidity: 1, uidNext: next }),
        getMailboxLock: async () => ({ release() {} }) }
    },
    readSettings: async () => cursorSettings,
    fetchRange: async () => [{ ...message, uid: 11 }],
    trackNewMail, lastUnseen: new Map(), newMailListener: (target, path, messages) => notices.push({ target, path, messages })
  }
  const runPoll = vm.runInNewContext(compile(`${poll}; pollAccountsActivity`), context)
  await runPoll()
  assert.equal(notices.length, 0, 'first inactive check establishes a baseline')
  next = 12
  await runPoll()
  await runPoll()
  assert.equal(notices.length, 1, 'inactive arrivals notify exactly once')
  assert.equal(notices[0].target.id, inactive.id)
  assert.equal(notices[0].messages[0].uid, 11)
  const afterSwitch = await trackNewMail(inactive.id, { uidValidity: 1, uidNext: 12 }, [{ ...message, uid: 11 }], { uidValidity: 1, uidNext: 10 })
  assert.equal(afterSwitch.length, 0, 'switching to an already notified account does not duplicate alerts')
  const raced = await trackNewMail(inactive.id, { uidValidity: 1, uidNext: 13 }, [{ ...message, uid: 13 }])
  assert.equal(raced.length, 1, 'a delivery during FETCH is included')
  assert.equal(cursorSettings.mailNotificationCursors[inactive.id].uidNext, 14)
  assert.equal((await trackNewMail(inactive.id, { uidValidity: 1, uidNext: 14 }, [{ ...message, uid: 13 }])).length, 0)
  const restarted = {}
  vm.runInNewContext(compile(fs.readFileSync('src/main/notificationCursor.ts', 'utf8')), { exports: restarted, require: () => ({ readSettings: async () => cursorSettings, writeSettings: async () => { throw new Error('unchanged cursor must not write') } }) })
  assert.equal((await restarted.trackNewMail(inactive.id, { uidValidity: 1, uidNext: 12 }, [{ ...message, uid: 11 }])).length, 0, 'restart preserves deduplication')

  console.log('Notifications: new mail, history, UID validity, deduplication, privacy, sound, grouping, settings and account isolation passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
