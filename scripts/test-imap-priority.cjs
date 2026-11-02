const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const source = fs.readFileSync('src/main/imap.ts', 'utf8')
const ast = ts.createSourceFile('imap.ts', source, ts.ScriptTarget.Latest, true)
const code = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'serial').getText(ast)
const serial = vm.runInNewContext(ts.transpile(`const operations=[];let operationRunning=false;${code};serial`, { target: ts.ScriptTarget.ES2022 }), {})
const flush = () => new Promise(resolve => setImmediate(resolve))
;(async () => {
  const events = []
  let release, active = 0
  const first = serial(async () => { active++; events.push('running'); await new Promise(resolve => { release = resolve }); active-- }, 'background')
  await flush()
  const task = label => async () => { assert.equal(active, 0, 'IMAP operations never overlap'); active++; events.push(label); active--; return label }
  const background = serial(task('background'), 'background')
  const reader = serial(task('reader'), 'interactive')
  assert.deepEqual(events, ['running'], 'an active operation is not interrupted')
  release()
  assert.deepEqual(await Promise.all([first, background, reader]), [undefined, 'background', 'reader'])
  assert.deepEqual(events, ['running', 'reader', 'background'])
  events.length = 0
  await Promise.all([
    serial(task('before switch'), 'background'), serial(task('account switch')),
    serial(task('after switch'), 'background'), serial(task('attachment'), 'interactive')
  ])
  assert.deepEqual(events, ['before switch', 'account switch', 'attachment', 'after switch'], 'interactive work never passes an account or write barrier')
  const failed = serial(async () => { throw new Error('Connection failed') }, 'interactive')
  const next = serial(task('recovery'), 'background')
  await assert.rejects(failed, /Connection failed/)
  assert.equal(await next, 'recovery', 'a failed operation cannot block the queue')
  console.log('IMAP priority: interactive reads, mutual exclusion, active locks, account barriers and error recovery passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
