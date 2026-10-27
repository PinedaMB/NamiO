import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { createTransport } from 'nodemailer'
import type { MailAction, OutboxItem, OutboxKind, OutboxStatus, PickedAttachment, SendMailPayload } from '@shared/ipc'
import { deleteOutbox, enqueueOutbox, listOutbox, updateOutbox, type OutboxRow } from './db'
import { appendToSent, archivePath, deleteMessage, getCredentials, moveMessage, setSeen, syncInbox } from './imap'

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

const pendingAttachments = new Map<string, PendingAttachment>()

export async function registerAttachments(window: BrowserWindow | null): Promise<PickedAttachment[]> {
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
    pendingAttachments.set(entry.id, entry)
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
    .map((id) => pendingAttachments.get(id))
    .filter((entry): entry is PendingAttachment => entry !== undefined)

  // Se compila con nodemailer (multipart si hay adjuntos) y se envía el crudo:
  // así la copia en Enviados es byte a byte el mensaje que salió.
  const compiler = createTransport({ streamTransport: true, buffer: true })
  const compiled = await compiler.sendMail({
    from: sender,
    to: payload.to,
    cc: payload.cc === '' ? undefined : payload.cc,
    subject: payload.subject,
    text: payload.text,
    attachments: files.map((file) => ({ filename: file.name, path: file.path }))
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
    tls: { rejectUnauthorized: account.smtp.secure }
  })

  const recipients = [payload.to, payload.cc]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '')

  try {
    await transport.sendMail({
      envelope: { from: sender, to: recipients },
      raw
    })

    // Copia en Enviados: si falla, el mensaje ya salió y no debe reintentarse.
    await appendToSent(raw).catch((error: unknown) => {
      console.error('[sent-copy]', error)
    })

    for (const file of files) pendingAttachments.delete(file.id)

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
  if (row.kind === 'send') {
    await sendWithSmtp(payloadOf(row) as unknown as SendMailPayload)
  } else if (row.kind === 'archive') {
    const target = archivePath()
    if (!target) throw new Error('El servidor no expone un buzón de archivo')
    await moveMessage(row.mailbox ?? 'INBOX', row.uid ?? 0, target)
  } else if (row.kind === 'delete') {
    await deleteMessage(row.mailbox ?? 'INBOX', row.uid ?? 0)
  } else if (row.kind === 'move') {
    const target = payloadOf(row).target
    if (typeof target !== 'string' || target === '') throw new Error('La regla no tiene buzón destino')
    await moveMessage(row.mailbox ?? 'INBOX', row.uid ?? 0, target)
  } else if (row.kind === 'seen') {
    await setSeen(row.mailbox ?? 'INBOX', row.uid ?? 0, true)
  }

  deleteOutbox(row.id)
}

/** Procesa la cola en orden. Es idempotente y no corre en paralelo consigo misma. */
export async function processOutbox(): Promise<void> {
  if (processing) return
  processing = true

  try {
    for (const row of listOutbox()) {
      if (row.status === 'failed') continue
      try {
        await runOne(row)
      } catch (error) {
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
  enqueueOutbox({ kind: 'send', payload })
  notify()
  await processOutbox()

  const pending = remaining('send')
  if (pending?.status === 'failed') {
    return { ok: false, queued: true, error: pending.lastError ?? 'No se pudo enviar' }
  }
  return { ok: true, queued: Boolean(pending) }
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

export async function deleteMessageAction(path: string, uid: number): Promise<MailAction> {
  enqueueOutbox({ kind: 'delete', mailbox: path, uid })
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
