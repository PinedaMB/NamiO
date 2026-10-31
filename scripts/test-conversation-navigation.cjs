const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions = {}, variables = {}
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions[node.name.text] = node.getText(ast)
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) variables[node.name.text] = node.initializer?.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })

const uidOf = id => id.startsWith('live:') && Number.isInteger(Number(id.slice(5))) ? Number(id.slice(5)) : null
const api = vm.runInNewContext(compile(`${functions.conversationKey};${functions.collapseConversations};${functions.threadMatchesId};({conversationKey,collapseConversations,threadMatchesId})`), { uidOf })

const conversation = (uid, ids) => ({ id: `live:${uid}`, messageIds: ids, unread: true })
const rows = [conversation(3, [1, 2, 3]), conversation(2, [1, 2, 3]), conversation(1, [1, 2, 3]), conversation(4, [4])]
const collapsed = api.collapseConversations(rows)
assert.deepEqual(Array.from(collapsed, thread => thread.id), ['live:3', 'live:4'], 'one row per conversation, newest first')
assert.equal(api.threadMatchesId(collapsed[0], 'live:2'), true, 'a member id resolves to its conversation')
assert.equal(api.threadMatchesId(collapsed[0], 'live:4'), false)

function stepFrom(id, delta) {
  let selectedId
  const step = vm.runInNewContext(compile(`(${variables.step})`), {
    visible: collapsed,
    selected: { id },
    threadMatchesId: api.threadMatchesId,
    select: next => { selectedId = next }
  })
  step(delta)
  return selectedId
}
assert.equal(stepFrom('live:2', 1), 'live:4', 'next goes to the next conversation, not a hidden member')
assert.equal(stepFrom('live:4', -1), 'live:3', 'previous returns to the previous conversation')
assert.equal(stepFrom('live:3', -1), 'live:4', 'previous wraps around conversations')

const uidsInThread = vm.runInNewContext(compile(`(${variables.uidsInThread})`), { uidOf })
assert.deepEqual(Array.from(uidsInThread({ id: 'live:3', messageIds: [1, 2, 3] })), [1, 2, 3], 'bulk actions expand the whole conversation')
assert.deepEqual(Array.from(uidsInThread({ id: 'live:9' })), [9])
assert.deepEqual(Array.from(uidsInThread({ id: 'draft:9' })), [])

console.log('Conversation navigation: visible deduplicates by thread, member ids resolve, j/k moves by conversation and bulk actions expand members')
