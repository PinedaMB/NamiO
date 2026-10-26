import { app, ipcMain } from 'electron'
import { IPC, type CoreStatus } from '@shared/ipc'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.coreStatus, (): CoreStatus => {
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
      stage: 'M0',
      accountCount: 0
    }
  })
}
