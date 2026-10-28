const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const expressions = {}
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['syncLabel', 'syncDetail'].includes(node.name.getText(ast))) expressions[node.name.getText(ast)] = node.initializer.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
function labels(live, sync) {
  return vm.runInNewContext(`const syncLabel = ${expressions.syncLabel}; const syncDetail = ${expressions.syncDetail}; [syncLabel, syncDetail]`, {
    live, sync, now: 2000, locale: 'es', formatElapsed: () => '1 segundo',
    t: (key, values) => values ? `${key}:${values.time}` : key
  })
}
let result = labels(true, { syncedAt: 1000, offline: false })
assert.equal(result[0], 'sidebar.synced')
assert.equal(result[1], 'sidebar.syncedAgo:1 segundo')
for (const [live, sync, expected] of [
  [false, {}, 'sidebar.demo'],
  [true, { offline: true, syncedAt: 1000 }, 'sidebar.offline'],
  [true, { offline: false, syncedAt: null }, 'sidebar.syncing']
]) {
  result = labels(live, sync)
  assert.equal(result[0], expected)
  assert.equal(result[1], expected)
}
console.log('Sync label: compact status, elapsed detail, offline, syncing and demo verified')
