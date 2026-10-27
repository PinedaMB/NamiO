const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const listeners = new Map()
const timers = new Map()
let anchor = null
let retainedAnchor = null
let stateIndex = 0
let timerId = 0
let cleanup
class Element {
  constructor(text) { this.dataset = { tooltip: text }; this.isConnected = true }
  closest(selector) { return selector.includes('data-tooltip') ? this : null }
  contains(node) { return node === this }
}
const document = {
  activeElement: null,
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: name => listeners.delete(name)
}
const exportsObject = {}
const source = fs.readFileSync('src/renderer/src/components/Tooltip.tsx', 'utf8')
const code = ts.transpile(source, { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 })
vm.runInNewContext(code, {
  exports: exportsObject, document, Element, Node: Element,
  window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
  setTimeout: fn => { timers.set(++timerId, fn); return timerId },
  clearTimeout: id => timers.delete(id),
  require: name => name === '../lib/usePresence' ? { usePresence: () => ({ mounted: false, closing: false }) } : name === '../lib/cx' ? { cx: (...values) => values.filter(Boolean).join(' ') } : name === 'react' ? {
    useId: () => 'tooltip-test', useRef: () => ({ current: null }),
    useState: initial => {
      const index = stateIndex++
      if (index === 0) return [retainedAnchor, value => { retainedAnchor = value }]
      if (index === 2) return [false, value => { anchor = value ? retainedAnchor : null }]
      return [initial, () => {}]
    },
    useEffect: fn => { cleanup = fn() }, useLayoutEffect: () => {}
  } : require(name)
})
exportsObject.Tooltips()
function flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()) }
const button = new Element('Archive')
listeners.get('pointerover')({ type: 'pointerover', target: button })
assert.equal(anchor, null, 'hover waits before showing')
flush()
assert.equal(anchor, button)
listeners.get('keydown')({ key: 'Escape' })
assert.equal(anchor, null)
assert.equal(retainedAnchor, button, 'closing keeps the tooltip content available for the exit animation')
listeners.get('focusin')({ type: 'focusin', target: button })
flush()
assert.equal(anchor, button, 'keyboard focus shows the tooltip')
document.activeElement = button
listeners.get('pointerout')({ type: 'pointerout', target: button, relatedTarget: null })
flush()
assert.equal(anchor, button, 'moving the pointer does not dismiss a focused tooltip')
listeners.get('scroll')()
assert.equal(anchor, null)
listeners.get('pointerover')({ type: 'pointerover', target: button })
listeners.get('pointerdown')({ target: button })
flush()
assert.equal(anchor, null, 'click cancels pending tooltip')
listeners.get('focusin')({ type: 'focusin', target: button })
listeners.get('click')({ target: button })
listeners.get('pointerover')({ type: 'pointerover', target: button })
flush()
assert.equal(anchor, null, 'pointer click followed by focus cannot reopen the tooltip')
listeners.get('pointerout')({ type: 'pointerout', target: button, relatedTarget: null })
listeners.get('keydown')({ key: 'Tab' })
listeners.get('focusin')({ type: 'focusin', target: button })
flush()
assert.equal(anchor, button, 'Tab restores keyboard tooltips after a mouse click')
listeners.get('keydown')({ key: 'Enter', target: button })
flush()
assert.equal(anchor, null, 'keyboard activation closes the tooltip')
listeners.get('focusout')({ type: 'focusout', target: button, relatedTarget: null })
listeners.get('pointerover')({ type: 'pointerover', target: button })
button.isConnected = false
flush()
assert.equal(anchor, null, 'removed buttons cannot show tooltips')
cleanup()
assert.equal(listeners.size, 0)
assert.equal(timers.size, 0)
const html = renderToStaticMarkup(React.createElement(exportsObject.TooltipButton, { title: 'Archive', disabled: true }, 'A'))
assert.ok(html.includes('data-tooltip="Archive"'))
assert.ok(html.includes('aria-label="Archive"'))
assert.ok(html.includes('disabled=""'))
assert.ok(!html.includes(' title='), 'native tooltip is removed')
for (const name of fs.readdirSync('src/renderer/src/components').filter(name => name.endsWith('.tsx')).map(name => 'src/renderer/src/components/' + name).concat('src/renderer/src/App.tsx')) {
  const ast = ts.createSourceFile(name, fs.readFileSync(name, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'button') {
      assert.ok(!node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'title'), `${name}: native titled button remains`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}
console.log('Tooltip interaction, accessibility and button coverage checks passed')
