const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const state = []
let index = 0
let darkened = false
let measured = false
const inner = {
  documentElement: { get scrollHeight() { assert.ok(darkened); measured = true; return 1250 } },
  body: {}, addEventListener() {}
}
const exportsObject = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/components/EmailBody.tsx', 'utf8'), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX
}), {
  exports: exportsObject,
  ResizeObserver: class { observe() {} disconnect() {} },
  DOMParser: class { parseFromString(html) { return { querySelectorAll: () => [], body: { innerHTML: html } } } },
  require: id => {
    if (id === 'react') return { ...React,
      useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value }] },
      useRef: () => ({ current: { contentDocument: inner, disconnect() {} } }), useEffect() {}, useLayoutEffect() {}, useMemo: fn => fn()
    }
    if (id === 'dompurify') return { default: { sanitize: html => html } }
    if (id === '../i18n') return { useI18n: () => ({ t: key => key }) }
    if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ remoteImages: 'allow', bodyTheme: 'dark' }) }
    if (id === '../lib/emailTheme') return { emailBackground: () => undefined, applyEmailTheme() { darkened = true } }
    if (id === './Icon') return { Icon: () => null }
    return require(id)
  }
})
function render(html = '<p>Message</p>', theme = 'dark') {
  index = 0
  const tree = exportsObject.EmailBody({ html, theme })
  return React.Children.toArray(tree.props.children).find(child => child.type === 'iframe')
}
let frame = render()
assert.equal(frame.props.style.visibility, 'hidden')
assert.equal(frame.props.style.height, 0)
// Preserve table min-content widths so currency columns cannot shrink to one character.
const baseStyle = frame.props.srcDoc.match(/<style>([\s\S]*?)<\/style>/)[1]
assert.match(baseStyle, /overflow-wrap: break-word/)
assert.match(baseStyle, /word-break: normal/)
assert.doesNotMatch(baseStyle, /overflow-wrap: anywhere|word-break: break-word/)

frame.props.onLoad()
assert.ok(measured)
frame = render()
assert.equal(frame.props.style.visibility, 'visible')
assert.equal(frame.props.style.height, 1250)
assert.equal(render('<p>Next message</p>').props.style.visibility, 'hidden')
assert.equal(render(undefined, 'light').props.style.visibility, 'visible')
assert.equal(render(undefined, 'light').props.srcDoc, frame.props.srcDoc)
assert.equal(render(undefined, 'light').key, frame.key)
console.log('Email body: hidden until themed and measured; message/theme changes reset readiness')
