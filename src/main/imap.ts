import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type {
  AccountState,
  Envelope,
  EnvelopeAddress,
  ImapAccountConfig,
  ImapErrorCode,
  ImapResult,
  MailboxInfo,
  MessageAttachment,
  MessageDetail
} from '@shared/ipc'
import { decryptSecret, readSettings } from './settings'

interface Session {
  client: ImapFlow
  config: ImapAccountConfig
}

let session: Session | null = null

/**
 * IMAP es un protocolo con estado y un solo buzón seleccionado por conexión:
 * serializar las operaciones evita locks cruzados y respuestas mezcladas.
 */
let chain: Promise<unknown> = Promise.resolve()

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

function createClient(config: ImapAccountConfig, password: string): ImapFlow {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: password },
    logger: false,
    // En claro no se intenta STARTTLS: en M1 el cifrado se elige con el switch.
    tls: { rejectUnauthorized: config.secure }
  })

  // Sin listener, un error de socket tira abajo el proceso principal.
  client.on('error', () => undefined)
  client.on('close', () => {
    if (session?.client === client) session = null
  })

  return client
}

async function openSession(config: ImapAccountConfig, password: string): Promise<void> {
  await closeSession()
  const client = createClient(config, password)
  await client.connect()
  session = { client, config }
}

async function closeSession(): Promise<void> {
  const current = session
  session = null
  if (!current) return
  try {
    await current.client.logout()
  } catch {
    try {
      current.client.close()
    } catch {
      // ya estaba cerrada
    }
  }
}

/** Conecta con la cuenta guardada si hace falta. Lanza si no hay credenciales usables. */
async function ensureClient(): Promise<ImapFlow> {
  if (session?.client.usable) return session.client

  const stored = await readSettings()
  if (!stored.account) throw new Error('No account configured')

  const password = stored.account.secret ? await decryptSecret(stored.account.secret) : null
  if (!password) throw new Error('Stored password unavailable')

  await openSession(
    {
      host: stored.account.host,
      port: stored.account.port,
      secure: stored.account.secure,
      user: stored.account.user
    },
    password
  )

  if (!session) throw new Error('Connection failed')
  return session.client
}

function classify(error: unknown): ImapErrorCode {
  const value = error as { code?: string; message?: string; authenticationFailed?: boolean } | null
  const code = (value?.code ?? '').toUpperCase()
  const message = (value?.message ?? '').toLowerCase()

  if (value?.authenticationFailed) return 'auth'
  if (code.includes('AUTH') || message.includes('authentication') || message.includes('invalid credentials')) return 'auth'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns'
  if (code === 'ECONNREFUSED') return 'refused'
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ESOCKETTIMEDOUT' || code === 'ECONNABORTED') return 'timeout'
  if (code.includes('CERT') || code.includes('TLS') || message.includes('certificate')) return 'tls'
  if (code.startsWith('E') && code.includes('NETWORK')) return 'network'
  return 'unknown'
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function attempt<T>(fn: (client: ImapFlow) => Promise<T>): Promise<ImapResult<T>> {
  try {
    const data = await serial(async () => fn(await ensureClient()))
    return { ok: true, data }
  } catch (error) {
    return { ok: false, code: classify(error), detail: describe(error) }
  }
}

function toDate(value: string | Date | undefined): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

function toAddress(entry: { name?: string; address?: string } | undefined): EnvelopeAddress | null {
  if (!entry?.address) return null
  return { name: entry.name ?? '', address: entry.address }
}

export async function getAccountState(): Promise<AccountState> {
  const stored = await readSettings()
  const account = stored.account ?? null
  return {
    configured: account !== null,
    connected: session !== null && session.client.usable,
    account: account
      ? { host: account.host, port: account.port, secure: account.secure, user: account.user }
      : null,
    passwordStored: Boolean(account?.secret)
  }
}

export async function connectAccount(
  config: ImapAccountConfig,
  password: string
): Promise<ImapResult<AccountState>> {
  try {
    await serial(() => openSession(config, password))
    return { ok: true, data: await getAccountState() }
  } catch (error) {
    return { ok: false, code: classify(error), detail: describe(error) }
  }
}

export async function disconnectAccount(): Promise<void> {
  await serial(closeSession)
}

export function listMailboxes(): Promise<ImapResult<MailboxInfo[]>> {
  return attempt(async (client) => {
    const boxes = await client.list()
    const result: MailboxInfo[] = []

    for (const box of boxes) {
      // STATUS por buzón es un round-trip cada uno: se acota para no demorar la
      // primera pantalla. M3 lo resuelve con la caché local.
      let messages = 0
      let unseen = 0
      if (result.length < 30) {
        try {
          const status = await client.status(box.path, { messages: true, unseen: true })
          if (status) {
            messages = status.messages ?? 0
            unseen = status.unseen ?? 0
          }
        } catch {
          // buzones \Noselect o servidores que niegan STATUS fuera de SELECT
        }
      }

      result.push({
        path: box.path,
        name: box.name || box.path,
        specialUse: box.specialUse ?? null,
        messages,
        unseen
      })
    }

    return result
  })
}

export function listEnvelopes(path: string, limit: number): Promise<ImapResult<Envelope[]>> {
  return attempt(async (client) => {
    const lock = await client.getMailboxLock(path)
    try {
      const mailbox = client.mailbox
      if (!mailbox || mailbox.exists === 0) return []

      const start = Math.max(1, mailbox.exists - limit + 1)
      const envelopes: Envelope[] = []

      for await (const message of client.fetch(`${start}:*`, {
        envelope: true,
        flags: true,
        uid: true,
        size: true,
        internalDate: true
      })) {
        envelopes.push({
          uid: message.uid,
          subject: message.envelope?.subject ?? '',
          from: toAddress(message.envelope?.from?.[0]),
          date: toDate(message.internalDate).toISOString(),
          unread: !message.flags?.has('\\Seen'),
          flagged: message.flags?.has('\\Flagged') ?? false,
          size: message.size ?? 0
        })
      }

      return envelopes.reverse()
    } finally {
      lock.release()
    }
  })
}

export function getMessage(path: string, uid: number): Promise<ImapResult<MessageDetail>> {
  return attempt(async (client) => {
    const lock = await client.getMailboxLock(path)
    try {
      const download = await client.download(String(uid), undefined, { uid: true })
      if (!download.content) throw new Error('Message body unavailable')
      const chunks: Buffer[] = []
      for await (const chunk of download.content) chunks.push(Buffer.from(chunk))

      // M1 muestra el cuerpo de texto; el HTML sanitizado es M2.
      const parsed = await simpleParser(Buffer.concat(chunks))

      const to = (parsed.to
        ? Array.isArray(parsed.to)
          ? parsed.to
          : [parsed.to]
        : []
      ).flatMap((entry) =>
        entry.value.flatMap((value) => {
          const address = toAddress(value)
          return address ? [address] : []
        })
      )

      const attachments: MessageAttachment[] = parsed.attachments.map((attachment) => ({
        name: attachment.filename ?? 'adjunto',
        size: attachment.size ?? 0,
        type: attachment.contentType ?? 'application/octet-stream'
      }))

      return {
        uid,
        subject: parsed.subject ?? '',
        from: parsed.from ? toAddress(parsed.from.value[0]) : null,
        to,
        cc: [],
        date: (parsed.date ?? new Date()).toISOString(),
        unread: false,
        flagged: false,
        size: Buffer.concat(chunks).length,
        text: parsed.text ?? '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        attachments
      }
    } finally {
      lock.release()
    }
  })
}

export function setFlagged(path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>> {
  return attempt(async (client) => {
    const lock = await client.getMailboxLock(path)
    try {
      if (flagged) await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true })
      else await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true })
      return flagged
    } finally {
      lock.release()
    }
  })
}
