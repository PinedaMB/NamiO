const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = ts.createSourceFile('ipc.ts', fs.readFileSync('src/main/ipc.ts', 'utf8'), ts.ScriptTarget.Latest, true)
let handler
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle' && node.arguments[0]?.getText(source) === 'IPC.accountConnectOAuth') handler = node.arguments[1].getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
async function check(provider, mode = 'normal', ok = true) {
  const calls = []
  let complete
  const sender = { isDestroyed: () => mode === 'destroyed', send: (...args) => calls.push(['url', ...args]) }
  const window = { isDestroyed: () => mode === 'closed', isMinimized: () => mode === 'minimized', restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') }
  const connect = vm.runInNewContext(ts.transpile(`(${handler})`, { target: ts.ScriptTarget.ES2022 }), {
    validConfig: () => true, IPC: { oauthUrl: 'oauth:url' }, processOutbox: () => calls.push('outbox'),
    BrowserWindow: { fromWebContents: contents => { assert.equal(contents, sender); return window } },
    connectAccountOAuth: async (_config, onUrl) => { onUrl('https://accounts.google.com/test'); return new Promise(resolve => { complete = resolve }) }
  })
  const pending = connect({ sender }, { host: 'imap.example.test', user: 'test@example.test', smtp: { host: 'smtp.example.test' }, oauth: { provider, clientId: 'test' } })
  assert.ok(!calls.includes('focus'), 'opening the browser must not immediately steal its focus')
  const result = { ok }
  complete(result)
  assert.equal(await pending, result)
  const shouldFocus = provider === 'google' && !['destroyed', 'closed'].includes(mode)
  assert.equal(calls.includes('focus'), shouldFocus)
  assert.equal(calls.includes('show'), shouldFocus)
  assert.equal(calls.includes('restore'), shouldFocus && mode === 'minimized')
  assert.equal(calls.includes('outbox'), ok)
  if (shouldFocus) assert.ok(calls.indexOf('show') < calls.indexOf('focus'))
}
;(async () => {
  for (const mode of ['normal', 'minimized', 'closed', 'destroyed']) await check('google', mode)
  await check('google', 'minimized', false)
  await check('microsoft')
  console.log('Google sign-in: delayed foreground return, restore, errors, closed windows and provider isolation passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
