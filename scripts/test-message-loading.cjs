const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
const ast = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx','utf8'), ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast)==='useEffect' && node.arguments[0]?.getText(ast).includes('const missing = (selected.messageIds')) effect=node.arguments[0].getText(ast)
  ts.forEachChild(node,visit)
}
visit(ast)
const flush = () => new Promise(resolve=>setImmediate(resolve))
async function progressive(individualMessageId=null, stale=false) {
  const calls=[],resolvers=[]
  let threads=[{id:'live:1',messageIds:[1,2,3],messages:[]}]
  const context={ view:'mailbox',live:true,selected:threads[0],folder:'INBOX',locale:'es',individualMessageId,
    activeFolderRef:{current:'INBOX'},folderRequest:{current:1},accountGeneration:{current:1},
    uidOf:id=>Number(id.slice(5)),detailToMessage:data=>({id:`live:${data.uid}`}),setToast(){},setLiveError(){},t:key=>key,
    setThreads:update=>{threads=update(threads)},window:{api:{getMessage:(_folder,uid)=>{calls.push(uid);return new Promise(resolve=>resolvers.push(resolve))}}}}
  const cleanup=vm.runInNewContext(compile(`(${effect})`),context)()
  const first=individualMessageId?1:3
  assert.deepEqual(calls,[first],'fetch the explicit message or newest one first')
  if(stale)context.folderRequest.current++
  resolvers.shift()({ok:true,data:{uid:first},meta:{}})
  await flush()
  assert.equal(threads[0].messages.length,stale?0:1,'show first body before remaining messages finish; reject obsolete responses')
  if(!stale){
    assert.equal(calls.length,2)
    cleanup()
    resolvers.shift()({ok:true,data:{uid:calls[1]},meta:{}})
    await flush()
    assert.equal(calls.length,2,'leaving the thread stops scheduling older bodies')
    assert.equal(threads[0].messages.length,1,'late body cannot overwrite a different selection')
  }
}
const imapAst=ts.createSourceFile('imap.ts',fs.readFileSync('src/main/imap.ts','utf8'),ts.ScriptTarget.Latest,true)
const source=imapAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getMessage').getText(imapAst).replace(/^export /,'')
async function deduplicate(changeAccount=false) {
  let stored=false,fetches=0,release,chain=Promise.resolve(),writes=0
  const detail={uid:7,text:'Body',html:null,to:[],cc:[],attachments:[]}
  const context={syncGeneration:1,offline:false,readBody:()=>({fetched:stored}),cachedDetail:()=>stored?detail:null,
    syncMeta:()=>({}),serial:fn=>{const run=chain.then(fn,fn);chain=run.catch(()=>{});return run},
    fetchMessage:()=>{fetches++;return new Promise(resolve=>{release=()=>resolve(detail)})},
    saveBody:()=>{stored=true;writes++},classify:()=> 'unknown',isOfflineError:()=>false,describe:error=>error.message}
  const get=vm.runInNewContext(compile(`${source};getMessage`),context)
  const one=get('INBOX',7),two=get('INBOX',7)
  await flush()
  if(changeAccount)context.syncGeneration++
  release()
  const results=await Promise.all([one,two])
  assert.equal(fetches,1,'requests waiting for the same body reuse the cache')
  assert.equal(writes,changeAccount?0:1,'stale fetch cannot write into the new account cache')
  assert.ok(results.every(result=>result.ok===!changeAccount))
}
;(async()=>{
  await progressive();await progressive('live:1');await progressive(null,true)
  await deduplicate();await deduplicate(true)
  console.log('Message loading: newest/explicit first, progressive display, cancellation, duplicate suppression and account isolation verified')
})().catch(error=>{console.error(error);process.exitCode=1})
