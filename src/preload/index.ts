import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type CoreStatus, type MailApi } from '@shared/ipc'

/**
 * Única superficie que la UI puede tocar. Agregar un canal acá es una decisión
 * de seguridad, no un detalle de implementación.
 */
const api: MailApi = {
  getCoreStatus: (): Promise<CoreStatus> => ipcRenderer.invoke(IPC.coreStatus)
}

contextBridge.exposeInMainWorld('api', api)
