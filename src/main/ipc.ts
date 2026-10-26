import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { app } from 'electron'
import {
  IPC,
  type AccountConfig,
  type AppSettings,
  type CoreStatus,
  type Draft,
  type ImapResult,
  type SendMailPayload
} from '@shared/ipc'
import {
  connectAccount,
  disconnectAccount,
  getAccountState,
  getMessage,
  listEnvelopes,
  listMailboxes,
  readAttachment,
  searchMail,
  setFlagged,
  setSeen
} from './imap'
import { archiveMessage, cancelOutbox, deleteMessageAction, outboxItems, processOutbox, registerAttachments, retryOutbox, sendMail } from './mail'
import { clearDraft, readDraft, saveDraft } from './db'
import { encryptSecret, readSettings, writeSettings } from './settings'

function validConfig(config: AccountConfig): boolean {
  const smtp = config.smtp
  return (
    typeof config.host === 'string' &&
    config.host.trim() !== '' &&
    Number.isInteger(config.port) &&
    config.port > 0 &&
    config.port < 65536 &&
    typeof config.user === 'string' &&
    config.user.trim() !== '' &&
    Boolean(smtp) &&
    typeof smtp.host === 'string' &&
    smtp.host.trim() !== '' &&
    Number.isInteger(smtp.port) &&
    smtp.port > 0 &&
    smtp.port < 65536
  )
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.coreStatus, (): CoreStatus => {
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
      stage: 'M3',
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
    async (_event, config: AccountConfig, password: string): Promise<ImapResult<unknown>> => {
      if (!validConfig(config) || typeof password !== 'string' || password === '') {
        return { ok: false, code: 'unknown', detail: 'Configuración incompleta' }
      }

      const normalized: AccountConfig = {
        host: config.host.trim(),
        port: config.port,
        secure: config.secure,
        user: config.user.trim(),
        smtp: {
          host: config.smtp.host.trim(),
          port: config.smtp.port,
          secure: config.smtp.secure
        }
      }

      const result = await connectAccount(normalized, password)
      if (!result.ok) return result

      // La contraseña solo se persiste si el SO ofrece cifrado (DPAPI, libsecret, Keychain).
      const secret = await encryptSecret(password)
      await writeSettings({
        account: { ...normalized, ...(secret ? { secret } : {}) }
      })

      // Al recuperar la cuenta, se drena lo que haya quedado en la cola.
      void processOutbox()

      return { ok: true, data: await getAccountState() }
    }
  )

  ipcMain.handle(IPC.accountDisconnect, async (): Promise<void> => {
    await disconnectAccount()
    // Desconectar olvida la cuenta: sin contraseña guardada, mantenerla sería un
    // estado a medias que confunde más de lo que ayuda.
    await writeSettings({ account: undefined })
  })

  ipcMain.handle(IPC.mailboxesList, (_event, sync: boolean = true) => listMailboxes(sync))
  ipcMain.handle(IPC.messagesList, (_event, path: string, limit: number, sync: boolean = true) =>
    listEnvelopes(path, Math.min(Math.max(limit, 1), 500), sync)
  )
  ipcMain.handle(IPC.messageGet, (_event, path: string, uid: number) => getMessage(path, uid))
  ipcMain.handle(IPC.messageFlag, (_event, path: string, uid: number, flagged: boolean) =>
    setFlagged(path, uid, flagged)
  )
  ipcMain.handle(IPC.messageSeen, (_event, path: string, uid: number, seen: boolean) => setSeen(path, uid, seen))
  ipcMain.handle(IPC.messageArchive, (_event, path: string, uid: number) => archiveMessage(path, uid))
  ipcMain.handle(IPC.messageDelete, (_event, path: string, uid: number) => deleteMessageAction(path, uid))

  ipcMain.handle(IPC.attachmentSave, async (event, path: string, uid: number, index: number) => {
    const attachment = await readAttachment(path, uid, index)
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { defaultPath: attachment.name }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, attachment.content)
    return result.filePath
  })

  ipcMain.handle(IPC.attachmentPick, (event) =>
    registerAttachments(BrowserWindow.fromWebContents(event.sender))
  )

  ipcMain.handle(IPC.draftGet, () => readDraft())
  ipcMain.handle(IPC.draftSave, (_event, draft: Draft) => {
    saveDraft({ ...draft, updatedAt: Date.now() })
  })
  ipcMain.handle(IPC.draftClear, () => clearDraft())

  ipcMain.handle(IPC.mailSend, (_event, payload: SendMailPayload) => sendMail(payload))
  ipcMain.handle(IPC.outboxList, () => outboxItems())
  ipcMain.handle(IPC.outboxRetry, (_event, id: string) => retryOutbox(id))
  ipcMain.handle(IPC.outboxCancel, (_event, id: string) => cancelOutbox(id))

  ipcMain.handle(IPC.searchQuery, (_event, query: string, limit: number = 60) =>
    searchMail(String(query ?? '').slice(0, 200), Math.min(Math.max(limit, 1), 100))
  )

  ipcMain.handle(IPC.shellOpen, async (_event, url: string): Promise<boolean> => {
    // Solo se abre lo que el usuario puede esperar: sin file://, sin protocolos raros.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return false
    await shell.openExternal(url)
    return true
  })
}
