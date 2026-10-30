const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const exportsObject = {}
let closing = false
let effect, status, copied, fail = false, closed = false, shown = false
const dialog = { showModal() { shown = true }, close() { closed = true } }
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/components/RecipientsDialog.tsx', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }), {
  exports: exportsObject,
  navigator: { clipboard: { async writeText(text) { if (fail) throw new Error('Denied'); copied = text } } },
  require: id => {
    if (id === 'react') return { ...React, useRef: () => ({ current: dialog }), useEffect: fn => { effect = fn }, useState: initial => typeof initial === 'boolean' ? [closing, value => { closing = value }] : [status, value => { status = value }] }
    if (id === '../i18n') return { useI18n: () => ({ t: (key, values) => values?.email ? `${key}:${values.email}` : key }) }
    if (id === './Icon') return { Icon: () => null }
    if (id === './Tooltip') return { TooltipButton: () => null }
    return require(id)
  }
})
const person = email => ({ name: '<script>', email })
const message = { to: Array.from({ length: 100 }, (_, i) => person(`user${i}@example.com`)), cc: [person('copy@example.com'), person('user0@example.com')] }
function findAll(node, predicate, result = []) {
  if (!React.isValidElement(node)) return result
  if (predicate(node)) result.push(node)
  React.Children.forEach(node.props.children, child => findAll(child, predicate, result))
  return result
}
;(async () => {
  let dismissed = false
  const tree = exportsObject.RecipientsDialog({ message, onClose() { dismissed = true } })
  const cleanup = effect(); assert.ok(shown)
  assert.equal(findAll(tree, node => node.type === 'li').length, 102, 'all To and CC recipients remain visible')
  const all = findAll(tree, node => node.props.children === 'recipients.copyAll')[0]
  all.props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(copied.split('; ').length, 101, 'copy all includes both groups without duplicates')
  assert.ok(copied.includes('copy@example.com'))
  assert.equal(status, 'copied')
  const one = findAll(tree, node => node.props.title === 'recipients.copy:user99@example.com')[0]
  one.props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(copied, 'user99@example.com')
  fail = true; one.props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(status, 'failed', 'clipboard failure is shown without closing the dialog')
  assert.ok(findAll(exportsObject.RecipientsDialog({ message, onClose() {} }), node => node.props.role === 'status')[0].props.children.includes('failed'))
  let stopped = false; tree.props.onKeyDown({ stopPropagation() { stopped = true } }); assert.ok(stopped)
  tree.props.onCancel({ preventDefault() {} })
  assert.ok(closing)
  assert.equal(dismissed, false, 'the dialog stays mounted while the exit animation runs')
  const closingTree = exportsObject.RecipientsDialog({ message, onClose() { dismissed = true } })
  assert.ok(closingTree.props.className.includes('recipients-dialog--closing'))
  closingTree.props.onAnimationEnd({ target: {}, currentTarget: dialog, animationName: 'dialog-out' })
  assert.equal(dismissed, false, 'child animation events cannot close the dialog')
  closingTree.props.onAnimationEnd({ target: dialog, currentTarget: dialog, animationName: 'dialog-in' })
  assert.equal(dismissed, false, 'entry completion cannot close the dialog')
  closingTree.props.onAnimationEnd({ target: dialog, currentTarget: dialog, animationName: 'dialog-out' })
  assert.ok(dismissed)
  cleanup(); assert.ok(closed)
  console.log('Recipients: 100+ addresses, To/CC, individual and deduplicated copy, clipboard errors, keyboard isolation and modal lifecycle passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
