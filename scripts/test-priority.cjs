const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const { simpleParser } = require('mailparser')
const ast = ts.createSourceFile('imap.ts', fs.readFileSync('src/main/imap.ts','utf8'), ts.ScriptTarget.Latest, true)
const code = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'fetchRange').getText(ast)
const compile = source => ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const fetchRange = vm.runInNewContext(compile(`(${code})`), { simpleParser, hasAttachments:()=>false, toAddress:()=>null, toDate:value=>new Date(value) })
async function main() {
  for (const [headers, expected] of [['Importance: high','high'],['X-Priority: 1 (Highest)','high'],['X-MSMail-Priority: High','high'],['Priority: urgent','high'],['Importance: low','low'],['X-Priority: 5 (Lowest)','low'],['Importance: normal','normal'],['X-Priority: garbage','normal'],['','normal']]) {
    const client = { async *fetch(range, query) {
      assert.ok(query.headers.includes('Importance'))
      assert.ok(query.headers.includes('X-Priority'))
      yield { uid:1, headers:Buffer.from(`${headers}\r\n\r\n`), internalDate:new Date(), flags:new Set(),size:20 }
    } }
    assert.equal((await fetchRange(client,'1',true))[0].priority,expected,headers)
  }
  console.log('Priority: IMAP header fetch and high/low/normal normalization verified')
}
main().catch(error=>{console.error(error);process.exitCode=1})
