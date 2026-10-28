const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const compile = source => ts.transpile(source, {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX})
const flush = () => new Promise(resolve => setImmediate(resolve))
function find(node, test) {
  if (!React.isValidElement(node)) return null
  if (test(node)) return node
  let found = null
  React.Children.forEach(node.props.children, child => {found ||= find(child, test)})
  return found
}
async function main() {
  const helpers = {}
  vm.runInNewContext(compile(fs.readFileSync('src/main/attachmentPreview.ts', 'utf8')), {exports: helpers, Buffer, TextDecoder, Error})
  const preview = (type, name, content) => helpers.attachmentPreview({type, name, content: Buffer.isBuffer(content) ? content : Buffer.from(content)})
  assert.equal(preview('text/plain', 'notas.txt', 'México y sincronización').text, 'México y sincronización')
  assert.equal(preview('application/octet-stream', 'NOTAS.TXT', Buffer.from([0xff, 0xfe, 0x4d, 0x00, 0xe9, 0x00])).text, 'Mé')
  assert.equal(preview('text/plain', 'notas.txt', Buffer.from([0xfe, 0xff, 0x00, 0x4d, 0x00, 0xe9])).text, 'Mé')
  assert.equal(preview('text/plain; charset=windows-1252', 'notas.txt', Buffer.from([0x4d, 0xe9, 0x78])).text, 'Méx')
  assert.equal(preview('text/plain', 'empty.txt', '').text, '')
  assert.equal(preview('application/pdf', 'one.pdf', '%PDF-1.4\n').kind, 'pdf')
  assert.equal(preview('application/octet-stream', 'one.PDF', '%PDF-1.4\n').kind, 'pdf')
  assert.throws(() => preview('application/pdf', 'bad.pdf', '<html>'), /PDF inválido/)
  assert.throws(() => preview('text/html', 'trick.txt', '<script>'), /no disponible/)
  assert.throws(() => preview('text/plain', 'binary.txt', Buffer.from([0, 1, 2])), /texto plano/)
  assert.throws(() => preview('text/plain', 'huge.txt', Buffer.alloc(20 * 1024 * 1024 + 1)), /20 MB/)

  const textViewer = {}
  vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/components/DocumentViewer.tsx', 'utf8')), {exports: textViewer, require: id => {
    if (id === 'react') return {...React, useRef: () => ({current: null}), useEffect() {}}
    if (id === '../i18n') return {useI18n: () => ({t: key => key})}
    if (id === './Icon') return {Icon: () => null}
    if (id === './Tooltip') return {TooltipButton: 'button'}
    return require(id)
  }})
  let closed = false, saved = false, stopped = false
  const props = {title: 'note.txt', attachment: preview('text/plain', 'note.txt', '<script>alert(1)</script>'), onClose: () => {closed = true}, onSave: () => {saved = true}}
  const tree = textViewer.DocumentViewer(props)
  const markup = renderToStaticMarkup(tree)
  assert.ok(markup.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(!markup.includes('<script>'))
  tree.props.onCancel({preventDefault() {}}); assert.equal(closed, true)
  tree.props.onKeyDown({stopPropagation: () => {stopped = true}}); assert.equal(stopped, true)
  find(tree, node => node.props.title === 'thread.download').props.onClick(); assert.equal(saved, true)
  assert.ok(find(textViewer.DocumentViewer({...props, attachment: undefined}), node => node.props.role === 'status'))
  assert.ok(find(textViewer.DocumentViewer({...props, error: true}), node => node.props.role === 'alert'))

  const state = [], refs = [], effects = []
  let slot = 0, refSlot = 0, resize, workerFailure, terminated = false, destroyed = false, workerDestroyed = false
  let replaced = 0, canceledRenders = 0, delayedRender = false, releaseRender
  const requestedPages = [], options = []
  const pdf = {numPages: 2, getPage: async number => {
    requestedPages.push(number)
    return {getViewport: ({scale}) => ({width: 600 * scale, height: 800 * scale}), render: params => {
      assert.ok(params.canvas.width * params.canvas.height <= 16_100_000)
      return {promise: delayedRender ? new Promise(resolve => {releaseRender = resolve}) : Promise.resolve(), cancel: () => {canceledRenders++}}
    }}
  }}
  const pdfModule = {}
  vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/components/PdfDocument.tsx', 'utf8')), {exports: pdfModule, Uint8Array, atob, URL, Promise,
    Worker: class {constructor(url) {assert.equal(url, 'file:///app/pdfjs/pdf.worker.min.mjs')} addEventListener(_name, listener) {workerFailure = listener} terminate() {terminated = true}},
    ResizeObserver: class {constructor(fn) {resize = fn} observe() {} disconnect() {}}, window: {devicePixelRatio: 2},
    document: {baseURI: 'file:///app/index.html', createElement: () => ({style: {}, setAttribute() {}})},
    require: id => {
      if (id === 'react') return {...React, useRef: value => {const index = refSlot++; return refs[index] ?? (refs[index] = {current: value})}, useEffect: fn => effects.push(fn), useState: value => {const index = slot++; if (!(index in state)) state[index] = value; return [state[index], next => {state[index] = next}]}}
      if (id === 'pdfjs-dist') return {PDFWorker: {create: () => ({destroy: () => {workerDestroyed = true}})}, getDocument: opts => {options.push(opts); return {promise: Promise.resolve(pdf), destroy: async () => {destroyed = true}}}}
      if (id === '../i18n') return {useI18n: () => ({t: key => key})}
      if (id === './Icon') return {Icon: () => null}
      if (id === './Tooltip') return {TooltipButton: 'button'}
      return require(id)
    }
  })
  function renderPdf() {slot = refSlot = 0; effects.length = 0; return pdfModule.PdfDocument({data: Buffer.from('%PDF-1.4').toString('base64')})}
  renderPdf()
  refs[0].current = {scrollTo() {}}
  refs[1].current = {replaceChildren() {replaced++}}
  const endDocument = effects[0]()
  const endResize = effects[1]()
  resize([{contentRect: {width: 800, height: 600}}])
  await flush()
  renderPdf()
  let endPage = effects[2]()
  await flush()
  assert.equal(replaced, 1)
  assert.equal(options[0].enableXfa, false)
  assert.equal(options[0].useWasm, false)
  assert.ok(options[0].standardFontDataUrl.startsWith('file:///app/pdfjs/'))
  find(renderPdf(), node => node.props.title === 'document.next').props.onClick()
  endPage()
  renderPdf(); endPage = effects[2](); await flush()
  assert.deepEqual(requestedPages, [1, 2])
  assert.equal(replaced, 2)
  delayedRender = true
  find(renderPdf(), node => node.props.title === 'image.zoomIn').props.onClick()
  endPage(); renderPdf(); endPage = effects[2](); await flush()
  endPage(); releaseRender(); await flush()
  assert.equal(replaced, 2, 'obsolete rendering cannot replace the current page')
  assert.ok(canceledRenders > 0)
  workerFailure()
  assert.ok(find(renderPdf(), node => node.props.role === 'alert'), 'worker startup errors must not leave an endless loader')
  endResize(); endDocument(); await flush()
  assert.ok(workerDestroyed && terminated, 'worker errors release the worker')
  const endCleanDocument = effects[0]()
  await flush()
  endCleanDocument()
  await flush()
  assert.equal(destroyed, true)

  const { pdfAssets } = await import('../scripts/pdf-assets.ts')
  const plugin = pdfAssets(), assets = new Map()
  plugin.generateBundle.call({emitFile: asset => assets.set(asset.fileName, asset.source)})
  for (const name of ['pdfjs/pdf.worker.min.mjs', 'pdfjs/standard_fonts/LiberationSans-Regular.ttf', 'pdfjs/wasm/openjpeg_nowasm_fallback.js', 'pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap']) assert.ok(assets.has(name), `${name} must ship locally`)
  assert.ok(!assets.has('pdfjs/wasm/quickjs-eval.js'))
  let middleware, passed = false
  plugin.configureServer({middlewares: {use: fn => {middleware = fn}}})
  middleware({url: '/pdfjs/../../package.json'}, {}, () => {passed = true})
  assert.equal(passed, true, 'development asset route cannot expose arbitrary files')
  console.log('PDF/TXT: encoding, safe text, validation, paging, zoom cancellation, cleanup, local assets and traversal protection passed')
}
main().catch(error => {console.error(error); process.exitCode = 1})
