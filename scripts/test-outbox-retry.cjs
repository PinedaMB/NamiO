const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript-test')
const nodemailer = require('nodemailer')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

/**
 * Regresión: un fallo de red no debe consumir intentos ni dejar el correo en
 * `failed` por el simple paso del tiempo. Un rechazo del servidor sí agota el
 * ciclo, y el reintento manual abre uno nuevo.
 */
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-outbox-retry-'))
  const db = {}, mail = {}, addresses = {}
  vm.runInNewContext(compile(await fs.readFile('src/shared/mailAddresses.ts', 'utf8')), { exports: addresses })
  vm.runInNewContext(compile(await fs.readFile('src/main/db.ts', 'utf8')), {
    exports: db,
    require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
  })
  db.openAccountCache('one')

  try {
    let mode = 'transient'
    let sent = 0
    const transport = {
      sendMail: async () => {
        if (mode === 'transient') {
          const error = new Error('connect ECONNREFUSED')
          error.code = 'ECONNECTION'
          throw error
        }
        if (mode === 'permanent') {
          const error = new Error('Invalid login')
          error.code = 'EAUTH'
          throw error
        }
        sent += 1
      },
      close() {}
    }

    vm.runInNewContext(compile(await fs.readFile('src/main/mail.ts', 'utf8')), {
      exports: mail,
      Buffer,
      setTimeout: () => 0,
      console,
      require: id => {
        if (id === '@shared/mailAddresses') return addresses
        if (id === './db') return db
        if (id === './drafts') return { queueDraftDelete: () => {}, syncDraft: async () => {} }
        if (id === './settings') return { readActiveAccount: async () => ({ id: 'one' }) }
        if (id === 'electron') return { dialog: {}, BrowserWindow: {} }
        if (id === 'nodemailer') return {
          createTransport: options => options.streamTransport ? nodemailer.createTransport(options) : transport
        }
        if (id === './imap') return {
          getCredentials: async () => ({
            account: { user: 'from@example.com', smtp: { host: 'localhost', port: 465, secure: true } },
            password: 'test'
          }),
          appendToSent: async () => {},
          sentContains: async () => false,
          deleteMessageBatch: async () => {}
        }
        return require(id)
      }
    })

    const payload = { to: 'dest@example.com', cc: '', subject: 'Sin red', text: 'Hola', attachments: [] }
    const queued = await mail.sendMail(payload)
    assert.equal(queued.ok, true)
    assert.equal(queued.queued, true, 'offline mail stays queued')
    assert.equal(db.listOutbox().length, 1)

    for (let index = 0; index < 6; index++) await mail.processOutbox()
    let row = db.listOutbox()[0]
    assert.equal(row.status, 'queued', 'network failures never become permanent by elapsed retries')
    assert.equal(row.attempts, 0, 'network failures do not consume attempts')
    assert.match(row.lastError ?? '', /ECONNREFUSED/)

    mode = 'permanent'
    for (let index = 0; index < 5; index++) await mail.processOutbox()
    row = db.listOutbox()[0]
    assert.equal(row.status, 'failed', 'a server rejection exhausts the attempt budget')
    assert.equal(row.attempts, 5)

    mode = 'ok'
    await mail.retryOutbox(row.id)
    assert.equal(sent, 1, 'manual retry starts a new attempt cycle and delivers')
    assert.equal(db.listOutbox().length, 0)

    console.log('Outbox retry: transient failures keep the item queued without consuming attempts; permanent errors fail; manual retry resets and delivers')
  } finally {
    db.closeCache()
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
