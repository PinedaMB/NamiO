const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(ast), node.initializer.getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)
let messageOpen = false
let selectedId = 'first'
let folder
let expanded = true
const context = {
  setMessageOpen: value => { messageOpen = value },
  setCompactNavExpanded: value => { expanded = value },
  setIndividualMessageId() {}, userNavigated: { current: false },
  setSelectedId: value => { selectedId = value }, draftsFolder: false,
  live: false, threads: [], uidOf: () => null,
  mailboxes: [], setView() {}, setFilter() {}, setFolder: value => { folder = value }
}
function run(name) {
  return vm.runInNewContext(ts.transpile(`(${declarations.get(name)})`, { target: ts.ScriptTarget.ES2022 }), context)
}
run('select')('second')
assert.equal(messageOpen, true, 'opening a message enters the reader')
assert.equal(selectedId, 'second')
context.draftsFolder = true
messageOpen = false
run('select')('draft')
assert.equal(messageOpen, false, 'drafts keep their existing compose navigation')
run('selectFolder')('archive')
assert.equal(messageOpen, false, 'changing folders returns to the list')
assert.equal(expanded, false, 'folder selection closes compact navigation')
assert.equal(folder, 'archive')
console.log('Responsive navigation: message selection, drafts and folder changes passed')
