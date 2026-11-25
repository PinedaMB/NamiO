import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import type {
  AccountConfig,
  CacheUsage,
  Draft,
  Envelope,
  EnvelopeListOptions,
  MailboxInfo,
  OutboxItem,
  PickedAttachment,
  RecipientSuggestion,
  RuleDraft,
  SendMailPayload,
  SyncProgress
} from '@shared/ipc'
import * as db from './db'
import * as imap from './imap'
import * as mail from './mail'
import * as drafts from './drafts'
import * as rules from './rules'
import * as preview from './attachmentPreview'
import { readActiveAccount, type StoredAccount } from './settings'
import { callEngine, isEngineActive, onEngineEvent, startEngineHost, stopEngineHost } from './engineHost'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024

export async function initCache(accountId: string = 'default'): Promise<void> {
  const started = await startEngineHost()
  if (started) {
    await callEngine('initCache', [accountId])
    return
  }
  db.initCache(accountId)
}

export function closeCache(): void {
  if (isEngineActive()) {
    stopEngineHost()
    return
  }
  db.closeCache()
}

export function closeAllSessions(): Promise<void> {
  if (isEngineActive()) return callEngine<void>('closeAllSessions')
  return imap.closeAllSessions()
}

export function cacheAccountId(): Promise<string> | string {
  return isEngineActive() ? callEngine<string>('cacheAccountId') : db.cacheAccountId()
}

export function suggestRecipients(query: string): Promise<RecipientSuggestion[]> | RecipientSuggestion[] {
  return isEngineActive() ? callEngine<RecipientSuggestion[]>('suggestRecipients', [query]) : db.suggestRecipients(query)
}

export function cacheUsage(accounts: readonly { id: string }[]): Promise<CacheUsage> {
  return isEngineActive() ? callEngine<CacheUsage>('cacheUsage', [accounts]) : db.cacheUsage(accounts)
}

export function listDrafts(): Promise<Draft[]> | Draft[] {
  return isEngineActive() ? callEngine<Draft[]>('listDrafts') : db.listDrafts()
}

export function readDraft(id?: string): Promise<Draft | null> | Draft | null {
  return isEngineActive() ? callEngine<Draft | null>('readDraft', [id]) : db.readDraft(id)
}

export function prunePickedAttachments(): Promise<void> | void {
  return isEngineActive() ? callEngine<void>('prunePickedAttachments') : db.prunePickedAttachments()
}

export function storePickedAttachment(id: string, name: string, data: Buffer): Promise<void> | void {
  return isEngineActive() ? callEngine<void>('storePickedAttachment', [id, name, data]) : db.storePickedAttachment(id, name, data)
}

export function readMailboxes(): Promise<MailboxInfo[]> | MailboxInfo[] {
  return isEngineActive() ? callEngine<MailboxInfo[]>('readMailboxes') : db.readMailboxes()
}

export function getMailboxMeta(path: string): Promise<db.MailboxMeta | null> | db.MailboxMeta | null {
  return isEngineActive() ? callEngine<db.MailboxMeta | null>('getMailboxMeta', [path]) : db.getMailboxMeta(path)
}

export function enqueueOutbox(input: Parameters<typeof db.enqueueOutbox>[0]): Promise<string> | string {
  return isEngineActive() ? callEngine<string>('enqueueOutbox', [input]) : db.enqueueOutbox(input)
}

// IMAP
export function accountIdFor(host: string, port: number, user: string): Promise<string> {
  return isEngineActive() ? callEngine<string>('accountIdFor', [host, port, user]) : imap.accountIdFor(host, port, user)
}

export function activateAccount(account: StoredAccount): Promise<void> {
  return isEngineActive() ? callEngine<void>('activateAccount', [account]) : imap.activateAccount(account)
}

export function checkAccountsActivity(): ReturnType<typeof imap.checkAccountsActivity> {
  return isEngineActive() ? callEngine('checkAccountsActivity') : imap.checkAccountsActivity()
}

export function clearCachedMail(accountId: string): Promise<void> {
  return isEngineActive() ? callEngine<void>('clearCachedMail', [accountId]) : imap.clearCachedMail(accountId)
}

export function connectAccount(config: AccountConfig, password: string): ReturnType<typeof imap.connectAccount> {
  return isEngineActive() ? callEngine('connectAccount', [config, password]) : imap.connectAccount(config, password)
}

export function connectAccountOAuth(
  config: AccountConfig,
  onAuthUrl?: (url: string) => void
): ReturnType<typeof imap.connectAccountOAuth> {
  if (isEngineActive()) {
    return callEngine(
      'connectAccountOAuth',
      [config],
      onAuthUrl ? (arg) => onAuthUrl(String(arg)) : undefined
    )
  }
  return imap.connectAccountOAuth(config, onAuthUrl)
}

export function disconnectAccount(accountId: string): Promise<void> {
  return isEngineActive() ? callEngine<void>('disconnectAccount', [accountId]) : imap.disconnectAccount(accountId)
}

export function getAccountState(): ReturnType<typeof imap.getAccountState> {
  return isEngineActive() ? callEngine('getAccountState') : imap.getAccountState()
}

export function getMessage(path: string, uid: number, cachedOnly = false): ReturnType<typeof imap.getMessage> {
  return isEngineActive() ? callEngine('getMessage', [path, uid, cachedOnly]) : imap.getMessage(path, uid, cachedOnly)
}

export function getSentReplies(path: string, uids: number[], cachedOnly = false): ReturnType<typeof imap.getSentReplies> {
  return isEngineActive() ? callEngine('getSentReplies', [path, uids, cachedOnly]) : imap.getSentReplies(path, uids, cachedOnly)
}

export function getSyncProgress(): Promise<SyncProgress | null> | SyncProgress | null {
  return isEngineActive() ? callEngine<SyncProgress | null>('getSyncProgress') : imap.getSyncProgress()
}

export function resumeOfflineDownload(): Promise<void> | void {
  return isEngineActive() ? callEngine<void>('resumeOfflineDownload') : imap.resumeOfflineDownload()
}

export function listAccounts(): ReturnType<typeof imap.listAccounts> {
  return isEngineActive() ? callEngine('listAccounts') : imap.listAccounts()
}

export function listEnvelopes(
  path: string,
  limit: number,
  sync = true,
  options: EnvelopeListOptions = {}
): ReturnType<typeof imap.listEnvelopes> {
  return isEngineActive() ? callEngine('listEnvelopes', [path, limit, sync, options]) : imap.listEnvelopes(path, limit, sync, options)
}

export function listUnifiedInbox(limit: number, options?: EnvelopeListOptions): ReturnType<typeof imap.listUnifiedInbox> {
  return isEngineActive() ? callEngine('listUnifiedInbox', [limit, options]) : imap.listUnifiedInbox(limit, options)
}

export function listMailboxes(sync = true): ReturnType<typeof imap.listMailboxes> {
  return isEngineActive() ? callEngine('listMailboxes', [sync]) : imap.listMailboxes(sync)
}

export function changeMailbox(path: string, remove: boolean, accountId: string): ReturnType<typeof imap.changeMailbox> {
  return isEngineActive() ? callEngine('changeMailbox', [path, remove, accountId]) : imap.changeMailbox(path, remove, accountId)
}

export function mailboxDeletionSnapshot(path: string): ReturnType<typeof imap.mailboxDeletionSnapshot> {
  return isEngineActive() ? callEngine('mailboxDeletionSnapshot', [path]) : imap.mailboxDeletionSnapshot(path)
}

export async function readAttachment(
  path: string,
  uid: number,
  index: number,
  onProgress?: (phase: 'waiting' | 'downloading') => void
): ReturnType<typeof imap.readAttachment> {
  if (isEngineActive()) {
    const result = await callEngine<{ name: string; type: string; content: Buffer | Uint8Array }>(
      'readAttachment',
      [path, uid, index],
      onProgress ? (arg) => onProgress(arg as 'waiting' | 'downloading') : undefined
    )
    return {
      ...result,
      content: Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content)
    }
  }
  return imap.readAttachment(path, uid, index, onProgress)
}

export function searchMail(query: string, limit = 60, offset = 0, allAccounts = false): ReturnType<typeof imap.searchMail> {
  return isEngineActive() ? callEngine('searchMail', [query, limit, offset, allAccounts]) : imap.searchMail(query, limit, offset, allAccounts)
}

export function selectAccount(id: string): ReturnType<typeof imap.selectAccount> {
  return isEngineActive() ? callEngine('selectAccount', [id]) : imap.selectAccount(id)
}

export function syncMailbox(path: string): ReturnType<typeof imap.syncMailbox> {
  return isEngineActive() ? callEngine('syncMailbox', [path]) : imap.syncMailbox(path)
}

export function syncInbox(limit?: number): ReturnType<typeof imap.syncInbox> {
  return isEngineActive() ? callEngine('syncInbox', [limit]) : imap.syncInbox(limit)
}

export function trashPath(): Promise<string | null> | string | null {
  return isEngineActive() ? callEngine<string | null>('trashPath') : imap.trashPath()
}

export function setFlagged(path: string, uid: number, flagged: boolean): ReturnType<typeof imap.setFlagged> {
  return isEngineActive() ? callEngine('setFlagged', [path, uid, flagged]) : imap.setFlagged(path, uid, flagged)
}

export function setSeen(path: string, uid: number, seen: boolean): ReturnType<typeof imap.setSeen> {
  return isEngineActive() ? callEngine('setSeen', [path, uid, seen]) : imap.setSeen(path, uid, seen)
}

// Mail & Outbox
export function moveMessageAction(path: string, uid: number, target: string): ReturnType<typeof mail.moveMessageAction> {
  return isEngineActive() ? callEngine('moveMessageAction', [path, uid, target]) : mail.moveMessageAction(path, uid, target)
}

export function archiveMessage(path: string, uid: number): ReturnType<typeof mail.archiveMessage> {
  return isEngineActive() ? callEngine('archiveMessage', [path, uid]) : mail.archiveMessage(path, uid)
}

export function cancelOutbox(id: string): ReturnType<typeof mail.cancelOutbox> {
  return isEngineActive() ? callEngine('cancelOutbox', [id]) : mail.cancelOutbox(id)
}

export function deleteMessageAction(path: string, uid: number, permanent: boolean): ReturnType<typeof mail.deleteMessageAction> {
  return isEngineActive() ? callEngine('deleteMessageAction', [path, uid, permanent]) : mail.deleteMessageAction(path, uid, permanent)
}

export function outboxItems(): Promise<OutboxItem[]> | OutboxItem[] {
  return isEngineActive() ? callEngine<OutboxItem[]>('outboxItems') : mail.outboxItems()
}

export function pauseOutbox(): Promise<void> {
  return isEngineActive() ? callEngine<void>('pauseOutbox') : mail.pauseOutbox()
}

export function resumeOutbox(): Promise<void> | void {
  return isEngineActive() ? callEngine<void>('resumeOutbox') : mail.resumeOutbox()
}

export function processOutbox(): Promise<void> {
  return isEngineActive() ? callEngine<void>('processOutbox') : mail.processOutbox()
}

export function retryOutbox(id: string): ReturnType<typeof mail.retryOutbox> {
  return isEngineActive() ? callEngine('retryOutbox', [id]) : mail.retryOutbox(id)
}

export function sendMail(payload: SendMailPayload): ReturnType<typeof mail.sendMail> {
  return isEngineActive() ? callEngine('sendMail', [payload]) : mail.sendMail(payload)
}

export async function registerAttachments(window: BrowserWindow | null): Promise<PickedAttachment[]> {
  if (!isEngineActive()) return mail.registerAttachments(window)
  const accountId = (await readActiveAccount())?.id
  if (!accountId) throw new Error('No hay cuenta activa')
  const options: OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    title: 'Adjuntar archivos'
  }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  if (result.canceled) return []

  const picked: PickedAttachment[] = []
  let totalBytes = 0
  for (const filePath of result.filePaths) {
    const info = await stat(filePath)
    if (info.size > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto supera el límite de 25 MB')
    totalBytes += info.size
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error('El total de adjuntos supera el límite de 50 MB')
    const id = randomUUID()
    const name = basename(filePath)
    const data = await readFile(filePath)
    if (data.length > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto supera el límite de 25 MB')
    if ((await readActiveAccount())?.id !== accountId) throw new Error('La cuenta activa cambió')
    await storePickedAttachment(id, name, data)
    picked.push({ id, name, size: info.size })
  }
  return picked
}

// Drafts
export function openServerDraft(path: string, uid: number): ReturnType<typeof drafts.openServerDraft> {
  return isEngineActive() ? callEngine('openServerDraft', [path, uid]) : drafts.openServerDraft(path, uid)
}

export function queueDraftDelete(id: string): Promise<void> | void {
  return isEngineActive() ? callEngine<void>('queueDraftDelete', [id]) : drafts.queueDraftDelete(id)
}

export function queueDraftSave(input: Draft): Promise<Draft> | Draft {
  return isEngineActive() ? callEngine<Draft>('queueDraftSave', [input]) : drafts.queueDraftSave(input)
}

// Rules
export function applyRulesToCache(): Promise<number> | number {
  return isEngineActive() ? callEngine<number>('applyRulesToCache') : rules.applyRulesToCache()
}

export function readRules(): ReturnType<typeof rules.readRules> | Promise<ReturnType<typeof rules.readRules>> {
  return isEngineActive() ? callEngine('readRules') : rules.readRules()
}

export function removeRule(id: number): ReturnType<typeof rules.removeRule> | Promise<ReturnType<typeof rules.removeRule>> {
  return isEngineActive() ? callEngine('removeRule', [id]) : rules.removeRule(id)
}

export function saveRule(draft: RuleDraft & { id?: number }): ReturnType<typeof rules.saveRule> | Promise<ReturnType<typeof rules.saveRule>> {
  return isEngineActive() ? callEngine('saveRule', [draft]) : rules.saveRule(draft)
}

// Attachment preview
export function attachmentPreview(
  attachment: Parameters<typeof preview.attachmentPreview>[0]
): ReturnType<typeof preview.attachmentPreview> | Promise<ReturnType<typeof preview.attachmentPreview>> {
  return isEngineActive() ? callEngine('attachmentPreview', [attachment]) : preview.attachmentPreview(attachment)
}

// Listeners
export function setNewMailListener(listener: (account: StoredAccount, path: string, messages: Envelope[]) => void): void {
  onEngineEvent('newMail', (a, p, m) => listener(a as StoredAccount, p as string, m as Envelope[]))
  imap.setNewMailListener(listener)
}

export function setCacheListener(listener: (mailbox: string) => void): void {
  onEngineEvent('cacheChanged', (m) => listener(m as string))
  imap.setCacheListener(listener)
}

export function setSyncProgressListener(listener: (progress: SyncProgress | null) => void): void {
  onEngineEvent('syncProgress', (p) => listener(p as SyncProgress | null))
  imap.setSyncProgressListener(listener)
}

export function setRulesListener(listener: () => void): void {
  onEngineEvent('rulesChanged', () => listener())
  imap.setRulesListener(listener)
}

export function setOutboxListener(listener: () => void): void {
  onEngineEvent('outboxChanged', () => listener())
  mail.setOutboxListener(listener)
}
