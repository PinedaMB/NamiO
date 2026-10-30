const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022 })
function find(file, predicate) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let result
  function visit(node) { if (predicate(node,ast)) result=node.arguments[1]?.getText(ast);ts.forEachChild(node,visit) }
  visit(ast);return result
}
const appAst=ts.createSourceFile('App.tsx',fs.readFileSync('src/renderer/src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let effect
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(appAst)==='useEffect'&&node.arguments[0]?.getText(appAst).includes('const reconnect ='))effect=node.arguments[0].getText(appAst);ts.forEachChild(node,visit)}visit(appAst)
let retry=0,syncCalls=0,sync={offline:false}
const listeners=new Map()
const context={live:true,navigator:{onLine:true},setMessageRetry:fn=>{retry=fn(retry)},setSync:fn=>{sync=fn(sync)},handleSync:async()=>{syncCalls++},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}}
const watch=vm.runInNewContext(compile(`(${effect})`),context)
let cleanup=watch();listeners.get('offline')();assert.equal(sync.offline,true);assert.equal(retry,1)
listeners.get('online')();assert.equal(syncCalls,1);assert.equal(retry,2)
cleanup();assert.equal(listeners.size,0,'navigation cleans up connectivity listeners')
context.navigator.onLine=false;cleanup=watch();assert.equal(retry,3,'starting offline immediately updates reader state');cleanup()
context.live=false;watch();assert.equal(listeners.size,0)
let errorEffect, errorCondition
function errorNodes(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(appAst)==='connectionError')errorCondition=node.initializer.getText(appAst)
 if(ts.isCallExpression(node)&&node.expression.getText(appAst)==='useEffect'&&node.arguments[0]?.getText(appAst).includes('if (!connectionError)'))errorEffect=node.arguments[0].getText(appAst)
 ts.forEachChild(node,errorNodes)
}
errorNodes(appAst)
for(const code of ['dns','refused','timeout','network','auth','tls','unknown']){
 let state={offline:false,syncedAt:123},error={code,detail:'fetch failed'}
 const env={liveError:error,setSync:fn=>{state=fn(state)},setLiveError:value=>{error=value}}
 env.connectionError=vm.runInNewContext(compile(`(${errorCondition})`),env)
 vm.runInNewContext(compile(`(${errorEffect})`),env)()
 const disconnected=['dns','refused','timeout','network'].includes(code)
 assert.equal(state.offline,disconnected,'transport failures switch to offline mode')
 assert.equal(error===null,disconnected,'authentication and certificate errors remain visible')
 assert.equal(state.syncedAt,123,'offline mode preserves the last successful synchronization')
}
const handler=find('src/main/ipc.ts',(node,ast)=>ts.isCallExpression(node)&&node.expression.getText(ast)==='ipcMain.handle'&&node.arguments[0]?.getText(ast)==='IPC.syncMailbox')
;(async()=>{
 for(const ok of [true,false]){
  let drained=0
  const syncFolder=vm.runInNewContext(compile(`(${handler})`),{console,syncMailbox:async()=>({ok}),processOutbox:async()=>{drained++}})
  await syncFolder(null,'INBOX');assert.equal(drained,ok?1:0,'successful reconnection drains pending operations')
  await syncFolder(null,'');assert.equal(drained,ok?1:0,'invalid folder cannot start synchronization')
 }
 console.log('Reconnect: automatic online retry, offline cached reading state, listener cleanup and pending outbox resumption passed')
})().catch(error=>{console.error(error);process.exitCode=1})
