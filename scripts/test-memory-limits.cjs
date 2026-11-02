const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

const MB = 1024 * 1024
const declarations = file => {
  const source = ts.createSourceFile(file, require('node:fs').readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return new Map(source.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node.getText(source)]))
}

/** Un mensaje/adjunto grande debe fallar con un error claro, no tumbar el proceso. */
async function main() {
  // Vista previa: el tope de 20 MB se comprueba antes de decodificar.
  const preview = {}
  vm.runInNewContext(compile(await fs.readFile('src/main/attachmentPreview.ts', 'utf8')), { exports: preview })
  assert.throws(() => preview.attachmentPreview({
    name: 'grande.png', type: 'image/png', content: Buffer.alloc(20 * MB + 1)
  }), /20 MB/)

  // Adjuntar: se comprueba el tamaño antes de leer el archivo a memoria.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-limits-'))
  const bigFile = path.join(directory, 'big.bin')
  await fs.writeFile(bigFile, Buffer.alloc(25 * MB + 1))
  const mail = {}
  try {
    vm.runInNewContext(compile(await fs.readFile('src/main/mail.ts', 'utf8')), {
      exports: mail, Buffer, setTimeout: () => 0, console,
      require: id => {
        if (id === 'electron') return { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [bigFile] }) }, BrowserWindow: {} }
        if (id === './settings') return { readActiveAccount: async () => ({ id: 'one' }) }
        if (id === './db') return { storePickedAttachment() {} }
        if (id === './drafts') return { queueDraftDelete() {}, syncDraft: async () => {} }
        if (id === './imap') return {
          appendToSent: async () => {}, archivePath: () => null, deleteMessage: async () => {},
          deleteMessageBatch: async () => {}, getCredentials: async () => null, moveMessage: async () => {},
          removeServerDraft: async () => {}, setSeen: async () => {}, syncInbox: async () => {}
        }
        if (id === '@shared/mailAddresses') return { splitRecipients: () => [], validRecipients: () => true }
        return require(id)
      }
    })
    await assert.rejects(mail.registerAttachments(null), /25 MB/, 'oversized attachments are rejected before reading')

    // El cuerpo selectivo se corta al pasar de 30 MB, sin concatenar todo.
    const imapFunctions = declarations('src/main/imap.ts')
    let chunks = 0
    const client = {
      mailbox: { uidValidity: 1n },
      fetchOne: async () => ({ uid: 1, bodyStructure: { type: 'text/plain', part: '1' } }),
      getMailboxLock: async () => ({ release() {} }),
      download: async () => ({
        content: (async function* () { while (chunks < 55) { chunks++; yield Buffer.alloc(MB) } })()
      })
    }
    const fetchMessage = vm.runInNewContext(compile(`
      ${imapFunctions.get('readLimited')}
      ${imapFunctions.get('cacheMessageBody')}
      ${imapFunctions.get('fetchMessage')}
      fetchMessage
    `), {
      ...require('./imap-test-helpers.cjs'), Buffer,
      MAX_MESSAGE_BYTES: 50 * MB, MAX_BODY_BYTES: 30 * MB, MAX_OFFLINE_MESSAGE_BYTES: 30 * MB,
      syncGeneration: 1, getMailboxMeta: () => ({ uidValidity: 1 }),
      ensureClient: async () => client,
      readEnvelope: () => ({ size: 0 }),
      simpleParser: async () => { throw new Error('no debe parsearse un mensaje por encima del límite') },
      toAddress: () => null,
      toDate: value => new Date(value)
    })
    await assert.rejects(fetchMessage('INBOX', 1), /límite de tamaño/)
    assert.ok(chunks <= 31, 'the download stops as soon as the limit is exceeded')

    console.log('Memory limits: preview 20 MB, attachment 25 MB and streamed body 30 MB fail early with clear errors')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
