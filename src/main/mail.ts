import { queueDraftDelete, syncDraft } from './drafts'
import { splitRecipients, validRecipients } from '@shared/mailAddresses'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { createTransport } from 'nodemailer'
import type { MailAction, OutboxItem, OutboxKind, OutboxStatus, PickedAttachment, SendMailPayload } from '@shared/ipc'
import { readMailboxes, readEnvelope, getMailboxMeta, readDraft, cacheAccountId, rememberRecipients, prunePickedAttachments, storePickedAttachment, readPickedAttachment, deleteOutbox, enqueueOutbox, listOutbox, updateOutbox, type OutboxRow } from './db'
import { readActiveAccount } from './settings'
import { appendToSent, archivePath, deleteMessage, deleteMessageBatch, getCredentials, moveMessage, removeServerDraft, sentContains, setSeen, syncInbox } from './imap'

/**
 * Cola de salida: todo lo que modifica el servidor (enviar, archivar, eliminar)
 * se encola primero. Si no hay red, queda pendiente y se reintenta; si el
 * servidor rechaza, se reintenta hasta MAX_ATTEMPTS y luego queda "failed"
 * para que el usuario decida.
 */

const MAX_ATTEMPTS = 5
/** Los adjuntos se copian a SQLite y viajan por SMTP; 25 MB por archivo y 50 MB por envío. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024

/** `Message-ID` estable desde el encolado: el reintento no crea otro mensaje. */
function newMessageId(user: string | undefined): string {
  const domain = (user ?? '').split('@')[1]?.trim().toLowerCase() ?? ''
  const safe = /^[a-z0-9.-]+$/.test(domain) ? domain : 'namio.local'
  return `<${randomUUID()}@${safe}>`
}

let processing = false
let outboxPaused = false
let wakeTimer: ReturnType<typeof setTimeout> | null = null
let processingDone: Promise<void> | null = null

export async function pauseOutbox(): Promise<void> {
  outboxPaused = true
  await processingDone
}

export function resumeOutbox(): void {
  outboxPaused = false
  void processOutbox().catch(error => console.error('[outbox]', error))
}
let deletionProgress: { id: string; completed: number } | null = null
let listener: (() => void) | null = null

export function setOutboxListener(fn: () => void): void {
  listener = fn
}

function notify(): void {
  listener?.()
}

function payloadOf(row: OutboxRow): Record<string, unknown> {
  if (!row.payload) return {}
  try {
    const parsed: unknown = JSON.parse(row.payload)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function labelOf(row: OutboxRow): string {
  const payload = payloadOf(row)
  if (row.kind === 'send') {
    const subject = typeof payload.subject === 'string' ? payload.subject : ''
    return subject || '(sin asunto)'
  }
  if (row.kind === 'delete-many') return row.mailbox ?? ''
  return row.kind
}

export function outboxItems(): OutboxItem[] {
  return listOutbox().map((row) => ({
    id: row.id,
    kind: row.kind as OutboxKind,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    label: labelOf(row),
    ...(row.kind === 'delete-many' ? {
      deletionProgress: {
        completed: deletionProgress?.id === row.id ? deletionProgress.completed : 0,
        total: Array.isArray(payloadOf(row).uids) ? (payloadOf(row).uids as unknown[]).length : 0,
        running: deletionProgress?.id === row.id
      }
    } : {})
  }))
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Un fallo de red no es un intento perdido: la operación sigue siendo válida y
 * se reintentará cuando vuelva la conexión. Si lo contáramos como intento, un
 * correo encolado sin red acabaría en `failed` solo por el paso del tiempo.
 * Solo los rechazos del servidor (auth, 5xx, validación) consumen intentos.
 */
function isTransientOutboxError(error: unknown): boolean {
  const value = error as {
    code?: string
    responseCode?: number
    authenticationFailed?: boolean
    message?: string
    responseText?: string
  } | null

  if (value?.authenticationFailed) return false
  // La operación no falló: se quedó sin la cuenta a la que pertenece.
  if ((value?.code ?? '').toUpperCase() === 'ACCOUNT_CHANGED') return true
  // SMTP: 4xx es temporal, 5xx es un rechazo definitivo.
  if (typeof value?.responseCode === 'number') return value.responseCode >= 400 && value.responseCode < 500

  const code = (value?.code ?? '').toUpperCase()
  if (['EAUTH', 'EENVELOPE', 'EMESSAGE', 'EMODULE'].includes(code)) return false
  if ([
    'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ETIMEOUT',
    'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EHOSTDOWN',
    'EPIPE', 'ECONNECTION', 'ESOCKET', 'EDNS', 'NOCONNECTION', 'NOTCONNECTED',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'
  ].includes(code)) return true

  const text = `${value?.message ?? ''} ${value?.responseText ?? ''}`.toLowerCase()
  return /offline|network|timed? ?out|timeout|socket|econn|enotfound|eai_again|not connected|no connection|connection (lost|closed|refused|reset)|fetch failed|temporary/.test(text)
}

function registerFailure(row: OutboxRow, error: unknown): void {
  const transient = isTransientOutboxError(error)
  const attempts = transient ? row.attempts : row.attempts + 1
  const failures = transient ? row.failures + 1 : row.failures
  // 30 s, 1 min, 2 min, 4 min, 8 min… hasta 15 min. Un fallo de red no consume
  // intentos, pero tampoco martilla el servidor cada minuto para siempre.
  const delay = transient ? Math.min(30_000 * 2 ** Math.min(Math.max(failures - 1, 0), 5), 15 * 60_000) : 0
  updateOutbox(row.id, {
    attempts,
    failures,
    nextAttemptAt: delay > 0 ? Date.now() + delay : null,
    lastError: describeError(error),
    status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued'
  })
}

/** Archivos elegidos para el próximo envío: el renderer solo ve id y nombre. */
interface PendingAttachment {
  id: string
  path: string
  name: string
  size: number
}

export async function registerAttachments(window: BrowserWindow | null): Promise<PickedAttachment[]> {
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
    const entry: PendingAttachment = {
      id: randomUUID(),
      path: filePath,
      name: basename(filePath),
      size: info.size
    }
    const data = await readFile(filePath)
    if (data.length > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto supera el límite de 25 MB')
    if ((await readActiveAccount())?.id !== accountId) throw new Error('La cuenta activa cambió')
    storePickedAttachment(entry.id, entry.name, data)
    picked.push({ id: entry.id, name: entry.name, size: entry.size })
  }

  return picked
}

async function sendWithSmtp(payload: SendMailPayload, accountId: string | null): Promise<void> {
  // `getCredentials` revalida la cuenta: si cambió, no se envían credenciales
  // (ni el correo) desde el buzón equivocado.
  const credentials = await getCredentials(accountId ?? undefined)
  if (!credentials) throw new Error('La cuenta no tiene credenciales guardadas')

  const { account, password, accessToken } = credentials
  // Cuentas locales de prueba no traen dominio: se lo damos para que el
  // remitente sea una dirección válida (los servidores rechazan "user" a secas).
  const sender = account.user.includes('@') ? account.user : `${account.user}@${account.host || 'localhost'}`

  const files = (payload.attachments ?? [])
    .map((id) => {
      const file = readPickedAttachment(id)
      if (!file) throw new Error('Falta un adjunto. Vuelve a adjuntarlo antes de enviar.')
      if (file.data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto supera el límite de 25 MB')
      return { name: file.name, data: Buffer.from(file.data) }
    })
  if (files.reduce((total, file) => total + file.data.byteLength, 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new Error('El total de adjuntos supera el límite de 50 MB')
  }

  // Se compila con nodemailer (multipart si hay adjuntos) y se envía el crudo:
  // así la copia en Enviados es byte a byte el mensaje que salió.
  const compiler = createTransport({ streamTransport: true, buffer: true })
  const compiled = await compiler.sendMail({
    from: sender,
    to: payload.to,
    cc: payload.cc === '' ? undefined : payload.cc,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    priority: payload.priority,
    messageId: payload.messageId,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    attachDataUrls: true,
    attachments: files.map((file) => ({ filename: file.name, content: file.data }))
  })

  const raw = Buffer.isBuffer(compiled.message)
    ? compiled.message
    : Buffer.from(String(compiled.message), 'utf8')

  const transport = createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    // XOAUTH2 para cuentas OAuth2; contraseña para el resto.
    auth: accessToken
      ? { type: 'OAuth2' as const, user: account.user, accessToken }
      : { user: account.user, pass: password ?? '' },
    tls: { rejectUnauthorized: true }
  })

  const recipients = [payload.to, payload.cc, payload.bcc ?? ''].flatMap(splitRecipients)

  try {
    await transport.sendMail({
      envelope: { from: sender, to: recipients },
      raw
    })

    // Copia en Enviados: si falla, el mensaje ya salió y no debe reintentarse.
    await appendToSent(raw, accountId ?? undefined).catch((error: unknown) => {
      console.error('[sent-copy]', error)
    })


    // Un servidor puede devolvernos la copia (o escribir a nosotros mismos):
    // se sondea la bandeja unas cuantas veces para que aparezca sin esperar al
    // sondeo de un minuto. Acotado: tres intentos, no un bucle.
    for (const delay of [1500, 5000, 12000]) {
      setTimeout(() => {
        void syncInbox()
      }, delay)
    }
  } finally {
    transport.close()
  }
}

async function runOne(row: OutboxRow): Promise<void> {
  const owner = cacheAccountId()
  // Una tarea de otra cuenta pertenece a su propia caché: se deja pendiente
  // para cuando esa cuenta vuelva a estar activa.
  if (row.accountId && row.accountId !== owner) return
  const expectedAccount = row.accountId ?? owner
  const validityOf = (path: string): string | null => {
    const value = getMailboxMeta(path)?.uidValidity
    return value == null ? null : String(value)
  }

  if (row.kind === 'draft-save') {
    const id = payloadOf(row).draftId
    if (typeof id !== 'string') throw new Error('Borrador inválido')
    await syncDraft(id, expectedAccount)
    const current = owner === cacheAccountId() ? readDraft(id) : null
    if (current && current.syncedAt !== current.updatedAt && !listOutbox().some(item => item.id !== row.id && item.kind === 'draft-save' && payloadOf(item).draftId === id)) {
      enqueueOutbox({ kind: 'draft-save', payload: { draftId: id } })
    }
  } else if (row.kind === 'draft-delete') {
    const reference = payloadOf(row).server as import('@shared/ipc').DraftServerRef
    if (!reference || typeof reference.path !== 'string' || !Number.isInteger(reference.uid) || typeof reference.uidValidity !== 'string') throw new Error('Borrador inválido')
    await removeServerDraft(reference, expectedAccount)
  } else if (row.kind === 'send') {
    const payload = payloadOf(row) as unknown as SendMailPayload
    const messageId = typeof payload.messageId === 'string' && payload.messageId !== ''
      ? payload.messageId
      : `<${row.id}@namio.local>`
    if (row.attemptedAt != null) {
      // Un intento anterior pudo ser aceptado por el servidor aunque se perdiera
      // la confirmación. Si ya está en Enviados, no se vuelve a mandar.
      const alreadySent = await sentContains(messageId, expectedAccount)
      if (!alreadySent) await sendWithSmtp({ ...payload, messageId }, expectedAccount)
    } else {
      updateOutbox(row.id, { attemptedAt: Date.now() })
      await sendWithSmtp({ ...payload, messageId }, expectedAccount)
    }
    if (owner === cacheAccountId() && typeof payload.draftId === 'string' && readDraft(payload.draftId)?.updatedAt === payload.draftUpdatedAt) queueDraftDelete(payload.draftId)
  } else if (row.kind === 'archive') {
    const path = row.mailbox ?? 'INBOX'
    const target = archivePath()
    if (!target) throw new Error('El servidor no expone un buzón de archivo')
    const uidValidity = row.uidValidity ?? validityOf(path)
    if (uidValidity == null) throw new Error('Sincroniza la carpeta antes de archivar')
    await moveMessage(path, row.uid ?? 0, target, uidValidity, expectedAccount)
  } else if (row.kind === 'delete') {
    const path = row.mailbox ?? 'INBOX'
    const uidValidity = row.uidValidity ?? validityOf(path)
    if (uidValidity == null) throw new Error('Sincroniza la carpeta antes de eliminar')
    await deleteMessage(path, row.uid ?? 0, payloadOf(row).permanent === true, { accountId: expectedAccount, uidValidity })
  } else if (row.kind === 'delete-many') {
    const payload = payloadOf(row)
    if (!row.mailbox || !Array.isArray(payload.uids) || payload.uids.some(uid => !Number.isInteger(uid) || uid <= 0) || typeof payload.uidValidity !== 'string' || !/^\d+$/.test(payload.uidValidity)) throw new Error('Lote de borrado inválido')
    deletionProgress = { id: row.id, completed: 0 }
    notify()
    try {
      await deleteMessageBatch(row.mailbox, payload.uids as number[], payload.permanent === true, payload.uidValidity, completed => {
        deletionProgress = { id: row.id, completed }
        notify()
      }, expectedAccount)
    } finally {
      deletionProgress = null
      notify()
    }
  } else if (row.kind === 'move') {
    const target = payloadOf(row).target
    if (typeof target !== 'string' || target === '') throw new Error('La regla no tiene buzón destino')
    const payloadValidity = payloadOf(row).uidValidity
    if (payloadValidity !== undefined && (typeof payloadValidity !== 'string' || !/^\d+$/.test(payloadValidity))) throw new Error('Identidad de carpeta inválida')
    const uidValidity = row.uidValidity ?? (typeof payloadValidity === 'string' ? payloadValidity : validityOf(row.mailbox ?? 'INBOX'))
    if (uidValidity == null) throw new Error('Sincroniza la carpeta antes de mover el mensaje')
    await moveMessage(row.mailbox ?? 'INBOX', row.uid ?? 0, target, uidValidity, expectedAccount)
  } else if (row.kind === 'seen') {
    await setSeen(row.mailbox ?? 'INBOX', row.uid ?? 0, true, expectedAccount)
  }

  if (owner !== cacheAccountId()) return
  deleteOutbox(row.id)
  prunePickedAttachments()
}

/** Procesa la cola en orden. Es idempotente y no corre en paralelo consigo misma. */
function scheduleOutboxWake(): void {
  if (wakeTimer !== null) {
    if (typeof clearTimeout === 'function') clearTimeout(wakeTimer)
    wakeTimer = null
  }
  if (outboxPaused || typeof setTimeout !== 'function') return
  const now = Date.now()
  const next = listOutbox()
    .filter((row) => row.status !== 'failed' && row.nextAttemptAt !== null && row.nextAttemptAt > now)
    .reduce<number | null>((earliest, row) => Math.min(earliest ?? row.nextAttemptAt!, row.nextAttemptAt!), null)
  if (next === null) return
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    void processOutbox().catch((error: unknown) => console.error('[outbox]', error))
  }, Math.max(1000, Math.min(60_000, next - now)))
}

export async function processOutbox(): Promise<void> {
  if (processing || outboxPaused) return
  if (wakeTimer !== null) {
    if (typeof clearTimeout === 'function') clearTimeout(wakeTimer)
    wakeTimer = null
  }
  processing = true
  let done!: () => void
  processingDone = new Promise(resolve => { done = resolve })
  const owner = cacheAccountId()

  try {
    const attempted = new Set<string>()
    while (!outboxPaused) {
      const now = Date.now()
      const row = listOutbox().find(item =>
        item.status !== 'failed' &&
        !attempted.has(item.id) &&
        (item.nextAttemptAt == null || item.nextAttemptAt <= now)
      )
      if (!row) break
      attempted.add(row.id)
      if (owner !== cacheAccountId()) return
      // Tareas de otra cuenta: se conservan para su propia sesión.
      if (row.accountId && row.accountId !== owner) continue
      try {
        await runOne(row)
      } catch (error) {
        if (owner !== cacheAccountId()) return
        // La cuenta cambió mientras la tarea esperaba su turno: no es un fallo.
        if ((error as { code?: string } | null)?.code === 'ACCOUNT_CHANGED') return
        registerFailure(row, error)
      }
    }
  } finally {
    processing = false
    processingDone = null
    done()
    notify()
    scheduleOutboxWake()
  }
}

function remaining(kind: OutboxKind, match?: (row: OutboxRow) => boolean): OutboxRow | undefined {
  return listOutbox().find((row) => row.kind === kind && (!match || match(row)))
}

export async function sendMail(payload: SendMailPayload): Promise<MailAction> {
  if (!payload || (payload.html !== undefined && typeof payload.html !== 'string') || typeof payload.to !== 'string' || typeof payload.cc !== 'string' || typeof payload.subject !== 'string' || typeof payload.text !== 'string' || (payload.bcc !== undefined && typeof payload.bcc !== 'string') || !validRecipients(payload.to, payload.cc, payload.bcc ?? '')) {
    return { ok: false, queued: false, error: 'Destinatarios inválidos' }
  }
  if (payload.priority !== undefined && !['high', 'normal', 'low'].includes(payload.priority)) return { ok: false, queued: false, error: 'Importancia inválida' }
  if (payload.attachments !== undefined && (!Array.isArray(payload.attachments) || payload.attachments.some(id => typeof id !== 'string' || !readPickedAttachment(id)))) {
    return { ok: false, queued: false, error: 'Falta un adjunto. Vuelve a adjuntarlo antes de enviar.' }
  }
  if ((payload.inReplyTo !== undefined && (typeof payload.inReplyTo !== 'string' || /[\r\n]/.test(payload.inReplyTo))) || (payload.references !== undefined && (!Array.isArray(payload.references) || payload.references.some(id => typeof id !== 'string' || /[\r\n]/.test(id))))) {
    return { ok: false, queued: false, error: 'Cabeceras de respuesta inválidas' }
  }
  payload = { ...payload, messageId: newMessageId((await readActiveAccount())?.user), draftUpdatedAt: payload.draftId ? readDraft(payload.draftId)?.updatedAt : undefined, to: splitRecipients(payload.to).join(', '), cc: splitRecipients(payload.cc).join(', '), bcc: splitRecipients(payload.bcc ?? '').join(', ') }
  const id = enqueueOutbox({ kind: 'send', payload })
  try {
    rememberRecipients([payload.to, payload.cc, payload.bcc ?? ''].flatMap(splitRecipients))
  } catch (cause) {
    console.error('[recipient-cache]', cause)
  }
  notify()
  await processOutbox()

  return { ok: true, queued: listOutbox().some(row => row.id === id) }
}

export async function moveMessageAction(path: string, uid: number, target: string): Promise<MailAction> {
  if (typeof path !== 'string' || !path || typeof target !== 'string' || !target || path === target || !Number.isSafeInteger(uid) || uid <= 0) {
    return { ok: false, queued: false, error: 'Movimiento inválido' }
  }
  const boxes = readMailboxes()
  if (!boxes.some(box => box.path === path) || !boxes.some(box => box.path === target) || !readEnvelope(path, uid)) {
    return { ok: false, queued: false, error: 'No se encontró el mensaje o la carpeta' }
  }
  const uidValidity = getMailboxMeta(path)?.uidValidity
  if (uidValidity == null) return { ok: false, queued: false, error: 'Sincroniza la carpeta antes de mover el mensaje' }
  const existing = remaining('move', row => row.mailbox === path && row.uid === uid)
  if (existing) return { ok: false, queued: true, error: 'El mensaje ya tiene un movimiento pendiente' }
  const id = enqueueOutbox({ kind: 'move', mailbox: path, uid, payload: { target, uidValidity: String(uidValidity) }, uidValidity: String(uidValidity) })
  notify()
  await processOutbox()
  const pending = listOutbox().find(row => row.id === id)
  if (pending?.status === 'failed') return { ok: false, queued: true, error: pending.lastError ?? 'No se pudo mover' }
  return { ok: true, queued: Boolean(pending) }
}

export async function archiveMessage(path: string, uid: number): Promise<MailAction> {
  const uidValidity = getMailboxMeta(path)?.uidValidity
  if (uidValidity == null) return { ok: false, queued: false, error: 'Sincroniza la carpeta antes de archivar' }
  enqueueOutbox({ kind: 'archive', mailbox: path, uid, uidValidity: String(uidValidity) })
  notify()
  await processOutbox()

  const pending = remaining('archive', (row) => row.mailbox === path && row.uid === uid)
  if (pending?.status === 'failed') {
    return { ok: false, queued: true, error: pending.lastError ?? 'No se pudo archivar' }
  }
  return { ok: true, queued: Boolean(pending) }
}

export async function deleteMessageAction(path: string, uid: number, permanent = false): Promise<MailAction> {
  const uidValidity = getMailboxMeta(path)?.uidValidity
  if (uidValidity == null) return { ok: false, queued: false, error: 'Sincroniza la carpeta antes de eliminar' }
  enqueueOutbox({ kind: 'delete', mailbox: path, uid, payload: { permanent }, uidValidity: String(uidValidity) })
  notify()
  await processOutbox()

  const pending = remaining('delete', (row) => row.mailbox === path && row.uid === uid)
  if (pending?.status === 'failed') {
    return { ok: false, queued: true, error: pending.lastError ?? 'No se pudo eliminar' }
  }
  return { ok: true, queued: Boolean(pending) }
}

export async function retryOutbox(id: string): Promise<void> {
  // Un reintento manual abre un ciclo nuevo: si no se reinicia, el primer fallo
  // vuelve a dejar la fila en `failed` sin haber agotado los intentos.
  updateOutbox(id, { status: 'queued', attempts: 0, failures: 0, nextAttemptAt: null, lastError: null })
  notify()
  await processOutbox()
}

export async function cancelOutbox(id: string): Promise<void> {
  deleteOutbox(id)
  notify()
}
