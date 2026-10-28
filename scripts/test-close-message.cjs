const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let keydown, selected, reconcile, initialSelection, folderSelection
const refreshSelections = []
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === '[selectedId, setSelectedId]') initialSelection = node.initializer.arguments[0].getText(ast)
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'setSelectedId' && node.arguments[0]?.getText(ast).startsWith('focusUid !== undefined')) folderSelection = node.arguments[0].getText(ast)
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'onKeyDown') keydown = node.initializer.getText(ast)
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selected') selected = node.initializer.arguments[0].getText(ast)
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[1]?.getText(ast) === '[visible, selectedId]') reconcile = node.arguments[0].getText(ast)
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'setSelectedId' && node.arguments[0]?.getText(ast).includes('mapped.some')) refreshSelections.push(node.arguments[0].getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)
let id = 'one', individual = 'one', open = true, focused = false, paletteClosed = false
const context = {
  isSelectAll: () => false,
  paletteOpen: false, compose: null, composeMinimized: false, accountOpen: false, view: 'mailbox',
  selectedId: 'one', visible: [{ id: 'one' }], listedThreads: [{ id: 'one' }], mapped: [{ id: 'one' }],
  setSelectedId: value => { id = value }, setIndividualMessageId: value => { individual = value }, setMessageOpen: value => { open = value },
  setPaletteOpen: () => { paletteClosed = true }, setAccountOpen: () => {}, setView: () => {},
  document: { querySelector: () => ({ focus: () => { focused = true } }) }
}
const evaluate = code => vm.runInNewContext(ts.transpile(`(${code})`, { target: ts.ScriptTarget.ES2022 }), context)
const escape = evaluate(keydown)
escape({ key: 'Escape', target: null })
assert.equal(id, null)
assert.equal(individual, null)
assert.equal(open, false)
assert.equal(focused, true)
context.selectedId = null
assert.equal(evaluate(selected)(), null, 'must render the empty reading pane')
id = 'unchanged'
evaluate(reconcile)()
assert.equal(id, 'unchanged', 'must not automatically reopen the first message')
assert.equal(refreshSelections.length, 2)
for (const updater of refreshSelections) assert.equal(evaluate(updater)(null), null, 'sync and load-more must preserve closed state')
context.paletteOpen = true
id = 'one'
escape({ key: 'Escape', target: null })
assert.equal(paletteClosed, true)
assert.equal(id, 'one', 'Escape closes the top overlay first')
context.paletteOpen = false
context.compose = {}
escape({ key: 'Escape', target: null })
assert.equal(id, 'one', 'composer handles its own Escape')
context.compose = null
for (const event of [{ key: 'Escape', target: { tagName: 'INPUT' } }, { key: 'Escape', target: null, defaultPrevented: true }]) {
  escape(event)
  assert.equal(id, 'one', 'must respect inputs and already handled Escape')
}
assert.match(source, /label=\{live && visible.length === 0 \? t\('account.liveEmpty'\) : undefined\}/)
console.log('Close message: Escape, empty state, sync/load-more persistence, focus and overlay priority passed')
const bodySource = fs.readFileSync('src/renderer/src/components/EmailBody.tsx', 'utf8')
const bodyAst = ts.createSourceFile('EmailBody.tsx', bodySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let forwardEscape
function findForwarder(node) {
  if (ts.isCallExpression(node) && node.expression.getText(bodyAst) === 'inner.addEventListener' && node.arguments[0]?.text === 'keydown') forwardEscape = node.arguments[1].getText(bodyAst)
  ts.forEachChild(node, findForwarder)
}
findForwarder(bodyAst)
let forwarded = 0, prevented = false
const forward = vm.runInNewContext(ts.transpile(`(${forwardEscape})`, { target: ts.ScriptTarget.ES2022 }), {
  KeyboardEvent: class { constructor(type, options) { this.type = type; this.key = options.key } },
  window: { dispatchEvent: event => { assert.equal(event.key, 'Escape'); forwarded++ } }
})
forward({ key: 'Escape', preventDefault: () => { prevented = true } })
assert.equal(prevented, true)
assert.equal(forwarded, 1)
forward({ key: 'a' })
forward({ key: 'Escape', defaultPrevented: true })
assert.equal(forwarded, 1)
console.log('Escape also reaches the app when focus is inside the email document')

assert.equal(vm.runInNewContext(initialSelection), null, 'startup must show the welcome pane')
assert.equal(vm.runInNewContext(folderSelection, { focusUid: undefined }), null, 'opening a mailbox must not open its first message')
assert.equal(vm.runInNewContext(folderSelection, { focusUid: 42 }), 'live:42', 'notifications and search can still open an explicit message')
assert.equal(source.includes('setSelectedId(THREADS[0]'), false, 'returning to demo must also show the welcome pane')
console.log('Startup and mailbox loading show welcome; explicit notification/search targets still open')
