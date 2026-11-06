const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = source => ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
const addresses = {}
vm.runInNewContext(compile(fs.readFileSync('src/shared/mailAddresses.ts', 'utf8')), { exports: addresses })
const api = {}
vm.runInNewContext(compile(fs.readFileSync('src/shared/mailto.ts', 'utf8')), { exports: api, URL, URLSearchParams, require: () => addresses })
const parse = value => JSON.parse(JSON.stringify(api.parseMailto(value)))
assert.deepEqual(parse('mailto:ana+news@example.com?to=otro%40example.com&CC=copia+tag@example.com&bcc=oculto%40example.com&subject=Hola%20mundo&body=L%C3%ADnea%201%0D%0AL%C3%ADnea%202'), {
  to: 'ana+news@example.com, otro@example.com', cc: 'copia+tag@example.com', bcc: 'oculto@example.com', subject: 'Hola mundo', body: 'Línea 1\r\nLínea 2'
})
assert.equal(parse('MAILTO:ana@example.com').to, 'ana@example.com')
assert.equal(parse('mailto:?subject=Sin%20destinatario').to, '')
for (const url of ['https://example.com', 'mailto:bad', 'mailto:ana@example.com%0D%0ABcc:otro@example.com', 'mailto:ana@example.com?subject=Hola%0AX-Evil:true', 'mailto:%ZZ', 'mailto:?body=%00', 'mailto:' + 'a'.repeat(65536)]) assert.equal(parse(url), null, url)
assert.deepEqual(Object.keys(parse('mailto:ana@example.com?attach=/etc/passwd&html=%3Cscript%3E&from=otro@example.com')), ['to', 'cc', 'bcc', 'subject', 'body'])

const source = fs.readFileSync('src/main/index.ts', 'utf8')
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
const receive = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'receiveMailto').getText(ast)
const sent = [], pending = []
let opened = 0
const context = { parseMailto: api.parseMailto, pendingMailto: pending, mailtoReady: false, mainWindow: null, IPC: { mailtoOpen: 'mailto' }, app: { isReady: () => false }, openWindow: () => opened++ }
const deliver = vm.runInNewContext(compile(receive + '; receiveMailto'), context)
deliver('mailto:ana@example.com')
assert.equal(pending.length, 1, 'startup links wait for the window')
context.app.isReady = () => true
context.mailtoReady = true
context.mainWindow = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } }
deliver('mailto:otro@example.com')
assert.equal(sent[0][1].to, 'otro@example.com', 'running instance receives the compose request')
assert.equal(opened, 1)
deliver('https://example.com')
assert.equal(sent.length, 1, 'invalid links do not open the compositor')

const preload = fs.readFileSync('src/preload/index.ts', 'utf8')
const buffer = preload.slice(preload.indexOf('const pendingMailto:'), preload.indexOf('const api: MailApi'))
const listeners = {}
const subscribe = preload.slice(preload.indexOf('  onMailtoOpen:'), preload.indexOf('  onZoomChanged:'))
const bridge = vm.runInNewContext(compile(buffer + '\nconst api = {' + subscribe + '}; api'), { IPC: { mailtoOpen: 'mailto' }, ipcRenderer: { on: (key, callback) => { listeners[key] = callback } } })
const drafts = []
listeners.mailto(null, { to: 'early@example.com' })
const unsubscribe = bridge.onMailtoOpen(draft => drafts.push(draft))
assert.equal(drafts[0].to, 'early@example.com', 'preload buffers links before React mounts')
unsubscribe()
listeners.mailto(null, { to: 'later@example.com' })
bridge.onMailtoOpen(draft => drafts.push(draft))
assert.equal(drafts.length, 2, 'resubscribing drains queued links exactly once')
const { createRequire } = require('node:module')
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const config = appBuilderRequire('js-yaml').load(fs.readFileSync('electron-builder.yml', 'utf8'))
assert.ok(config.protocols.some(protocol => protocol.schemes.includes('mailto')), 'installers register mailto as a supported protocol')

console.log('Mailto: parsing, injection rejection, startup delivery and preload buffering passed')
