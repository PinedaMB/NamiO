import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppSettings, type CoreStatus, type MailApi } from '@shared/ipc'

/**
 * Única superficie que la UI puede tocar. Agregar un canal acá es una decisión
 * de seguridad, no un detalle de implementación.
 */
const api: MailApi = {
  getCoreStatus: (): Promise<CoreStatus> => ipcRenderer.invoke(IPC.coreStatus),
  getSettings: (): Promise<Partial<AppSettings>> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (settings: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC.settingsSet, settings)
}

contextBridge.exposeInMainWorld('api', api)
