const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
async function main() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'namio-settings-'))
  try {
    const exports = {}
    const source = await fs.readFile('src/main/settings.ts', 'utf8')
    vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), {
      exports, require: name => name === 'electron' ? { app: { getPath: () => dir }, safeStorage: {} } : require(name)
    })
    const account = { id: 'one', host: 'mail.example.com', user: 'a@example.com', port: 993, secret: 'encrypted', label: 'Original' }
    await exports.saveAccount(account)
    await Promise.all([
      exports.updateAccount('one', { label: 'Trabajo' }),
      exports.updateAccount('one', { refreshToken: 'rotated-token' }),
      exports.writeSettings({ onboarded: true }),
      exports.writeSettings({ contextPanel: false })
    ])
    const saved = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf8'))
    assert.equal(saved.accounts[0].label, 'Trabajo')
    assert.equal(saved.accounts[0].secret, 'encrypted')
    assert.equal(saved.accounts[0].refreshToken, 'rotated-token')
    assert.equal(saved.onboarded, true)
    assert.equal(saved.contextPanel, false)
    await exports.saveAccount({ ...saved.accounts[0], label: undefined })
    assert.equal((await exports.readAccounts()).accounts[0].label, 'Trabajo')
    await exports.updateAccount('deleted', { refreshToken: 'ignored' })
    assert.equal((await exports.readAccounts()).accounts.length, 1)
    console.log('Settings persistence: concurrent name/token/preferences and reconnect preserve the account name')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
