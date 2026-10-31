const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const nodemailer = require('nodemailer')
const { simpleParser } = require('mailparser')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

/**
 * Un envío debe conservar su Message-ID entre intentos y, si un intento pudo
 * aceptarse sin confirmación, comprobar Enviados antes de volver a mandarlo.
 */
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-send-id-'))
  const db = {}, mail = {}, addresses = {}
  vm.runInNewContext(compile(await fs.readFile('src/shared/mailAddresses.ts', 'utf8')), { exports: addresses })
  vm.runInNewContext(compile(await fs.readFile('src/main/db.ts', 'utf8')), {
    exports: db,
    require: id => id === 'electron' ? { app: { getPath: () => directory } } : require(id)
  })
  db.openAccountCache('one')

  let fail = true
  let sent = 0
  let lastRaw = null
  let alreadySent = false
  const queries = []
  const transport = {
    sendMail: async message => {
      if (fail) {
        const error = new Error('connect ECONNREFUSED')
        error.code = 'ECONNECTION'
        throw error
      }
      sent += 1
      lastRaw = message.raw
    },
    close() {}
  }

  try {
    vm.runInNewContext(compile(await fs.readFile('src/main/mail.ts', 'utf8')), {
      exports: mail, Buffer, setTimeout: () => 0, console,
      require: id => {
        if (id === './db') return db
        if (id === '@shared/mailAddresses') return addresses
        if (id === './drafts') return { queueDraftDelete: () => {}, syncDraft: async () => {} }
        if (id === './settings') return { readActiveAccount: async () => ({ id: 'one', user: 'sender@example.com' }) }
        if (id === 'electron') return { dialog: {}, BrowserWindow: {} }
        if (id === 'nodemailer') return {
          createTransport: options => options.streamTransport ? nodemailer.createTransport(options) : transport
        }
        if (id === './imap') return {
          getCredentials: async () => ({
            account: { user: 'sender@example.com', smtp: { host: 'localhost', port: 465, secure: true } },
            password: 'test'
          }),
          appendToSent: async () => {},
          sentContains: async messageId => { queries.push(messageId); return alreadySent },
          deleteMessageBatch: async () => {}
        }
        return require(id)
      }
    })

    const payload = { to: 'dest@example.com', cc: '', subject: 'Hola', text: 'Cuerpo', attachments: [] }
    const queued = await mail.sendMail(payload)
    assert.equal(queued.queued, true)
    const row = db.listOutbox()[0]
    const stored = JSON.parse(row.payload)
    assert.match(stored.messageId, /^<[^<>]+@example\.com>$/, 'the Message-ID is generated once and persisted')
    assert.equal(typeof row.attemptedAt, 'number', 'the first attempt is recorded before sending')

    // El servidor pudo aceptar el mensaje y perderse la respuesta: está en Enviados.
    alreadySent = true
    fail = false
    await mail.processOutbox()
    assert.equal(sent, 0, 'a message already in Sent is not sent again')
    assert.deepEqual(queries, [stored.messageId])
    assert.equal(db.listOutbox().length, 0)

    // Un envío nuevo usa un Message-ID distinto y llega con esa cabecera.
    alreadySent = false
    await mail.sendMail({ ...payload, subject: 'Segundo' })
    assert.equal(sent, 1)
    assert.notEqual((await simpleParser(lastRaw)).messageId, stored.messageId)

    // Un fallo de red tras el primer intento reutiliza el mismo Message-ID.
    fail = true
    await mail.sendMail({ ...payload, subject: 'Tercero' })
    const retry = JSON.parse(db.listOutbox()[0].payload).messageId
    fail = false
    await mail.processOutbox()
    assert.equal(sent, 2)
    assert.equal((await simpleParser(lastRaw)).messageId, retry, 'the retry keeps its identity')

    console.log('Send idempotency: stable Message-ID, attempted marker and Sent-folder check prevent duplicate delivery')
  } finally {
    db.closeCache()
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
