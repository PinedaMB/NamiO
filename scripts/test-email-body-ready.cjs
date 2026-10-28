const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const state = []
let index = 0
let darkened = false
let measured = false
let resize, pendingMeasure
let disconnected = 0
const observed = []
const listeners = new Map()
const animationFrame = { current: 0 }
const inner = {
  documentElement: { get scrollHeight() { assert.ok(darkened); measured = true; return 1250 } },
  body: {}, querySelectorAll: () => [], addEventListener: (name, fn) => listeners.set(name, fn)
}
const exportsObject = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/components/EmailBody.tsx', 'utf8'), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX
}), {
  exports: exportsObject,
  ResizeObserver: class { constructor(callback) { resize = callback } observe(target) { observed.push(target) } disconnect() { disconnected++ } },
  requestAnimationFrame: callback => { pendingMeasure = callback; return 1 },
  cancelAnimationFrame: () => { pendingMeasure = undefined },
  DOMParser: class { parseFromString(html) { return { querySelectorAll: () => [], body: { innerHTML: html } } } },
  require: id => {
    if (id === 'react') return { ...React,
      useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value }] },
      useRef: initial => typeof initial === 'number' ? animationFrame : ({ current: { contentDocument: inner, disconnect() {} } }), useEffect() {}, useLayoutEffect() {}, useMemo: fn => fn()
    }
    if (id === 'dompurify') return { default: { sanitize: html => html } }
    if (id === '../i18n') return { useI18n: () => ({ t: key => key }) }
    if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ remoteImages: 'allow', bodyTheme: 'dark' }) }
    if (id === '../lib/emailTheme') return { emailBackground: () => undefined, applyEmailTheme() { darkened = true } }
    if (id === './ImageViewer') return { ImageViewer: () => null }
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
assert.deepEqual(observed, [inner.body], 'observe message content, not the root whose height follows the iframe')
frame.props.onLoad()
assert.equal(observed.length, 1, 'late image completion must not initialize the document twice')
assert.ok(measured)
measured = false
const beforeResize = disconnected
resize([{ contentRect: { width: 600, height: 1250 } }])
assert.equal(disconnected, beforeResize + 1, 'pause observation before scheduling an iframe resize')
assert.equal(observed.length, 1, 'do not resume within the observer delivery')
assert.equal(measured, false, 'ResizeObserver must defer layout mutations to the next frame')
pendingMeasure()
assert.ok(measured)
assert.equal(observed.length, 2, 'resume observing after the deferred measurement')
pendingMeasure = undefined
resize([{ contentRect: { width: 600, height: 1250 } }])
assert.equal(pendingMeasure, undefined, 're-observing unchanged content must not create a frame loop')
frame = render()
assert.equal(frame.props.style.visibility, 'visible')
assert.equal(frame.props.style.height, 1250)
assert.equal(render('<p>Next message</p>').props.style.visibility, 'hidden')
assert.equal(render(undefined, 'light').props.style.visibility, 'visible')
assert.equal(render(undefined, 'light').props.srcDoc, frame.props.srcDoc)
assert.equal(render(undefined, 'light').key, frame.key)
console.log('Email body: hidden until themed and measured; message/theme changes reset readiness')
const tsSource = fs.readFileSync('src/renderer/src/components/EmailBody.tsx', 'utf8')
const ast = ts.createSourceFile('EmailBody.tsx', tsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let readinessEffect
function findReadiness(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('showWhenParsed')) readinessEffect = node.arguments[0].getText(ast)
  ts.forEachChild(node, findReadiness)
}
findReadiness(ast)
let nextFrame, displayed = 0, canceled = false
const documentState = {URL: 'about:blank', readyState: 'complete', body: {}}
const ready = vm.runInNewContext(ts.transpile(`(${readinessEffect})`, {target: ts.ScriptTarget.ES2022}), {
  frameRef: {current: {contentDocument: documentState}}, handleLoad: () => {displayed++},
  requestAnimationFrame: callback => {nextFrame = callback; return 1}, cancelAnimationFrame: () => {canceled = true}
})
const cancelReadiness = ready()
nextFrame()
assert.equal(displayed, 0, 'initial about:blank must never appear as the message')
documentState.URL = 'about:srcdoc'; documentState.readyState = 'loading'
nextFrame()
assert.equal(displayed, 0)
documentState.readyState = 'interactive'
nextFrame()
assert.equal(displayed, 1, 'show parsed text while remote images still prevent document load')
cancelReadiness()
assert.equal(canceled, true)
console.log('Email readiness: parsed text does not wait for slow images; blank document is ignored and polling is canceled on unmount')

const inlineImage = {src: 'https://example.test/photo.png', alt: 'Photo', closest: selector => selector === 'img' ? inlineImage : null}
listeners.get('click')({target: inlineImage, preventDefault() {}})
index = 0
let viewerTree = exportsObject.EmailBody({html: '<p>Message</p>', theme: 'dark'})
let viewer = React.Children.toArray(viewerTree.props.children).find(child => child.props?.src === inlineImage.src)
assert.ok(viewer, 'inline image opens the shared viewer')
viewer.props.onClose()
inlineImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
listeners.get('click')({target: inlineImage, preventDefault() {}})
index = 0
viewerTree = exportsObject.EmailBody({html: '<p>Message</p>', theme: 'dark'})
assert.equal(React.Children.toArray(viewerTree.props.children).some(child => child.props?.onClose), false, 'blocked tracking placeholders cannot open a viewer')
console.log('Inline image previews open safely; blocked placeholders remain blocked')
