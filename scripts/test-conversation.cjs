const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript-test')
const React = require('react')
const compile = file => ts.transpile(fs.readFileSync(file, 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX })
const dates = {}
vm.runInNewContext(compile('src/renderer/src/lib/dates.ts'), { exports: dates })
const live = {}
vm.runInNewContext(compile('src/renderer/src/data/live.ts'), { exports: live, require: id => id === '../lib/dates' ? dates : ({ isSpamMailbox: () => false }) })
function envelope(uid, messageId, inReplyTo, subject = 'Same subject') {
  return { uid, messageId, inReplyTo, subject, hasAttachments: uid === 2, from: { name: 'Sender', address: 'sender@example.com' }, date: `2026-10-${20 + uid}T12:00:00Z`, unread: false, flagged: false, size: 1 }
}
const envelopes = [envelope(3, '<third>', '<second>'), envelope(2, '<second>', '<first>'), envelope(1, '<first>'), envelope(4, '<unrelated>')]
let threads = live.envelopesToThreads(envelopes, 'es')
assert.deepEqual(Array.from(threads[0].messageIds), [1, 2, 3])
assert.equal(threads[0].messageCount, 3)
assert.deepEqual(Array.from(threads[3].messageIds), [4])
assert.deepEqual(Array.from(live.envelopesToThreads([envelope(1, '<a>', '<b>'), envelope(2, '<b>', '<a>')], 'es')[0].messageIds), [1, 2])
assert.equal(live.envelopesToThreads([envelope(1), envelope(2)], 'es')[0].messageCount, 1)

// The additive migration must retain bodies already stored by an older installation.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-conversation-'))
const { DatabaseSync } = require('node:sqlite')
const old = new DatabaseSync(path.join(directory, 'cache.db'))
old.exec(`CREATE TABLE messages (mailbox TEXT NOT NULL, uid INTEGER NOT NULL, subject TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '', from_addr TEXT NOT NULL DEFAULT '', date INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 1, flagged INTEGER NOT NULL DEFAULT 0, to_json TEXT, cc_json TEXT, body_text TEXT, body_html TEXT, PRIMARY KEY(mailbox, uid)); INSERT INTO messages(mailbox,uid,body_text) VALUES ('INBOX',1,'Saved body')`)
old.close()
const db = {}
vm.runInNewContext(compile('src/main/db.ts'), { exports: db, Buffer, require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id) })
try {
  db.openAccountCache('default')
  db.upsertEnvelopes('INBOX', envelopes)
  assert.equal(db.missingEnvelopeMetadata('INBOX').length, 0)
  db.upsertEnvelopes('INBOX', [{ ...envelope(5, '<legacy>'), hasAttachments: undefined }])
  assert.deepEqual(Array.from(db.missingEnvelopeMetadata('INBOX')), [5])
  db.upsertEnvelopes('INBOX', [{ ...envelope(5, '<legacy>'), hasAttachments: true }])
  assert.equal(db.missingEnvelopeMetadata('INBOX').length, 0)
  const cached = db.readEnvelopes('INBOX', 50)
  assert.equal(db.readEnvelope('INBOX', 2).inReplyTo, '<first>')
  assert.equal(db.readEnvelope('INBOX', 2).hasAttachments, true)
  assert.equal(db.readEnvelope('INBOX', 1).hasAttachments, false)
  assert.equal(db.readEnvelope('INBOX', 1).messageId, '<first>')
  assert.equal(db.readBody('INBOX', 1).text, 'Saved body')
  assert.equal(live.envelopesToThreads(cached, 'es').find(thread => thread.id === 'live:3').messageCount, 3)
} finally {
  db.closeCache()
  fs.rmSync(directory, { recursive: true, force: true })
}

const pane = {}
const clicked = []
vm.runInNewContext(compile('src/renderer/src/components/ThreadPane.tsx'), { exports: pane, require: id => {
  if (id === 'react') return { ...React, useState: () => [null, () => {}], useEffect() {} }
  if (id === '../lib/dates') return dates
  if (id === '../i18n') return { useI18n: () => ({ t: key => key, locale: 'es' }) }
  if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ bodyTheme: 'dark' }) }
  if (id === '../settings/shortcuts') return { formatCombo: () => '' }
  if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
  if (id === './EmailBody') return { EmailBody: () => null }
  if (id === './SenderAvatar') return { SenderAvatar: () => null }
  if (id === './Tooltip') return { TooltipButton: () => null }
  if (id === './Icon') return { Icon: () => null }
  return require(id)
} })
const messages = envelopes.slice(0, 3).reverse().map(item => live.detailToMessage({ ...item, to: [], text: 'Message body', html: '<p>Message body</p>', attachments: [{name: 'file.pdf', type: 'application/pdf', size: 12, index: 0}] }, 'es'))
const tree = pane.ThreadPane({ thread: { ...threads[0], messages }, mailbox: 'INBOX', bindings: {}, onOpenAttachment: (...args) => clicked.push(args) })
const cards = []
const attachmentSections = []
function visit(node) {
  if (!React.isValidElement(node)) return
  if (node.props.className === 'thread-message') cards.push(node)
  if (node.props.className === 'thread-message__files') attachmentSections.push(node)
  if (node.props.className === 'attachment') node.props.onClick()
  React.Children.forEach(node.props.children, visit)
}
visit(tree)
assert.equal(cards.length, 3)
assert.deepEqual(cards.map(card => card.props.open), [false, false, true])
assert.deepEqual(clicked, [[0, 'live:1'], [0, 'live:2'], [0, 'live:3']])
console.log('Conversation: reply links, independent subjects, cycles, additive cache migration, cards and attachment identity passed')

assert.equal(attachmentSections.length, 3)
for (const section of attachmentSections) {
  assert.equal(section.type, 'details')
  assert.equal(section.props.open, true)
  const children = React.Children.toArray(section.props.children)
  assert.equal(children[0].type, 'summary')
  assert.equal(children[1].props.className, 'attachments')
}
console.log('Attachments: independent native disclosure for each message, expanded by default')

const list = {}
vm.runInNewContext(compile('src/renderer/src/components/ThreadList.tsx'), { exports: list, require: id => {
  if (id === '../lib/dates') return dates
  if (id === '../i18n') return { useI18n: () => ({ t: key => key, locale: 'es' }) }
  if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
  if (id === './SenderAvatar') return { SenderAvatar: () => null }
  if (id === './Tooltip') return { TooltipButton: () => null }
  if (id === './Icon') return { Icon: () => null }
  return require(id)
} })
const selectedMessages = []
const checkedMessages = []
const listTree = list.ThreadList({
  threads, allThreads: threads, selectedId: 'live:2', selectedMessageId: 'live:2', mailbox: 'INBOX', live: true,
  checkedIds: [], filter: 'all', onSelect: (...args) => selectedMessages.push(args), onCheck: id => checkedMessages.push(id)
})
let articleCount = 0
let disclosureCount = 0
let selectedChildren = 0
function visitList(node) {
  if (!React.isValidElement(node)) return
  if (node.type === 'article') articleCount++
  if (node.props.className === 'thread-group__messages') disclosureCount++
  if (node.type === 'button' && node.props.className?.startsWith('thread-group__message')) {
    node.props.onClick()
    if (node.props['aria-current']) selectedChildren++
  }
  if (node.props.className === 'thread-group__item') {
    React.Children.toArray(node.props.children).find(child => child.type === 'input').props.onChange()
  }
  React.Children.forEach(node.props.children, visitList)
}
visitList(listTree)
assert.equal(articleCount, 2, 'one conversation row plus the unrelated message')
assert.equal(disclosureCount, 1)
assert.equal(selectedChildren, 1)
assert.deepEqual(selectedMessages, [['live:1', 'live:1'], ['live:2', 'live:2'], ['live:3', 'live:3']])
assert.deepEqual(checkedMessages, ['live:1', 'live:2', 'live:3'])

const appSource = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const appAst = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let selectSource
function findSelect(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === 'select') selectSource = node.initializer.getText(appAst)
  ts.forEachChild(node, findSelect)
}
findSelect(appAst)
let individual, selected
const selectMessage = vm.runInNewContext(ts.transpile(`(${selectSource})`, { target: ts.ScriptTarget.ES2022 }), {
  setIndividualMessageId: value => { individual = value }, setSelectedId: value => { selected = value }, setMessageOpen() {},
  userNavigated: { current: false }, live: true, draftsFolder: false, folderRequest: { current: 0 }, threads, uidOf: id => Number(id.slice(5)), markRead() {}, folder: 'INBOX'
})
selectMessage('live:2', 'live:2')
assert.equal(selected, 'live:2')
assert.equal(individual, 'live:2')
selectMessage('live:3')
assert.equal(selected, 'live:3')
assert.equal(individual, null, 'selecting the conversation restores the whole thread')
console.log('Conversation list: unique groups, independent selection, per-message checkboxes and returning to conversation passed')

const imapSource = fs.readFileSync('src/main/imap.ts', 'utf8')
const imapAst = ts.createSourceFile('imap.ts', imapSource, ts.ScriptTarget.Latest, true)
const hasFilesDeclaration = imapAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'hasAttachments')
const hasFiles = vm.runInNewContext(ts.transpile(`${hasFilesDeclaration.getText(imapAst)}; hasAttachments`, { target: ts.ScriptTarget.ES2022 }))
assert.equal(hasFiles(undefined), false)
assert.equal(hasFiles({ type: 'text/plain' }), false)
assert.equal(hasFiles({ type: 'multipart/mixed', childNodes: [{ type: 'text/html' }, { type: 'application/pdf', disposition: 'attachment' }] }), true)
assert.equal(hasFiles({ type: 'image/png', disposition: 'inline', dispositionParameters: { filename: 'logo.png' } }), true)
assert.equal(hasFiles({ type: 'application/pdf', parameters: { name: 'report.pdf' } }), true)
let filesIndicator = false
function inspectCard(node) {
  if (!React.isValidElement(node)) return
  if (node.type === 'article') {
    const children = React.Children.toArray(node.props.children)
    assert.ok(children.some(child => child.props?.className === 'thread__content'))
    assert.ok(!children.some(child => child.props?.className === 'thread-group__messages'), 'expanded messages stay outside the card')
  }
  if (node.props['aria-label'] === 'thread.attachments') filesIndicator = true
  React.Children.forEach(node.props.children, inspectCard)
}
inspectCard(listTree)
assert.ok(filesIndicator)
console.log('Cards: inline disclosure, attachment indicator, MIME detection and cached attachment metadata passed')
