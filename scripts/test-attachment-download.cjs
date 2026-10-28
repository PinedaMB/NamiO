const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let code
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openAttachment') code = node.initializer.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
async function check(result) {
  let calls = 0, resolve, reject, busy = null
  const toasts = []
  const context = {
    selected: {id: 'live:1', messages: [{id: 'live:1', attachments: [{kind: 'sheet', name: 'budget.xlsx'}]}]}, live: true, folder: 'INBOX',
    uidOf: id => Number(id.slice(5)), accountGeneration: {current: 1}, savingAttachmentRef: {current: false},
    setSavingAttachment: value => {busy = value}, setToast: value => toasts.push(value), t: key => key,
    window: {api: {saveAttachment: () => {calls++; return new Promise((yes, no) => {resolve = yes; reject = no})}}}
  }
  const open = vm.runInNewContext(ts.transpile(`(${code})`, {target: ts.ScriptTarget.ES2022}), context)
  open(0, 'live:1')
  assert.equal(busy.mailbox, 'INBOX')
  assert.equal(busy.messageId, 'live:1')
  assert.equal(busy.index, 0)
  assert.equal(context.savingAttachmentRef.current, true)
  open(0, 'live:1')
  assert.equal(calls, 1, 'rapid duplicate clicks must not start more downloads')
  if (result === 'switch') context.accountGeneration.current++
  if (result === 'error') reject(new Error('Download failed'))
  else resolve(result === 'cancel' ? null : '/tmp/budget.xlsx')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(busy, null, 'success, cancel and failure must all clear the progress indicator')
  assert.equal(context.savingAttachmentRef.current, false)
  assert.deepEqual(toasts, result === 'error' ? ['toast.actionFailed'] : result === 'success' ? ['toast.saved'] : [])
  open(0, 'live:1')
  assert.equal(calls, 2, 'buttons work again after the previous operation finishes')
  resolve(null)
  await new Promise(resolve => setImmediate(resolve))
}
;(async () => {
  for (const result of ['success', 'cancel', 'error', 'switch']) await check(result)
  console.log('Attachment download: immediate progress, duplicate-click protection, completion/cancel/error cleanup and account isolation passed')
})().catch(error => {console.error(error); process.exitCode = 1})
