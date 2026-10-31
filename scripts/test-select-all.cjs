const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const compile = text => ts.transpile(text, {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX})
const helpers = {}
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/lib/selection.ts', 'utf8')), {exports: helpers})
const ast = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let keyboard
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'onKeyDown') keyboard = node.initializer.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
let checked = [], text = [], prevented = 0, focused = 0
const root = {tagName: 'BODY', closest: () => null}
const list = {querySelector: () => 'search results'}
const target = (selectors, extra = {}) => ({tagName: 'DIV', closest: selector => selectors[selector] ?? null, ...extra})
const context = {
  isSelectAll: helpers.isSelectAll, selectTextContents: element => text.push(element),
  paletteOpen: false, accountOpen: false, compose: null, composeMinimized: false, view: 'mailbox', query: '', bulkBusy: false, pendingDelete: null,
  visible: [{id: 'live:1'}, {id: 'live:2'}, {id: 'draft:3'}], setCheckedIds: value => {checked = Array.from(value)},
  document: {body: root, querySelector: () => null}
}
const keydown = vm.runInNewContext(compile(`(${keyboard})`), context)
const press = (element, extra = {}) => keydown({key: 'a', ctrlKey: true, target: element, preventDefault: () => {prevented++}, ...extra})
press(target({'.list': list}))
assert.deepEqual(checked, ['live:1', 'live:2'], 'only visible loaded messages are selected')
checked = []
press(target({'.list': list}, {tagName: 'INPUT', type: 'checkbox'}))
assert.deepEqual(checked, ['live:1', 'live:2'], 'checkbox focus is not a text editor')
const beforeTyping = prevented
for (const element of [{tagName: 'INPUT', type: 'search'}, {tagName: 'TEXTAREA'}, {tagName: 'DIV', isContentEditable: true}]) press(element)
assert.equal(prevented, beforeTyping, 'inputs and rich text retain native select-all')
context.query = 'invoice'; checked = []
press(target({'.list': list}))
assert.deepEqual(checked, [])
assert.deepEqual(text, ['search results'], 'search results select their text without touching app chrome')
context.query = ''; context.bulkBusy = true
press(target({'.list': list})); assert.deepEqual(checked, [])
context.bulkBusy = false
const frame = {focus: () => {focused++}, contentDocument: {body: 'mail body'}}
const message = {querySelector: selector => selector === '.email-body__frame' ? frame : null}
const reading = {querySelector: () => message}
press(target({'.reading': reading}))
assert.equal(focused, 1)
assert.equal(text.at(-1), 'mail body')
message.querySelector = selector => selector === '.body' ? 'plain body' : null
press(target({'.reading': reading}))
assert.equal(text.at(-1), 'plain body')
context.view = 'settings'; checked = []; text = []
press(target({'.list': list})); assert.deepEqual(checked, []); assert.deepEqual(text, [])
assert.ok(helpers.isSelectAll({key: 'A', metaKey: true}))
assert.ok(!helpers.isSelectAll({key: 'a', ctrlKey: true, altKey: true}))

let selectedElement, cleared = false, added = false
const ownerDocument = {createRange: () => ({selectNodeContents: element => {selectedElement = element}}), defaultView: {getSelection: () => ({removeAllRanges: () => {cleared = true}, addRange: () => {added = true}})}}
const element = {ownerDocument}
helpers.selectTextContents(element)
assert.equal(selectedElement, element)
assert.ok(cleared && added)

for (const [file, component] of [['DocumentViewer', 'DocumentViewer'], ['ImageViewer', 'ImageViewer']]) {
  const exports = {}
  vm.runInNewContext(compile(fs.readFileSync(`src/renderer/src/components/${file}.tsx`, 'utf8')), {exports, require: id => {
    if (id === 'react') return {...React, useRef: initial => ({current: initial}), useState: initial => [initial, () => {}], useEffect() {}}
    if (id === '../lib/selection') return helpers
    if (id === '../i18n') return {useI18n: () => ({t: key => key})}
    if (id === './Icon') return {Icon: () => null}
    if (id === './Tooltip') return {TooltipButton: 'button'}
    return require(id)
  }})
  let blocked = false, stopped = false
  const tree = exports[component]({title: 'Preview', onClose() {}, onSave() {}})
  selectedElement = null
  tree.props.onKeyDown({key: 'a', ctrlKey: true, preventDefault: () => {blocked = true}, stopPropagation: () => {stopped = true}, currentTarget: {querySelector: () => element}})
  assert.ok(blocked && stopped)
  assert.equal(selectedElement, component === 'DocumentViewer' ? element : null)
}
const mainAst = ts.createSourceFile('main.ts', fs.readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
let nativeHandler
function findNative(node) {
  if (ts.isCallExpression(node) && node.arguments[0]?.text === 'before-input-event') nativeHandler = node.arguments[1].getText(mainAst)
  ts.forEachChild(node, findNative)
}
findNative(mainAst)
const ignored = []
let zoomLevel = 0
const zoomNotifications = []
const native = vm.runInNewContext(compile(`(${nativeHandler})`), {IPC: { zoomChanged: 'window:zoom-changed' }, mainWindow: {webContents: {getZoomFactor: () => 1.2 ** zoomLevel, send: (...args) => zoomNotifications.push(args), setIgnoreMenuShortcuts: value => ignored.push(value), getZoomLevel: () => zoomLevel, setZoomLevel: value => { zoomLevel = value }}}})
for (const input of [{type: 'keyDown', key: 'a', control: true}, {type: 'keyUp', key: 'a', control: true}, {type: 'keyDown', key: 'c', control: true}, {type: 'keyDown', key: 'A', meta: true}]) native(null, input)
assert.deepEqual(ignored, [true, false, false, true], 'only the select-all menu accelerator defers to renderer focus')
for (const type of ['keyDown', 'keyUp']) {
  for (const modifier of ['control', 'meta']) {
    for (const shift of [false, true]) {
      let prevented = false
      native({ preventDefault() { prevented = true } }, { type, key: 'R', [modifier]: true, shift })
      assert.equal(prevented, !shift, 'plain reload is blocked while forced reload remains available')
    }
  }
}
for (const input of [{ key: 'r' }, { key: 'r', control: true, alt: true }, { key: 't', control: true }]) {
  let prevented = false
  native({ preventDefault() { prevented = true } }, { type: 'keyDown', ...input })
  assert.equal(prevented, false, 'unrelated shortcuts remain available')
}
for (const modifier of ['control', 'meta']) {
  for (const key of ['+', '=']) {
    for (const shift of [false, true]) {
      zoomLevel = -1
      let prevented = 0
      const input = { type: 'keyDown', key, [modifier]: true, shift }
      native({ preventDefault() { prevented++ } }, input)
      assert.equal(zoomLevel, -0.5, 'zoom-in accepts plus and equals across keyboard layouts')
      assert.equal(prevented, 1, 'native zoom cannot apply a second time')
      native({ preventDefault() { prevented++ } }, { ...input, type: 'keyUp' })
      assert.equal(zoomLevel, -0.5, 'key-up cannot zoom a second time')
    }
  }
}
for (const input of [{ key: '+' }, { key: '=', control: true, alt: true }]) {
  zoomLevel = 0
  native({ preventDefault() { throw new Error('Unrelated input must keep its native behavior') } }, { type: 'keyDown', ...input })
  assert.equal(zoomLevel, 0)
}
for (const [key, expectedLevel] of [['-', -0.5], ['0', 0], ['+', 0.5]]) {
  zoomLevel = 0
  native({ preventDefault() {} }, { type: 'keyDown', key, control: true })
  assert.equal(zoomLevel, expectedLevel)
  assert.deepEqual(zoomNotifications.at(-1), ['window:zoom-changed', Math.round(1.2 ** expectedLevel * 100)], 'notification reports the applied zoom percentage')
}
console.log('Select all: loaded mail, checkbox focus, fields/editors, HTML/plain bodies, TXT/image viewers and native-menu routing passed')
