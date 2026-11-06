const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')

const source = ts.createSourceFile('index.ts', fs.readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
let callback
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'app.whenReady().then') callback = node.arguments[0].getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(callback)

async function check(configured, migrationFails = false) {
  const calls = []
  let release
  const migration = new Promise(resolve => { release = resolve })
  const noop = () => {}
  const context = {
    readSettings: async () => ({}), nativeTheme: { on: noop }, mainWindow: null,
    app: { setAppUserModelId: noop, on: noop }, hardenSession: noop, setupAutoUpdate: noop,
    migrateOAuthSecrets: async () => { await migration; if (migrationFails) throw new Error('Wallet unavailable') },
    readActiveAccount: async () => configured ? { id: 'saved-account' } : null,
    initCache: id => calls.push(`cache:${id}`),
    registerIpcHandlers: () => calls.push('handlers'),
    setNewMailListener: noop, setCacheListener: noop, setSyncProgressListener: noop,
    setRulesListener: noop, setOutboxListener: noop, setInterval: noop, setTimeout: noop,
    createWindow: () => calls.push('window'), syncInbox: async () => calls.push('sync')
  }
  const start = vm.runInNewContext(ts.transpile(`(${callback})`, { target: ts.ScriptTarget.ES2022 }), context)
  const pending = start()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [], 'no window or request handlers can use an uninitialized account cache')
  release()
  await pending
  assert.deepEqual(calls, [`cache:${configured ? 'saved-account' : 'default'}`, 'handlers', 'window', ...(configured ? ['sync'] : [])])
}

async function sentPreparation() {
  const ast=ts.createSourceFile('imap.ts',fs.readFileSync('src/main/imap.ts','utf8'),ts.ScriptTarget.Latest,true)
  const code=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='syncInbox').getText(ast).replace(/^export /,'')
  const calls=[]
  const context={readMailboxes:()=>[{path:'INBOX',name:'INBOX',specialUse:'\\Inbox'},{path:'Correo enviado',name:'Correo enviado',specialUse:'\\Sent'}],scheduleSync:(...args)=>calls.push(args)}
  const sync=vm.runInNewContext(ts.transpile(`${code};syncInbox`,{target:ts.ScriptTarget.ES2022}),context)
  await sync(50)
  assert.deepEqual(calls,[['Correo enviado',100,true],['INBOX',50,true]],'automatic sync prepares sent bodies without opening that folder')
  const listCode=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='listMailboxes').getText(ast).replace(/^export /,'')
  let prepared=0
  const list=vm.runInNewContext(ts.transpile(`${listCode};listMailboxes`,{target:ts.ScriptTarget.ES2022}),{
    readMailboxes:()=>[],serial:async fn=>fn(),syncMailboxes:async()=>[{path:'INBOX'}],syncInbox:async()=>{prepared++},syncMeta:()=>({}),classify:()=> 'unknown',isOfflineError:()=>false,describe:error=>error.message
  })
  assert.equal((await list()).ok,true)
  assert.equal(prepared,1,'a new account starts preparation as soon as its folder list arrives')
  calls.length=0;context.readMailboxes=()=>[{path:'INBOX',name:'INBOX',specialUse:null}]
  await sync(50);assert.deepEqual(calls,[['INBOX',50,true]],'accounts without a Sent folder still synchronize normally')
}
;(async () => {
  await sentPreparation()
  await check(true)
  await check(false)
  await check(true, true)
  console.log('Startup: account cache ready before UI, immediate automatic sync, no-account startup and unavailable secret migration passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
