const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const compile = text => ts.transpile(text, {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX})
const selectionHelpers = {}
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/lib/selection.ts', 'utf8')), {exports: selectionHelpers})
function find(node, test) {
  if (!React.isValidElement(node)) return null
  if (test(node)) return node
  let result = null
  React.Children.forEach(node.props.children, child => {result ||= find(child, test)})
  return result
}
async function main() {
  const state = [], refs = [], effects = []
  let stateIndex = 0, refIndex = 0, resize, closed = 0, saved = 0, shown = 0, nativeClosed = 0
  const exports = {}
  vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/components/ImageViewer.tsx', 'utf8')), {exports,
    ResizeObserver: class {constructor(callback) {resize = callback} observe() {} disconnect() {}},
    require: id => {
      if (id === 'react') return {...React, useState: initial => {const slot = stateIndex++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => {state[slot] = value}]}, useRef: initial => {const slot = refIndex++; return refs[slot] ?? (refs[slot] = {current: initial})}, useEffect: fn => effects.push(fn)}
      if (id === '../lib/selection') return selectionHelpers
      if (id === '../i18n') return {useI18n: () => ({t: key => key})}
      if (id === './Icon') return {Icon: () => null}
      if (id === './Tooltip') return {TooltipButton: 'button'}
      return require(id)
    }
  })
  function render(extra = {}) {stateIndex = refIndex = 0; return exports.ImageViewer({src: 'data:image/png;base64,AA==', title: 'photo.png', onClose: () => {closed++}, onSave: () => {saved++}, ...extra})}
  let tree = render()
  tree.props.ref.current = {showModal: () => {shown++}, close: () => {nativeClosed++}}
  find(tree, node => node.props.className === 'image-viewer__stage').props.ref.current = {}
  const cleanup = effects[0]()
  assert.equal(shown, 1)
  resize([{contentRect: {width: 800, height: 600}}])
  find(tree, node => node.type === 'img').props.onLoad({currentTarget: {naturalWidth: 1600, naturalHeight: 1200}})
  tree = render()
  const zoomText = () => find(render(), node => node.props.className === 'image-viewer__zoom').props.children
  assert.equal(zoomText(), '46%')
  find(tree, node => node.props['aria-label'] === 'image.zoomIn').props.onClick()
  assert.equal(zoomText(), '58%')
  find(render(), node => node.props.children === '100%').props.onClick()
  assert.equal(zoomText(), '100%')
  find(render(), node => node.props['aria-label'] === 'image.fit').props.onClick()
  assert.equal(zoomText(), '46%')
  let stopped = false, prevented = false
  render().props.onKeyDown({key: '+', stopPropagation: () => {stopped = true}, preventDefault: () => {prevented = true}})
  assert.ok(stopped && prevented)
  render().props.onCancel({preventDefault() {}})
  assert.equal(closed, 1, 'native Escape closes only the viewer')
  find(render(), node => node.props['aria-label'] === 'thread.download').props.onClick()
  assert.equal(saved, 1)
  find(render(), node => node.type === 'img').props.onError()
  assert.ok(find(render(), node => node.props.role === 'alert'))
  const busySave = find(render({saving: true}), node => node.props['aria-label'] === 'attachment.preparing')
  assert.equal(busySave.props.disabled, true)
  assert.equal(busySave.props['aria-busy'], true)
  assert.ok(find(render({saving: true}), node => node.props.className === 'attachment-progress' && node.props.role === 'status'))
  cleanup(); assert.equal(nativeClosed, 1)

  const ipcSource = fs.readFileSync('src/main/ipc.ts', 'utf8')
  const ast = ts.createSourceFile('ipc.ts', ipcSource, ts.ScriptTarget.Latest, true)
  let handler
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.attachmentPreview') handler = node.arguments[1].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  let attachment = {name: 'photo.png', type: 'image/png', content: Buffer.from('test')}, requests = 0
  const previewHelpers = {}
  vm.runInNewContext(compile(fs.readFileSync('src/main/attachmentPreview.ts', 'utf8')), {exports: previewHelpers, Buffer, TextDecoder, Error})
  const preview = vm.runInNewContext(compile(`(${handler})`), {Error, attachmentPreview: previewHelpers.attachmentPreview, readAttachment: async () => {requests++; return attachment}})
  assert.equal((await preview(null, 'INBOX', 1, 0)).src, 'data:image/png;base64,dGVzdA==')
  await assert.rejects(preview(null, 'INBOX', -1, 0), /inválido/)
  assert.equal(requests, 1)
  attachment = {...attachment, type: 'text/html'}
  await assert.rejects(preview(null, 'INBOX', 1, 0), /no disponible/)
  attachment = {...attachment, type: 'image/svg+xml'}
  await assert.rejects(preview(null, 'INBOX', 1, 0), /no disponible/)
  attachment = {...attachment, type: 'image/png', content: Buffer.alloc(20 * 1024 * 1024 + 1)}
  await assert.rejects(preview(null, 'INBOX', 1, 0), /límite/)

  const appSource = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
  const appAst = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let openSource
  function visitApp(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === 'openAttachment') openSource = node.initializer.getText(appAst)
    ts.forEachChild(node, visitApp)
  }
  visitApp(appAst)
  let displayed, finish, saves = 0
  const context = {savingAttachmentRef: {current: false}, setSavingAttachment() {}, selected: {id: 'live:1', messages: [{id: 'live:1', attachments: [{kind: 'image', name: 'photo.png'}]}]}, live: true,
    uidOf: id => Number(id.slice(5)), folder: 'INBOX', accountGeneration: {current: 1}, attachmentRequest: {current: 0}, setAttachmentPreview: value => {displayed = value}, setToast() {}, t: key => key,
    window: {api: {previewAttachment: () => new Promise(resolve => {finish = resolve}), saveAttachment: async () => {saves++; return null}}}}
  const open = vm.runInNewContext(compile(`(${openSource})`), context)
  open(0, 'live:1'); assert.equal(displayed.title, 'photo.png')
  context.attachmentRequest.current++
  displayed = null
  finish({name: 'photo.png', src: 'data:image/png;base64,AA=='})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(displayed, null, 'closing pending previews prevents late reopening')
  context.selected.messages[0].attachments[0].kind = 'sheet'
  open(0, 'live:1'); await new Promise(resolve => setImmediate(resolve))
  assert.equal(saves, 1, 'non-image attachment keeps the save flow')
  const imapSource = fs.readFileSync('src/main/imap.ts', 'utf8')
  const imapAst = ts.createSourceFile('imap.ts', imapSource, ts.ScriptTarget.Latest, true)
  const readSource = imapAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readAttachment').getText(imapAst).replace(/^export /, '')
  let releaseParse, releasedLock = false
  const readerContext = {Buffer, Error, syncGeneration: 1, serial: fn => Promise.resolve().then(fn),
    ensureClient: async () => ({getMailboxLock: async () => ({release: () => {releasedLock = true}}), download: async () => ({content: (async function* () {yield Buffer.from('mime')})()})}),
    simpleParser: () => new Promise(resolve => {releaseParse = resolve})}
  const readAttachment = vm.runInNewContext(compile(`(${readSource})`), readerContext)
  const reading = readAttachment('INBOX', 1, 0)
  await new Promise(resolve => setImmediate(resolve))
  readerContext.syncGeneration++
  releaseParse({attachments: [{filename: 'photo.png', contentType: 'image/png', content: Buffer.from('image')}]})
  await assert.rejects(reading, /cuenta activa cambió/)
  assert.equal(releasedLock, true)
  console.log('Image viewer: fit/zoom, keyboard isolation, native close, save/errors, safe preview MIME/size, cancellation and non-image downloads passed')
}
main().catch(error => {console.error(error); process.exitCode = 1})
