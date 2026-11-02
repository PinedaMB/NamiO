const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

/** Las credenciales solo se persisten si el SO ofrece cifrado real. */
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-secrets-'))
  const settings = {}
  let backend = 'basic_text'
  let available = true
  let encryptCalls = 0
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => available,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async value => { encryptCalls++; return Buffer.from(`enc:${value}`) },
    decryptStringAsync: async value => ({ result: Buffer.from(value).toString().replace(/^enc:/, ''), shouldReEncrypt: false })
  }
  const context = {
    exports: settings,
    Buffer,
    process: { platform: 'linux' },
    require: id => id === '@shared/ipc' ? require('./load-shared-ipc.cjs') : id === 'electron' ? { app: { getPath: () => directory }, safeStorage } : require(id)
  }
  vm.runInNewContext(compile(await fs.readFile('src/main/settings.ts', 'utf8')), context)

  try {
    assert.equal(await settings.encryptSecret('secret'), null, 'basic_text is not considered real encryption')
    assert.equal(encryptCalls, 0, 'nothing is encrypted with the basic_text backend')

    backend = 'gnome_libsecret'
    const encrypted = await settings.encryptSecret('secret')
    assert.equal(Buffer.from(encrypted, 'base64').toString(), 'enc:secret')
    assert.equal(encryptCalls, 1)

    backend = 'unknown'
    assert.equal(await settings.encryptSecret('secret'), null)
    assert.equal(encryptCalls, 1)

    context.process.platform = 'win32'
    available = false
    assert.equal(await settings.encryptSecret('secret'), null)
    available = true
    assert.ok(await settings.encryptSecret('secret'), 'non-Linux platforms rely on the OS backend availability')
    assert.equal(await settings.decryptSecret(Buffer.from('enc:x').toString('base64')), 'x')

    const account = { id: 'one', oauth: { provider: 'custom', clientId: 'client', clientSecret: 'client-secret', authUrl: 'https://example.test/auth', tokenUrl: 'https://example.test/token' } }
    const sealed = await settings.sealOAuthSecret(account)
    assert.equal(sealed.oauth.clientSecret, '', 'the plaintext client secret is not persisted')
    assert.ok(sealed.oauthSecret, 'the client secret is stored encrypted')
    assert.equal((await settings.revealOAuthSecret(sealed)).clientSecret, 'client-secret', 'the secret is decrypted for token refresh')

    backend = 'basic_text'
    context.process.platform = 'linux'
    const unsealed = await settings.sealOAuthSecret(account)
    assert.equal(unsealed.oauth.clientSecret, '', 'without OS encryption the secret is dropped')
    assert.equal(unsealed.oauthSecret, undefined)

    // Una cuenta guardada por una versión anterior se migra en el arranque.
    context.process.platform = 'win32'
    backend = 'gnome_libsecret'
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({
      accounts: [{
        id: 'legacy', host: 'imap.example.com', port: 993, secure: true, user: 'person@example.com',
        smtp: { host: 'smtp.example.com', port: 465, secure: true }, auth: 'oauth2',
        oauth: { provider: 'custom', clientId: 'client', clientSecret: 'legacy-secret', authUrl: 'https://example.test/auth', tokenUrl: 'https://example.test/token' }
      }]
    }))
    await settings.migrateOAuthSecrets()
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'))
    assert.equal(saved.accounts[0].oauth.clientSecret, '', 'migration removes the plaintext secret')
    assert.ok(saved.accounts[0].oauthSecret, 'migration stores the encrypted secret')
    assert.equal((await settings.revealOAuthSecret(saved.accounts[0])).clientSecret, 'legacy-secret')

    console.log('Secrets: basic_text/unknown backends never persist, OS encryption is used when available, clientSecret is sealed, revealed and migrated')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
