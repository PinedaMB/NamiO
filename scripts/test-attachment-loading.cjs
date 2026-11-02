const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript-test')
const compile = code => ts.transpile(code, {target: ts.ScriptTarget.ES2022})
const app = ts.createSourceFile('App.tsx', fs.readFileSync('src/renderer/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let openSource, effect
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'openAttachment') openSource = node.initializer.getText(app)
  if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect' && node.arguments[0]?.getText(app).includes('onAttachmentProgress')) effect = node.arguments[0].getText(app)
  ts.forEachChild(node, visit)
}
visit(app)
async function main() {
  let state = null, listener, unsubscribed = false
  const requests = []
  const selected = {id: 'live:1', messages: [{id: 'live:1', attachments: [{kind: 'pdf', name: 'report.pdf'}]}]}
  const context = {selected, readerThread: selected, live: true, folder: 'INBOX', uidOf: () => 1,
    attachmentRequest: {current: 0}, accountGeneration: {current: 1}, savingAttachmentRef: {current: false},
    setSavingAttachment() {}, setToast() {}, t: key => key,
    setAttachmentPreview: next => {state = typeof next === 'function' ? next(state) : next},
    window: {api: {
      onAttachmentProgress: callback => {listener = callback; return () => {unsubscribed = true}},
      previewAttachment: (path, uid, index, request) => new Promise((resolve, reject) => requests.push({path, uid, index, request, resolve, reject}))
    }}
  }
  const cleanup = vm.runInNewContext(compile(`(${effect})`), context)()
  const open = vm.runInNewContext(compile(`(${openSource})`), context)
  open(0, 'live:1')
  assert.equal(state.phase, 'waiting')
  listener({request: requests[0].request, phase: 'downloading'})
  assert.equal(state.phase, 'downloading')
  requests[0].reject(new Error('Offline'));await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.error, true)
  state.retry()
  assert.equal(state.phase, 'waiting');assert.equal(state.error, undefined)
  listener({request: requests[0].request, phase: 'preparing'})
  assert.equal(state.phase, 'waiting', 'late events from an older request cannot overwrite a retry')
  listener({request: requests[1].request, phase: 'preparing'})
  requests[1].resolve({kind: 'pdf', name: 'report.pdf', data: 'JVBERi0='})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.attachment.kind, 'pdf')
  listener({request: requests[1].request, phase: 'downloading'})
  assert.equal(state.phase, 'preparing', 'late progress cannot replace a completed preview')
  context.attachmentRequest.current++;state = null
  listener({request: requests[1].request, phase: 'waiting'})
  assert.equal(state, null, 'closing a preview prevents late progress from reopening it')
  cleanup();assert.ok(unsubscribed)

  const ipc = ts.createSourceFile('ipc.ts', fs.readFileSync('src/main/ipc.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  let handler
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ipc) === 'ipcMain.handle' && node.arguments[0]?.getText(ipc) === 'IPC.attachmentPreview') handler = node.arguments[1].getText(ipc)
    ts.forEachChild(node, find)
  }
  find(ipc)
  const events = []
  const preview = vm.runInNewContext(compile(`(${handler})`), {IPC: {attachmentProgress: 'attachment:progress'}, attachmentPreview: value => value,
    readAttachment: async (_path, _uid, _index, progress) => {progress('waiting');progress('downloading');return {name: 'report.pdf'}}})
  const sender = {isDestroyed: () => false, send: (channel, payload) => events.push([channel, payload.request, payload.phase])}
  await preview({sender}, 'INBOX', 1, 0, 7)
  assert.deepEqual(events, ['waiting', 'downloading', 'preparing'].map(phase => ['attachment:progress', 7, phase]))
  await assert.rejects(preview({sender}, 'INBOX', 1, 0, -1), /Solicitud/)
  console.log('Attachment loading: real phase events, retry, stale request isolation, close/cleanup and IPC validation passed')
}
main().catch(error => {console.error(error);process.exitCode = 1})
