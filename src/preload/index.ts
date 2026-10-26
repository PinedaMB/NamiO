import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AccountState,
  type AppSettings,
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

  listMailboxes: (): Promise<ImapResult<MailboxInfo[]>> => ipcRenderer.invoke(IPC.mailboxesList),
  listEnvelopes: (path: string, limit: number): Promise<ImapResult<Envelope[]>> =>
    ipcRenderer.invoke(IPC.messagesList, path, limit),
  getMessage: (path: string, uid: number): Promise<ImapResult<MessageDetail>> =>
    ipcRenderer.invoke(IPC.messageGet, path, uid),
  setFlagged: (path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>> =>
    ipcRenderer.invoke(IPC.messageFlag, path, uid, flagged)
}

contextBridge.exposeInMainWorld('api', api)
