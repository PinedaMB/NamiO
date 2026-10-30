const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { Readable } = require('node:stream')
const { simpleParser } = require('mailparser')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
const ast = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const declarations = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast).replace(/^export /, '')]))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-offline-bodies-'))
const db = {}
vm.runInNewContext(compile(fs.readFileSync('src/main/db.ts', 'utf8')), { exports: db, require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id) })
async function main() {
  const resumed = []
  const resumeContext = { session: null, ensureFullSync: mailbox => resumed.push(mailbox) }
  const resume = vm.runInNewContext(compile(`${declarations.get('resumeOfflineDownload')}; resumeOfflineDownload`), resumeContext)
  resume()
  resumeContext.session = { client: { usable: false, mailbox: { path: 'INBOX' } } }
  resume()
  assert.equal(resumed.length,0,'enabling offline download while disconnected waits for normal reconnection')
  resumeContext.session.client.usable = true
  resume()
  assert.deepEqual(resumed,['INBOX'],'enabling offline download starts the selected mailbox immediately')

  db.openAccountCache('one')
  db.upsertMailboxes([{ path: 'INBOX', name: 'INBOX', specialUse: null, messages: 2, unseen: 2 }])
  db.saveMailboxSync('INBOX', { uidValidity: 7, uidNext: 3, messages: 2, unseen: 2 })
  db.upsertEnvelopes('INBOX', [1,2].map(uid => ({ uid, subject: 'Mail', from: null, date: new Date().toISOString(), size: 1, unread: true, flagged: false, hasAttachments: true, priority: 'normal' })))
  db.saveBody('INBOX', 1, { text: 'Already saved', html: null, to: [], cc: [], attachments: [] })
  const structure = { type: 'multipart/mixed', childNodes: [
    { type: 'multipart/alternative', childNodes: [{ part: '1.1', type: 'text/plain' }, { part: '1.2', type: 'text/html' }] },
    { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'report.pdf' }, size: 9000000 },
    { part: '3', type: 'image/png', id: 'logo', disposition: 'inline', size: 5000000 },
    { part: '4', type: 'text/plain', disposition: 'attachment', dispositionParameters: { filename: 'notes.txt' }, size: 6000000 },
    { part: '5', type: 'message/rfc822', childNodes: [{ part: '5.1', type: 'text/plain' }], size: 7000000 }
  ] }
  let failure = false, changeAccount = false, releases = 0
  const downloads = [], progress = []
  const client = { mailbox: { uidValidity: 7n }, search: async () => [1,2], getMailboxLock: async () => ({ release() { releases++ } }),
    fetchOne: async uid => ({ uid: Number(uid), bodyStructure: structure, envelope: { to: [{ name: 'To', address: 'to@example.com' }], cc: [{ name: 'Copy', address: 'cc@example.com' }] } }),
    download: async (_uid, part) => {
      downloads.push(part);assert.ok(['1.1','1.2','1'].includes(part), 'attachment binaries and embedded email bodies must not be requested')
      if (failure && part === '1.2') throw Object.assign(new Error('Network down'), { code: 'ENETUNREACH' })
      if (changeAccount) context.syncGeneration++
      const bytes = Buffer.from(part === '1.2' ? '<p>Información útil</p>' : 'Información útil')
      return { content: Readable.from([bytes.subarray(0,13),bytes.subarray(13)]) }
    }
  }
  const context = { readSettings: async () => ({ offlineDownload: true }), ...db, Buffer, simpleParser, console: { error() {} }, syncGeneration: 1, fullSyncRunning: false, pendingFullSync: new Set(), offline: false,
    ensureClient: async () => client, serial: async fn => fn(), sleep: async () => {}, notify() {}, publishProgress: value => progress.push(value),
    fetchRange: async () => { throw new Error('Headers already exist; no envelope refetch expected') }, classify: error => error.code === 'ENETUNREACH' ? 'network' : 'unknown', isOfflineError: code => code === 'network', describe: error => error.message }
  const functions = ['toAddress','cacheMessageBody','fullSyncMailbox','ensureFullSync'].map(name => declarations.get(name)).join('\n')
  const api = vm.runInNewContext(compile(`${functions}; ({cacheMessageBody, fullSyncMailbox, ensureFullSync})`), context)
  context.readSettings = async () => ({})
  await api.fullSyncMailbox('INBOX',100)
  assert.equal(downloads.length,0,'missing preference defaults to no background body downloads')
  context.readSettings = async () => ({ offlineDownload: false })
  await api.fullSyncMailbox('INBOX',100)
  assert.equal(downloads.length,0,'explicit opt-out prevents background body downloads')
  assert.equal(db.readBody('INBOX',1).text,'Already saved','opting out preserves cached content')
  context.readSettings = async () => ({ offlineDownload: true })
  failure = true
  await api.fullSyncMailbox('INBOX',100)
  assert.equal(db.readBody('INBOX',2).fetched,false,'interrupted multipart bodies cannot be marked available offline')
  assert.equal(db.readBody('INBOX',1).text,'Already saved');assert.equal(context.offline,true)
  failure = false;downloads.length=0;progress.length=0
  await api.fullSyncMailbox('INBOX',100)
  assert.deepEqual(downloads,['1.1','1.2'],'resume downloads only the missing message text and HTML')
  const body=db.readBody('INBOX',2)
  assert.equal(body.text,'Información útil');assert.equal(body.html,'<p>Información útil</p>')
  assert.equal(body.to[0].address,'to@example.com');assert.equal(body.cc[0].address,'cc@example.com')
  assert.deepEqual(Array.from(body.attachments,a=>a.type),['application/pdf','image/png','text/plain','message/rfc822'],'attachment metadata stays in MIME order for on-demand saving')
  assert.equal(db.countBodies('INBOX'),2)
  assert.ok(progress.some(item=>item?.phase==='bodies'&&item.cached===2&&item.total===2),'progress reports offline bodies rather than envelope count')
  downloads.length=0;await api.fullSyncMailbox('INBOX',100);assert.equal(downloads.length,0,'complete bodies are never downloaded again')
  api.ensureFullSync('INBOX');assert.equal(context.fullSyncRunning,false,'fully cached mailboxes do not restart background work')
  db.closeCache();db.openAccountCache('one');assert.equal(db.countBodies('INBOX'),2,'bodies remain available after restarting the cache')
  client.mailbox.uidValidity=8n
  await assert.rejects(api.cacheMessageBody('INBOX',2),/identidad/)
  client.mailbox.uidValidity=7n;changeAccount=true;const before=db.readBody('INBOX',2).text
  await api.cacheMessageBody('INBOX',2);assert.equal(db.readBody('INBOX',2).text,before,'stale body responses cannot overwrite another account')
  changeAccount=false
  structure.type='text/plain';delete structure.childNodes
  await api.cacheMessageBody('INBOX',2);assert.equal(downloads.at(-1),'1','single-part mail fetches the text part rather than the full RFC822 message')
  structure.type='text/html'
  await api.cacheMessageBody('INBOX',2)
  assert.ok(db.readBody('INBOX',2).text.includes('Información'),'HTML-only messages retain a plain-text reply fallback')
  structure.type='application/pdf';downloads.length=0
  await api.cacheMessageBody('INBOX',2)
  assert.equal(downloads.length,0,'attachment-only messages do not download the binary')
  assert.equal(db.readBody('INBOX',2).fetched,true,'a legitimate empty message body is complete')
  assert.ok(releases>0)
  console.log('Offline body sync: selective MIME downloads, UTF-8, attachment order, partial failure/resume, progress, persistence and identity/account isolation passed')
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{db.closeCache();fs.rmSync(directory,{recursive:true,force:true})})
