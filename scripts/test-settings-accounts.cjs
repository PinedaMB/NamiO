const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = fs.readFileSync('src/renderer/src/components/Settings.tsx', 'utf8')
function settings(accounts, events, section = 'accounts') {
  let stateIndex = 0
  const exports = {}
  const requireMock = id => {
    if (id.endsWith('.png')) return { default: '/image.png' }
    if (id === 'react') return { ...React, useEffect: () => {}, useRef: () => ({ current: null }), useMemo: fn => fn(), useState: initial => [stateIndex++ === 0 ? section : initial, () => {}] }
    if (id === '../i18n') return { LOCALES: [], useI18n: () => ({ t: key => key, locale: 'es' }) }
    if (id === '../settings/ShortcutsProvider') return { useShortcuts: () => ({ bindings: {} }), useFormatCombo: () => combo => combo }
    if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ timeFormat: '24h', setTimeFormat: format => events.push(format), notificationPreferences: { notifications: true, notificationSound: true, notificationPrivate: true, keepInBackground: false } }) }
    if (id === '../settings/shortcuts') return { SHORTCUTS: [], SHORTCUT_GROUPS: [] }
    if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
    if (id === './Icon') return { Icon: () => null }
    if (id === './Tooltip') return { TooltipButton: props => React.createElement('button', props) }
    if (id === './UpdateNotice') return { UpdateNotice: () => null }
    if (id === './RulesSection') return { RulesSection: () => null }
    return require(id)
  }
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }), { exports, require: requireMock, window: { api: { openExternal: url => events.push(url) } } })
  return exports.Settings({ accounts, onBack() {}, onAddAccount: () => events.push('add'), onManageAccount: () => events.push('manage'), onSelectAccount: id => events.push(id) })
}
const accounts = [
  { id: 'one', label: 'Personal', user: 'personal@example.com', host: 'imap.example.com', port: 993, auth: 'oauth2', active: true },
  { id: 'two', label: 'Work', user: 'work@example.com', host: 'imap.work.com', port: 993, auth: 'password', active: false }
]
const events = []
const tree = settings(accounts, events)
const html = renderToStaticMarkup(tree)
assert.ok(html.includes('personal@example.com'))
assert.ok(html.includes('work@example.com'))
assert.ok(html.includes('settings.accounts.active'))
assert.ok(!html.includes('settings.accounts.empty'))
assert.ok(!html.includes('Alex Rivera'))
function visit(node) {
  if (!React.isValidElement(node)) return
  if (node.type === 'button') {
    const children = React.Children.toArray(node.props.children)
    if (children.includes('account.add') || children.includes('account.manage') || children.includes('settings.accounts.select')) node.props.onClick()
  }
  React.Children.forEach(node.props.children, visit)
}
visit(tree)
assert.deepEqual(events, ['add', 'manage', 'two'])
const empty = renderToStaticMarkup(settings([], []))
assert.ok(empty.includes('settings.accounts.empty'))
assert.ok(empty.includes('account.add'))
assert.ok(!empty.includes('Alex Rivera'))
console.log('Settings accounts: saved accounts, active profile, empty state and actions passed')

const aboutEvents = []
const about = settings(accounts, aboutEvents, 'about')
const aboutHtml = renderToStaticMarkup(about)
assert.ok(aboutHtml.includes('NamiO'))
assert.ok(aboutHtml.includes('PinedaMB'))
assert.ok(aboutHtml.includes('MIT'))
function inspectAbout(node) {
  if (!React.isValidElement(node)) return
  if (node.type === 'button' && React.Children.toArray(node.props.children).some(child => child === 'settings.about.repository' || child === 'settings.about.report')) node.props.onClick()
  React.Children.forEach(node.props.children, inspectAbout)
}
inspectAbout(about)
assert.deepEqual(aboutEvents, ['https://github.com/PinedaMB/NamiO', 'https://github.com/PinedaMB/NamiO/issues'])
console.log('About: project identity, license and external project/support actions passed')

const generalHtml = renderToStaticMarkup(settings(accounts, [], 'general'))
assert.ok(generalHtml.includes('settings.notifications.title'))
assert.equal((generalHtml.match(/role="switch"/g) || []).length, 4)
assert.ok(generalHtml.includes('settings.notifications.test'))
const generalSections = [...generalHtml.matchAll(/<section class="settings-card" aria-labelledby="([^"]+)"/g)].map(match => match[1])
assert.deepEqual(generalSections, ['settings-language-title', 'settings-time-title', 'settings-reading-title', 'settings-notifications-title'])
assert.ok(!generalHtml.includes('settings.general.diagnostics'))
assert.ok(aboutHtml.includes('settings.general.diagnostics'))
assert.ok(aboutHtml.includes('settings-updates-title'))
assert.ok(!generalHtml.includes('settings-updates-title'))
console.log('Notification settings: labeled preferences and test action render')

const timeEvents = []
function checkTimeButtons(node) {
  if (!React.isValidElement(node)) return
  if (node.type === 'button' && ['settings.time.12h', 'settings.time.24h'].includes(node.props.children)) {
    assert.equal(node.props['aria-pressed'], node.props.children === 'settings.time.24h')
    node.props.onClick()
  }
  React.Children.forEach(node.props.children, checkTimeButtons)
}
checkTimeButtons(settings(accounts, timeEvents, 'general'))
assert.deepEqual(timeEvents, ['12h', '24h'], 'time format buttons save both supported choices')
