import { attachmentPreview } from './attachmentPreview'
import { openServerDraft, queueDraftDelete, queueDraftSave } from './drafts'
import { setBackgroundMode } from './background'
import { testNotification } from './notifications'
import { senderLogo } from './senderLogo'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { app } from 'electron'
import { isSpamMailbox } from '@shared/mailboxes'
import {
  IPC,
  type AccountConfig,
  type AppSettings,
  type CoreStatus,
  type Draft,
  type EnvelopeListOptions,
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
  mailboxDeletionSnapshot,
  readAttachment,
  searchMail,
  selectAccount,
  syncMailbox,
  trashPath,
  setFlagged,
  setSeen
} from './imap'
import { moveMessageAction, archiveMessage, cancelOutbox, deleteMessageAction, outboxItems, pauseOutbox, resumeOutbox, processOutbox, registerAttachments, retryOutbox, sendMail } from './mail'
import { suggestRecipients, cacheUsage, listDrafts, readDraft, prunePickedAttachments, readMailboxes, getMailboxMeta, cacheAccountId, enqueueOutbox } from './db'
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
  let disconnecting = false
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

  ipcMain.handle(IPC.recipientSuggestions, (_event, query: string) => {
    if (typeof query !== 'string' || query.length > 320) return []
    return suggestRecipients(query)
  })

  ipcMain.handle(IPC.notificationTest, () => testNotification())

  ipcMain.handle(IPC.settingsGet, (): Promise<Partial<AppSettings>> => readSettings())

  ipcMain.handle(IPC.settingsSet, async (_event, patch: Partial<AppSettings>): Promise<void> => {
    for (const key of ['notifications', 'notificationSound', 'notificationPrivate', 'keepInBackground'] as const) {
      if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error('Invalid notification setting')
    }
    if (patch.timeFormat !== undefined && patch.timeFormat !== '12h' && patch.timeFormat !== '24h') throw new Error('Invalid time format')
    if (patch.shortcutModifier !== undefined && patch.shortcutModifier !== 'ctrl' && patch.shortcutModifier !== 'command') throw new Error('Invalid shortcut modifier')
    await writeSettings(patch)
    if (typeof patch.keepInBackground === 'boolean') setBackgroundMode(patch.keepInBackground)
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

  ipcMain.handle(IPC.accountDisconnect, async (event): Promise<boolean> => {
    if (disconnecting) return false
    disconnecting = true
    try {
      const account = await readActiveAccount()
      if (!account || cacheAccountId() !== account.id) throw new Error('La cuenta activa cambió')
      await pauseOutbox()
      if ((await readActiveAccount())?.id !== account.id || cacheAccountId() !== account.id) throw new Error('La cuenta activa cambió')
      const pending = listDrafts().filter(draft => !draft.server || draft.syncedAt !== draft.updatedAt || draft.previousServer).length
      const queued = outboxItems().length
      const english = (await readSettings()).language === 'en'
      const options = {
        type: 'warning' as const,
        message: english ? `Unlink ${account.user}?` : `¿Desvincular ${account.user}?`,
        detail: (english
          ? 'The account, saved credentials and ALL local data will be deleted, including downloaded messages, drafts, pending operations and rules. Emails on the server will not be deleted.'
          : 'Se eliminarán la cuenta, sus credenciales y TODOS sus datos locales: mensajes descargados, borradores, operaciones pendientes y reglas. Los correos del servidor no se borrarán.') +
          (pending || queued ? (english ? `\n\nUnsynced drafts: ${pending}. Pending operations: ${queued}. These local changes will be lost. Cancel to keep them.` : `\n\nBorradores sin sincronizar: ${pending}. Operaciones pendientes: ${queued}. Estos cambios locales se perderán. Cancela para conservarlos.`) : ''),
        buttons: english ? ['Cancel', 'Unlink and delete local data'] : ['Cancelar', 'Desvincular y borrar datos locales'],
        defaultId: 0, cancelId: 0, noLink: true
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const choice = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
      if (choice.response !== 1) return false
      if ((await readActiveAccount())?.id !== account.id || cacheAccountId() !== account.id) throw new Error('La cuenta activa cambió')
      await disconnectAccount(account.id)
      return true
    } finally {
      disconnecting = false
      resumeOutbox()
    }
  })

  ipcMain.handle(IPC.mailboxesList, (_event, sync: boolean = true) => listMailboxes(sync))
  ipcMain.handle(IPC.messagesList, (_event, path: string, limit: number, sync: boolean = true, options: EnvelopeListOptions = {}) => {
    if (typeof path !== 'string' || !Number.isSafeInteger(limit) || limit < 1 ||
      !options || typeof options !== 'object' ||
      (options.filter !== undefined && !['all', 'unread', 'read'].includes(options.filter)) ||
      (options.oldestFirst !== undefined && typeof options.oldestFirst !== 'boolean') ||
      (options.includeUid !== undefined && (!Number.isSafeInteger(options.includeUid) || options.includeUid < 1))) {
      return { ok: false, code: 'unknown', detail: 'Consulta de mensajes inválida' }
    }
    return listEnvelopes(path, limit, sync, options)
  })
  ipcMain.handle(IPC.messageGet, (_event, path: string, uid: number, cachedOnly = false) => getMessage(path, uid, cachedOnly === true))
  ipcMain.handle(IPC.messageFlag, (_event, path: string, uid: number, flagged: boolean) =>
    setFlagged(path, uid, flagged)
  )
  ipcMain.handle(IPC.messageSeen, (_event, path: string, uid: number, seen: boolean) => setSeen(path, uid, seen))
  ipcMain.handle(IPC.messageMove, (_event, path: string, uid: number, target: string) => moveMessageAction(path, uid, target))
  ipcMain.handle(IPC.messageArchive, (_event, path: string, uid: number) => archiveMessage(path, uid))
  ipcMain.handle(IPC.messageDelete, async (event, path: string, uid: number) => {
    if (typeof path !== 'string' || !path || !Number.isInteger(uid) || uid <= 0) {
      return { ok: false, queued: false, error: 'Mensaje inválido' }
    }
    const permanent = path === trashPath()
    {
      const account = await readActiveAccount()
      const english = (await readSettings()).language === 'en'
      const options = {
        type: 'warning' as const,
        message: permanent ? (english ? 'Permanently delete this message?' : '¿Eliminar este mensaje definitivamente?') : (english ? 'Move this message to Trash?' : '¿Mover este mensaje a Papelera?'),
        detail: permanent ? (english ? 'This action cannot be undone.' : 'Esta acción no se puede deshacer.') : (english ? 'You can recover it from Trash.' : 'Puedes recuperarlo desde Papelera.'),
        buttons: english ? ['Cancel', permanent ? 'Delete permanently' : 'Move to Trash'] : ['Cancelar', permanent ? 'Eliminar definitivamente' : 'Mover a Papelera'],
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

  ipcMain.handle(IPC.messagesDelete, async (event, path: string, selectedUids?: number[]) => {
    try {
      if (typeof path !== 'string' || !path || (selectedUids !== undefined && (!Array.isArray(selectedUids) || selectedUids.length > 10000 || selectedUids.some(uid => !Number.isSafeInteger(uid) || uid <= 0)))) throw new Error('Selección inválida')
      const account = await readActiveAccount()
      if (!account || cacheAccountId() !== account.id) throw new Error('La cuenta activa cambió')
      const empty = selectedUids === undefined
      const box = readMailboxes().find(item => item.path === path)
      if (empty && (!box || (path !== trashPath() && !isSpamMailbox(box)))) throw new Error('Solo se puede vaciar Spam o Papelera')
      const permanent = empty || path === trashPath()
      const cachedValidity = getMailboxMeta(path)?.uidValidity
      const snapshot = empty || !cachedValidity ? await mailboxDeletionSnapshot(path) : null
      const uids = [...new Set(selectedUids ?? snapshot!.uids)]
      const uidValidity = snapshot?.uidValidity ?? String(cachedValidity)
      if (!uids.length) return { ok: true, queued: false }
      const english = (await readSettings()).language === 'en'
      const options = {
        type: 'warning' as const,
        message: empty
          ? (english ? `Empty folder "${box!.name}" (${uids.length} messages)?` : `¿Vaciar la carpeta «${box!.name}» (${uids.length} mensajes)?`)
          : (english ? `Delete ${uids.length} selected messages?` : `¿Eliminar ${uids.length} mensajes seleccionados?`),
        detail: `${account.user}\n${path}\n` + (permanent ? (english ? 'These messages will be permanently deleted. This cannot be undone.' : 'Estos mensajes se eliminarán definitivamente. Esta acción no se puede deshacer.') : (english ? 'These messages will be moved to Trash.' : 'Estos mensajes se moverán a Papelera.')),
        buttons: english ? ['Cancel', permanent ? 'Delete permanently' : 'Move to Trash'] : ['Cancelar', permanent ? 'Eliminar definitivamente' : 'Mover a Papelera'],
        defaultId: 0, cancelId: 0, noLink: true
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const choice = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
      if (choice.response !== 1) return { ok: true, queued: false, canceled: true }
      if ((await readActiveAccount())?.id !== account.id || cacheAccountId() !== account.id) throw new Error('La cuenta activa cambió')
      enqueueOutbox({ kind: 'delete-many', mailbox: path, payload: { uids, uidValidity, permanent } })
      void processOutbox()
      return { ok: true, queued: true }
    } catch (error) {
      return { ok: false, queued: false, error: error instanceof Error ? error.message : 'No se pudo iniciar el borrado' }
    }
  })

  ipcMain.handle(IPC.attachmentPreview, async (_event, path: string, uid: number, index: number) => {
    if (typeof path !== 'string' || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(index) || index < 0) throw new Error('Adjunto inválido')
    const attachment = await readAttachment(path, uid, index)
    return attachmentPreview(attachment)
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

  ipcMain.handle(IPC.draftGet, (_event, id?: string) => readDraft(id))
  ipcMain.handle(IPC.draftsList, () => listDrafts())
  ipcMain.handle(IPC.draftOpen, (_event, path: string, uid: number) => openServerDraft(path, uid))
  ipcMain.handle(IPC.draftSave, async (_event, input: Draft) => {
    const draft = queueDraftSave(input)
    void processOutbox()
    return { id: draft.id!, queued: true }
  })
  ipcMain.handle(IPC.draftClear, async (_event, id?: string) => {
    if (id) queueDraftDelete(id)
    else prunePickedAttachments()
    void processOutbox()
  })

  ipcMain.handle(IPC.mailSend, (_event, payload: SendMailPayload) => sendMail(payload))
  ipcMain.handle(IPC.outboxList, () => outboxItems())
  ipcMain.handle(IPC.outboxRetry, (_event, id: string) => retryOutbox(id))
  ipcMain.handle(IPC.outboxCancel, (_event, id: string) => cancelOutbox(id))

  ipcMain.handle(IPC.syncMailbox, async (_event, path: string) => {
    if (typeof path !== 'string' || path.trim() === '') {
      return { ok: false, code: 'unknown', detail: 'Carpeta inválida' }
    }
    const result = await syncMailbox(path)
    if (result.ok) void processOutbox().catch(error => console.error('[outbox] reconnect retry failed:', error))
    return result
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
      throw new Error('Elige el buzón destino')
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

  ipcMain.handle(IPC.searchQuery, (_event, query: string, limit = 60, offset = 0) => {
    if (typeof query !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid search query')
    return searchMail(query.slice(0, 200), limit, offset)
  })

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
