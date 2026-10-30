const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const source = fs.readFileSync('src/renderer/src/components/ThreadList.tsx', 'utf8')
const ast = ts.createSourceFile('ThreadList.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('arrivalBaseline')) effect = node.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
let arrivals = new Set()
const context = { allThreads: [], arrivalKey: 'one:INBOX:all:newest:50', live: true, loading: false,
  arrivalBaseline: { current: { key: 'one:INBOX:all:newest:50', uid: null } }, setArrivals: update => { arrivals = typeof update === 'function' ? update(arrivals) : update } }
const update = vm.runInNewContext(ts.transpile(`(${effect})`, { target: ts.ScriptTarget.ES2022 }), context)
const mail = uid => ({ id: `live:${uid}` })
context.loading = true; context.allThreads = [mail(100)]; update()
assert.equal(context.arrivalBaseline.current.uid, null)
context.loading = false; update(); assert.equal(arrivals.size, 0, 'first folder load does not animate')
context.allThreads = [mail(101), mail(100)]; update(); assert.ok(arrivals.has('live:101'))
context.allThreads = [mail(102), ...context.allThreads]; update(); assert.ok(arrivals.has('live:101') && arrivals.has('live:102'), 'overlapping arrivals are preserved')
context.allThreads = [...context.allThreads, mail(1)]; update(); assert.equal(arrivals.has('live:1'), false, 'older cached messages do not animate')
context.arrivalKey = 'one:INBOX:read:newest:50'; context.allThreads = [mail(200)]; update(); assert.equal(arrivals.size, 0, 'changing filters resets the baseline')
context.arrivalKey = 'one:INBOX:all:oldest:150'; context.allThreads = [mail(300)]; update(); assert.equal(arrivals.size, 0, 'pagination/order changes do not animate old mail')
context.arrivalKey = 'two:INBOX:all:newest:50'; context.allThreads = [mail(500)]; update(); assert.equal(arrivals.size, 0, 'switching accounts does not animate the mailbox')
context.allThreads = [mail(501), mail(500)]; update(); assert.ok(arrivals.has('live:501'))
context.live = false; update(); assert.equal(arrivals.size, 0, 'demo mail is not treated as incoming mail')
context.live = true; context.allThreads = []; update(); context.allThreads = [mail(1)]; update(); assert.ok(arrivals.has('live:1'), 'first arrival in a loaded empty inbox animates')

const out = {}
vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }), { exports: out, require: id => {
  if (id === 'react') return { ...React, useEffect() {}, useRef: value => ({ current: value }), useCallback: fn => fn, useState: value => typeof value?.has === 'function' ? [new Set(['live:2']), update => { arrivals = update(new Set(['live:2'])) }] : [null, () => {}] }
  if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ timeFormat: '24h' }) }
  if (id === '../i18n') return { useI18n: () => ({ t: key => key, locale: 'es' }) }
  if (id === '../lib/cx') return { cx: (...values) => values.filter(Boolean).join(' ') }
  if (id === '../lib/dates') return { formatMessageDate: () => '', formatMessageDateTime: () => '' }
  if (id === 'react/jsx-runtime') return require(id)
  return { Icon: () => null, SenderAvatar: () => null, TooltipButton: () => null, ContextMenu: () => null }
} })
const base = { subject: 'Conversation', participants: [], messages: [], tags: [], preview: '', unread: true, messageCount: 2, messageIds: [1, 2] }
const threads = [{ ...base, id: 'live:1' }, { ...base, id: 'live:2' }]
arrivals = new Set(['live:2'])
const tree = out.ThreadList({ threads, allThreads: threads, mailbox: 'INBOX', checkedIds: [], filter: 'all', live: true })
let row
function find(node) { if (!React.isValidElement(node)) return; if (node.type === 'article') row = node; React.Children.forEach(node.props.children, find) }
find(tree)
assert.ok(row.props.className.includes('thread--arriving'), 'new reply highlights its existing conversation')
row.props.onAnimationEnd({ target: tree, currentTarget: row, animationName: 'mail-arrival' }); assert.ok(arrivals.has('live:2'), 'nested animation events do not clear arrival state')
row.props.onAnimationEnd({ target: row, currentTarget: row, animationName: 'mail-arrival' }); assert.equal(arrivals.size, 0)
console.log('Mail arrival animation: initial/empty load, new mail, replies, pagination, filters, sorting, account isolation and animation cleanup passed')
