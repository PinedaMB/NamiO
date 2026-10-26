import { randomUUID } from 'node:crypto'
import { createTransport } from 'nodemailer'
import type { MailAction, OutboxItem, OutboxKind, OutboxStatus, SendMailPayload } from '@shared/ipc'
import { deleteOutbox, enqueueOutbox, listOutbox, updateOutbox, type OutboxRow } from './db'
import { appendToSent, archivePath, deleteMessage, getCredentials, moveMessage, syncInbox } from './imap'

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

/** Compone el mensaje crudo (RFC 5322) para enviarlo y copiarlo a Enviados. */
function buildRawMessage(input: { from: string; to: string; cc: string; subject: string; text: string }): Buffer {
  const encodeWord = (value: string): string =>
    /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`

  const wrap = (value: string): string => Buffer.from(value, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')

  const domain = input.from.split('@')[1] ?? 'localhost'
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    `Subject: ${encodeWord(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64'
  ]

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${wrap(input.text)}\r\n`, 'utf8')
}

async function sendWithSmtp(payload: SendMailPayload): Promise<void> {
  const credentials = await getCredentials()
  if (!credentials) throw new Error('La cuenta no tiene credenciales guardadas')

  const { account, password } = credentials
  // Cuentas locales de prueba no traen dominio: se lo damos para que el
  // remitente sea una dirección válida (los servidores rechazan "user" a secas).
  const sender = account.user.includes('@') ? account.user : `${account.user}@${account.host || 'localhost'}`

  const raw = buildRawMessage({
    from: sender,
    to: payload.to,
    cc: payload.cc,
    subject: payload.subject,
    text: payload.text
  })

  const transport = createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: password },
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
