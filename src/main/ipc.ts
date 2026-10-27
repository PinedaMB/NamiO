import { senderLogo } from './senderLogo'
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
  type RuleDraft,
  type SendMailPayload
} from '@shared/ipc'
import {
  accountIdFor,
  activateAccount,
  checkAccountsActivity,
  clearCachedMail,
  connectAccount,
  connectAccountOAuth,
  disconnectAccount,
  getAccountState,
  getMessage,
  getSyncProgress,
  listAccounts,
  listEnvelopes,
  listMailboxes,
  readAttachment,
  searchMail,
  selectAccount,
  syncMailbox,
  trashPath,
  setFlagged,
  setSeen
} from './imap'
import { archiveMessage, cancelOutbox, deleteMessageAction, outboxItems, processOutbox, registerAttachments, retryOutbox, sendMail } from './mail'
import { cacheUsage, clearDraft, readDraft, saveDraft } from './db'
import { applyRulesToCache, readRules, removeRule, saveRule } from './rules'
import { encryptSecret, readActiveAccount, readAccounts, updateAccount, readSettings, writeSettings } from './settings'

function validConfig(config: AccountConfig): boolean {
  const smtp = config.smtp
  return (
    (config.label === undefined || (typeof config.label === 'string' && config.label.trim().length <= 80)) &&
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
  ipcMain.handle(IPC.coreStatus, async (): Promise<CoreStatus> => {
    const { accounts } = await readAccounts()
    return {
      cacheUsage: await cacheUsage(accounts).catch(() => null),
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
      stage: 'M8',
      accountCount: accounts.length
    }
  })

  ipcMain.handle(IPC.cacheClear, async (event, accountId: string) => {
    const { accounts } = await readAccounts()
    const account = accounts.find(item => item.id === accountId)
    if (typeof accountId !== 'string' || !account) throw new Error('Cuenta inválida')
    const english = (await readSettings()).language === 'en'
    const options = {
      type: 'question' as const,
      buttons: english ? ['Cancel', 'Clear cache'] : ['Cancelar', 'Vaciar caché'],
      defaultId: 0,
      cancelId: 0,
      title: english ? 'Clear mail cache' : 'Vaciar caché de correo',
      message: account.label || account.user,
      detail: english
        ? 'Downloaded message bodies will be removed from this device and downloaded again when opened. Server mail, drafts, rules and pending operations are kept.'
        : 'Se quitarán los cuerpos descargados de este equipo y se descargarán al abrirlos de nuevo. Se conservan los correos del servidor, borradores, reglas y operaciones pendientes.'
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
    if (result.response !== 1) return { canceled: true }
    if (!(await readAccounts()).accounts.some(item => item.id === accountId)) throw new Error('Cuenta inválida')
    await clearCachedMail(accountId)
    return { canceled: false }
  })

  ipcMain.handle(IPC.settingsGet, (): Promise<Partial<AppSettings>> => readSettings())

  ipcMain.handle(IPC.settingsSet, async (_event, patch: Partial<AppSettings>): Promise<void> => {
    await writeSettings(patch)
  })

  ipcMain.handle(IPC.accountStatus, () => getAccountState())

  ipcMain.handle(IPC.accountsList, () => listAccounts())

  ipcMain.handle(IPC.accountSelect, (_event, id: string) => selectAccount(String(id)))

  ipcMain.handle(IPC.accountsCheck, () => checkAccountsActivity())

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
        label: config.label?.trim(),
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
      await activateAccount({
        id: await accountIdFor(normalized.host, normalized.port, normalized.user),
        ...normalized,
        ...(secret ? { secret } : {})
      })

      // Al recuperar la cuenta, se drena lo que haya quedado en la cola.
      void processOutbox()

      return { ok: true, data: await getAccountState() }
    }
  )

  ipcMain.handle(
    IPC.accountConnectOAuth,
    async (_event, config: AccountConfig): Promise<ImapResult<unknown>> => {
      if (!config?.oauth || config.oauth.clientId.trim() === '') {
        return { ok: false, code: 'unknown', detail: 'Falta el client ID de OAuth' }
      }
      if (config.oauth.provider === 'custom' && (!config.oauth.authUrl || !config.oauth.tokenUrl)) {
        return { ok: false, code: 'unknown', detail: 'Faltan los endpoints OAuth' }
      }
      if (!validConfig(config)) {
        return { ok: false, code: 'unknown', detail: 'Configuración incompleta' }
      }

      const normalized: AccountConfig = {
        host: config.host.trim(),
        port: config.port,
        secure: config.secure,
        user: config.user.trim(),
        label: config.label?.trim(),
        auth: 'oauth2',
        oauth: { ...config.oauth, clientId: config.oauth.clientId.trim() },
        smtp: {
          host: config.smtp.host.trim(),
          port: config.smtp.port,
          secure: config.smtp.secure
        }
      }

      const result = await connectAccountOAuth(normalized)
      if (result.ok) void processOutbox()
      return result
    }
  )

  ipcMain.handle(IPC.accountRename, async (_event, label: string) => {
    if (typeof label !== 'string' || label.trim().length > 80) {
      return { ok: false, code: 'unknown', detail: 'Nombre de cuenta inválido' }
    }
    const account = await readActiveAccount()
    if (!account) return { ok: false, code: 'unknown', detail: 'No hay una cuenta activa' }
    await updateAccount(account.id, { label: label.trim() })
    return { ok: true, data: await getAccountState() }
  })

  ipcMain.handle(IPC.accountDisconnect, async (): Promise<void> => {
    await disconnectAccount()
  })

  ipcMain.handle(IPC.mailboxesList, (_event, sync: boolean = true) => listMailboxes(sync))
  ipcMain.handle(IPC.messagesList, (_event, path: string, limit: number, sync: boolean = true) =>
    listEnvelopes(path, Math.min(Math.max(limit, 1), 2000), sync)
  )
  ipcMain.handle(IPC.messageGet, (_event, path: string, uid: number) => getMessage(path, uid))
  ipcMain.handle(IPC.messageFlag, (_event, path: string, uid: number, flagged: boolean) =>
    setFlagged(path, uid, flagged)
  )
  ipcMain.handle(IPC.messageSeen, (_event, path: string, uid: number, seen: boolean) => setSeen(path, uid, seen))
  ipcMain.handle(IPC.messageArchive, (_event, path: string, uid: number) => archiveMessage(path, uid))
  ipcMain.handle(IPC.messageDelete, async (event, path: string, uid: number) => {
    if (typeof path !== 'string' || !path || !Number.isInteger(uid) || uid <= 0) {
      return { ok: false, queued: false, error: 'Mensaje inválido' }
    }
    const permanent = path === trashPath()
    if (permanent) {
      const account = await readActiveAccount()
      const english = (await readSettings()).language === 'en'
      const options = {
        type: 'warning' as const,
        message: english ? 'Permanently delete this message?' : '¿Eliminar este mensaje definitivamente?',
        detail: english ? 'This action cannot be undone.' : 'Esta acción no se puede deshacer.',
        buttons: english ? ['Cancel', 'Delete permanently'] : ['Cancelar', 'Eliminar definitivamente'],
        defaultId: 0, cancelId: 0, noLink: true
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const choice = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
      if (choice.response !== 1) return { ok: true, queued: false, canceled: true }
      if (!account || (await readActiveAccount())?.id !== account.id) {
        return { ok: false, queued: false, error: 'La cuenta activa cambió' }
      }
    }
    return deleteMessageAction(path, uid, permanent)
  })

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

  ipcMain.handle(IPC.syncMailbox, (_event, path: string) => {
    if (typeof path !== 'string' || path.trim() === '') {
      return { ok: false, code: 'unknown', detail: 'Carpeta inválida' }
    }
    return syncMailbox(path)
  })
  ipcMain.handle(IPC.senderLogo, (_event, email: string, mailbox: string) => senderLogo(email, mailbox))
  ipcMain.handle(IPC.syncProgress, () => getSyncProgress())

  ipcMain.handle(IPC.rulesList, () => readRules())

  ipcMain.handle(IPC.rulesSave, (_event, draft: RuleDraft & { id?: number }) => {
    // El renderer no manda basura al motor: se validan los enums y el largo.
    const fields = ['from', 'subject', 'to', 'any']
    const ops = ['contains', 'equals', 'starts']
    const actions = ['archive', 'delete', 'move', 'read']
    if (!draft || typeof draft.value !== 'string' || draft.value.trim() === '') {
      throw new Error('La regla necesita un valor')
    }
    if (!fields.includes(draft.field) || !ops.includes(draft.op) || !actions.includes(draft.action)) {
      throw new Error('Regla inválida')
    }
    if (draft.action === 'move' && (typeof draft.target !== 'string' || draft.target === '')) {
      throw new Error('Elegí el buzón destino')
    }

    return saveRule({
      ...draft,
      name: String(draft.name ?? '').slice(0, 80),
      value: draft.value.slice(0, 200),
      target: typeof draft.target === 'string' ? draft.target.slice(0, 200) : null,
      enabled: draft.enabled !== false
    })
  })

  ipcMain.handle(IPC.rulesDelete, (_event, id: number) => removeRule(Number(id)))

  ipcMain.handle(IPC.rulesApply, async () => {
    const matched = applyRulesToCache()
    if (matched > 0) await processOutbox()
    return { matched }
  })

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
