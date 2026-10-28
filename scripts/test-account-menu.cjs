const fs = require('node:fs')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/renderer/src/components/Sidebar.tsx', 'utf8')
const ast = ts.createSourceFile('Sidebar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('const outside')) effect = node.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
const listeners = new Map()
let open = true
let focused = false
class Node {}
const inside = new Node()
const context = {
  menuOpen: true, Node,
  setMenuOpen: value => { open = value },
  accountMenu: { current: { contains: node => node === inside, querySelector: () => ({ focus: () => { focused = true } }) } },
  document: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) }
}
const setup = vm.runInNewContext(ts.transpile(`(${effect})`, { target: ts.ScriptTarget.ES2022 }), context)
const cleanup = setup()
listeners.get('pointerdown')({ target: inside })
assert.equal(open, true)
listeners.get('pointerdown')({ target: new Node() })
assert.equal(open, false)
open = true
let stopped = false
listeners.get('keydown')({ key: 'Escape', stopPropagation: () => { stopped = true } })
assert.equal(open, false)
assert.equal(focused, true)
assert.equal(stopped, true)
cleanup()
assert.equal(listeners.size, 0)
console.log('Account menu: inside click, outside click, Escape, focus restoration and cleanup passed')
