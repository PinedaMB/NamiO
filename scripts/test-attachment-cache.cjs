const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript-test')
const helpers = require('./imap-test-helpers.cjs')
const compile = source => ts.transpile(source, {target: ts.ScriptTarget.ES2022})
const ast = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node.getText(ast).replace(/^export /, '')]))
async function main() {
  const block = Buffer.allocUnsafe(25 * 1024 * 1024)
  const entry = {name: 'test.pdf', type: 'application/pdf', content: block}
  for (const key of ['a', 'b', 'c', 'd']) helpers.cacheAttachment(key, entry)
  helpers.cachedAttachment('a')
  helpers.cacheAttachment('e', entry)
  assert.equal(helpers.cachedAttachment('b'), undefined, 'the oldest file is evicted to keep the cache within 100 MB')
  assert.ok(helpers.cachedAttachment('a'), 'opening a file refreshes its recency')
  helpers.clearAttachmentCache()
  assert.equal(helpers.cachedAttachment('a'), undefined)
  for (let i = 0; i < 65; i++) helpers.cacheAttachment(String(i), {...entry, content: Buffer.alloc(0)})
  assert.equal(helpers.cachedAttachment('0'), undefined, 'empty files cannot create an unbounded metadata cache')
  helpers.clearAttachmentCache()
  const downloads = [], phases = []
  let owner = 'one', validity = 1, structureRequests = 0, network = true, release
  const context = {...helpers, Buffer, syncGeneration: 1, MAX_ATTACHMENT_BYTES: 25 * 1024 * 1024,
    cacheAccountId: () => owner, getMailboxMeta: () => ({uidValidity: validity}), readEnvelope: () => ({uid: 1}),
    readBody: () => ({attachments: []}), accountChangedError: () => new Error('Account changed'), serial: fn => fn(),
    ensureClient: async () => {
      if (!network) throw new Error('Offline')
      return {mailbox: {uidValidity: 1n}, getMailboxLock: async () => ({release() {}}),
        fetchOne: async () => {structureRequests++; return {uid: 1, bodyStructure: {type: 'multipart/mixed', childNodes: [
          {type: 'text/plain', part: '1'}, {type: 'application/pdf', part: '2', size: 3, dispositionParameters: {filename: 'report.pdf'}}
        ]}}},
        download: async (_uid, part) => {downloads.push(part); return {content: (async function* () {
          if (release !== undefined) await new Promise(resolve => {release = resolve})
          yield Buffer.from('PDF')
        })()}}
      }
    }
  }
  const read = vm.runInNewContext(compile(`const operations=[];let operationRunning=false;${functions.get('serial')};${functions.get('readLimited')}; (${functions.get('readAttachment')})`), context)
  const first = await read('INBOX', 1, 0, phase => phases.push(phase))
  assert.equal(first.name, 'report.pdf');assert.equal(first.content.toString(), 'PDF')
  assert.deepEqual(downloads, ['2']);assert.equal(structureRequests, 1)
  assert.deepEqual(phases, ['waiting', 'downloading'])
  network = false
  assert.equal(await read('INBOX', 1, 0), first, 'reopen/save uses the same cached bytes, including offline')
  owner = 'two'
  await assert.rejects(read('INBOX', 1, 0), /Offline/, 'another account cannot reuse the cached attachment')
  owner = 'one';validity = 2;network = true
  await assert.rejects(read('INBOX', 1, 0), /identidad/, 'a changed mailbox identity cannot reuse old bytes')
  validity = 1;context.syncGeneration++
  await read('INBOX', 1, 0)
  assert.equal(downloads.length, 2, 'a new account session cannot reuse the old generation')
  helpers.clearAttachmentCache();release = true
  const pending = read('INBOX', 1, 0)
  await new Promise(resolve => setImmediate(resolve))
  context.syncGeneration++;release()
  await assert.rejects(pending, /Account changed/, 'late downloads cannot populate another account cache')
  await assert.rejects(read('INBOX', 1, -1), /inválido/)
  release = undefined;helpers.clearAttachmentCache()
  const before = downloads.length
  const [reopened, saved] = await Promise.all([read('INBOX', 1, 0), read('INBOX', 1, 0)])
  assert.equal(downloads.length, before + 1, 'concurrent preview/save requests share the first download')
  assert.equal(reopened, saved)

  console.log('Attachment cache: bounded LRU, empty files, MIME-only download, offline reuse, account/UID identity and stale downloads passed')
}
main().catch(error => {console.error(error); process.exitCode = 1})
