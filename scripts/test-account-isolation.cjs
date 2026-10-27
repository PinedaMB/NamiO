const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, name, context) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let code
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      code = node.getText(source).replace(/^export /, '')
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      code = `const ${name} = ${node.initializer.getText(source)}`
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(code, `${name} exists`)
  return vm.runInNewContext(ts.transpile(`${code}; ${name}`, { target: ts.ScriptTarget.ES2022 }), context)
}

async function main() {
  let accounts = []
  const accountIdFor = load('src/main/imap.ts', 'accountIdFor', {
    createHash, readAccounts: async () => ({ accounts })
  })
  const first = await accountIdFor('outlook.office365.com', 993, 'a@example.com')
  const second = await accountIdFor('outlook.office365.com', 993, 'b@example.com')
  assert.notEqual(first, second, 'different users cannot reuse a disconnected account cache')
  assert.notEqual(first, 'default')
  assert.equal(await accountIdFor('outlook.office365.com', 993, 'a@example.com'), first)
  accounts = [{ host: 'old.example.com', port: 993, user: 'legacy', id: 'default' }]
  assert.equal(await accountIdFor('old.example.com', 993, 'legacy'), 'default')

  const state = { threads: ['old mail'], selectedId: 'live:1', hits: ['old result'] }
  const context = {
    folder: 'inbox', folderRequest: { current: 0 }, activeFolderRef: { current: 'inbox' }, locale: 'es', listLimit: 50, useCallback: fn => fn, accountIdentity: { current: 'previous' }, accountGeneration: { current: 0 }
  }
  for (const name of ['Threads', 'SelectedId', 'IndividualMessageId', 'LocalDrafts', 'Mailboxes', 'Query', 'Hits', 'Searching', 'LoadingFolder', 'Folder', 'LiveError', 'Sync', 'SyncProgress', 'Outbox', 'Account']) {
    context[`set${name}`] = value => { state[name[0].toLowerCase() + name.slice(1)] = value }
  }
  const applyAccount = load('src/renderer/src/App.tsx', 'applyAccount', context)
  const account = { configured: true, account: { host: 'mail.example.com', port: 993, user: 'new@example.com' } }
  applyAccount(account)
  assert.equal(state.threads.length, 0)
  assert.equal(state.selectedId, null)
  assert.equal(state.individualMessageId, null)
  assert.equal(state.hits.length, 0)
  assert.equal(context.accountGeneration.current, 1)
  applyAccount(account)
  assert.equal(context.accountGeneration.current, 1, 'refreshing the same account preserves its generation')

  let finish
  context.window = { api: { listMailboxes: () => new Promise(resolve => { finish = resolve }) } }
  const refresh = load('src/renderer/src/App.tsx', 'refreshFromCache', context)
  const pending = refresh()
  applyAccount({ ...account, account: { ...account.account, user: 'other@example.com' } })
  finish({ ok: true, data: ['old folders'] })
  await pending
  assert.equal(state.mailboxes.length, 0, 'a stale cache response cannot repopulate the new account')
  let finishMessages
  context.window.api = {
    listMailboxes: async () => ({ ok: true, data: [] }),
    listEnvelopes: () => new Promise(resolve => { finishMessages = resolve })
  }
  const messages = refresh()
  await new Promise(resolve => setImmediate(resolve))
  applyAccount(account)
  finishMessages({ ok: true, data: ['old message with reused UID'] })
  await messages
  assert.equal(state.threads.length, 0, 'old messages cannot repopulate a new account')
  let finishFolder
  context.window.api.listMailboxes = () => new Promise(resolve => { finishFolder = resolve })
  const oldFolder = refresh()
  context.folderRequest.current++
  context.activeFolderRef.current = 'Archive'
  finishFolder({ ok: true, data: ['Spam'] })
  await oldFolder
  assert.equal(state.mailboxes.length, 0, 'late responses from another folder are discarded')
  console.log('Account and folder isolation checks passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
