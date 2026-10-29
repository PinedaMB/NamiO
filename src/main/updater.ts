import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateState } from '../shared/ipc'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function setupAutoUpdate(): void {
  const supported = app.isPackaged && (process.platform === 'win32' || Boolean(process.env.APPIMAGE))
  let state: UpdateState = { phase: 'idle' }
  let checking = false
  const publish = (next: UpdateState): void => {
    state = next
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.updateChanged, state)
    }
  }
  const check = async (): Promise<void> => {
    if (!supported || checking || ['available', 'downloading', 'ready'].includes(state.phase)) return
    checking = true
    publish({ phase: 'checking' })
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      publish({ phase: 'error' })
    } finally {
      checking = false
    }
  }
  ipcMain.handle(IPC.updateStatus, () => supported ? state : null)
  ipcMain.handle(IPC.updateCheck, check)
  ipcMain.handle(IPC.updateInstall, () => {
    if (supported && state.phase === 'ready') autoUpdater.quitAndInstall()
  })
  if (!supported) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', info => publish({ phase: 'available', version: info.version, releaseDate: info.releaseDate, checkedAt: Date.now() }))
  autoUpdater.on('update-not-available', info => publish({ phase: 'idle', version: info?.version, releaseDate: info?.releaseDate, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', progress => publish({ ...state, phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent))), transferred: progress.transferred, total: progress.total, bytesPerSecond: progress.bytesPerSecond }))
  autoUpdater.on('update-downloaded', info => publish({ ...state, phase: 'ready', version: info.version, releaseDate: info.releaseDate }))
  autoUpdater.on('error', () => publish({ phase: 'error' }))
  void check()
  setInterval(() => void check(), CHECK_INTERVAL_MS)
}
