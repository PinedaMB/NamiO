import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Busca versiones nuevas en las GitHub Releases, las descarga en segundo plano
 * y las instala al cerrar la app. Solo aplica a instaladores NSIS y AppImage;
 * el .deb se actualiza con apt.
 */
export function setupAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', () => undefined)

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
