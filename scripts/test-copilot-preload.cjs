const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript-test')
const ast=ts.createSourceFile('preload.ts',fs.readFileSync('src/preload/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let source
function visit(node){if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='generateCopilot')source=node.initializer.getText(ast);ts.forEachChild(node,visit)}visit(ast)
assert.ok(source)
const listeners=new Set(),pending=[]
const context={copilotRequest:0,IPC:{copilotChunk:'chunk',copilotGenerate:'generate'},ipcRenderer:{
 on:(channel,listener)=>{assert.equal(channel,'chunk');listeners.add(listener)},
 removeListener:(channel,listener)=>{assert.equal(channel,'chunk');listeners.delete(listener)},
 invoke:(channel,input,id)=>{assert.equal(channel,'generate');return new Promise((resolve,reject)=>pending.push({id,resolve,reject}))}
}}
const generate=vm.runInNewContext(ts.transpile(`(${source})`,{target:ts.ScriptTarget.ES2022}),context)
const emit=(request,text)=>listeners.forEach(listener=>listener(null,{request,text}))
;(async()=>{
 const a=[],b=[]
 const first=generate({},text=>a.push(text)),second=generate({},text=>b.push(text))
 emit(pending[0].id,'first');emit(pending[1].id,'second')
 assert.deepEqual(a,['first']);assert.deepEqual(b,['second'],'Streaming responses are isolated by request ID')
 pending[0].resolve({text:'first'});await first;assert.equal(listeners.size,1)
 emit(pending[0].id,'late');assert.deepEqual(a,['first'],'Late chunks are ignored after completion')
 pending[1].reject(Error('IPC failed'));await assert.rejects(second);assert.equal(listeners.size,0,'Failures remove their listener')
 const withoutCallback=generate({});pending[2].resolve({text:'complete'});await withoutCallback;assert.equal(listeners.size,0)
 console.log('Copilot preload: request isolation, late chunks and success/failure listener cleanup passed')
})().catch(error=>{console.error(error);process.exitCode=1})
