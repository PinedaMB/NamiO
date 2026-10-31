const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

const document = { activeElement: null }
class FakeElement {
  constructor(name, children = []) {
    this.name = name
    this.children = children
    this.listeners = {}
    this.isConnected = true
  }
  focus() { document.activeElement = this }
  getClientRects() { return [{}] }
  contains(node) { return node === this || this.children.includes(node) }
  querySelectorAll() { return this.children }
  addEventListener(type, listener) { this.listeners[type] = listener }
  removeEventListener(type) { delete this.listeners[type] }
  dispatch(type, event) { this.listeners[type]?.(event) }
}

const exportsObject = {}
let cleanup
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/lib/useFocusTrap.ts', 'utf8')), {
  exports: exportsObject,
  document,
  HTMLElement: FakeElement,
  require: id => id === 'react' ? { useEffect: (effect) => { cleanup = effect() } } : require(id)
})

const previous = new FakeElement('previous')
const first = new FakeElement('first')
const last = new FakeElement('last')
const root = new FakeElement('root', [first, last])
document.activeElement = previous

exportsObject.useFocusTrap({ current: root }, true)
assert.equal(document.activeElement, first, 'focus starts inside the dialog')

let prevented = false
document.activeElement = last
root.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented = true } })
assert.ok(prevented)
assert.equal(document.activeElement, first, 'Tab wraps to the first control')

prevented = false
document.activeElement = first
root.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented = true } })
assert.ok(prevented)
assert.equal(document.activeElement, last, 'Shift+Tab wraps to the last control')

prevented = false
document.activeElement = new FakeElement('outside')
root.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented = true } })
assert.ok(prevented)
assert.equal(document.activeElement, first, 'focus outside the dialog is brought back')

cleanup()
assert.equal(document.activeElement, previous, 'closing restores the previous focus')

console.log('Focus trap: initial focus, Tab cycling, outside focus recovery and restore on close verified')
