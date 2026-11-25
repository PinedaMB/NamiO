import type { MailtoDraft } from '@shared/mailto'
import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type CopilotRequest,
  type CopilotResult,
  type CopilotConfig,
  type UpdateState,
  type NotificationTarget,
  type AccountConfig,
  type CalendarEvent,
  type RecipientSuggestion,
  type AccountActivity,
  type AccountState,
  type AccountSummary,
  type AppSettings,
  type CachedResult,
  type CoreStatus,
  type EnvelopeListOptions,
  type EnvelopeListResult,
  type ImapResult,
  type MailAction,
  type MailboxInfo,
  type MailApi,
  type MessageDetail,
  type OutboxItem,
  type PickedAttachment,
  type PrintableMessage,
  type AttachmentPreview,
  type AttachmentProgress,
  type DiscoveredMailConfig,
  type UnifiedEnvelope,
  type Draft,
  type Rule,
  type RuleDraft,
  type SearchHit,
  type SyncProgress,
  type SendMailPayload,
  type SnoozedItem,
  type UnsubscribeInfo
} from '@shared/ipc'

/**
 * Única superficie que la UI puede tocar. Agregar un canal acá es una decisión
 * de seguridad, no un detalle de implementación.
 */
let copilotRequest = 0

// Buffer links until React subscribes, including links delivered during startup.
const pendingMailto: MailtoDraft[] = []
let mailtoListener: ((draft: MailtoDraft) => void) | null = null
ipcRenderer.on(IPC.mailtoOpen, (_event, draft: MailtoDraft) => {
  if (mailtoListener) mailtoListener(draft)
  else pendingMailto.push(draft)
})

const api: MailApi = {
  onMailtoOpen: listener => {
    mailtoListener = listener
    for (const draft of pendingMailto.splice(0)) listener(draft)
    return () => { mailtoListener = null }
  },
  onZoomChanged: listener => {
    const handler = (_event: unknown, percent: number): void => listener(percent)
    ipcRenderer.on(IPC.zoomChanged, handler)
    return () => ipcRenderer.removeListener(IPC.zoomChanged, handler)
  },
  onOauthUrl: (listener: (url: string) => void): (() => void) => {
    const handler = (_event: unknown, url: string): void => listener(url)
    ipcRenderer.on(IPC.oauthUrl, handler)
    return () => ipcRenderer.removeListener(IPC.oauthUrl, handler)
  },
  updateStatus: () => ipcRenderer.invoke(IPC.updateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  onUpdateChanged: (listener) => {
    const handler = (_event: unknown, state: UpdateState): void => listener(state)
    ipcRenderer.on(IPC.updateChanged, handler)
    return () => ipcRenderer.removeListener(IPC.updateChanged, handler)
  },
  testNotification: () => ipcRenderer.invoke(IPC.notificationTest),
  onNotificationOpen: (listener) => {
    const handler = (_event: unknown, target: NotificationTarget): void => listener(target)
    ipcRenderer.on(IPC.notificationOpen, handler)
    return () => ipcRenderer.removeListener(IPC.notificationOpen, handler)
  },
  suggestRecipients: (query: string): Promise<RecipientSuggestion[]> => ipcRenderer.invoke(IPC.recipientSuggestions, query),
  clearMailCache: (accountId: string): Promise<{ canceled: boolean }> => ipcRenderer.invoke(IPC.cacheClear, accountId),
  getCoreStatus: (): Promise<CoreStatus> => ipcRenderer.invoke(IPC.coreStatus),
  listOllamaModels: (server: string) => ipcRenderer.invoke(IPC.ollamaModels, server),
  configureCopilot: (config: CopilotConfig) => ipcRenderer.invoke(IPC.copilotConfigure, config),
  copilotStatus: () => ipcRenderer.invoke(IPC.copilotStatus),
  setCopilotKey: (key: string) => ipcRenderer.invoke(IPC.copilotKey, key),
  generateCopilot: async (input: CopilotRequest, onChunk?: (text: string) => void): Promise<CopilotResult> => {
    const request = ++copilotRequest
    const chunk = (_event: unknown, value: { request: number; text: string }): void => {
      if (value.request === request) onChunk?.(value.text)
    }
    ipcRenderer.on(IPC.copilotChunk, chunk)
    try { return await ipcRenderer.invoke(IPC.copilotGenerate, input, request) }
    finally { ipcRenderer.removeListener(IPC.copilotChunk, chunk) }
  },
  cancelCopilot: () => ipcRenderer.invoke(IPC.copilotCancel),
  getSettings: (): Promise<Partial<AppSettings>> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (settings: Partial<AppSettings>): Promise<void> => ipcRenderer.invoke(IPC.settingsSet, settings),

  accountStatus: (): Promise<AccountState> => ipcRenderer.invoke(IPC.accountStatus),
  accounts: (): Promise<AccountSummary[]> => ipcRenderer.invoke(IPC.accountsList),
  selectAccount: (id: string): Promise<ImapResult<AccountState>> => ipcRenderer.invoke(IPC.accountSelect, id),
  checkAccounts: (): Promise<AccountActivity[]> => ipcRenderer.invoke(IPC.accountsCheck),
  onAccountsActivity: (listener: (activity: AccountActivity[]) => void): (() => void) => {
    const handler = (_event: unknown, activity: AccountActivity[]): void => listener(activity)
    ipcRenderer.on(IPC.accountsActivity, handler)
    return () => ipcRenderer.removeListener(IPC.accountsActivity, handler)
  },
  accountConnect: (config: AccountConfig, password: string): Promise<ImapResult<AccountState>> =>
    ipcRenderer.invoke(IPC.accountConnect, config, password),
  accountConnectOAuth: (config: AccountConfig): Promise<ImapResult<AccountState>> =>
    ipcRenderer.invoke(IPC.accountConnectOAuth, config),
  autodiscoverAccount: (email: string): Promise<DiscoveredMailConfig | null> =>
    ipcRenderer.invoke(IPC.accountAutodiscover, email),
  accountRename: (label: string): Promise<ImapResult<AccountState>> => ipcRenderer.invoke(IPC.accountRename, label),
  accountDisconnect: (): Promise<boolean> => ipcRenderer.invoke(IPC.accountDisconnect),

  changeMailbox: (path: string, remove: boolean): Promise<ImapResult<boolean>> => ipcRenderer.invoke(IPC.mailboxChange, path, remove),
  listMailboxes: (sync = true): Promise<CachedResult<MailboxInfo[]>> => ipcRenderer.invoke(IPC.mailboxesList, sync),
  listEnvelopes: (path: string, limit: number, sync = true, options?: EnvelopeListOptions): Promise<EnvelopeListResult> =>
    ipcRenderer.invoke(IPC.messagesList, path, limit, sync, options),
  listUnifiedInbox: (limit: number, options?: EnvelopeListOptions): Promise<UnifiedEnvelope[]> =>
    ipcRenderer.invoke(IPC.unifiedInbox, limit, options),
  getSentReplies: (path, uids, cachedOnly = false) => ipcRenderer.invoke(IPC.sentReplies, path, uids, cachedOnly),
  getMessage: (path: string, uid: number, cachedOnly = false): Promise<CachedResult<MessageDetail>> =>
    ipcRenderer.invoke(IPC.messageGet, path, uid, cachedOnly),
  setFlagged: (path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>> =>
    ipcRenderer.invoke(IPC.messageFlag, path, uid, flagged),
  setSeen: (path: string, uid: number, seen: boolean): Promise<ImapResult<boolean>> =>
    ipcRenderer.invoke(IPC.messageSeen, path, uid, seen),
  moveMessage: (path: string, uid: number, target: string): Promise<MailAction> =>
    ipcRenderer.invoke(IPC.messageMove, path, uid, target),
  archiveMessage: (path: string, uid: number): Promise<MailAction> =>
    ipcRenderer.invoke(IPC.messageArchive, path, uid),
  deleteMessage: (path: string, uid: number): Promise<MailAction> => ipcRenderer.invoke(IPC.messageDelete, path, uid),
  deleteMessages: (path: string, uids?: number[]): Promise<MailAction> => ipcRenderer.invoke(IPC.messagesDelete, path, uids),
  previewAttachment: (path: string, uid: number, index: number, request?: number): Promise<AttachmentPreview> => ipcRenderer.invoke(IPC.attachmentPreview, path, uid, index, request),
  onAttachmentProgress: (listener: (progress: AttachmentProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: AttachmentProgress): void => listener(progress)
    ipcRenderer.on(IPC.attachmentProgress, handler)
    return () => ipcRenderer.removeListener(IPC.attachmentProgress, handler)
  },
  saveAttachment: (path: string, uid: number, index: number): Promise<string | null> =>
    ipcRenderer.invoke(IPC.attachmentSave, path, uid, index),

  sendMail: (payload: SendMailPayload): Promise<MailAction> => ipcRenderer.invoke(IPC.mailSend, payload),
  unsubscribeMessage: (info: UnsubscribeInfo): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.mailUnsubscribe, info),
  replyCalendarInvite: (event: CalendarEvent, status: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.mailCalendarReply, event, status),
  snoozeMessage: (mailbox: string, uid: number, wakeAt: number): Promise<SnoozedItem[]> =>
    ipcRenderer.invoke(IPC.messageSnooze, mailbox, uid, wakeAt),
  unsnoozeMessage: (mailbox: string, uid: number): Promise<SnoozedItem[]> =>
    ipcRenderer.invoke(IPC.messageUnsnooze, mailbox, uid),
  listSnoozed: (): Promise<SnoozedItem[]> => ipcRenderer.invoke(IPC.snoozedList),
  printMessage: (message: PrintableMessage): Promise<boolean> => ipcRenderer.invoke(IPC.messagePrint, message),
  pickAttachments: (): Promise<PickedAttachment[]> => ipcRenderer.invoke(IPC.attachmentPick),
  attachBuffers: (files: { name: string; data: Uint8Array }[]): Promise<PickedAttachment[]> =>
    ipcRenderer.invoke(IPC.attachmentAttachBuffers, files),
  getDraft: (id?: string): Promise<Draft | null> => ipcRenderer.invoke(IPC.draftGet, id),
  listDrafts: (): Promise<Draft[]> => ipcRenderer.invoke(IPC.draftsList),
  openDraft: (path: string, uid: number): Promise<Draft> => ipcRenderer.invoke(IPC.draftOpen, path, uid),
  saveDraft: (draft: Draft): Promise<{ id: string; queued: boolean }> => ipcRenderer.invoke(IPC.draftSave, draft),
  clearDraft: (id?: string): Promise<void> => ipcRenderer.invoke(IPC.draftClear, id),
  listOutbox: (): Promise<OutboxItem[]> => ipcRenderer.invoke(IPC.outboxList),
  retryOutbox: (id: string): Promise<void> => ipcRenderer.invoke(IPC.outboxRetry, id),
  cancelOutbox: (id: string): Promise<void> => ipcRenderer.invoke(IPC.outboxCancel, id),
  search: (query: string, limit = 60, offset = 0, allAccounts = false): Promise<SearchHit[]> =>
    ipcRenderer.invoke(IPC.searchQuery, query, limit, offset, allAccounts),
  searchServer: (query: string, mailbox = 'INBOX', limit = 30): Promise<SearchHit[]> =>
    ipcRenderer.invoke(IPC.searchServer, query, mailbox, limit),
  senderLogo: (email: string, mailbox: string): Promise<string | null> => ipcRenderer.invoke(IPC.senderLogo, email, mailbox),
  syncMailbox: (path: string): Promise<ImapResult<boolean>> => ipcRenderer.invoke(IPC.syncMailbox, path),
  syncProgress: (): Promise<SyncProgress | null> => ipcRenderer.invoke(IPC.syncProgress),
  onSyncProgress: (listener: (progress: SyncProgress | null) => void): (() => void) => {
    const handler = (_event: unknown, progress: SyncProgress | null): void => listener(progress)
    ipcRenderer.on(IPC.syncProgress, handler)
    return () => ipcRenderer.removeListener(IPC.syncProgress, handler)
  },
  onOutboxChanged: (listener: () => void): (() => void) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC.outboxChanged, handler)
    return () => ipcRenderer.removeListener(IPC.outboxChanged, handler)
  },

  rules: (): Promise<Rule[]> => ipcRenderer.invoke(IPC.rulesList),
  saveRule: (rule: RuleDraft & { id?: number }): Promise<Rule[]> => ipcRenderer.invoke(IPC.rulesSave, rule),
  deleteRule: (id: number): Promise<Rule[]> => ipcRenderer.invoke(IPC.rulesDelete, id),
  applyRules: (): Promise<{ matched: number }> => ipcRenderer.invoke(IPC.rulesApply),

  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.shellOpen, url),
  onCacheChanged: (listener: (mailbox: string) => void): (() => void) => {
    const handler = (_event: unknown, mailbox: string): void => listener(mailbox)
    ipcRenderer.on(IPC.cacheChanged, handler)
    return () => ipcRenderer.removeListener(IPC.cacheChanged, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
