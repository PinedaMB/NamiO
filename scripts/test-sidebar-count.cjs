const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const exportsObject = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/components/Sidebar.tsx', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
}), { exports: exportsObject, require: id => {
  if (id === 'react') return { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: () => ({ current: null }), useEffect() {} }
  if (id === '../i18n') return { useI18n: () => ({ t: key => key }) }
  if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
  if (id === '../data/demo') return { TAGS: [] }
  if (id.endsWith('.png')) return { default: '' }
  if (id === './Icon') return { Icon: 'span' }
  if (id === './Tooltip') return { TooltipButton: 'button' }
  return require(id)
} })
function nodes(node, found = []) {
  if (!React.isValidElement(node)) return found
  found.push(node)
  React.Children.forEach(node.props.children, child => nodes(child, found))
  return found
}
const folders = [0, 1, 2, 12, 99, 1000].map(count => ({ id: String(count), label: 'Papelera', icon: 'delete', count }))
for (const collapsed of [true, false]) {
  const tree = nodes(exportsObject.Sidebar({ collapsed, folders, accounts: [], activity: [] }))
  const badges = tree.filter(node => node.props.className?.split(' ').includes('nav-item__count'))
  assert.deepEqual(badges.map(node => node.props.children), collapsed ? [1, 2, 12, 99, '99+'] : [1, 2, 12, 99, 1000])
  const folder = tree.find(node => node.props['data-mailbox'] === '1000')
  assert.equal(folder.props['aria-label'], 'Papelera (1000)')
  assert.equal(folder.props.title, collapsed ? 'Papelera (1000)' : undefined)
}
console.log('Sidebar counts: hide zero, cap only collapsed badges, retain exact tooltip and accessible count')
const groupNodes = nodes(exportsObject.Sidebar({ collapsed: true, accounts: [], activity: [], folders: [
  { id: 'parent', label: 'Proyectos', icon: 'folder', hasChildren: true, count: 12 },
  { id: 'parent/child', label: 'Trabajo', icon: 'folder', parentId: 'parent', depth: 1 }
] }))
const parent = groupNodes.find(node => node.props['data-mailbox'] === 'parent')
assert.equal(parent.props['aria-expanded'], false)
assert.ok(groupNodes.some(node => node.props.className === 'nav-group__chevron'))
assert.ok(groupNodes.some(node => node.props.name === 'chevron_right' && node.props.size === 12))
assert.ok(!groupNodes.some(node => node.props['data-mailbox'] === 'parent/child'))
