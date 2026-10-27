const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript')
const {simpleParser}=require('mailparser')
const compile=source=>ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
async function main(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'namio-drafts-')),db={},mailboxes={},service={}
 vm.runInNewContext(compile(await fs.readFile('src/shared/mailboxes.ts','utf8')),{exports:mailboxes})
 vm.runInNewContext(compile(await fs.readFile('src/main/db.ts','utf8')),{exports:db,require:id=>id==='electron'?{app:{getPath:()=>directory}}:require(id)})
 db.openAccountCache('one')
 try{
 db.upsertMailboxes([{path:'Drafts',name:'Drafts',specialUse:'\\Drafts',messages:0,unseen:0}])
 const remote=new Map(),deleted=[];let nextUid=1,appendCount=0,loseAppendReply=false,onAppend=null
 const client={capabilities:new Set(['UIDPLUS']),mailbox:{uidValidity:10n},
  getMailboxLock:async()=>({release(){}}),
  search:async query=>{const ids=[];for(const [uid,message]of remote)if(message.messageId===query.header['Message-ID'])ids.push(uid);return ids},
  append:async(_folder,raw,flags)=>{assert.ok(flags.includes('\\Draft'));const uid=nextUid++;appendCount++;remote.set(uid,{raw,messageId:(await simpleParser(raw)).messageId});if(onAppend){const callback=onAppend;onAppend=null;callback()}if(loseAppendReply){loseAppendReply=false;throw new Error('Append response lost')}return{uid,uidValidity:10n}},
  fetchOne:async uid=>remote.has(Number(uid))?{uid:Number(uid)}:false,
  messageDelete:async uid=>{deleted.push(Number(uid));remote.delete(Number(uid));return true}
 }
 const source=await fs.readFile('src/main/imap.ts','utf8'),ast=ts.createSourceFile('imap.ts',source,ts.ScriptTarget.Latest,true)
 const declarations=new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node=>[node.name?.text,node.getText(ast)]))
 const context={syncGeneration:0,serial:fn=>fn(),ensureClient:async()=>client,isDraftMailbox:mailboxes.isDraftMailbox,
 readMailboxes:db.readMailboxes,readLocalDraft:db.readDraft,enqueueOutbox:db.enqueueOutbox,storeDraft:db.saveDraft,deleteMessageRow:db.deleteMessageRow,syncMessages:async()=>{},syncMailboxes:async()=>{},notify(){}}
 const load=name=>vm.runInNewContext(compile(`(${declarations.get(name).replace(/^export /,'')})`),context)
 context.removeDraftWithClient=load('removeDraftWithClient')
 const uploadDraft=load('uploadDraft')
 vm.runInNewContext(compile(await fs.readFile('src/main/drafts.ts','utf8')),{exports:service,Buffer,require:id=>{
 if(id==='./db')return db
 if(id==='./settings')return{readActiveAccount:async()=>({id:'one',user:'author@example.com'})}
 if(id==='./imap')return{uploadDraft,notifyDraftsChanged(){},downloadDraft:async(_path,uid)=>({raw:remote.get(uid).raw,server:{path:'Drafts',uid,uidValidity:'10'}})}
 return require(id)
 }})
 db.storePickedAttachment('file-one','report.txt',Buffer.from('Persisted file'))
 const input={to:'to@example.com',cc:'copy@example.com',bcc:'hidden@example.com',subject:'First draft',body:'Hello',html:'<p><strong>Hello</strong></p>',attachments:[{id:'file-one',name:'report.txt',size:14}],updatedAt:1}
 assert.throws(()=>service.queueDraftSave({...input,inReplyTo:'bad\r\nHeader: value'}),/Cabeceras/)
 const first=service.queueDraftSave(input),second=service.queueDraftSave({...input,subject:'Second draft',attachments:[]})
 assert.notEqual(first.id,second.id);assert.equal(db.listDrafts().length,2)
 db.closeCache();db.openAccountCache('one');assert.equal(db.listDrafts().length,2);assert.equal(db.listOutbox().length,2);assert.ok(db.readPickedAttachment('file-one'))
 await service.syncDraft(first.id)
 assert.equal(remote.size,1);assert.ok(db.readDraft(first.id).server)
 let parsed=await simpleParser([...remote.values()][0].raw)
 assert.equal(parsed.bcc.value[0].address,'hidden@example.com');assert.ok(parsed.html.includes('<strong>'));assert.equal(parsed.attachments[0].content.toString(),'Persisted file')
 await service.syncDraft(first.id);assert.equal(appendCount,1,'retrying the same revision does not duplicate it')
 const edited=service.queueDraftSave({...db.readDraft(first.id),body:'Updated body'})
 assert.ok(edited.updatedAt>first.updatedAt)
 loseAppendReply=true
 await assert.rejects(service.syncDraft(first.id),/Append response lost/)
 assert.equal(remote.size,2,'old server draft is preserved if acknowledgement fails')
 await service.syncDraft(first.id)
 assert.equal(appendCount,2,'retry recovers the appended message by Message-ID')
 assert.equal(remote.size,1);assert.equal(deleted.length,1,'only the old revision is removed')
 parsed=await simpleParser([...remote.values()][0].raw);assert.ok(parsed.text.includes('Updated body'))
 const pending=db.listOutbox().filter(row=>row.kind==='draft-save'&&JSON.parse(row.payload).draftId===first.id)
 assert.equal(pending.length,1,'queued updates coalesce by draft identity')
 const uid=[...remote.keys()][0]
 db.clearDraft(first.id)
 const reopened=await service.openServerDraft('Drafts',uid)
 assert.equal(reopened.bcc,'hidden@example.com');assert.equal(reopened.attachments[0].name,'report.txt');assert.equal(reopened.server.uid,uid)
 service.queueDraftDelete(reopened.id)
 assert.equal(db.readDraft(reopened.id),null);assert.ok(db.readDraft(second.id),'discarding one draft preserves others')
 assert.ok(db.listOutbox().some(row=>row.kind==='draft-delete'))
 const reference={path:'Drafts',uid,uidValidity:'9'}
 const before=deleted.length
 await assert.rejects(context.removeDraftWithClient(client,reference),/identidad/)
 assert.equal(deleted.length,before,'UIDVALIDITY mismatch cannot delete another message')
 client.capabilities.clear()
 await assert.rejects(context.removeDraftWithClient(client,{...reference,uidValidity:'10'}),/segura/)
 assert.equal(deleted.length,before,'without UIDPLUS no broad expunge is attempted')

 client.capabilities.add('UIDPLUS')
 const addresses={},mail={};let smtpFails=true,smtpSent=0
 vm.runInNewContext(compile(await fs.readFile('src/shared/mailAddresses.ts','utf8')),{exports:addresses})
 vm.runInNewContext(compile(await fs.readFile('src/main/mail.ts','utf8')),{exports:mail,Buffer,console,setTimeout:()=>0,require:id=>{
  if(id==='@shared/mailAddresses')return addresses
  if(id==='./db')return db
  if(id==='./drafts')return service
  if(id==='./settings')return{readActiveAccount:async()=>({id:'one'})}
  if(id==='electron')return{dialog:{},BrowserWindow:{}}
  if(id==='nodemailer')return{createTransport:options=>options.streamTransport?require('nodemailer').createTransport(options):{sendMail:async()=>{if(smtpFails)throw new Error('SMTP offline');smtpSent++},close(){}}}
  if(id==='./imap')return{getCredentials:async()=>({account:{user:'author@example.com',smtp:{host:'localhost',port:465,secure:true}},password:'test'}),appendToSent:async()=>{},removeServerDraft:async reference=>context.removeDraftWithClient(client,reference)}
  return require(id)
 }})
 await mail.processOutbox()
 assert.equal(db.listOutbox().length,0)
 assert.equal(remote.size,1)
 const outgoing={draftId:second.id,to:second.to,cc:second.cc,bcc:second.bcc,subject:second.subject,text:second.body,attachments:[]}
 const accepted=await mail.sendMail(outgoing)
 assert.equal(accepted.queued,true)
 assert.ok(db.readDraft(second.id));assert.equal(remote.size,1,'queued mail retains its draft until SMTP succeeds')
 const sending=db.listOutbox().find(row=>row.kind==='send')
 smtpFails=false
 await mail.retryOutbox(sending.id)
 assert.equal(smtpSent,1);assert.equal(db.readDraft(second.id),null);assert.equal(remote.size,0,'successful send removes only its server draft')
 assert.equal(db.listOutbox().length,0)
 const newer=service.queueDraftSave({...input,id:undefined,subject:'Newer draft',attachments:[]})
 await mail.processOutbox()
 smtpFails=true
 await mail.sendMail({...outgoing,draftId:newer.id})
 const waiting=db.listOutbox().find(row=>row.kind==='send')
 const revision=service.queueDraftSave({...db.readDraft(newer.id),body:'Edited after queuing'})
 smtpFails=false
 await mail.retryOutbox(waiting.id)
 assert.equal(db.readDraft(newer.id).updatedAt,revision.updatedAt,'sending an older queued version must preserve newer draft edits')
 assert.equal(remote.size,1)

 const racing=service.queueDraftSave({...input,id:undefined,subject:'Concurrent edits',attachments:[]})
 onAppend=()=>service.queueDraftSave({...db.readDraft(racing.id),body:'Latest edit during upload'})
 await mail.processOutbox()
 assert.equal(db.readDraft(racing.id).body,'Latest edit during upload')
 assert.equal(db.readDraft(racing.id).syncedAt,db.readDraft(racing.id).updatedAt,'newer edits are uploaded again instead of being overwritten by the old acknowledgement')
 const canceled=service.queueDraftSave({...input,id:undefined,subject:'Discard during upload',attachments:[]})
 onAppend=()=>service.queueDraftDelete(canceled.id)
 await mail.processOutbox()
 assert.equal(db.readDraft(canceled.id),null,'upload completion cannot resurrect a discarded draft')
 assert.ok(![...remote.values()].some(message=>message.raw.toString().includes('Discard during upload')))
 console.log('Server drafts: multiple local drafts, rich MIME/CCO/attachments, version replacement, lost-ACK recovery, coalescing, reopening, independent discard and safe UID deletion passed')
 }finally{db.closeCache();await fs.rm(directory,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})
