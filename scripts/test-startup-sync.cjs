const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')

const source = ts.createSourceFile('index.ts', fs.readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
let callback
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'app.whenReady().then') callback = node.arguments[0].getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(callback)

async function check(configured, migrationFails = false) {
  const calls = []
  let release
  const migration = new Promise(resolve => { release = resolve })
  const noop = () => {}
  const context = {
    readSettings: async () => ({}), nativeTheme: { on: noop }, mainWindow: null,
    app: { setAppUserModelId: noop, on: noop }, hardenSession: noop, setupAutoUpdate: noop,
    migrateOAuthSecrets: async () => { await migration; if (migrationFails) throw new Error('Wallet unavailable') },
    readActiveAccount: async () => configured ? { id: 'saved-account' } : null,
    initCache: id => calls.push(`cache:${id}`),
    registerIpcHandlers: () => calls.push('handlers'),
    setNewMailListener: noop, setCacheListener: noop, setSyncProgressListener: noop,
    setRulesListener: noop, setOutboxListener: noop, setInterval: noop, setTimeout: noop,
    createWindow: () => calls.push('window'), syncInbox: async () => calls.push('sync')
  }
  const start = vm.runInNewContext(ts.transpile(`(${callback})`, { target: ts.ScriptTarget.ES2022 }), context)
  const pending = start()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [], 'no window or request handlers can use an uninitialized account cache')
  release()
  await pending
  assert.deepEqual(calls, [`cache:${configured ? 'saved-account' : 'default'}`, 'handlers', 'window', ...(configured ? ['sync'] : [])])
}

;(async () => {
  await check(true)
  await check(false)
  await check(true, true)
  console.log('Startup: account cache ready before UI, immediate automatic sync, no-account startup and unavailable secret migration passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
