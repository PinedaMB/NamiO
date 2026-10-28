const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/main/mail.ts', 'utf8')
const ast = ts.createSourceFile('mail.ts', source, ts.ScriptTarget.Latest, true)
const names = new Set(['pauseOutbox', 'resumeOutbox', 'processOutbox'])
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(ast).replace(/^export /, '')).join('\n')
let release, started
const running = new Promise(resolve => { started = resolve })
const rows = [{ id: 'first', status: 'queued' }, { id: 'second', status: 'queued' }]
const seen = []
const api = vm.runInNewContext(ts.transpile(`let processing = false, outboxPaused = false, processingDone = null;
${functions}
({pauseOutbox, resumeOutbox, processOutbox})`, { target: ts.ScriptTarget.ES2022 }), {
  console, cacheAccountId: () => 'one', listOutbox: () => rows, notify: () => {},
  registerFailure: (_, error) => { throw error },
  runOne: async row => {
    seen.push(row.id)
    if (row.id === 'first') { started(); await new Promise(resolve => { release = resolve }) }
    rows.splice(rows.indexOf(row), 1)
  }
})
async function main() {
  const drain = api.processOutbox()
  await running
  let paused = false
  const pause = api.pauseOutbox().then(() => { paused = true })
  await Promise.resolve()
  assert.equal(paused, false, 'must wait for the current operation')
  release()
  await Promise.all([pause, drain])
  assert.deepEqual(seen, ['first'])
  await api.processOutbox()
  assert.deepEqual(seen, ['first'], 'must remain paused')
  api.resumeOutbox()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(seen, ['first', 'second'])
  console.log('Outbox pause waits for in-flight operation, stops subsequent operations and resumes correctly')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
