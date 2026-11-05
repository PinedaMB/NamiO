const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
const helpers = {}
vm.runInNewContext(compile(fs.readFileSync('src/shared/mailboxes.ts','utf8')), { exports: helpers })
const ast = ts.createSourceFile('imap.ts',fs.readFileSync('src/main/imap.ts','utf8'),ts.ScriptTarget.Latest,true)
const code = ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='changeMailbox').getText(ast).replace(/^export /,'')
const box = (path,specialUse=null) => ({path,name:path,specialUse,messages:3,unseen:0})
async function check(path, remove, mode, expected) {
  const calls=[]
  const boxes=[box('INBOX','\\Inbox'),box('Sent'),box('Junk','\\Junk'),box('Personal'),box('spam'),box('Parent'),box('Parent/Child')]
  const client={
    list:async()=>[{path:'Personal',delimiter:'.'},...(mode==='children'?[{path:'Personal.Child',delimiter:'.'}]:[])],
    mailboxCreate:async name=>{calls.push(['create',name]);if(mode==='error')throw Error('Server failed');return mode!=='refused'},
    mailboxDelete:async name=>{calls.push(['delete',name]);return mode!=='refused'}
  }
  const context={...helpers,serial:async fn=>fn(),cacheAccountId:()=>mode==='switch'?'two':'one',accountChangedError:()=>Error('Account changed'),
    syncMailboxes:async()=>boxes,ensureClient:async()=>client,notify:path=>calls.push(['notify',path]),classify:()=> 'unknown',describe:error=>error.message}
  const change=vm.runInNewContext(compile(`${code};changeMailbox`),context)
  const result=await change(path,remove,'one')
  assert.equal(result.ok,expected,`${mode}: ${path}`)
  if(expected)assert.deepEqual(calls,[[remove?'delete':'create',path],['notify','*']])
  else assert.equal(calls.some(call=>call[0]==='notify'),false,'failed mutations do not report success')
  if(['switch','protected','invalid','duplicate','children'].includes(mode))assert.equal(calls.length,0,'invalid requests never mutate the server')
}
async function confirmation(accept) {
  const source=ts.createSourceFile('ipc.ts',fs.readFileSync('src/main/ipc.ts','utf8'),ts.ScriptTarget.Latest,true)
  let handler
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='ipcMain.handle'&&node.arguments[0]?.getText(source)==='IPC.mailboxChange')handler=node.arguments[1].getText(source);ts.forEachChild(node,visit)}
  visit(source)
  let mutations=0
  const run=vm.runInNewContext(compile(`(${handler})`),{
    readActiveAccount:async()=>({id:'one'}),cacheAccountId:()=> 'one',readSettings:async()=>({language:'es'}),BrowserWindow:{fromWebContents:()=>null},
    dialog:{showMessageBox:async options=>{assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);assert.match(options.message,/todos sus mensajes/);return {response:accept?1:0}}},
    changeMailbox:async()=>{mutations++;return {ok:true,data:true}}
  })
  const result=await run({sender:{}},'Personal',true)
  assert.equal(result.data,accept)
  assert.equal(mutations,accept?1:0,'canceling confirmation never reaches the server')
}
;(async()=>{
  await confirmation(false);await confirmation(true)
  await check('New folder',false,'ok',true)
  await check('Personal',true,'ok',true)
  await check('spam',true,'ok',true)
  for(const path of ['INBOX','Sent','Junk','Parent'])await check(path,true,'protected',false)
  for(const path of ['', ' bad ', 'A/B', 'A\\B', 'A.B', 'A\nB'])await check(path,false,'invalid',false)
  await check('personal',false,'duplicate',false)
  await check('Personal',true,'children',false)
  await check('New',false,'switch',false)
  await check('New',false,'error',false)
  await check('Personal',true,'refused',false)
  console.log('Mailbox management: create/delete, protected folders, hierarchy, duplicates, account isolation and server errors passed')
})().catch(error=>{console.error(error);process.exitCode=1})
