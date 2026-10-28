const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript-test')
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-recipients-'))
  const db = {}
  vm.runInNewContext(ts.transpile(await fs.readFile('src/main/db.ts','utf8'), {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}), {
    exports:db, require:id=>id==='electron'?{app:{getPath:()=>directory}}:require(id)
  })
  try {
    db.openAccountCache('one')
    db.rememberRecipients(['Alice@Example.com','alice@example.com','copy@example.com','hidden@example.com'])
    db.upsertEnvelopes('INBOX',[{uid:1,subject:'Hi',from:{name:'Jorge Ocejo',address:'jorge@example.com'},date:new Date().toISOString(),unread:false,flagged:false,size:1}])
    assert.equal(db.suggestRecipients('ALICE').length,1)
    assert.equal(db.suggestRecipients('Alice')[0].email,'alice@example.com')
    assert.equal(db.suggestRecipients('Ocejo')[0].email,'jorge@example.com')
    assert.equal(db.suggestRecipients('%').length,0)
    assert.equal(db.suggestRecipients("' OR 1=1 --").length,0)
    db.closeCache();db.openAccountCache('one')
    assert.equal(db.suggestRecipients('hidden')[0].email,'hidden@example.com')
    db.openAccountCache('two')
    assert.equal(db.suggestRecipients('').length,0,'account histories are isolated')
    db.openAccountCache('one')
    db.rememberRecipients(Array.from({length:20},(_,index)=>`person${index}@example.net`))
    assert.equal(db.suggestRecipients('').length,8,'suggestions remain bounded')
    console.log('Recipient cache: persistence, case-insensitive deduplication, sender names, CC/BCC addresses, safe search, limits and account isolation passed')
  } finally {db.closeCache();await fs.rm(directory,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})
