import { queueDraftDelete, syncDraft } from './drafts'
import { splitRecipients, validRecipients } from '@shared/mailAddresses'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { createTransport } from 'nodemailer'
import type { MailAction, OutboxItem, OutboxKind, OutboxStatus, PickedAttachment, SendMailPayload } from '@shared/ipc'
import { readDraft, cacheAccountId, rememberRecipients, prunePickedAttachments, storePickedAttachment, readPickedAttachment, deleteOutbox, enqueueOutbox, listOutbox, updateOutbox, type OutboxRow } from './db'
import { readActiveAccount } from './settings'
import { appendToSent, archivePath, deleteMessage, deleteMessageBatch, getCredentials, moveMessage, removeServerDraft, setSeen, syncInbox } from './imap'

/**
 * Cola de salida: todo lo que modifica el servidor (enviar, archivar, eliminar)
 * se encola primero. Si no hay red, queda pendiente y se reintenta; si el
 * servidor rechaza, se reintenta hasta MAX_ATTEMPTS y luego queda "failed"
 * para que el usuario decida.
 */

const MAX_ATTEMPTS = 5

let processing = false
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
  if (row.kind === 'delete-many') return `${row.mailbox}: ${Array.isArray(payload.uids) ? payload.uids.length : 0}`
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
    label: labelOf(row)
  }))
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function registerFailure(row: OutboxRow, error: unknown): void {
  const attempts = row.attempts + 1
  updateOutbox(row.id, {
    attempts,
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
  for (const filePath of result.filePaths) {
    const info = await stat(filePath)
    const entry: PendingAttachment = {
      id: randomUUID(),
      path: filePath,
      name: basename(filePath),
      size: info.size
    }
    const data = await readFile(filePath)
    if ((await readActiveAccount())?.id !== accountId) throw new Error('La cuenta activa cambió')
    storePickedAttachment(entry.id, entry.name, data)
    picked.push({ id: entry.id, name: entry.name, size: entry.size })
  }

  return picked
}

async function sendWithSmtp(payload: SendMailPayload): Promise<void> {
  const credentials = await getCredentials()
  if (!credentials) throw new Error('La cuenta no tiene credenciales guardadas')

  const { account, password, accessToken } = credentials
  // Cuentas locales de prueba no traen dominio: se lo damos para que el
  // remitente sea una dirección válida (los servidores rechazan "user" a secas).
  const sender = account.user.includes('@') ? account.user : `${account.user}@${account.host || 'localhost'}`

  const files = (payload.attachments ?? [])
    .map((id) => {
      const file = readPickedAttachment(id)
      if (!file) throw new Error('Falta un adjunto. Vuelve a adjuntarlo antes de enviar.')
      return { name: file.name, data: Buffer.from(file.data) }
    })

  // Se compila con nodemailer (multipart si hay adjuntos) y se envía el crudo:
  // así la copia en Enviados es byte a byte el mensaje que salió.
  const compiler = createTransport({ streamTransport: true, buffer: true })
  const compiled = await compiler.sendMail({
    from: sender,
    to: payload.to,
    cc: payload.cc === '' ? undefined : payload.cc,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
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
    await appendToSent(raw).catch((error: unknown) => {
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
  if (row.kind === 'draft-save') {
    const id = payloadOf(row).draftId
    if (typeof id !== 'string') throw new Error('Borrador inválido')
    await syncDraft(id)
    const current = owner === cacheAccountId() ? readDraft(id) : null
    if (current && current.syncedAt !== current.updatedAt && !listOutbox().some(item => item.id !== row.id && item.kind === 'draft-save' && payloadOf(item).draftId === id)) {
      enqueueOutbox({ kind: 'draft-save', payload: { draftId: id } })
    }
  } else if (row.kind === 'draft-delete') {
    const reference = payloadOf(row).server as import('@shared/ipc').DraftServerRef
    if (!reference || typeof reference.path !== 'string' || !Number.isInteger(reference.uid) || typeof reference.uidValidity !== 'string') throw new Error('Borrador inválido')
    await removeServerDraft(reference)
  } else if (row.kind === 'send') {
    await sendWithSmtp(payloadOf(row) as unknown as SendMailPayload)
    if (owner === cacheAccountId() && typeof payloadOf(row).draftId === 'string' && readDraft(payloadOf(row).draftId as string)?.updatedAt === payloadOf(row).draftUpdatedAt) queueDraftDelete(payloadOf(row).draftId as string)
  } else if (row.kind === 'archive') {
    const target = archivePath()
    if (!target) throw new Error('El servidor no expone un buzón de archivo')
    await moveMessage(row.mailbox ?? 'INBOX', row.uid ?? 0, target)
  } else if (row.kind === 'delete') {
    await deleteMessage(row.mailbox ?? 'INBOX', row.uid ?? 0, payloadOf(row).permanent === true)
  } else if (row.kind === 'delete-many') {
    const payload = payloadOf(row)
    if (!row.mailbox || !Array.isArray(payload.uids) || payload.uids.some(uid => !Number.isInteger(uid) || uid <= 0) || typeof payload.uidValidity !== 'string' || !/^\d+$/.test(payload.uidValidity)) throw new Error('Lote de borrado inválido')
    await deleteMessageBatch(row.mailbox, payload.uids as number[], payload.permanent === true, payload.uidValidity)
  } else if (row.kind === 'move') {
    const target = payloadOf(row).target
    if (typeof target !== 'string' || target === '') throw new Error('La regla no tiene buzón destino')
    await moveMessage(row.mailbox ?? 'INBOX', row.uid ?? 0, target)
  } else if (row.kind === 'seen') {
    await setSeen(row.mailbox ?? 'INBOX', row.uid ?? 0, true)
  }

  if (owner !== cacheAccountId()) return
  deleteOutbox(row.id)
  prunePickedAttachments()
}

/** Procesa la cola en orden. Es idempotente y no corre en paralelo consigo misma. */
export async function processOutbox(): Promise<void> {
  if (processing) return
  processing = true
  const owner = cacheAccountId()

  try {
    const attempted = new Set<string>()
    while (true) {
      const row = listOutbox().find(item => item.status !== 'failed' && !attempted.has(item.id))
      if (!row) break
      attempted.add(row.id)
      if (owner !== cacheAccountId()) return
      try {
        await runOne(row)
      } catch (error) {
        if (owner !== cacheAccountId()) return
        registerFailure(row, error)
      }
    }
  } finally {
    processing = false
    notify()
  }
}

function remaining(kind: OutboxKind, match?: (row: OutboxRow) => boolean): OutboxRow | undefined {
  return listOutbox().find((row) => row.kind === kind && (!match || match(row)))
}

export async function sendMail(payload: SendMailPayload): Promise<MailAction> {
  if (!payload || (payload.html !== undefined && typeof payload.html !== 'string') || typeof payload.to !== 'string' || typeof payload.cc !== 'string' || typeof payload.subject !== 'string' || typeof payload.text !== 'string' || (payload.bcc !== undefined && typeof payload.bcc !== 'string') || !validRecipients(payload.to, payload.cc, payload.bcc ?? '')) {
    return { ok: false, queued: false, error: 'Destinatarios inválidos' }
  }
  if (payload.attachments !== undefined && (!Array.isArray(payload.attachments) || payload.attachments.some(id => typeof id !== 'string' || !readPickedAttachment(id)))) {
    return { ok: false, queued: false, error: 'Falta un adjunto. Vuelve a adjuntarlo antes de enviar.' }
  }
  if ((payload.inReplyTo !== undefined && (typeof payload.inReplyTo !== 'string' || /[\r\n]/.test(payload.inReplyTo))) || (payload.references !== undefined && (!Array.isArray(payload.references) || payload.references.some(id => typeof id !== 'string' || /[\r\n]/.test(id))))) {
    return { ok: false, queued: false, error: 'Cabeceras de respuesta inválidas' }
  }
  payload = { ...payload, draftUpdatedAt: payload.draftId ? readDraft(payload.draftId)?.updatedAt : undefined, to: splitRecipients(payload.to).join(', '), cc: splitRecipients(payload.cc).join(', '), bcc: splitRecipients(payload.bcc ?? '').join(', ') }
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

export async function archiveMessage(path: string, uid: number): Promise<MailAction> {
  enqueueOutbox({ kind: 'archive', mailbox: path, uid })
  notify()
  await processOutbox()

  const pending = remaining('archive', (row) => row.mailbox === path && row.uid === uid)
  if (pending?.status === 'failed') {
    return { ok: false, queued: true, error: pending.lastError ?? 'No se pudo archivar' }
  }
  return { ok: true, queued: Boolean(pending) }
}

export async function deleteMessageAction(path: string, uid: number, permanent = false): Promise<MailAction> {
  enqueueOutbox({ kind: 'delete', mailbox: path, uid, payload: { permanent } })
  notify()
  await processOutbox()

  const pending = remaining('delete', (row) => row.mailbox === path && row.uid === uid)
  if (pending?.status === 'failed') {
    return { ok: false, queued: true, error: pending.lastError ?? 'No se pudo eliminar' }
  }
  return { ok: true, queued: Boolean(pending) }
}

export async function retryOutbox(id: string): Promise<void> {
  updateOutbox(id, { status: 'queued', lastError: null })
  notify()
  await processOutbox()
}

export async function cancelOutbox(id: string): Promise<void> {
  deleteOutbox(id)
  notify()
}
