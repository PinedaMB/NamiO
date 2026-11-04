const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = fs.readFileSync('src/renderer/src/components/Settings.tsx', 'utf8')
function settings(accounts, events, section = 'accounts', notifications = true) {
  let stateIndex = 0
  const exports = {}
  const requireMock = id => {
    if (id.endsWith('.png')) return { default: '/image.png' }
    if (id === 'react') return { ...React, useEffect: () => {}, useRef: () => ({ current: null }), useMemo: fn => fn(), useState: initial => [stateIndex++ === 0 ? section : initial, () => {}] }
    if (id === '../lib/useAnimatedClose') return {useAnimatedClose: onClose => ({closing: false, close: (action = onClose) => action()})}
    if (id === '../i18n') return { LOCALES: [], useI18n: () => ({ t: key => key, locale: 'es' }) }
    if (id === '../settings/ShortcutsProvider') return { useShortcuts: () => ({ bindings: {} }), useFormatCombo: () => combo => combo }
    if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ appTheme: 'system', setAppTheme: theme => events.push(theme), offlineDownload: false, setOfflineDownload: enabled => events.push(enabled), timeFormat: '24h', setTimeFormat: format => events.push(format), notificationPreferences: { notifications, notificationSound: true, notificationPrivate: true, keepInBackground: false } }) }
    if (id === '../settings/shortcuts') return { SHORTCUTS: [], SHORTCUT_GROUPS: [] }
    if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
    if (id === '../lib/useFocusTrap') return { useFocusTrap() {} }
 if(id==='./CopilotSettings')return{CopilotSettings:()=>null}
    if (id === './Icon') return { Icon: () => null }
    if (id === './Tooltip') return { TooltipButton: props => React.createElement('button', props) }
    if (id === './UpdateNotice') return { UpdateNotice: () => null }
    if (id === './SignatureSection') return { SignatureSection: () => null }
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
const notificationHtml = renderToStaticMarkup(settings(accounts, [], 'notifications'))
const readingHtml = renderToStaticMarkup(settings(accounts, [], 'reading'))
assert.ok(notificationHtml.includes('settings.notifications.title'))
assert.equal((generalHtml.match(/role="switch"/g) || []).length, 1)
assert.equal((notificationHtml.match(/role="switch"/g) || []).length, 3)
assert.equal((readingHtml.match(/role="switch"/g) || []).length, 1)
assert.ok(notificationHtml.includes('settings.notifications.test'))
assert.ok(!generalHtml.includes('settings-notifications-title'))
assert.ok(!notificationHtml.includes('notification-keepInBackground'))
const generalSections = [...generalHtml.matchAll(/<section class="settings-card" aria-labelledby="([^"]+)"/g)].map(match => match[1])
assert.deepEqual(generalSections, ['settings-theme-title', 'settings-language-title', 'settings-time-title', 'settings-background-title'])
assert.ok(!generalHtml.includes('settings.general.diagnostics'))
assert.ok(aboutHtml.includes('settings.general.diagnostics'))
assert.ok(aboutHtml.includes('settings-updates-title'))
assert.ok(aboutHtml.includes('<details class="settings-card settings-about__details">'), 'support details remain available without permanent technical clutter')
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

const offlineEvents = []
function checkOfflineSwitch(node) {
  if (!React.isValidElement(node)) return
  if (node.type === 'button' && node.props['aria-labelledby'] === 'settings-offline-title') {
    assert.equal(node.props['aria-checked'],false)
    assert.equal(node.props['aria-describedby'],'settings-offline-hint')
    node.props.onClick()
  }
  React.Children.forEach(node.props.children, checkOfflineSwitch)
}
checkOfflineSwitch(settings(accounts, offlineEvents, 'reading'))
assert.deepEqual(offlineEvents,[true],'offline switch explicitly enables background downloads')

const themeEvents = []
function checkThemeButtons(node) {
  if (!React.isValidElement(node)) return
  if (node.type === 'button' && React.Children.toArray(node.props.children).some(child => typeof child === 'string' && /^settings.theme.(light|dark|system)$/.test(child))) {
    const label=React.Children.toArray(node.props.children).find(child=>typeof child==='string')
    assert.equal(node.props['aria-pressed'],label==='settings.theme.system')
    node.props.onClick()
  }
  React.Children.forEach(node.props.children,checkThemeButtons)
}
checkThemeButtons(settings(accounts,themeEvents,'general'))
assert.deepEqual(themeEvents,['light','dark','system'])

for (const enabled of [true, false]) {
  const switches = []
  function inspect(node) {
    if (!React.isValidElement(node)) return
    if (node.props.role === 'switch') switches.push(node)
    React.Children.forEach(node.props.children, inspect)
  }
  inspect(settings(accounts, [], 'notifications', enabled))
  for (const key of ['notificationSound', 'notificationPrivate']) {
    const control = switches.find(node => node.props['aria-labelledby'] === `notification-${key}`)
    assert.equal(control.props.disabled, !enabled, `${key} depends on automatic notifications`)
    assert.equal(control.props['aria-checked'], true, 'disabling alerts preserves the dependent preference')
  }
  assert.equal(switches.some(node => node.props['aria-labelledby'] === 'notification-keepInBackground'), false, 'background mode belongs to General')
}
assert.ok(!generalHtml.includes('settings.nav.copilot'))
assert.ok(html.includes('settings.cache.hint'), 'cache measurement scope is visible')

assert.ok(readingHtml.includes('settings-reading-title'))
assert.ok(readingHtml.includes('settings-offline-title'))
assert.ok(!generalHtml.includes('settings-reading-title'))
function signatureSections(node) {
  if (!React.isValidElement(node)) return 0
  return (node.type.name === 'SignatureSection' ? 1 : 0) + React.Children.toArray(node.props.children).reduce((sum, child) => sum + signatureSections(child), 0)
}
assert.equal(signatureSections(settings(accounts, [], 'accounts')), 1, 'active account owns the signature editor')
assert.equal(signatureSections(settings(accounts, [], 'general')), 0)
assert.equal(signatureSections(settings([], [], 'accounts')), 0, 'no signature setting without a real account')
