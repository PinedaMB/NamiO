const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const ast = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const names = ['classify', 'isOfflineError', 'getMessage']
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast).replace(/^export /, '')).join('\n')
const cached = { uid: 1, subject: 'Cached mail', text: '', to: [], cc: [], attachments: [] }
let failure, fallback = cached
const context = { syncGeneration: 1, offline: false, readBody: () => ({ fetched: false }), cachedDetail: () => fallback,
  syncMeta: () => ({ offline: context.offline, syncedAt: 1 }), serial: async fn => fn(),
  fetchMessage: async () => { throw failure }, saveBody: () => { throw new Error('Offline fetch cannot save a body') } }
// Describe uses the server error message but is unrelated to classification.
context.describe = error => error.message
const api = vm.runInNewContext(ts.transpile(`${functions}; ({classify, isOfflineError, getMessage})`, { target: ts.ScriptTarget.ES2022 }), context)
;(async () => {
  for (const [code, expected] of [['ENETUNREACH', 'network'], ['EHOSTUNREACH', 'network'], ['ENETDOWN', 'network'], ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'], ['ECONNRESET', 'timeout'], ['UND_ERR_CONNECT_TIMEOUT', 'timeout'], ['UND_ERR_SOCKET', 'network']]) {
    failure = new TypeError('fetch failed', { cause: Object.assign(new Error('Connection unavailable'), { code }) })
    assert.equal(api.classify(failure), expected)
    assert.ok(api.isOfflineError(expected))
    const result = await api.getMessage('INBOX', 1)
    assert.equal(result.ok, true, 'network failures use the cached envelope instead of the generic connection error')
    assert.equal(result.data, cached); assert.equal(result.meta.partial, true); assert.equal(result.meta.offline, true)
  }
  assert.equal(api.classify(new TypeError('fetch failed')), 'network')
  for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
    failure = new TypeError('fetch failed', { cause: Object.assign(new Error('certificate error'), { code }) })
    assert.equal(api.classify(failure), 'tls')
    fallback = null
    const result = await api.getMessage('INBOX', 1)
    assert.equal(result.ok, false); assert.equal(result.code, 'tls', 'certificate errors are not reclassified as network failures')
    fallback = cached
  }
  failure = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true })
  assert.equal(api.classify(failure), 'auth'); assert.equal((await api.getMessage('INBOX', 1)).ok, false)
  assert.equal(api.classify(new Error('Unexpected parser failure')), 'unknown')
  assert.equal(api.classify(null), 'unknown')
  fallback = null; failure = new TypeError('fetch failed', { cause: { code: 'ENETUNREACH' } })
  const missing = await api.getMessage('INBOX', 1)
  assert.equal(missing.ok, false); assert.equal(missing.code, 'network', 'missing cache still reports the actual network condition')
  console.log('Offline errors: nested Fetch/OAuth network causes use cached mail; TLS/auth and unknown errors keep their classifications')
})().catch(error => { console.error(error); process.exitCode = 1 })
