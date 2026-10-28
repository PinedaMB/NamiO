const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript-test')
const compile=source=>ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const boxes={},live={}
vm.runInNewContext(compile(fs.readFileSync('src/shared/mailboxes.ts','utf8')),{exports:boxes})
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/data/live.ts','utf8')),{exports:live,require:()=>boxes})
const drafts=[{id:'local-one',to:'one@example.com',cc:'',subject:'Pending new',body:'Hello',updatedAt:1},
 {id:'local-two',to:'two@example.com',cc:'',subject:'Pending edit',body:'Updated',updatedAt:2,syncedAt:1,server:{path:'Drafts',uid:2}},
 {id:'local-three',to:'three@example.com',cc:'',subject:'Already saved',body:'Saved',updatedAt:3,syncedAt:3,server:{path:'Drafts',uid:3}}]
const result=live.pendingDraftThreads([{id:'live:2'},{id:'live:3'}],drafts,'Drafts','es','Pending draft')
assert.deepEqual(Array.from(result,item=>item.id),['draft:local-one','draft:local-two','live:3'])
assert.equal(result[0].messages[0].body[0],'Hello')
assert.equal(live.mailboxToFolder({path:'Drafts',name:'Drafts',specialUse:'\\Drafts',messages:4,unseen:0}).count,4)
const source=fs.readFileSync('src/renderer/src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let code
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='select')code=node.initializer.getText(ast);ts.forEachChild(node,visit)}visit(ast)
let opened,lookup,session=0
const context={compose:null,setComposeMinimized(){},live:true,draftsFolder:true,folder:'Drafts',accountGeneration:{current:0},folderRequest:{current:0},
 setIndividualMessageId(){},userNavigated:{current:false},setSelectedId(){},
 setComposeSession:fn=>{session=fn(session)},setCompose:draft=>{opened=draft},uidOf:id=>Number(id.slice(5)),
 window:{api:{openDraft:async(path,uid)=>{lookup=[path,uid];return drafts[2]},getDraft:async id=>drafts.find(draft=>draft.id===id)}},
 setToast(){},t:key=>key,threads:[],markRead(){throw new Error('Draft edit should not toggle read state')}}
const select=vm.runInNewContext(compile(`(${code})`),context)
;(async()=>{
 select('live:3');await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(lookup,['Drafts',3]);assert.equal(opened,drafts[2])
 select('draft:local-one');await new Promise(resolve=>setImmediate(resolve));assert.equal(opened,drafts[0])
 assert.equal(session,2)
 console.log('Draft UI: pending new/edited drafts, remote deduplication, folder counts and independent remote/local editing passed')
})().catch(error=>{console.error(error);process.exitCode=1})
