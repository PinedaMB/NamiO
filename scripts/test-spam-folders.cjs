const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const exportsObject = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/shared/mailboxes.ts','utf8'), {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}), {exports:exportsObject})
const {sidebarMailboxes}=exportsObject
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
