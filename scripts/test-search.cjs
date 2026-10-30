const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const compile = text => ts.transpile(text, {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX})
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-search-'))
const db = {}
vm.runInNewContext(compile(fs.readFileSync('src/main/db.ts', 'utf8')), {exports: db, require: id => id === 'electron' ? {app: {getPath: () => directory}} : require(id)})
async function main() {
  try {
    db.openAccountCache('one')
    const rows = Array.from({length: 145}, (_, index) => ({uid: index + 1, subject: 'Valoración presupuesto', from: {name: 'Equipo', address: 'equipo@example.com'}, date: '2026-10-28T12:00:00Z', size: 1, unread: true, flagged: false}))
    db.upsertEnvelopes('INBOX', rows)
    db.upsertEnvelopes('Archive', [{...rows[0], uid: 900}])
    const first = db.searchMessages('valoracion', 60, 0)
    const second = db.searchMessages('valoracion', 60, 60)
    const third = db.searchMessages('valoracion', 60, 120)
    assert.ok(first[0].subjectMatch.includes('⟦Valoración⟧'), 'subject highlighting follows accent-insensitive search matches')
    assert.equal(first.length, 60); assert.equal(second.length, 60); assert.equal(third.length, 26)
    assert.equal(new Set([...first, ...second, ...third].map(hit => `${hit.mailbox}:${hit.uid}`)).size, 146)
    assert.equal(db.searchMessages('valoracion', 60, 180).length, 0)
    assert.equal(db.searchMessages('cuerpoexclusivo', 60).length, 0)
    db.saveBody('INBOX', 1, {text: 'cuerpoexclusivo', html: '', to: [], cc: [], attachments: []})
    assert.equal(db.searchMessages('cuerpoexclusivo', 60).length, 1)
    db.openAccountCache('two')
    assert.equal(db.searchMessages('valoracion', 60).length, 0)

    const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
    const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let openHit, effect
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openHit') openHit = node.initializer.arguments[0].getText(ast)
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[1]?.getText(ast).includes('searchOffset')) effect = node.arguments[0].getText(ast)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    const opened = [], marked = []
    const context = {accountGeneration: {current: 1}, folderRequest: {current: 1}, userNavigated: {current: false}, setMessageOpen() {},
      loadFolder: async (...args) => { opened.push(args) }, setIndividualMessageId: id => opened.push(id), markRead: (...args) => marked.push(args)}
    vm.runInNewContext(compile(`(${openHit})`), context)({mailbox: 'INBOX', uid: 1, unread: true})
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(opened[0], ['INBOX', 1, false], 'even old results in the current folder must be loaded explicitly')
    assert.equal(opened[1], 'live:1')
    assert.deepEqual(marked, [['INBOX', 1, 'live:1']])
    let finish
    context.loadFolder = () => new Promise(resolve => {finish = resolve})
    vm.runInNewContext(compile(`(${openHit})`), context)({mailbox: 'INBOX', uid: 2, unread: true})
    context.accountGeneration.current++
    finish()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(marked.length, 1, 'an old account result cannot mutate the new account')

    let hits = [], more, error, timer, fail = false
    const calls = []
    Object.assign(context, {query: 'valoracion', searchOffset: 0, searchRetry: 0, setHits: value => {hits = typeof value === 'function' ? value(hits) : value}, setSearching() {}, setSearchHasMore: value => {more = value}, setSearchError: value => {error = value},
      window: {setTimeout: fn => {timer = fn; return 1}, clearTimeout() {}, api: {search: async (...args) => {calls.push(args); if (fail) throw new Error('IPC'); return Array.from({length: context.searchOffset === 0 ? 61 : 8}, (_, i) => ({uid: context.searchOffset + i + 1}))}}}})
    const search = vm.runInNewContext(compile(`(${effect})`), context)
    search(); timer(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(hits.length, 60); assert.equal(more, true)
    context.searchOffset = 60
    search(); timer(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(hits.length, 68); assert.equal(more, false)
    assert.deepEqual(calls, [['valoracion', 61, 0], ['valoracion', 61, 60]])
    context.query = 'other'; context.searchOffset = 0
    const cleanup = search(); cleanup(); timer(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(hits.length, 0, 'obsolete responses cannot restore old results')
    fail = true
    search(); timer(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(error, true)

    const ipcSource = fs.readFileSync('src/main/ipc.ts', 'utf8')
    const ipcAst = ts.createSourceFile('ipc.ts', ipcSource, ts.ScriptTarget.Latest, true)
    let ipcHandler
    function findIpc(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ipcAst) === 'ipcMain.handle' && node.arguments[0]?.getText(ipcAst) === 'IPC.searchQuery') ipcHandler = node.arguments[1].getText(ipcAst)
      ts.forEachChild(node, findIpc)
    }
    findIpc(ipcAst)
    let ipcArgs
    const handleSearch = vm.runInNewContext(compile(`(${ipcHandler})`), {Error, searchMail: (...args) => {ipcArgs = args; return []}})
    handleSearch(null, 'budget', 61, 120)
    assert.deepEqual(ipcArgs, ['budget', 61, 120])
    for (const args of [['budget', NaN, 0], ['budget', 101, 0], ['budget', 60, -1], ['budget', 60, 1.5], [null, 60, 0]]) assert.throws(() => handleSearch(null, ...args), /Invalid search query/)

    const ui = {}
    vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/components/SearchResults.tsx', 'utf8')), {exports: ui, require: id => {
      if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ timeFormat: '24h' }) }
    if (id === '../i18n') return {useI18n: () => ({t: key => key, locale: 'es'})}
      if (id === '../lib/cx') return {cx: (...values) => values.filter(Boolean).join(' ')}
      if (id === './Icon') return {Icon: () => null}
      if (id === '../lib/dates') return {formatMessageDate: () => '', formatMessageDateTime: () => ''}
      return require(id)
    }})
    let loaded = false, retried = false
    function find(node, predicate) {
      if (!React.isValidElement(node)) return null
      if (predicate(node)) return node
      let found = null
      React.Children.forEach(node.props.children, child => {found ||= find(child, predicate)})
      return found
    }
    const props = {query: 'budget', hits: [], loading: false, error: false, hasMore: true, onOpen() {}, onLoadMore: () => {loaded = true}, onRetry: () => {retried = true}}
    const tree = ui.SearchResults(props)
    find(tree, node => node.type === 'button').props.onClick()
    assert.equal(loaded, true)
    assert.ok(find(tree, node => node.props.className === 'search-local-hint'))
    find(ui.SearchResults({...props, error: true}), node => node.type === 'button').props.onClick()
    assert.equal(retried, true)
    const {renderToStaticMarkup} = require('react-dom/server')
    const html = renderToStaticMarkup(ui.SearchResults({...props, hits: [{mailbox: 'INBOX', mailboxName: 'Inbox', uid: 1,
      subject: 'Valoración <script>', subjectMatch: '⟦Valoración⟧ <script>', snippet: 'Texto ⟦encontrado⟧', from: {name: 'Equipo', address: 'equipo@example.com'}, date: '', unread: true}]}))
    assert.match(html, /<mark>Valoración<\/mark>/)
    assert.match(html, /<mark>encontrado<\/mark>/)
    assert.ok(html.includes('&lt;script&gt;'), 'message subject is rendered as safe text')
    assert.ok(html.indexOf('search-hit__location') < html.indexOf('search-hit__subject'))
    assert.equal(html.includes('aria-current'), false)
    console.log('Search: stable pagination beyond 100, all cached folders, account isolation, explicit result opening, cancellation, retry and local scope passed')
  } finally {db.closeCache(); fs.rmSync(directory, {recursive: true, force: true})}
}
main().catch(error => {console.error(error); process.exitCode = 1})
