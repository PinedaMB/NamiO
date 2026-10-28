const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const { EventEmitter } = require('node:events')
const source = ts.transpile(fs.readFileSync('src/main/updater.ts', 'utf8'), { module: ts.ModuleKind.CommonJS })
async function run(supported) {
  const handlers = {}, broadcasts = []
  const updater = new EventEmitter()
  let checks = 0, installs = 0
  updater.checkForUpdates = async () => { checks++; updater.emit('update-not-available') }
  updater.quitAndInstall = () => installs++
  const exported = {}
  vm.runInNewContext(source, {
    exports: exported, process: { platform: 'win32', env: {} }, setInterval() {},
    require(name) {
      if (name === 'electron') return { app: { isPackaged: supported }, ipcMain: { handle: (key, fn) => handlers[key] = fn }, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...args) => broadcasts.push(args) } }] } }
      if (name === 'electron-updater') return { autoUpdater: updater }
      return { IPC: { updateStatus: 'status', updateCheck: 'check', updateInstall: 'install', updateChanged: 'changed' } }
    }
  })
  exported.setupAutoUpdate()
  await Promise.resolve()
  if (!supported) { assert.equal(handlers.status(), null); handlers.install(); assert.equal(installs, 0); assert.equal(checks, 0); return }
  assert.equal(checks, 1)
  handlers.install(); assert.equal(installs, 0)
  updater.emit('update-available', { version: '0.4.4' })
  updater.emit('download-progress', { percent: 45.7 })
  assert.equal(handlers.status().percent, 46)
  await handlers.check(); assert.equal(checks, 1)
  updater.emit('update-downloaded', { version: '0.4.4' })
  assert.equal(handlers.status().phase, 'ready')
  assert.equal(handlers.status().version, '0.4.4')
  handlers.install(); assert.equal(installs, 1)
  updater.emit('error', new Error('network'))
  assert.equal(handlers.status().phase, 'error')
  await handlers.check(); assert.equal(checks, 2)
  assert.equal(handlers.status().phase, 'idle')
  assert.ok(broadcasts.length > 0)
}
Promise.resolve().then(() => run(true)).then(() => run(false)).catch(error => { console.error(error); process.exitCode = 1 })
