const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let code
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'toggleRead') code = node.initializer.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
async function check(unread, failure, switchAccount = false) {
  let rows = [{ id: 'live:7', unread }]
  const calls = [], notices = []
  const context = {
    selected: rows[0], live: true, folder: 'INBOX', togglingRead: { current: false },
    accountGeneration: { current: 1 }, folderRequest: { current: 2 },
    uidOf: () => 7, setThreads: update => { rows = update(rows) }, setToast: text => notices.push(text),
    t: key => key, Error,
    window: { api: { setSeen: async (...args) => {
      calls.push(args)
      if (switchAccount) context.accountGeneration.current++
      if (failure === 'reject') throw new Error('IPC failed')
      return failure ? { ok: false, detail: 'Denied' } : { ok: true }
    } } }
  }
  const toggle = vm.runInNewContext(ts.transpile(`(${code})`, { target: ts.ScriptTarget.ES2022 }), context)
  const pending = toggle()
  await toggle() // Ignore repeated clicks while the request is pending.
  await pending
  assert.deepEqual(calls, [['INBOX', 7, unread]])
  assert.equal(rows[0].unread, failure || switchAccount ? unread : !unread)
  assert.equal(context.togglingRead.current, false)
  if (switchAccount) assert.deepEqual(notices, [])
  else assert.deepEqual(notices, [failure ? 'toast.actionFailed' : unread ? 'toast.markedRead' : 'toast.markedUnread'])
}
;(async () => {
  for (const unread of [true, false]) {
    await check(unread)
    await check(unread, 'result')
    await check(unread, 'reject')
    await check(unread, false, true)
  }
  console.log('Read toggle: server polarity, notices, repeated clicks, failures and account isolation passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
