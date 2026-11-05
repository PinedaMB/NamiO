const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript-test')
const exportsObject = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/shared/mailboxes.ts','utf8'), {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}), {exports:exportsObject})
const {sidebarMailboxes,isAdditionalSpamMailbox}=exportsObject
const junk={path:'Junk',name:'Junk',specialUse:'\\Junk',messages:0,unseen:0}
const spam={path:'spam',name:'spam',specialUse:null,messages:0,unseen:0}
const inbox={path:'INBOX',name:'Inbox',specialUse:'\\Inbox',messages:4,unseen:1}
const paths=boxes=>Array.from(sidebarMailboxes(boxes),box=>box.path)
assert.deepEqual(paths([inbox,junk,spam]),['INBOX','Junk'])
assert.deepEqual(paths([inbox,spam]),['INBOX','spam'],'without an official folder, keep the fallback')
assert.deepEqual(paths([junk,{...spam,messages:1}]),['Junk','spam'])
assert.deepEqual(paths([junk,{...spam,unseen:1}]),['Junk','spam'])
assert.deepEqual(paths([junk,spam,{...spam,path:'spam/Archive',name:'Archive'}]),['Junk','spam','spam/Archive'])
assert.deepEqual(paths([junk,{...spam,specialUse:'\\Archive'}]),['Junk','spam'])
assert.deepEqual(paths([junk,{...spam,name:'junk',path:'junk',messages:2}]),['Junk','junk'])
assert.equal(spam.messages,0)
console.log('Spam folders: hide only empty additional spam folders, preserve official/fallback/content/children/special folders')

assert.equal(isAdditionalSpamMailbox(spam,[junk,spam]),true,'a populated or empty alias is identified without merging mailboxes')
assert.equal(isAdditionalSpamMailbox(junk,[junk,spam]),false,'official spam keeps its identity')
assert.equal(isAdditionalSpamMailbox(spam,[spam]),false,'the only spam folder remains the primary one')
assert.equal(isAdditionalSpamMailbox(inbox,[junk,inbox]),false)
