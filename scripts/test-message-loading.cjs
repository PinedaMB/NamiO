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
    uidOf:id=>Number(id.slice(5)),detailToMessage:data=>({id:`live:${data.uid}`}),setToast(){},setLiveError(){},setSync(){},t:key=>key,
    setThreads:update=>{threads=update(threads)},window:{api:{getMessage:(_folder,uid,cachedOnly)=>{if(cachedOnly)return Promise.resolve({ok:false});calls.push(uid);return new Promise(resolve=>resolvers.push(resolve))}}}}
  const cleanup=vm.runInNewContext(compile(`(${effect})`),context)()
  await flush()
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
async function cachedFirst(disconnected, inlineOnly=false) {
  let connection={offline:disconnected}
  let threads=[{id:'live:1',messageIds:[1,2,3],messages:[]}]
  const network=[]
  const context={view:'mailbox',live:true,selected:threads[0],folder:'INBOX',locale:'es',individualMessageId:null,
    activeFolderRef:{current:'INBOX'},folderRequest:{current:1},accountGeneration:{current:1},navigator:{onLine:!disconnected},
    uidOf:id=>Number(id.slice(5)),detailToMessage:(data,_locale,partial)=>({id:`live:${data.uid}`,partial}),setToast(){},setLiveError(){},setSync:update=>{connection=update(connection)},t:key=>key,
    setThreads:update=>{threads=update(threads)},window:{api:{getMessage:async(_folder,uid,cachedOnly)=>{
      if(cachedOnly)return {ok:true,data:{uid},meta:{partial:uid===3&&!inlineOnly,inlineImagesPending:uid===3&&inlineOnly}}
      network.push(uid)
      return disconnected ? {ok:true,data:{uid},meta:{partial:false,offline:false}} : new Promise(()=>{})
    }}}}
  const run=vm.runInNewContext(compile(`(${effect})`),context)
  const cleanup=run();await flush()
  assert.equal(threads[0].messages.length,(disconnected||inlineOnly)?3:2,'saved bodies appear even while the newest message waits on the network')
  assert.equal(network.length,disconnected?0:1,'offline reading must not queue network work')
  if(disconnected){
    assert.equal(threads[0].messages.find(message=>message.id==='live:3').partial,!inlineOnly,'pending images must not hide the saved body')
    if(inlineOnly)assert.equal(threads[0].messages.find(message=>message.id==='live:3').inlineImagesPending,true)
    cleanup();context.navigator.onLine=true;context.selected=threads[0]
    run();await flush()
    assert.equal(network.length,1,'reconnection retries the partial message')
    assert.equal(threads[0].messages.find(message=>message.id==='live:3').partial,false)
    assert.equal(connection.offline,false,'successful online reading clears stale offline state')
  }else cleanup()
}
const imapAst=ts.createSourceFile('imap.ts',fs.readFileSync('src/main/imap.ts','utf8'),ts.ScriptTarget.Latest,true)
const source=imapAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getMessage').getText(imapAst).replace(/^export /,'')
async function deduplicate(changeAccount=false) {
  let stored=false,fetches=0,release,chain=Promise.resolve(),writes=0
  const detail={uid:7,text:'Body',html:null,to:[],cc:[],attachments:[]}
  const context={syncGeneration:1,offline:false,readBody:()=>({fetched:stored}),cachedDetail:()=>detail,
    syncMeta:()=>({}),serial:fn=>{const run=chain.then(fn,fn);chain=run.catch(()=>{});return run},
    fetchMessage:()=>{fetches++;return new Promise(resolve=>{release=()=>resolve(detail)})},
    notify(){}, saveBody:()=>{stored=true;writes++},classify:()=> 'unknown',isOfflineError:()=>false,describe:error=>error.message}
  const get=vm.runInNewContext(compile(`${source};getMessage`),context)
  const localOnly=await get('INBOX',7,true)
  assert.equal(localOnly.ok,true);assert.equal(localOnly.meta.partial,true);assert.equal(fetches,0,'local-only reads never join the network queue')
  const one=get('INBOX',7),two=get('INBOX',7)
  await flush()
  if(changeAccount)context.syncGeneration++
  release()
  const results=await Promise.all([one,two])
  assert.equal(fetches,1,'requests waiting for the same body reuse the cache')
  assert.equal(writes,changeAccount?0:1,'stale fetch cannot write into the new account cache')
  assert.ok(results.every(result=>result.ok===!changeAccount))
}
async function inlineOfflineFallback() {
  const detail={uid:7,text:'Cached text',html:'<p>Cached text<img src="cid:logo"></p>',attachments:[],to:[],cc:[]}
  let requests=0
  const context={syncGeneration:1,offline:false,readBody:()=>({...detail,fetched:true}),cachedDetail:()=>detail,
    syncMeta:()=>({offline:context.offline}),serial:fn=>fn(),fetchMessage:async()=>{requests++;throw new Error('Network down')},
    classify:()=> 'network',isOfflineError:()=>true,describe:error=>error.message}
  const get=vm.runInNewContext(compile(`${source};getMessage`),context)
  const cached=await get('INBOX',7,true)
  assert.equal(requests,0);assert.equal(cached.meta.inlineImagesPending,true);assert.notEqual(cached.meta.partial,true)
  const fallback=await get('INBOX',7)
  assert.equal(requests,1);assert.equal(fallback.ok,true);assert.equal(fallback.data.text,'Cached text')
  assert.equal(fallback.meta.partial,false,'an image network failure cannot hide an already saved body')
  assert.equal(fallback.meta.offline,true);assert.equal(fallback.meta.inlineImagesPending,true)
}
;(async()=>{
  await cachedFirst(false);await cachedFirst(true);await cachedFirst(false,true);await cachedFirst(true,true)
  await progressive();await progressive('live:1');await progressive(null,true)
  await deduplicate();await deduplicate(true);await inlineOfflineFallback()
  console.log('Message loading: newest/explicit first, progressive display, cancellation, duplicate suppression and account isolation verified')
})().catch(error=>{console.error(error);process.exitCode=1})
