import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AccountConfig,
  type AccountState,
  type AppSettings,
  type CachedResult,
  type CoreStatus,
  type Envelope,
  type ImapResult,
  type MailAction,
  type MailboxInfo,
  type MailApi,
  type MessageDetail,
  type OutboxItem,
  type PickedAttachment,
  type Draft,
  type Rule,
  type RuleDraft,
  type SearchHit,
  type SyncProgress,
  type SendMailPayload
} from '@shared/ipc'

/**
 * Única superficie que la UI puede tocar. Agregar un canal acá es una decisión
 * de seguridad, no un detalle de implementación.
 */
const api: MailApi = {
  getCoreStatus: (): Promise<CoreStatus> => ipcRenderer.invoke(IPC.coreStatus),
  getSettings: (): Promise<Partial<AppSettings>> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (settings: Partial<AppSettings>): Promise<void> => ipcRenderer.invoke(IPC.settingsSet, settings),

  accountStatus: (): Promise<AccountState> => ipcRenderer.invoke(IPC.accountStatus),
  accountConnect: (config: AccountConfig, password: string): Promise<ImapResult<AccountState>> =>
    ipcRenderer.invoke(IPC.accountConnect, config, password),
  accountConnectOAuth: (config: AccountConfig): Promise<ImapResult<AccountState>> =>
    ipcRenderer.invoke(IPC.accountConnectOAuth, config),
  accountDisconnect: (): Promise<void> => ipcRenderer.invoke(IPC.accountDisconnect),

  listMailboxes: (sync = true): Promise<CachedResult<MailboxInfo[]>> => ipcRenderer.invoke(IPC.mailboxesList, sync),
  listEnvelopes: (path: string, limit: number, sync = true): Promise<CachedResult<Envelope[]>> =>
    ipcRenderer.invoke(IPC.messagesList, path, limit, sync),
  getMessage: (path: string, uid: number): Promise<CachedResult<MessageDetail>> =>
    ipcRenderer.invoke(IPC.messageGet, path, uid),
  setFlagged: (path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>> =>
    ipcRenderer.invoke(IPC.messageFlag, path, uid, flagged),
  setSeen: (path: string, uid: number, seen: boolean): Promise<ImapResult<boolean>> =>
    ipcRenderer.invoke(IPC.messageSeen, path, uid, seen),
  archiveMessage: (path: string, uid: number): Promise<MailAction> =>
    ipcRenderer.invoke(IPC.messageArchive, path, uid),
  deleteMessage: (path: string, uid: number): Promise<MailAction> => ipcRenderer.invoke(IPC.messageDelete, path, uid),
  saveAttachment: (path: string, uid: number, index: number): Promise<string | null> =>
    ipcRenderer.invoke(IPC.attachmentSave, path, uid, index),

  sendMail: (payload: SendMailPayload): Promise<MailAction> => ipcRenderer.invoke(IPC.mailSend, payload),
  pickAttachments: (): Promise<PickedAttachment[]> => ipcRenderer.invoke(IPC.attachmentPick),
  getDraft: (): Promise<Draft | null> => ipcRenderer.invoke(IPC.draftGet),
  saveDraft: (draft: Draft): Promise<void> => ipcRenderer.invoke(IPC.draftSave, draft),
  clearDraft: (): Promise<void> => ipcRenderer.invoke(IPC.draftClear),
  listOutbox: (): Promise<OutboxItem[]> => ipcRenderer.invoke(IPC.outboxList),
  retryOutbox: (id: string): Promise<void> => ipcRenderer.invoke(IPC.outboxRetry, id),
  cancelOutbox: (id: string): Promise<void> => ipcRenderer.invoke(IPC.outboxCancel, id),
  search: (query: string, limit = 60): Promise<SearchHit[]> => ipcRenderer.invoke(IPC.searchQuery, query, limit),
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
