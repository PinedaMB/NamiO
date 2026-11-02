const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = path => ts.transpile(fs.readFileSync(path, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX })
const load = (path, require) => {
  const exports = {}
  vm.runInNewContext(compile(path), { exports, require })
  return exports
}
const boxes = load('src/shared/mailboxes.ts')
const dates = load('src/renderer/src/lib/dates.ts')
const live = load('src/renderer/src/data/live.ts', id => id === '../lib/dates' ? dates : boxes)
const es = load('src/renderer/src/i18n/es.ts')
const react = require('react')
const { MoveDialog } = load('src/renderer/src/components/MoveDialog.tsx', id => {
  if (id === 'react') return { ...react, useState: value => [value, () => {}], useRef: () => ({ current: null }), useEffect() {} }
  if (id === '../i18n') return { useI18n: () => ({ t: key => es.es[key] }) }
  if (id === '../lib/useAnimatedClose') return { useAnimatedClose: onClose => ({ closing: false, close: (action = onClose) => action() }) }
  if (id === '../data/live') return live
  if (id === 'react/jsx-runtime') return require(id)
  return Object.fromEntries(['Icon', 'Select', 'TooltipButton'].map(name => [name, name]))
})
const folders = [
  { path: 'Archive', name: 'Archive', specialUse: '\\Archive' },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts' },
  { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
  { path: 'Trash', name: 'Trash', specialUse: '\\Trash' },
  { path: 'Junk', name: 'Junk', specialUse: '\\Junk' },
  { path: 'Personal/Trabajo', name: 'Trabajo', specialUse: null }
].map(folder => ({ ...folder, messages: 0, unseen: 0 }))
let moved
const tree = MoveDialog({ subject: 'Test', folders, onClose() {}, onMove: path => { moved = path } })
const nodes = []
function walk(node) {
  if (!react.isValidElement(node)) return
  nodes.push(node)
  react.Children.forEach(node.props.children, walk)
}
walk(tree)
const options = nodes.filter(node => node.type === 'option')
assert.deepEqual(options.map(node => node.props.value), folders.map(folder => folder.path))
assert.deepEqual(options.map(node => node.props['aria-label']), ['Archivo', 'Borradores', 'Enviados', 'Papelera', es.es['sidebar.spam'], 'Trabajo'])
assert.deepEqual(options.map(node => react.Children.toArray(node.props.children)[0].props.name), ['archive', 'draft', 'send', 'delete', 'report', 'folder'])
nodes.find(node => node.type === 'button' && node.props.className === 'btn btn--primary').props.onClick()
assert.equal(moved, 'Archive')
console.log('Move dialog: translated labels, folder icons and original IMAP destination preserved')
