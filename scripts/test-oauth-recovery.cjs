const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')

async function main() {
  const oauth = {}, requests = []
  let now = 0, offline = false
  vm.runInNewContext(ts.transpile(fs.readFileSync('src/main/oauth.ts', 'utf8'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }), {
    exports: oauth, Buffer, URLSearchParams, Date: { now: () => now },
    require: id => {
      if (id === 'electron') return { shell: {} }
      if (id === '@shared/oauth') return { GOOGLE_CLIENT_ID: 'managed-google' }
      if (id === './googleOAuth') return { GOOGLE_CLIENT_SECRET: 'test-desktop-secret' }
      return require(id)
    },
    fetch: async (_url, options) => {
      requests.push(new URLSearchParams(options.body))
      if (offline) throw new Error('Network offline')
      return { ok: true, json: async () => ({ access_token: `access-${requests.length}`, refresh_token: 'rotated', expires_in: 3600 }) }
    }
  })
  const config = { provider: 'microsoft', clientId: 'test-client' }
  const first = await oauth.getAccessToken(config, 'original')
  assert.equal(first.refreshToken, 'rotated')
  assert.equal(requests[0].get('grant_type'), 'refresh_token')
  assert.equal(requests[0].get('refresh_token'), 'original')
  assert.equal((await oauth.getAccessToken(config, 'original')).accessToken, first.accessToken)
  assert.equal(requests.length, 1, 'an unexpired access token is reused')
  now = first.expiresAt
  offline = true
  await assert.rejects(oauth.getAccessToken(config, 'original'), /Network offline/)
  offline = false
  const renewed = await oauth.getAccessToken(config, 'original')
  assert.notEqual(renewed.accessToken, first.accessToken, 'refresh recovers after a network failure')
  await oauth.getAccessToken(config, 'rotated')
  assert.equal(requests.at(-1).get('refresh_token'), 'rotated')

  await oauth.refresh({ provider: 'google', clientId: 'managed-google', clientSecret: '' }, 'gmail-refresh')
  assert.equal(requests.at(-1).get('client_secret'), 'test-desktop-secret', 'the built-in Google client supplies its desktop credential')
  await oauth.refresh({ provider: 'google', clientId: 'own-client', clientSecret: 'own-secret' }, 'gmail-refresh')
  assert.equal(requests.at(-1).get('client_secret'), 'own-secret', 'existing custom Google registrations keep their credentials')
  await oauth.refresh({ provider: 'google', clientId: 'own-client', clientSecret: '' }, 'gmail-refresh')
  assert.equal(requests.at(-1).has('client_secret'), false, 'another client cannot receive the built-in credential')
  await oauth.refresh({ provider: 'custom', clientId: 'managed-google', clientSecret: '', tokenUrl: 'https://example.test/token' }, 'custom-refresh')
  assert.equal(requests.at(-1).has('client_secret'), false, 'custom endpoints cannot receive the built-in credential')

  const source = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  const auth = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'authFor')
  const updates = []
  const authFor = vm.runInNewContext(ts.transpile(`(${auth.getText(source)})`, { target: ts.ScriptTarget.ES2022 }), {
    decryptSecret: async () => 'original', getAccessToken: async () => renewed,
    encryptSecret: async token => `encrypted:${token}`,
    updateAccount: async (id, patch) => updates.push({ id, ...patch })
  })
  assert.equal((await authFor({ id: 'owner', auth: 'oauth2', oauth: config, refreshToken: 'encrypted-original' })).accessToken, renewed.accessToken)
  assert.deepEqual(updates, [{ id: 'owner', refreshToken: 'encrypted:rotated' }], 'rotated credentials are encrypted and saved to their owning account')
  console.log('OAuth recovery: expiry, offline retry, token reuse and encrypted refresh-token rotation passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
