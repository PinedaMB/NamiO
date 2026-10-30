const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript-test')
const ast=ts.createSourceFile('App.tsx',fs.readFileSync('src/renderer/src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const declarations=new Map()
function visit(node){if(ts.isVariableDeclaration(node)&&node.initializer)declarations.set(node.name.getText(ast),node.initializer.getText(ast));ts.forEachChild(node,visit)}visit(ast)
let value,session=0,reads=0
const draft={to:'old@example.com',cc:'copy@example.com',subject:'Old draft',body:'Old content',html:'<p><strong>Old content</strong></p>',attachments:[{id:'old-file'}]}
const context={compose:null,account:null,setComposeMinimized(){},setCompose:next=>{value=next},setComposeSession:update=>{session=update(session)},accountGeneration:{current:1},window:{api:{getDraft:async()=>{reads++;return draft}}},setToast(){},t:key=>key}
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
 context.compose=null
 context.individualMessageId='live:2'
 const messages=[{id:'live:1',body:['Old message'],from:{name:'Old sender',email:'old@example.com'}},{id:'live:2',messageId:'<reply-target>',inReplyTo:'<parent>',sentAt:'27 oct',body:['First line\nSecond line','Last paragraph'],from:{name:'Sender',email:'sender@example.com'}}]
 context.selected={id:'conversation',subject:'Test',messages,participants:[]}
 let quoteArgs
 context.replyComposeHtml=(...args)=>{quoteArgs=args;return '<p></p><blockquote>Original</blockquote>'}
 load('openReply')()
 assert.equal(value.to,'sender@example.com')
 assert.equal(value.inReplyTo,'<reply-target>')
 assert.ok(value.html.includes('<blockquote>'))
 assert.ok(value.body.includes('> First line\n> Second line'),'every line is quoted in the plain-text fallback')
 assert.equal(quoteArgs[0],'')
 assert.equal(quoteArgs[2],'First line\nSecond line\n\nLast paragraph')
 assert.equal(quoteArgs[3],'compose.originalMessage')
 context.account={account:{user:' Me@Example.com '}}
 messages[1].to=[{email:'me@example.com'},{email:'other@example.com'},{email:'SENDER@example.com'},{email:'other@example.com'}]
 messages[1].cc=[{email:'copy@example.com'},{email:'OTHER@example.com'},{email:'ME@example.com'},{email:'COPY@example.com'}]
 load('openReply')()
 assert.equal(value.to,'sender@example.com','reply goes only to the sender')
 assert.equal(value.cc,'','reply does not include original CC recipients')
 load('openReply')('',true)
 assert.equal(value.to,'sender@example.com, other@example.com','reply all includes sender and To, excluding self and duplicates')
 assert.equal(value.cc,'copy@example.com','CC remains CC without duplicating To or the active account')
 assert.equal(value.bcc,undefined,'reply all does not invent hidden recipients')
 assert.equal(value.inReplyTo,'<reply-target>')
 assert.equal(value.subject,'Re: Test')
 assert.ok(value.body.includes('> First line'))
 messages[1].from.email='ME@example.com'
 load('openReply')('',true)
 assert.equal(value.to,'other@example.com, SENDER@example.com','replying to a sent message excludes the current account as sender')
 messages[1].to=[];messages[1].cc=[]
 load('openReply')('',true)
 assert.equal(value.to,'','no other recipients leaves To empty for manual entry')
 assert.equal(value.cc,'')
 console.log('New compose: fresh content and instance per message, with explicit draft restoration passed')
})().catch(error=>{console.error(error);process.exitCode=1})
