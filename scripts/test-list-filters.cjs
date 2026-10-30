const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const ast = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const code = {}
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) code[node.name.text] = node.getText(ast)
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'filteredThreads') code.filteredThreads = node.initializer.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
const load = (name, context = {}) => vm.runInNewContext(ts.transpile(`${code[name]}; ${name}`, { target: ts.ScriptTarget.ES2022 }), context)
const matchesFilter = load('matchesFilter'), matchesFolder = load('matchesFolder'), sortThreads = load('sortThreads')
const rows = [
  { id: 'old', date: '2026-01-01', unread: true, vip: true, starred: true, messages: [] },
  { id: 'new', date: '2026-02-01', unread: false, vip: false, starred: false, hasAttachments: true, messages: [] },
  { id: 'middle', date: '2026-01-15', unread: true, vip: false, starred: false, messages: [{ attachments: [{}] }] }
]
const ids = values => Array.from(values, row => row.id)
assert.deepEqual(ids(sortThreads(rows, false)), ['new', 'middle', 'old'])
assert.deepEqual(ids(sortThreads(rows, true)), ['old', 'middle', 'new'])
assert.deepEqual(ids(rows), ['old', 'new', 'middle'], 'sorting must not mutate loaded data')
for (const [filter, expected] of Object.entries({ all: ['old', 'new', 'middle'], focused: ['old', 'middle'], other: ['new'], vip: ['old'], files: ['new', 'middle'], 'needs-reply': ['old'] })) {
  const filtered = rows.filter(row => matchesFilter(row, filter))
  assert.deepEqual(ids(filtered), expected, filter)
  assert.equal(sortThreads(filtered, false).length, expected.length, 'sort preserves filter membership')
}
const demo = rows.map(({ date, ...row }) => row)
assert.deepEqual(ids(sortThreads(demo, true)), ['middle', 'new', 'old'])
assert.deepEqual(ids(sortThreads([], true)), [])
assert.equal(sortThreads([{ ...rows[0], date: 'invalid' }], false).length, 1)
function visible(filter, selectedId, live = true, folder = 'inbox') {
  return vm.runInNewContext(ts.transpile(code.filteredThreads, { target: ts.ScriptTarget.ES2022 }), {
    useMemo: fn => fn(), live, listedThreads: rows, filter, folder, selectedId, matchesFilter, matchesFolder
  })
}
assert.deepEqual(ids(visible('focused', null)), ['old', 'middle'])
assert.deepEqual(ids(visible('other', null)), ['new'])
assert.deepEqual(ids(visible('focused', 'new')), ['old', 'new', 'middle'], 'open message survives mark-read to prevent selection cascades')
assert.deepEqual(ids(visible('all', null)), ids(rows))
assert.deepEqual(ids(visible('all', null, false, 'starred')), ['old'])
assert.deepEqual(ids(visible('all', null, false, 'trash')), [])
console.log('List: date ordering, immutable input, demo, all filters, attachments metadata and selected-message preservation verified')

const React = require('react')
const exportsList = {}
let menu = null, sorted, filtered
const ContextMenu = () => null
const TooltipButton = () => null
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/components/ThreadList.tsx', 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }), {
  exports: exportsList, require: id => {
    if (id === 'react') return { ...React, useEffect() {}, useRef: initial => ({ current: initial }), useState: initial => typeof initial?.has === 'function' ? [initial, () => {}] : [menu, value => { menu = value }], useCallback: fn => fn }
    if (id === './ContextMenu') return { ContextMenu }
    if (id === './Tooltip') return { TooltipButton }
    if (id === './SenderAvatar') return { SenderAvatar: () => null }
    if (id === './Icon') return { Icon: () => null }
    if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ timeFormat: '24h' }) }
    if (id === '../i18n') return { useI18n: () => ({ t: key => key, locale: 'es' }) }
    if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
    if (id === '../lib/dates') return {}
    return require(id)
  }
})
const render = live => exportsList.ThreadList({ threads: [], checkedIds: [], filter: 'all', live, showVip: !live, oldestFirst: false, onSort: value => { sorted = value }, onFilter: value => { filtered = value } })
function find(tree, predicate) {
  if (!React.isValidElement(tree)) return null
  if (predicate(tree)) return tree
  return React.Children.toArray(tree.props.children).map(child => find(child, predicate)).find(Boolean)
}
const trigger = { getBoundingClientRect: () => ({ left: 20, bottom: 30 }) }
for (const kind of ['sort', 'filter']) {
  menu = null
  find(render(true), node => node.type === TooltipButton && node.props['aria-label'] === `list.${kind}`).props.onClick({ currentTarget: trigger })
  const popup = find(render(true), node => node.type === ContextMenu)
  assert.ok(popup, `${kind} button opens its menu`)
  assert.equal(popup.props.anchor.trigger, trigger)
  if (kind === 'sort') { popup.props.actions[1].run(); assert.equal(sorted, true) }
  else {
    assert.equal(popup.props.actions.length, 3, 'live menu only offers supported filters')
    popup.props.actions[2].run(); assert.equal(filtered, 'other')
    assert.equal(find(render(false), node => node.type === ContextMenu).props.actions.length, 6)
  }
  popup.props.onClose()
  assert.equal(menu, null)
}
console.log('List menus: open, select sort/filter, close and live/demo options verified')
