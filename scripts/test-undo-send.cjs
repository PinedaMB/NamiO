const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const nodemailer = require('nodemailer')

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-undo-send-'))
  const db = {}
  const addresses = {}
  const mail = {}
  let sentCount = 0
  let scheduledWake = null

  try {
    vm.runInNewContext(compile(await fs.readFile('src/shared/mailAddresses.ts', 'utf8')), { exports: addresses, require })
    vm.runInNewContext(compile(await fs.readFile('src/main/db.ts', 'utf8')), {
      exports: db,
      Buffer,
      require: id => (id === 'electron' ? { app: { getPath: () => dir } } : require(id))
    })
    db.openAccountCache('one')

    vm.runInNewContext(compile(await fs.readFile('src/main/mail.ts', 'utf8')), {
      exports: mail,
      Buffer,
      console,
      setTimeout: (fn, ms) => { scheduledWake = { fn, ms }; return 1 },
      clearTimeout: () => { scheduledWake = null },
      require: id => {
        if (id === '@shared/mailAddresses') return addresses
        if (id === './db') return db
        if (id === './drafts') return { queueDraftDelete() {}, syncDraft: async () => {} }
        if (id === './settings') return { readActiveAccount: async () => ({ id: 'one', user: 'user@example.com' }) }
        if (id === 'electron') return { dialog: {}, BrowserWindow: {} }
        if (id === 'nodemailer') return {
          createTransport: options => options.streamTransport
            ? nodemailer.createTransport(options)
            : { sendMail: async () => { sentCount++ }, close() {} }
        }
        if (id === './imap') return {
          getCredentials: async () => ({ account: { user: 'user@example.com', smtp: { host: 'localhost', port: 465, secure: true } }, password: 'test' }),
          appendToSent: async () => {},
          sentContains: async () => false,
          syncInbox: async () => {}
        }
        return require(id)
      }
    })

    // 1. Send with delayMs returns undoId without calling SMTP yet
    const res = await mail.sendMail({
      to: 'dest@example.com',
      cc: '',
      subject: 'Undo test',
      text: 'Hello',
      delayMs: 7000
    })
    assert.equal(res.ok, true)
    assert.equal(res.queued, false)
    assert.ok(typeof res.undoId === 'string' && res.undoId.length > 0, 'returns undoId')
    assert.equal(sentCount, 0, 'SMTP must not run during undo grace window')
    assert.ok(scheduledWake && scheduledWake.ms >= 1000, 'wake timer scheduled')

    // 2. Canceling before timer fires prevents delivery completely
    mail.cancelOutbox(res.undoId)
    assert.equal(db.listOutbox().length, 0, 'canceled undo send removed from outbox')
    await mail.processOutbox()
    assert.equal(sentCount, 0, 'canceled send must never be delivered')

    // 3. When NOT canceled, once nextAttemptAt expires it delivers normally
    const res2 = await mail.sendMail({
      to: 'dest@example.com',
      cc: '',
      subject: 'Deliver after grace',
      text: 'Hello 2',
      delayMs: 5000
    })
    assert.ok(res2.undoId)
    assert.equal(sentCount, 0)
    db.updateOutbox(res2.undoId, { nextAttemptAt: Date.now() - 10 })
    await mail.processOutbox()
    assert.equal(sentCount, 1, 'un-canceled send delivers after grace window')
    assert.equal(db.listOutbox().length, 0)

    console.log('Undo send: grace window delay, cancel before delivery, and delivery after expiry passed')
  } finally {
    db.closeCache?.()
    await fs.rm(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
