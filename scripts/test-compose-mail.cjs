const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
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
    const draft = {to:'to@example.com',cc:'copy@example.com',bcc:'hidden@example.com',subject:'Test',body:'Hello',html:'<p><strong>Hello</strong> <u>team</u></p>',attachments:[{id:'file1',name:'report.txt',size:19}],inReplyTo:'<parent@example.com>',references:['<root@example.com>','<parent@example.com>'],updatedAt:1}
    db.saveDraft(draft)
    db.closeCache(); db.openAccountCache('one')
    assert.equal(db.readDraft().html, draft.html)
    assert.equal(db.readDraft().bcc, 'hidden@example.com')
    assert.equal(db.readDraft().attachments[0].id,'file1')
    assert.equal(db.readPickedAttachment('file1').name,'report.txt')
    const sent = [], copies = []
    let failSmtp = false
    vm.runInNewContext(compile(await fs.readFile('src/main/mail.ts','utf8')), { exports:mail, Buffer, setTimeout:()=>0, console, require:id=>{
      if(id==='@shared/mailAddresses')return addresses
      if(id==='./db')return db
      if(id==='./drafts')return {queueDraftDelete:id=>db.clearDraft(id),syncDraft:async()=>{}}
      if(id==='./settings')return {readActiveAccount:async()=>({id:'one'})}
      if(id==='electron')return {dialog:{},BrowserWindow:{}}
      if(id==='nodemailer')return {createTransport:options=>options.streamTransport ? nodemailer.createTransport(options) : {sendMail:async message=>{if(failSmtp)throw new Error('Offline');sent.push(message)},close(){}}}
      if(id==='./imap')return {getCredentials:async()=>({account:{user:'from@example.com',smtp:{host:'localhost',port:465,secure:true}},password:'test'}),appendToSent:async raw=>copies.push(raw)}
      return require(id)
    }})
    const payload = {to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,text:draft.body,html:draft.html,attachments:['file1'],inReplyTo:draft.inReplyTo,references:draft.references}
    assert.equal((await mail.sendMail({...payload,to:'bad'})).ok,false)
    assert.equal((await mail.sendMail({...payload,attachments:['missing']})).ok,false)
    assert.equal(db.listOutbox().length,0)
    assert.equal((await mail.sendMail(payload)).ok,true)
    assert.deepEqual(Array.from(sent[0].envelope.to),['to@example.com','copy@example.com','hidden@example.com'])
    const parsed = await simpleParser(sent[0].raw)
    assert.equal(parsed.bcc,undefined)
    assert.ok(parsed.html.includes('<strong>Hello</strong>'))
    assert.ok(parsed.text.includes('Hello'))
    assert.equal(parsed.cc.value[0].address,'copy@example.com')
    assert.equal(parsed.inReplyTo,draft.inReplyTo)
    assert.equal(parsed.references[0],'<root@example.com>')
    assert.equal(parsed.attachments[0].content.toString(),'Attachment contents')
    assert.ok(copies[0].equals(sent[0].raw))
    failSmtp = true
    const queued = await mail.sendMail({...payload,attachments:[]})
    assert.equal(queued.ok,true)
    assert.equal(queued.queued,true)
    assert.equal(db.listOutbox().length,1)
    db.clearDraft()
    assert.equal(db.readPickedAttachment('file1'),undefined)
    console.log('Compose mail: durable attachments/drafts, validation, CC/BCC privacy, reply headers, exact sent copy, queued offline mail and file cleanup passed')
  } finally { db.closeCache(); await fs.rm(directory,{recursive:true,force:true}) }
}
main().catch(error=>{console.error(error);process.exitCode=1})
