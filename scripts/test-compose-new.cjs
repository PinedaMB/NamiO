const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const ast=ts.createSourceFile('App.tsx',fs.readFileSync('src/renderer/src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const declarations=new Map()
function visit(node){if(ts.isVariableDeclaration(node)&&node.initializer)declarations.set(node.name.getText(ast),node.initializer.getText(ast));ts.forEachChild(node,visit)}visit(ast)
let value,session=0,reads=0
const draft={to:'old@example.com',cc:'copy@example.com',subject:'Old draft',body:'Old content',html:'<p><strong>Old content</strong></p>',attachments:[{id:'old-file'}]}
const context={compose:null,setComposeMinimized(){},setCompose:next=>{value=next},setComposeSession:update=>{session=update(session)},accountGeneration:{current:1},window:{api:{getDraft:async()=>{reads++;return draft}}},setToast(){},t:key=>key}
const load=name=>vm.runInNewContext(ts.transpile(`(${declarations.get(name)})`,{target:ts.ScriptTarget.ES2022}),context)
;(async()=>{
 value=draft
 load('openCompose')()
 assert.equal(value.to,'');assert.equal(value.subject,'');assert.equal(value.body,'');assert.equal(value.html,undefined);assert.equal(value.attachments,undefined)
 assert.equal(reads,0,'new mail never implicitly loads a draft')
 assert.equal(session,1)
 await load('restoreDraft')()
 assert.equal(value,draft);assert.equal(reads,1);assert.equal(session,2)
 load('openCompose')()
 assert.equal(value.body,'');assert.equal(session,3)
 context.compose=draft
 load('openCompose')()
 assert.equal(session,3,'restoring a minimized message must keep the editor instance')
 assert.equal(value.body,'','restoring must not replace the active editor values')
 console.log('New compose: fresh content and instance per message, with explicit draft restoration passed')
})().catch(error=>{console.error(error);process.exitCode=1})
