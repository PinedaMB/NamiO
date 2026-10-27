const fs = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
async function main() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'namio-icons-'))
  try {
    const helpers = {}
    vm.runInNewContext(ts.transpile(await fs.readFile('src/shared/mailboxes.ts', 'utf8'), { module: ts.ModuleKind.CommonJS }), { exports: helpers })
    let allowed = false
    let calls = 0
    const source = await fs.readFile('src/main/senderLogo.ts', 'utf8')
    const request = async url => {
      calls++
      assert.equal(new URL(url).hostname, 'www.google.com')
      assert.ok(!url.includes('person@'))
      let sent = false
      return { ok: true, body: { getReader: () => ({
        read: async () => { if (sent) return { done: true }; sent = true; return { done: false, value: Buffer.from('png') } }, releaseLock() {}, cancel: async () => {}
      }) } }
    }
    function load() {
      const exports = {}
      vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), {
        exports, Buffer, AbortSignal, fetch: request,
        require: id => {
          if (id === 'electron') return { app: { getPath: () => directory }, nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, resize: () => ({ toPNG: () => Buffer.from('normalized-png') }) }) } }
          if (id === '@shared/mailboxes') return helpers
          if (id === './settings') return { readSettings: async () => ({ remoteImages: allowed ? 'allow' : 'block' }) }
          if (id === './db') return { readMailboxes: () => [{ path: 'INBOX' }, { path: 'Junk', specialUse: '\\Junk' }] }
          return require(id)
        }
      })
      return exports.senderLogo
    }
    let logo = load()
    assert.equal(await logo('person@company.example', 'INBOX'), null)
    assert.equal(calls, 0)
    allowed = true
    assert.equal(await logo('person@company.example', 'Junk'), null)
    assert.equal(await logo('person@gmail.com', 'INBOX'), null)
    assert.equal(await logo('person@../../invalid', 'INBOX'), null)
    assert.equal(await logo('person@company.example', 'missing'), null)
    assert.equal(calls, 0)
    const [first, second] = await Promise.all([logo('person@company.example', 'INBOX'), logo('other@company.example', 'INBOX')])
    assert.ok(first.startsWith('data:image/png;base64,'))
    assert.equal(first, second)
    assert.equal(calls, 1, 'requests are shared by domain')
    logo = load()
    assert.equal(await logo('person@company.example', 'INBOX'), first)
    assert.equal(calls, 1, 'the disk cache avoids a request after restart')
    allowed = false
    assert.equal(await logo('person@company.example', 'INBOX'), null)
    console.log('Sender logos: privacy, Spam protection, domain validation, deduplication and persistent cache passed')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
