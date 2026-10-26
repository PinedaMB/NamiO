import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { IPC, type AppSettings, type CoreStatus } from '@shared/ipc'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<Partial<AppSettings>> {
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<AppSettings>) : {}
  } catch {
    // Primera ejecución o archivo corrupto: se arranca con los valores por defecto.
    return {}
  }
}

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

  ipcMain.handle(IPC.settingsGet, (): Promise<Partial<AppSettings>> => readSettings())

  ipcMain.handle(
    IPC.settingsSet,
    async (_event, patch: Partial<AppSettings>): Promise<void> => {
      const current = await readSettings()
      await writeFile(settingsPath(), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf8')
    }
  )
}
