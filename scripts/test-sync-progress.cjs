const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('.syncProgress()')) effect = node.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(effect)
async function check(mode) {
  let resolve, listener, unsubscribed = false
  const states = []
  const context = { setSyncProgress: value => states.push(value), window: { api: {
    syncProgress: () => new Promise(done => { resolve = done }),
    onSyncProgress: callback => { listener = callback; return () => { unsubscribed = true } }
  } } }
  const cleanup = vm.runInNewContext(ts.transpile(`(${effect})`, { target: ts.ScriptTarget.ES2022 }), context)()
  const snapshot = { cached: 12949, total: 12949, phase: 'headers' }
  if (mode === 'completed') listener(null)
  if (mode === 'newer') listener({ cached: 1, total: 10, phase: 'bodies' })
  if (mode === 'unmounted') cleanup()
  resolve(snapshot)
  await new Promise(done => setImmediate(done))
  if (mode === 'snapshot') assert.equal(states[0], snapshot)
  if (mode === 'completed') assert.deepEqual(states, [null], 'stale initial progress cannot resurrect a completed synchronization')
  if (mode === 'newer') assert.equal(states[0].phase, 'bodies', 'live progress wins over the initial snapshot')
  if (mode === 'unmounted') assert.equal(states.length, 0, 'an unmounted effect cannot update progress')
  cleanup()
  assert.ok(unsubscribed)
}
;(async () => {
  for (const mode of ['snapshot', 'completed', 'newer', 'unmounted']) await check(mode)
  console.log('Sync progress: snapshot, completion race, newer events and cleanup passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
