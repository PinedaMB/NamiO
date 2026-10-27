const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const source = fs.readFileSync('src/main/ipc.ts', 'utf8')
const ast = ts.createSourceFile('ipc.ts', source, ts.ScriptTarget.Latest, true)
let handler
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.accountRename') handler = node.arguments[1].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
async function main() {
  let stored = { id: 'one', user: 'user@example.com', secret: 'encrypted', refreshToken: 'token' }
  const rename = vm.runInNewContext(ts.transpile(`(${handler})`, { target: ts.ScriptTarget.ES2022 }), {
    readActiveAccount: async () => stored,
    updateAccount: async (id, patch) => { assert.equal(id, stored.id); stored = { ...stored, ...patch } },
    getAccountState: async () => ({ account: stored })
  })
  assert.equal((await rename(null, '  Trabajo  ')).ok, true)
  assert.equal(stored.label, 'Trabajo')
  assert.equal(stored.user, 'user@example.com')
  assert.equal(stored.secret, 'encrypted')
  assert.equal(stored.refreshToken, 'token')
  assert.equal((await rename(null, 'x'.repeat(81))).ok, false)
  assert.equal((await rename(null, 123)).ok, false)
  assert.equal(stored.label, 'Trabajo')
  assert.equal((await rename(null, '')).ok, true)
  assert.equal(stored.label, '')
  stored = null
  assert.equal((await rename(null, 'Work')).ok, false)
  console.log('Account name: validation, trimming, clearing and credential preservation passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
