import { ipcMain } from 'electron'
import { app } from 'electron'
import {
  IPC,
  type AppSettings,
  type CoreStatus,
  type ImapAccountConfig,
  type ImapResult,
  type MessageDetail
} from '@shared/ipc'
import {
  connectAccount,
  disconnectAccount,
  getAccountState,
  getMessage,
  listEnvelopes,
  listMailboxes,
  setFlagged
} from './imap'
import { encryptSecret, readSettings, writeSettings } from './settings'

function validConfig(config: ImapAccountConfig): boolean {
  return (
    typeof config.host === 'string' &&
    config.host.trim() !== '' &&
    Number.isInteger(config.port) &&
    config.port > 0 &&
    config.port < 65536 &&
    typeof config.user === 'string' &&
    config.user.trim() !== ''
  )
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.coreStatus, (): CoreStatus => {
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
      stage: 'M1',
      accountCount: 0
    }
  })

  ipcMain.handle(IPC.settingsGet, (): Promise<Partial<AppSettings>> => readSettings())

  ipcMain.handle(IPC.settingsSet, async (_event, patch: Partial<AppSettings>): Promise<void> => {
    await writeSettings(patch)
  })

  ipcMain.handle(IPC.accountStatus, () => getAccountState())

  ipcMain.handle(
    IPC.accountConnect,
    async (_event, config: ImapAccountConfig, password: string): Promise<ImapResult<unknown>> => {
      if (!validConfig(config) || typeof password !== 'string' || password === '') {
        return { ok: false, code: 'unknown', detail: 'Configuración incompleta' }
      }

      const result = await connectAccount(
        { host: config.host.trim(), port: config.port, secure: config.secure, user: config.user.trim() },
        password
      )
      if (!result.ok) return result

      // La contraseña solo se persiste si el SO ofrece cifrado (DPAPI, libsecret, Keychain).
      const secret = await encryptSecret(password)
      await writeSettings({
        account: {
          host: config.host.trim(),
          port: config.port,
          secure: config.secure,
          user: config.user.trim(),
          ...(secret ? { secret } : {})
        }
      })

      return { ok: true, data: await getAccountState() }
    }
  )

  ipcMain.handle(IPC.accountDisconnect, async (): Promise<void> => {
    await disconnectAccount()
    // Desconectar olvida la cuenta: sin contraseña guardada, mantenerla sería un
    // estado a medias que confunde más de lo que ayuda.
    await writeSettings({ account: undefined })
  })

  ipcMain.handle(IPC.mailboxesList, () => listMailboxes())
  ipcMain.handle(IPC.messagesList, (_event, path: string, limit: number) =>
    listEnvelopes(path, Math.min(Math.max(limit, 1), 200))
  )
  ipcMain.handle(IPC.messageGet, (_event, path: string, uid: number): Promise<ImapResult<MessageDetail>> =>
    getMessage(path, uid)
  )
  ipcMain.handle(IPC.messageFlag, (_event, path: string, uid: number, flagged: boolean) =>
    setFlagged(path, uid, flagged)
  )
}
