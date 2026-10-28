const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript-test')
const ast = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const code = new Map()
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) code.set(node.name.text, node.getText(ast))
  if (ts.isVariableDeclaration(node) && node.initializer) code.set(node.name.getText(ast), `const ${node.name.getText(ast)} = ${node.initializer.getText(ast)}`)
  ts.forEachChild(node, visit)
}
visit(ast)
const load = (name, context) => vm.runInNewContext(ts.transpile(`${code.get(name)}; ${name}`, { target: ts.ScriptTarget.ES2022 }), context)
const uidOf = load('uidOf', {})
const merge = load('mergeLoaded', { uidOf })
const message = { id: 'live:1', html: '<p>Already loaded</p>' }
const old = { id: 'live:1', unread: false, messageIds: [1], messages: [message] }
assert.equal(merge([old], [{ ...old, messages: [] }])[0], old, 'unchanged sync preserves the selected object and iframe')
const extended = merge([old], [{ ...old, messageIds: [1, 2], messages: [] }])[0]
assert.equal(extended.messages[0], message, 'new replies keep the existing content visible')
assert.equal(merge([extended], [{ ...old, messageIds: [2], messages: [] }])[0].messages.length, 0, 'removed messages must not survive synchronization')

const flush = () => new Promise(resolve => setImmediate(resolve))
;(async () => {
  for (const outcome of ['success', 'cancel', 'error', 'queued', 'account', 'folder']) {
    let resolve, pending = null, calls = 0, removed = false
    const context = {
      selected: old, live: true, folder: 'INBOX', mailboxes: [], uidOf,
      accountGeneration: { current: 1 }, folderRequest: { current: 1 }, deletingMessage: { current: false }, bulkRunning: { current: false },
      setPendingDelete: value => { pending = value }, setToast() {}, t: key => key, refreshOutbox() {},
      setThreads: updater => { removed = updater([old]).length === 0 },
      window: { api: { deleteMessage: () => { calls++; return new Promise(done => { resolve = done }) } } }
    }
    const remove = load('deleteSelected', context)
    remove(); remove()
    assert.equal(calls, 1, 'repeated delete cannot start another request')
    assert.equal(pending.id, old.id, 'pending feedback identifies the requested message')
    assert.equal(removed, false, 'mail remains visible while deletion is pending')
    if (outcome === 'account') context.accountGeneration.current++
    if (outcome === 'folder') context.folderRequest.current++
    resolve(outcome === 'error' ? { ok: false, error: 'failed' } : { ok: true, canceled: outcome === 'cancel', queued: outcome === 'queued' })
    await flush()
    assert.equal(pending, null, 'feedback clears for every outcome')
    assert.equal(context.deletingMessage.current, false)
    assert.equal(removed, outcome === 'success', 'failure, cancel, queued and stale account responses preserve visible messages')
  }
  console.log('Sync continuity and delete feedback: stable loaded content, new replies, removals, pending state, duplicates, cancel, errors, queue and account isolation passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
