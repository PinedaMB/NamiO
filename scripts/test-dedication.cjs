const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync('src/renderer/src/components/Settings.tsx', 'utf8')
const ast = ts.createSourceFile('Settings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes("section !== 'about'")) effect = node.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(effect)
function mount(section) {
  let listener, opened = 0
  const dialog = { open: false, showModal() { this.open = true; opened++ } }
  const context = { section, dedication: { current: dialog }, window: {
    addEventListener(name, fn, capture) { assert.equal(capture, true); listener = fn },
    removeEventListener(name, fn, capture) { assert.equal(fn, listener); assert.equal(capture, true); listener = null }
  } }
  const js = ts.transpile(`(${effect})()`, { target: ts.ScriptTarget.ES2022 })
  const cleanup = vm.runInNewContext(js, context)
  return { dialog, cleanup, get opened() { return opened }, get listening() { return !!listener },
    key(key, extra = {}) { listener?.({ key, preventDefault() {}, stopPropagation() {}, ...extra }) } }
}
assert.equal(mount('general').listening, false)
const about = mount('about')
for (const key of '100x825') about.key(key)
assert.equal(about.opened, 0)
for (const key of '100825') about.key(key)
assert.equal(about.opened, 1)
for (const key of '100825') about.key(key)
assert.equal(about.opened, 1, 'typing in the modal cannot reopen it')
about.dialog.open = false
about.key('1', { ctrlKey: true })
for (const key of '00825') about.key(key)
assert.equal(about.opened, 1, 'modified keys cannot complete the code')
for (const key of '100825') about.key(key)
assert.equal(about.opened, 2)
about.cleanup()
assert.equal(about.listening, false)
console.log('Dedication: section scope, consecutive keys, modifiers, reopening and cleanup passed')
