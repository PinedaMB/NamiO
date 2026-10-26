import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AccountState,
  type AppSettings,
  type CachedResult,
  type CoreStatus,
  type Envelope,
  type ImapAccountConfig,
  type ImapResult,
  type MailboxInfo,
  type MailApi,
  type MessageDetail
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
  accountConnect: (config: ImapAccountConfig, password: string): Promise<ImapResult<AccountState>> =>
    ipcRenderer.invoke(IPC.accountConnect, config, password),
  accountDisconnect: (): Promise<void> => ipcRenderer.invoke(IPC.accountDisconnect),

  listMailboxes: (sync = true): Promise<CachedResult<MailboxInfo[]>> => ipcRenderer.invoke(IPC.mailboxesList, sync),
  listEnvelopes: (path: string, limit: number, sync = true): Promise<CachedResult<Envelope[]>> =>
    ipcRenderer.invoke(IPC.messagesList, path, limit, sync),
  getMessage: (path: string, uid: number): Promise<CachedResult<MessageDetail>> =>
    ipcRenderer.invoke(IPC.messageGet, path, uid),
  setFlagged: (path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>> =>
    ipcRenderer.invoke(IPC.messageFlag, path, uid, flagged),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.shellOpen, url),
  onCacheChanged: (listener: (mailbox: string) => void): (() => void) => {
    const handler = (_event: unknown, mailbox: string): void => listener(mailbox)
    ipcRenderer.on(IPC.cacheChanged, handler)
    return () => ipcRenderer.removeListener(IPC.cacheChanged, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
