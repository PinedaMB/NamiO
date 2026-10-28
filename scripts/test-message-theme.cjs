const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
let override = null
let preferred = 'light'
const exportsObject = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/components/ThreadPane.tsx', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }), {
  exports: exportsObject,
  require: id => {
    if (id === 'react') return { ...React, useState: () => [override, value => { override = value }], useEffect() {} }
    if (id === '../i18n') return { useI18n: () => ({ t: key => key }) }
    if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ bodyTheme: preferred }) }
    if (id === '../settings/shortcuts') return { formatCombo: () => '' }
    if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
    if (id === './EmailBody') return { EmailBody: () => null }
    if (id === './SenderAvatar') return { SenderAvatar: () => null }
    if (id === './Tooltip') return { TooltipButton: () => null }
    if (id === './Icon') return { Icon: () => null }
    return require(id)
  }
})
function render(id = 'one', mailbox = 'INBOX') {
  const message = { from: { name: 'Sender', email: 'sender@example.com' }, to: [], sentAt: '', html: '<p>Hello</p>', body: [] }
  const tree = exportsObject.ThreadPane({ thread: { id, subject: 'Hello', participants: [message.from], messages: [message] }, mailbox, bindings: {}, canMutate: true })
  let theme
  let toggle
  function visit(node) {
    if (!React.isValidElement(node)) return
    if (node.props.html) theme = node.props.theme
    if (node.props.title === 'mail.bodyThemeDark' || node.props.title === 'mail.bodyThemeLight') toggle = node.props.onClick
    React.Children.forEach(node.props.children, visit)
  }
  visit(tree)
  return { theme, toggle }
}
assert.equal(render().theme, 'light')
render().toggle()
assert.equal(render().theme, 'dark')
assert.equal(preferred, 'light', 'reader toggle cannot persist the global preference')
assert.equal(render('two').theme, 'light')
assert.equal(render('one', 'Archive').theme, 'light')
preferred = 'dark'
assert.equal(render('two').theme, 'dark')
console.log('Message theme: temporary toggle, folder/message isolation and global preference passed')
