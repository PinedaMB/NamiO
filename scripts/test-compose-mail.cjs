const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript-test')
const nodemailer = require('nodemailer')
const { simpleParser } = require('mailparser')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-compose-'))
  const db = {}, mail = {}, addresses = {}
  vm.runInNewContext(compile(await fs.readFile('src/shared/mailAddresses.ts','utf8')), { exports: addresses })
  assert.equal(addresses.validRecipients('bad'), false)
  assert.equal(addresses.validRecipients('', '', 'hidden@example.com'), true)
  vm.runInNewContext(compile(await fs.readFile('src/main/db.ts','utf8')), { exports: db, require: id => id === 'electron' ? {app:{getPath:()=>directory}} : require(id) })
  db.openAccountCache('one')
  try {
    db.storePickedAttachment('file1','report.txt',Buffer.from('Attachment contents'))
    const draft = {priority:'high',to:'to@example.com',cc:'copy@example.com',bcc:'hidden@example.com',subject:'Test',body:'Hello',html:'<p><strong>Hello</strong> <u>team</u></p>',attachments:[{id:'file1',name:'report.txt',size:19}],inReplyTo:'<parent@example.com>',references:['<root@example.com>','<parent@example.com>'],updatedAt:1}
 draft.html += '<img width="120" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGNsaP7PQApgIkn1qIZRDUNKAwBWBwIi7kQ8QgAAAABJRU5ErkJggg==" alt="Pasted image">'
    db.saveDraft(draft)
    db.closeCache(); db.openAccountCache('one')
    assert.equal(db.readDraft().priority,'high')
    assert.equal(db.readDraft().html, draft.html)
    assert.equal(db.readDraft().bcc, 'hidden@example.com')
    assert.equal(db.readDraft().attachments[0].id,'file1')
    assert.equal(db.readPickedAttachment('file1').name,'report.txt')
    const sent = [], copies = [], deletedBatches = []
    let failSmtp = false, failSentCopy = false, failBatch = false
    vm.runInNewContext(compile(await fs.readFile('src/main/mail.ts','utf8')), { exports:mail, Buffer, setTimeout:()=>0, console, require:id=>{
      if(id==='@shared/mailAddresses')return addresses
      if(id==='./db')return db
      if(id==='./drafts')return {queueDraftDelete:id=>db.clearDraft(id),syncDraft:async()=>{}}
      if(id==='./settings')return {readActiveAccount:async()=>({id:'one'})}
      if(id==='electron')return {dialog:{},BrowserWindow:{}}
      if(id==='nodemailer')return {createTransport:options=>options.streamTransport ? nodemailer.createTransport(options) : {sendMail:async message=>{if(failSmtp)throw new Error('Offline');sent.push(message)},close(){}}}
      if(id==='./imap')return {getCredentials:async()=>({account:{user:'from@example.com',smtp:{host:'localhost',port:465,secure:true}},password:'test'}),appendToSent:async raw=>{if(failSentCopy)throw new Error('IMAP offline after SMTP accepted');copies.push(raw)},deleteMessageBatch:async(...args)=>{if(failBatch)throw new Error('IMAP offline');args[4](1);args[4](args[1].length);deletedBatches.push(args)}}
      return require(id)
    }})
    const payload = {priority:draft.priority,to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,text:draft.body,html:draft.html,attachments:['file1'],inReplyTo:draft.inReplyTo,references:draft.references}
    assert.equal((await mail.sendMail({...payload,priority:'urgent\r\nX-Bad: true'})).ok,false)
    assert.equal((await mail.sendMail({...payload,to:'bad'})).ok,false)
    assert.equal((await mail.sendMail({...payload,attachments:['missing']})).ok,false)
    assert.equal(db.listOutbox().length,0)
    assert.equal((await mail.sendMail(payload)).ok,true)
    assert.deepEqual(Array.from(sent[0].envelope.to),['to@example.com','copy@example.com','hidden@example.com'])
    const parsed = await simpleParser(sent[0].raw)
    assert.equal(parsed.headers.get('priority'),'high')
    assert.equal(parsed.bcc,undefined)
    assert.ok(parsed.html.includes('<strong>Hello</strong>'))
    assert.ok(parsed.text.includes('Hello'))
    assert.equal(parsed.cc.value[0].address,'copy@example.com')
    assert.equal(parsed.inReplyTo,draft.inReplyTo)
    assert.equal(parsed.references[0],'<root@example.com>')
    assert.equal(parsed.attachments.find(file=>file.filename==='report.txt').content.toString(),'Attachment contents')
    assert.ok(parsed.html.includes('width="120"'),'SMTP retains image sizing')
    assert.ok(parsed.attachments.some(file=>file.related&&file.contentType==='image/png'))
    assert.ok(parsed.html.includes('data:image/png;base64,'),'received inline image is available offline')
    assert.ok((await simpleParser(sent[0].raw,{skipImageLinks:true})).html.includes('cid:'),'SMTP uses MIME content IDs, not data URLs')
    assert.ok(copies[0].equals(sent[0].raw))
    await mail.sendMail({...payload,priority:'low',attachments:[]})
    assert.equal((await simpleParser(sent.at(-1).raw)).headers.get('priority'),'low')
    const copiesPayload={...payload,to:'first@example.com, second@example.com',cc:'copy@example.com, copy2@example.com',bcc:'hidden@example.com, hidden2@example.com'}
    assert.equal((await mail.sendMail(copiesPayload)).ok,true)
    const delivery=sent.at(-1)
    assert.deepEqual(Array.from(delivery.envelope.to),['first@example.com','second@example.com','copy@example.com','copy2@example.com','hidden@example.com','hidden2@example.com'])
    const copiedMail=await simpleParser(delivery.raw)
    assert.deepEqual(copiedMail.cc.value.map(address=>address.address),['copy@example.com','copy2@example.com'])
    assert.equal(copiedMail.bcc,undefined)
    assert.ok(!delivery.raw.toString().includes('hidden@example.com')&&!delivery.raw.toString().includes('hidden2@example.com'),'BCC addresses never appear in the shared MIME message')
    assert.equal(copiedMail.attachments.find(file=>file.filename==='report.txt').content.toString(),'Attachment contents','All envelope recipients receive the same complete attachment')
    assert.ok(copiedMail.attachments.some(file=>file.related&&file.contentType==='image/png'),'Copies receive inline images too')
    failSentCopy = true
    const sentBefore = sent.length
    assert.equal((await mail.sendMail({...payload,attachments:[]})).queued,false)
    assert.equal(db.listOutbox().length,0,'failure to save the sent copy cannot queue another SMTP delivery')
    await mail.processOutbox()
    assert.equal(sent.length,sentBefore+1,'processing again cannot resend an accepted message')
    failSentCopy = false
    failSmtp = true
    const queued = await mail.sendMail({...payload,attachments:[]})
    assert.equal(queued.ok,true)
    assert.equal(queued.queued,true)
    assert.equal(JSON.parse(db.listOutbox().find(row=>row.kind==='send').payload).priority,'high')
    assert.equal(db.listOutbox().length,1)
    const pendingId = db.listOutbox()[0].id
    db.closeCache(); db.openAccountCache('one')
    assert.equal(db.listOutbox()[0].id,pendingId,'offline send survives reopening the persistent cache')
    failSmtp = false
    const deliveriesBeforeRetry = sent.length
    await Promise.all([mail.processOutbox(),mail.processOutbox()])
    assert.equal(sent.length,deliveriesBeforeRetry+1,'concurrent retries deliver the queued message once')
    assert.equal(db.listOutbox().length,0)
    await mail.processOutbox()
    assert.equal(sent.length,deliveriesBeforeRetry+1,'completed queue entries are not sent again')
    const progressSnapshots=[]
    mail.setOutboxListener(()=>progressSnapshots.push(...mail.outboxItems().filter(item=>item.kind==='delete-many').map(item=>item.deletionProgress)))
    db.enqueueOutbox({kind:'delete-many',mailbox:'Spam',payload:{uids:[1,5000],uidValidity:'7',permanent:true}})
    failBatch = true
    await mail.processOutbox()
    assert.equal(db.listOutbox().length,1,'failed background deletion remains pending')
    assert.equal(mail.outboxItems()[0].deletionProgress.running,false,'a disconnected deletion is pending, not still running')
    db.closeCache();db.openAccountCache('one')
    failBatch = false
    await mail.processOutbox()
    assert.equal(db.listOutbox().length,0,'background deletion resumes after reopening the cache')
    assert.equal(deletedBatches.length,1)
    assert.equal(deletedBatches[0][0],'Spam')
    assert.deepEqual(Array.from(deletedBatches[0][1]),[1,5000])
    assert.equal(deletedBatches[0][2],true)
    assert.equal(deletedBatches[0][3],'7')
    assert.ok(progressSnapshots.some(progress=>progress.running&&progress.completed===0))
    assert.ok(progressSnapshots.some(progress=>progress.running&&progress.completed===1&&progress.total===2))
    assert.ok(progressSnapshots.some(progress=>progress.running&&progress.completed===2))
    db.clearDraft()
    assert.equal(db.readPickedAttachment('file1'),undefined)
    console.log('Compose mail: durable attachments/drafts, validation, CC/BCC privacy, reply headers, exact sent copy, queued offline mail and file cleanup passed')
  } finally { db.closeCache(); await fs.rm(directory,{recursive:true,force:true}) }
}
main().catch(error=>{console.error(error);process.exitCode=1})
