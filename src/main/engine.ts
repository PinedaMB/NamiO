import { Buffer } from 'node:buffer'
import Module from 'node:module'

interface ParentPortLike {
  on: (event: 'message', listener: (message: unknown) => void) => void
  postMessage: (message: unknown) => void
}

type EngineMessage =
  | { type: 'init'; userDataDir: string; isPackaged: boolean }
  | { type: 'call'; id: number; method: string; args?: unknown[]; hasCallback?: boolean }
  | { type: 'hostResult'; id: number; ok: boolean; value?: unknown; error?: string }
  | { type: 'hostEvent'; name: string; windowId?: number; error?: string }
  | { type: 'shutdown'; id: number }

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort

function post(message: unknown): void {
  parentPort?.postMessage(message)
}

function unwrapMessage(raw: unknown): EngineMessage {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: EngineMessage }).data
  }
  return raw as EngineMessage
}

let hostCallSeq = 0
const pendingHostCalls = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

function callHost<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const id = ++hostCallSeq
  return new Promise<T>((resolve, reject) => {
    pendingHostCalls.set(id, {
      resolve: (value) => resolve(value as T),
      reject
    })
    post({ type: 'hostCall', id, method, args })
  })
}

let oauthWindowSeq = 0
const oauthWindowHandlers = new Map<number, { onClosed: () => void; onError: (message: string) => void }>()

function installElectronShim(userDataDir: string, isPackaged: boolean): void {
  const globals = globalThis as {
    __namioUserData?: string
    __namioSecretBridge?: {
      encryptSecret: (password: string) => Promise<string | null>
      decryptSecret: (secret: string) => Promise<string | null>
    }
    __namioOAuthWindowBridge?: {
      open: (url: string, onClosed: () => void, onError: (message: string) => void) => () => void
    }
  }

  globals.__namioUserData = userDataDir
  globals.__namioSecretBridge = {
    encryptSecret: (password: string) => callHost<string | null>('secret.encrypt', password),
    decryptSecret: (secret: string) => callHost<string | null>('secret.decrypt', secret)
  }
  globals.__namioOAuthWindowBridge = {
    open: (url, onClosed, onError) => {
      const windowId = ++oauthWindowSeq
      oauthWindowHandlers.set(windowId, { onClosed, onError })
      void callHost('oauth.openWindow', url, windowId).catch((error: unknown) => {
        const handler = oauthWindowHandlers.get(windowId)
        oauthWindowHandlers.delete(windowId)
        handler?.onError(error instanceof Error ? error.message : String(error))
      })
      return () => {
        oauthWindowHandlers.delete(windowId)
        void callHost('oauth.closeWindow', windowId).catch(() => undefined)
      }
    }
  }

  const electronStub = {
    app: {
      getPath: () => userDataDir,
      isPackaged,
      getVersion: () => ''
    },
    safeStorage: {
      getSelectedStorageBackend: () => 'unknown',
      isAsyncEncryptionAvailable: async () => false,
      encryptStringAsync: async () => Buffer.alloc(0),
      decryptStringAsync: async () => ({ result: '' })
    },
    shell: {
      openExternal: (url: string) => callHost<void>('shell.openExternal', url)
    },
    BrowserWindow: {
      getAllWindows: () => []
    },
    dialog: {}
  }

  const mod = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown
  }
  const originalLoad = mod._load
  mod._load = function (request: string, parent: unknown, isMain: boolean): unknown {
    if (request === 'electron') return electronStub
    return originalLoad.call(this, request, parent, isMain)
  }
}

type MethodHandler = (args: unknown[], onCallback?: (arg: unknown) => void) => unknown

let methods: Record<string, MethodHandler> | null = null
let shutdownHandler: (() => Promise<void>) | null = null

async function bootEngine(userDataDir: string, isPackaged: boolean): Promise<void> {
  installElectronShim(userDataDir, isPackaged)

  const [db, imap, mail, drafts, rules, preview] = await Promise.all([
    import('./db'),
    import('./imap'),
    import('./mail'),
    import('./drafts'),
    import('./rules'),
    import('./attachmentPreview')
  ])

  imap.setCacheListener((mailbox) => post({ type: 'event', name: 'cacheChanged', args: [mailbox] }))
  imap.setSyncProgressListener((progress) => post({ type: 'event', name: 'syncProgress', args: [progress] }))
  imap.setRulesListener(() => post({ type: 'event', name: 'rulesChanged', args: [] }))
  imap.setNewMailListener((account, path, messages) => post({ type: 'event', name: 'newMail', args: [account, path, messages] }))
  imap.setAccountsActivityListener((activity) => post({ type: 'event', name: 'accountsActivity', args: [activity] }))
  mail.setOutboxListener(() => post({ type: 'event', name: 'outboxChanged', args: [] }))

  methods = {
    // db
    initCache: (args) => db.initCache(args[0] as string | undefined),
    closeCache: () => db.closeCache(),
    cacheAccountId: () => db.cacheAccountId(),
    suggestRecipients: (args) => db.suggestRecipients(args[0] as string),
    cacheUsage: (args) => db.cacheUsage(args[0] as readonly { id: string }[]),
    listDrafts: () => db.listDrafts(),
    readDraft: (args) => db.readDraft(args[0] as string | undefined),
    prunePickedAttachments: () => db.prunePickedAttachments(),
    storePickedAttachment: (args) => {
      const data = args[2] as Buffer | Uint8Array
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      return db.storePickedAttachment(args[0] as string, args[1] as string, buf)
    },
    readMailboxes: () => db.readMailboxes(),
    getMailboxMeta: (args) => db.getMailboxMeta(args[0] as string),
    enqueueOutbox: (args) => db.enqueueOutbox(args[0] as Parameters<typeof db.enqueueOutbox>[0]),
    listSnoozed: () => db.listSnoozed(),
    snoozeMessage: (args) => db.snoozeMessage(args[0] as string, args[1] as number, args[2] as number),
    unsnoozeMessage: (args) => db.unsnoozeMessage(args[0] as string, args[1] as number),

    // imap
    accountIdFor: (args) => imap.accountIdFor(args[0] as string, args[1] as number, args[2] as string),
    activateAccount: (args) => imap.activateAccount(args[0] as Parameters<typeof imap.activateAccount>[0]),
    checkAccountsActivity: () => imap.checkAccountsActivity(),
    clearCachedMail: (args) => imap.clearCachedMail(args[0] as string),
    connectAccount: (args) => imap.connectAccount(args[0] as Parameters<typeof imap.connectAccount>[0], args[1] as string),
    connectAccountOAuth: (args, onCallback) =>
      imap.connectAccountOAuth(
        args[0] as Parameters<typeof imap.connectAccountOAuth>[0],
        onCallback ? (url) => onCallback(url) : undefined
      ),
    disconnectAccount: (args) => imap.disconnectAccount(args[0] as string),
    getAccountState: () => imap.getAccountState(),
    getMessage: (args) => imap.getMessage(args[0] as string, args[1] as number, args[2] as boolean | undefined),
    getSentReplies: (args) => imap.getSentReplies(args[0] as string, args[1] as number[], args[2] as boolean | undefined),
    getSyncProgress: () => imap.getSyncProgress(),
    resumeOfflineDownload: () => imap.resumeOfflineDownload(),
    listAccounts: () => imap.listAccounts(),
    listEnvelopes: (args) =>
      imap.listEnvelopes(
        args[0] as string,
        args[1] as number,
        args[2] as boolean | undefined,
        args[3] as Parameters<typeof imap.listEnvelopes>[3]
      ),
    listUnifiedInbox: (args) =>
      imap.listUnifiedInbox(args[0] as number, args[1] as Parameters<typeof imap.listUnifiedInbox>[1]),
    listMailboxes: (args) => imap.listMailboxes(args[0] as boolean | undefined),
    changeMailbox: (args) => imap.changeMailbox(args[0] as string, args[1] as boolean, args[2] as string),
    mailboxDeletionSnapshot: (args) => imap.mailboxDeletionSnapshot(args[0] as string),
    readAttachment: (args, onCallback) =>
      imap.readAttachment(
        args[0] as string,
        args[1] as number,
        args[2] as number,
        onCallback ? (phase) => onCallback(phase) : undefined
      ),
    searchMail: (args) =>
      imap.searchMail(args[0] as string, args[1] as number | undefined, args[2] as number | undefined, args[3] as boolean | undefined),
    searchServer: (args) =>
      imap.searchServer(args[0] as string, args[1] as string | undefined, args[2] as number | undefined),
    selectAccount: (args) => imap.selectAccount(args[0] as string),
    syncMailbox: (args) => imap.syncMailbox(args[0] as string),
    syncInbox: (args) => imap.syncInbox(args[0] as number | undefined),
    trashPath: () => imap.trashPath(),
    setFlagged: (args) => imap.setFlagged(args[0] as string, args[1] as number, args[2] as boolean),
    setSeen: (args) => imap.setSeen(args[0] as string, args[1] as number, args[2] as boolean),
    closeAllSessions: () => imap.closeAllSessions(),

    // mail
    moveMessageAction: (args) => mail.moveMessageAction(args[0] as string, args[1] as number, args[2] as string),
    archiveMessage: (args) => mail.archiveMessage(args[0] as string, args[1] as number),
    cancelOutbox: (args) => mail.cancelOutbox(args[0] as string),
    deleteMessageAction: (args) => mail.deleteMessageAction(args[0] as string, args[1] as number, args[2] as boolean),
    outboxItems: () => mail.outboxItems(),
    pauseOutbox: () => mail.pauseOutbox(),
    resumeOutbox: () => mail.resumeOutbox(),
    processOutbox: () => mail.processOutbox(),
    retryOutbox: (args) => mail.retryOutbox(args[0] as string),
    sendMail: (args) => mail.sendMail(args[0] as Parameters<typeof mail.sendMail>[0]),
    replyCalendarInvite: (args) => mail.replyCalendarInvite(args[0] as Parameters<typeof mail.replyCalendarInvite>[0], args[1] as 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'),

    // drafts
    openServerDraft: (args) => drafts.openServerDraft(args[0] as string, args[1] as number),
    queueDraftDelete: (args) => drafts.queueDraftDelete(args[0] as string),
    queueDraftSave: (args) => drafts.queueDraftSave(args[0] as Parameters<typeof drafts.queueDraftSave>[0]),

    // rules
    applyRulesToCache: () => rules.applyRulesToCache(),
    readRules: () => rules.readRules(),
    removeRule: (args) => rules.removeRule(args[0] as number),
    saveRule: (args) => rules.saveRule(args[0] as Parameters<typeof rules.saveRule>[0]),

    // attachmentPreview
    attachmentPreview: (args) => {
      const attachment = args[0] as { name: string; type: string; content: Buffer | Uint8Array }
      const content = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content)
      return preview.attachmentPreview({ ...attachment, content })
    }
  }

  shutdownHandler = async () => {
    await imap.closeAllSessions().catch(() => undefined)
    db.closeCache()
  }
}

parentPort?.on('message', (raw) => {
  const msg = unwrapMessage(raw)
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'init') {
    void bootEngine(msg.userDataDir, msg.isPackaged)
      .then(() => post({ type: 'ready' }))
      .catch((error: unknown) => {
        post({ type: 'initError', error: error instanceof Error ? error.message : String(error) })
      })
    return
  }

  if (msg.type === 'hostResult') {
    const pending = pendingHostCalls.get(msg.id)
    if (!pending) return
    pendingHostCalls.delete(msg.id)
    if (msg.ok) pending.resolve(msg.value)
    else pending.reject(new Error(msg.error ?? 'Host call failed'))
    return
  }

  if (msg.type === 'hostEvent') {
    if (msg.windowId === undefined) return
    const handler = oauthWindowHandlers.get(msg.windowId)
    if (!handler) return
    oauthWindowHandlers.delete(msg.windowId)
    if (msg.name === 'oauthWindowClosed') handler.onClosed()
    else if (msg.name === 'oauthWindowError') handler.onError(msg.error ?? 'OAuth window error')
    return
  }

  if (msg.type === 'shutdown') {
    void (shutdownHandler ? shutdownHandler() : Promise.resolve())
      .finally(() => {
        post({ type: 'result', id: msg.id, ok: true })
        process.exit(0)
      })
    return
  }

  if (msg.type === 'call') {
    const fn = methods?.[msg.method]
    if (!fn) {
      post({ type: 'result', id: msg.id, ok: false, error: `Unknown engine method: ${msg.method}` })
      return
    }
    const onCallback = msg.hasCallback
      ? (arg: unknown) => post({ type: 'callback', id: msg.id, arg })
      : undefined
    void Promise.resolve()
      .then(() => fn(msg.args ?? [], onCallback))
      .then(
        (value) => post({ type: 'result', id: msg.id, ok: true, value }),
        (error: unknown) =>
          post({
            type: 'result',
            id: msg.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined
          })
      )
  }
})
