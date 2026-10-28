const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-cache-usage-'))
  const exports = {}
  vm.runInNewContext(ts.transpile(await fs.readFile('src/main/db.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), {
    exports, require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
  })
  try {
    assert.equal((await exports.cacheUsage([{ id: 'default' }])).totalBytes, 0)
    for (const [file, size] of Object.entries({
      'cache.db': 100, 'cache.db-wal': 20, 'cache.db-shm': 5,
      'cache-work.db': 200, 'cache-work.db-journal': 30,
      'cache-removed.db': 40, 'settings.json': 700, 'other.db': 800
    })) await fs.writeFile(path.join(directory, file), Buffer.alloc(size))
    const result = await exports.cacheUsage([{ id: 'default' }, { id: 'work' }, { id: 'empty' }])
    assert.equal(result.totalBytes, 395)
    assert.equal(result.accounts.find(account => account.id === 'default').bytes, 125)
    assert.equal(result.accounts.find(account => account.id === 'work').bytes, 230)
    assert.equal(result.accounts.find(account => account.id === 'empty').bytes, 0)
    assert.equal(result.unassignedBytes, 40)
    assert.equal(result.accounts.reduce((sum, account) => sum + account.bytes, result.unassignedBytes), result.totalBytes)
    console.log('Cache usage: per-account sizes, total, WAL/SHM/journal, legacy default, missing files and unassigned databases passed')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
