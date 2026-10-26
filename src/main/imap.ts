import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type {
  AccountConfig,
  AccountState,
  CachedResult,
  Envelope,
  EnvelopeAddress,
  ImapAccountConfig,
  ImapErrorCode,
  ImapResult,
  MailboxInfo,
  MessageAttachment,
  MessageDetail,
  SearchHit,
  SyncMeta
} from '@shared/ipc'
import {
  clearMailbox,
  countMessages,
  countUnread,
  deleteMessageRow,
  getMailboxMeta,
  getMeta,
  readBody,
  readEnvelope,
  readEnvelopes,
  readMailboxes,
  pruneExcept,
  saveBody,
  saveMailboxSync,
  searchMessages,
  setFlagged as cacheFlagged,
  setMeta,
  setUnread as cacheUnread,
  updateFlags,
  upsertEnvelopes,
  upsertMailboxes
} from './db'
import { authorize, getAccessToken } from './oauth'
import { decryptSecret, encryptSecret, readSettings, writeSettings, type StoredAccount } from './settings'

interface Session {
  client: ImapFlow
  config: ImapAccountConfig
}

let session: Session | null = null
let offline = false
let cacheListener: ((mailbox: string) => void) | null = null

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

export function setCacheListener(listener: (mailbox: string) => void): void {
  cacheListener = listener
}

function notify(mailbox: string): void {
  cacheListener?.(mailbox)
}

function syncMeta(): SyncMeta {
  const last = getMeta('lastSync')
  return { offline, syncedAt: last ? Number(last) : null }
}

function isOfflineError(code: ImapErrorCode): boolean {
  return code === 'dns' || code === 'refused' || code === 'timeout' || code === 'network' || code === 'tls'
}

type ImapAuth = { password: string } | { accessToken: string }

function createClient(config: ImapAccountConfig, auth: ImapAuth): ImapFlow {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // XOAUTH2 cuando la cuenta es OAuth2; si no, SASL PLAIN con la contraseña.
    auth: 'accessToken' in auth ? { user: config.user, accessToken: auth.accessToken } : { user: config.user, pass: auth.password },
    logger: false,
    tls: { rejectUnauthorized: config.secure }
  })

  // Sin listener, un error de socket tira abajo el proceso principal.
  client.on('error', () => undefined)
  client.on('close', () => {
    if (session?.client === client) session = null
  })

  return client
}

async function openSession(config: ImapAccountConfig, auth: ImapAuth): Promise<void> {
  await closeSession()
  const client = createClient(config, auth)
  await client.connect()
  session = { client, config }
  offline = false
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

/** Resuelve las credenciales de la cuenta: contraseña guardada o access token OAuth. */
async function authFor(account: StoredAccount): Promise<ImapAuth> {
  if (account.auth === 'oauth2') {
    if (!account.oauth || !account.refreshToken) throw new Error('La cuenta OAuth no tiene refresh token')
    const refreshToken = await decryptSecret(account.refreshToken)
    if (!refreshToken) throw new Error('No se pudo descifrar el refresh token')

    const token = await getAccessToken(account.oauth, refreshToken)
    if (token.refreshToken) {
      // Microsoft rota el refresh token: se persiste el nuevo.
      const encrypted = await encryptSecret(token.refreshToken)
      if (encrypted) await writeSettings({ account: { ...account, refreshToken: encrypted } })
    }
    return { accessToken: token.accessToken }
  }

  const password = account.secret ? await decryptSecret(account.secret) : null
  if (!password) throw new Error('Stored password unavailable')
  return { password }
}

/** Conecta con la cuenta guardada si hace falta. Lanza si no hay credenciales usables. */
async function ensureClient(): Promise<ImapFlow> {
  if (session?.client.usable) return session.client

  const stored = await readSettings()
  if (!stored.account) throw new Error('No account configured')

  const auth = await authFor(stored.account)

  await openSession(
    {
      host: stored.account.host,
      port: stored.account.port,
      secure: stored.account.secure,
      user: stored.account.user
    },
    auth
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
  const value = error as { message?: string; responseText?: string } | null
  const base = error instanceof Error ? error.message : String(error)
  // El servidor explica el rechazo (p. ej. "[AUTHENTICATIONFAILED] Invalid credentials");
  // sin esto el usuario solo ve "Command failed".
  const detail = typeof value?.responseText === 'string' ? value.responseText.trim() : ''
  if (detail !== '' && !base.includes(detail)) return `${base} — ${detail}`
  return base
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

/* ---------------------------------------------------------------------------
   Sincronización
   ------------------------------------------------------------------------- */

async function fetchRange(client: ImapFlow, range: string, byUid: boolean): Promise<Envelope[]> {
  const envelopes: Envelope[] = []
  const options = byUid ? { uid: true } : undefined

  for await (const message of client.fetch(
    range,
    { envelope: true, flags: true, uid: true, size: true, internalDate: true },
    options
  )) {
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

  return envelopes
}

async function syncMailboxes(): Promise<MailboxInfo[]> {
  const client = await ensureClient()
  const boxes = await client.list()
  const result: MailboxInfo[] = []

  for (const box of boxes) {
    let messages = 0
    let unseen = 0
    try {
      const status = await client.status(box.path, { messages: true, unseen: true })
      if (status) {
        messages = status.messages ?? 0
        unseen = status.unseen ?? 0
      }
    } catch {
      // buzones \Noselect o servidores que niegan STATUS fuera de SELECT
    }

    result.push({
      path: box.path,
      name: box.name || box.path,
      specialUse: box.specialUse ?? null,
      messages,
      unseen
    })
  }

  upsertMailboxes(result)
  setMeta('lastSync', String(Date.now()))
  offline = false
  return result
}

async function syncMessages(path: string, limit: number): Promise<void> {
  const client = await ensureClient()

  // STATUS fresco: si el buzón ya estaba seleccionado, `client.mailbox` puede
  // tener EXISTS/UIDNEXT viejos y el sync se quedaría dormido.
  let exists = 0
  let uidNext: number | null = null
  let uidValidity: number | null = null
  try {
    const status = await client.status(path, { messages: true, uidNext: true, uidValidity: true })
    if (status) {
      exists = status.messages ?? 0
      uidNext = status.uidNext != null ? Number(status.uidNext) : null
      uidValidity = status.uidValidity != null ? Number(status.uidValidity) : null
    }
  } catch {
    const box = client.mailbox
    if (box) {
      exists = box.exists ?? 0
      uidNext = box.uidNext != null ? Number(box.uidNext) : null
      uidValidity = box.uidValidity != null ? Number(box.uidValidity) : null
    }
  }

  const lock = await client.getMailboxLock(path)

  try {
    const cached = getMailboxMeta(path)
    // Resync completo si cambió UIDVALIDITY, o si el servidor "encogió" (pocos
    // servidores reinician sin cambiarla, pero la caché no debe quedar mintiendo).
    const shrunk =
      cached !== null &&
      ((uidNext !== null && cached.uidNext !== null && uidNext < cached.uidNext) ||
        exists < countMessages(path))
    const fullSync = cached?.uidValidity == null || cached.uidValidity !== uidValidity || shrunk

    if (fullSync) {
      clearMailbox(path)
      const start = Math.max(1, exists - limit + 1)
      const envelopes = await fetchRange(client, `${start}:*`, false)
      upsertEnvelopes(path, envelopes)
      if (exists <= limit) pruneExcept(path, envelopes.map((envelope) => envelope.uid))
    } else {
      const fromUid = cached.uidNext ?? 1
      if (uidNext != null && uidNext > fromUid) {
        upsertEnvelopes(path, await fetchRange(client, `${fromUid}:*`, true))
      }
    }

    saveMailboxSync(path, {
      uidValidity,
      uidNext,
      messages: exists,
      unseen: countUnread(path)
    })
    setMeta('lastSync', String(Date.now()))
    offline = false

    // Los flags cambian desde otros clientes: se refresca el tramo visible.
    if (exists > 0) {
      const recentStart = Math.max(1, exists - 19)
      const flags: { uid: number; unread: boolean; flagged: boolean }[] = []
      for await (const message of client.fetch(`${recentStart}:*`, { uid: true, flags: true })) {
        flags.push({
          uid: message.uid,
          unread: !message.flags?.has('\\Seen'),
          flagged: message.flags?.has('\\Flagged') ?? false
        })
      }
      updateFlags(path, flags)
    }

    // Reconciliación: si el servidor cuenta más mensajes de los que tenemos, el
    // UIDNEXT pudo quedar desfasado (entrega a mitad de camino). Se re-lee el
    // tramo final por secuencia, que es idempotente.
    if (countMessages(path) < exists) {
      const start = Math.max(1, exists - limit + 1)
      const envelopes = await fetchRange(client, `${start}:*`, false)
      upsertEnvelopes(path, envelopes)
      // Si el tramo cubre todo el buzón, también se poda lo que ya no existe.
      if (exists <= limit) pruneExcept(path, envelopes.map((envelope) => envelope.uid))
      saveMailboxSync(path, {
        uidValidity,
        uidNext,
        messages: exists,
        unseen: countUnread(path)
      })
    }
  } finally {
    lock.release()
  }
}

/* ---------------------------------------------------------------------------
   API de lectura: caché primero, red después
   ------------------------------------------------------------------------- */

export async function listMailboxes(sync = true): Promise<CachedResult<MailboxInfo[]>> {
  const cached = readMailboxes()

  if (sync) {
    if (cached.length === 0) {
      try {
        return { ok: true, data: await serial(syncMailboxes), meta: syncMeta() }
      } catch (error) {
        const code = classify(error)
        if (!isOfflineError(code)) return { ok: false, code, detail: describe(error) }
        offline = true
        return { ok: true, data: [], meta: syncMeta() }
      }
    }

    // Con caché, se responde ya y se actualiza en segundo plano.
    void serial(syncMailboxes)
      .then(() => notify('*'))
      .catch(() => {
        offline = true
        // Sin este aviso la UI no se entera de que pasó a modo offline.
        notify('*')
      })
  }

  return { ok: true, data: cached, meta: syncMeta() }
}

export async function listEnvelopes(
  path: string,
  limit: number,
  sync = true
): Promise<CachedResult<Envelope[]>> {
  const cached = readEnvelopes(path, limit)

  if (!sync) return { ok: true, data: cached, meta: syncMeta() }

  if (cached.length === 0) {
    try {
      await serial(() => syncMessages(path, limit))
      return { ok: true, data: readEnvelopes(path, limit), meta: syncMeta() }
    } catch (error) {
      const code = classify(error)
      if (!isOfflineError(code)) return { ok: false, code, detail: describe(error) }
      offline = true
      return { ok: true, data: [], meta: syncMeta() }
    }
  }

  void serial(() => syncMessages(path, limit))
    .then(() => notify(path))
    .catch(() => {
      offline = true
      notify(path)
    })

  return { ok: true, data: cached, meta: syncMeta() }
}

async function fetchMessage(path: string, uid: number): Promise<MessageDetail> {
  const client = await ensureClient()
  const lock = await client.getMailboxLock(path)

  try {
    const download = await client.download(String(uid), undefined, { uid: true })
    if (!download.content) throw new Error('Message body unavailable')

    const chunks: Buffer[] = []
    for await (const chunk of download.content) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks)

    const parsed = await simpleParser(raw)

    const to = (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : []).flatMap((entry) =>
      entry.value.flatMap((value) => {
        const address = toAddress(value)
        return address ? [address] : []
      })
    )

    const cc = (parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) : []).flatMap((entry) =>
      entry.value.flatMap((value) => {
        const address = toAddress(value)
        return address ? [address] : []
      })
    )

    const attachments: MessageAttachment[] = parsed.attachments.map((attachment, index) => ({
      name: attachment.filename ?? `adjunto-${index + 1}`,
      size: attachment.size ?? 0,
      type: attachment.contentType ?? 'application/octet-stream',
      index
    }))

    const envelope = readEnvelope(path, uid)

    return {
      uid,
      subject: parsed.subject ?? envelope?.subject ?? '',
      from: parsed.from ? toAddress(parsed.from.value[0]) : (envelope?.from ?? null),
      to,
      cc,
      date: (parsed.date ?? toDate(envelope?.date)).toISOString(),
      unread: envelope?.unread ?? false,
      flagged: envelope?.flagged ?? false,
      size: raw.length,
      text: parsed.text ?? '',
      html: typeof parsed.html === 'string' ? parsed.html : null,
      attachments
    }
  } finally {
    lock.release()
  }
}

function cachedDetail(path: string, uid: number): MessageDetail | null {
  const envelope = readEnvelope(path, uid)
  if (!envelope) return null

  const body = readBody(path, uid)
  const attachments: MessageAttachment[] = body.attachments.map((attachment, index) => ({
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    index
  }))

  return {
    ...envelope,
    to: body.to,
    cc: body.cc,
    text: body.text ?? '',
    html: body.html,
    attachments
  }
}

export async function getMessage(path: string, uid: number): Promise<CachedResult<MessageDetail>> {
  const body = readBody(path, uid)
  if (body.fetched) {
    const detail = cachedDetail(path, uid)
    if (detail) return { ok: true, data: detail, meta: syncMeta() }
  }

  try {
    const detail = await serial(() => fetchMessage(path, uid))
    saveBody(path, uid, {
      text: detail.text,
      html: detail.html,
      to: detail.to,
      cc: detail.cc,
      attachments: detail.attachments
    })
    offline = false
    return { ok: true, data: detail, meta: syncMeta() }
  } catch (error) {
    const code = classify(error)
    const fallback = cachedDetail(path, uid)
    if (fallback && isOfflineError(code)) {
      offline = true
      return { ok: true, data: fallback, meta: { ...syncMeta(), partial: true } }
    }
    return { ok: false, code, detail: describe(error) }
  }
}

export function setFlagged(path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>> {
  return serial(async () => {
    try {
      const client = await ensureClient()
      const lock = await client.getMailboxLock(path)
      try {
        if (flagged) await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true })
        else await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true })
      } finally {
        lock.release()
      }
      cacheFlagged(path, uid, flagged)
      offline = false
      return { ok: true as const, data: flagged }
    } catch (error) {
      return { ok: false as const, code: classify(error), detail: describe(error) }
    }
  })
}

/** Búsqueda local sobre lo ya sincronizado (asunto, remitentes y cuerpos). */
export function searchMail(query: string, limit = 60): SearchHit[] {
  const names = new Map(readMailboxes().map((box) => [box.path, box.name]))

  try {
    return searchMessages(query, limit).map((row) => ({
      mailbox: row.mailbox,
      mailboxName: names.get(row.mailbox) ?? row.mailbox,
      uid: row.uid,
      subject: row.subject,
      from: row.fromAddr ? { name: row.fromName, address: row.fromAddr } : null,
      date: new Date(row.date).toISOString(),
      unread: row.unread,
      flagged: row.flagged,
      snippet: row.snippet
    }))
  } catch {
    // Consulta inválida para FTS: la UI muestra "sin resultados" y sigue viva.
    return []
  }
}

/** Sincroniza la bandeja de entrada y avisa a la UI. Silencioso ante errores. */
export async function syncInbox(limit = 50): Promise<void> {
  const inbox = readMailboxes().find((box) => box.specialUse === '\\Inbox' || /^inbox$/i.test(box.path))?.path
  if (!inbox) return

  try {
    await serial(() => syncMessages(inbox, limit))
    notify(inbox)
    notify('*')
  } catch {
    // sin red o sin sesión: la UI sigue con la caché
  }
}

export function setSeen(path: string, uid: number, seen: boolean): Promise<ImapResult<boolean>> {
  return serial(async () => {
    try {
      const client = await ensureClient()
      const lock = await client.getMailboxLock(path)
      try {
        if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
        else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
      } finally {
        lock.release()
      }
      cacheUnread(path, uid, !seen)
      offline = false
      return { ok: true as const, data: seen }
    } catch (error) {
      return { ok: false as const, code: classify(error), detail: describe(error) }
    }
  })
}

/** Descarga un adjunto puntual (los cuerpos cacheados no guardan los bytes). */
export function readAttachment(
  path: string,
  uid: number,
  index: number
): Promise<{ name: string; content: Buffer }> {
  return serial(async () => {
    const client = await ensureClient()
    const lock = await client.getMailboxLock(path)

    try {
      const download = await client.download(String(uid), undefined, { uid: true })
      if (!download.content) throw new Error('El mensaje no tiene contenido')

      const chunks: Buffer[] = []
      for await (const chunk of download.content) chunks.push(Buffer.from(chunk))

      const parsed = await simpleParser(Buffer.concat(chunks))
      const attachment = parsed.attachments[index]
      if (!attachment?.content) throw new Error('Adjunto no encontrado')

      return {
        name: attachment.filename ?? `adjunto-${index + 1}`,
        content: Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content)
      }
    } finally {
      lock.release()
    }
  })
}

/** Ruta del buzón de archivo, si el servidor la expone. */
export function archivePath(): string | null {
  const boxes = readMailboxes()
  return (boxes.find((box) => box.specialUse === '\\Archive') ?? boxes.find((box) => /^archive$/i.test(box.path)))?.path ?? null
}

/** Copia el mensaje en Enviados después de un envío correcto (best effort). */
export function appendToSent(raw: Buffer): Promise<void> {
  return serial(async () => {
    const client = await ensureClient()
    const sent = readMailboxes().find((box) => box.specialUse === '\\Sent' || /^sent$/i.test(box.path))?.path
    if (!sent) return
    await client.append(sent, raw, ['\\Seen'])
  })
}

export function moveMessage(path: string, uid: number, target: string): Promise<void> {
  return serial(async () => {
    const client = await ensureClient()
    const lock = await client.getMailboxLock(path)
    try {
      await client.messageMove(String(uid), target, { uid: true })
    } finally {
      lock.release()
    }
    deleteMessageRow(path, uid)
  })
}

export function deleteMessage(path: string, uid: number): Promise<void> {
  return serial(async () => {
    const client = await ensureClient()
    const lock = await client.getMailboxLock(path)
    try {
      await client.messageDelete(String(uid), { uid: true })
    } finally {
      lock.release()
    }
    deleteMessageRow(path, uid)
  })
}

/* ---------------------------------------------------------------------------
   Cuenta
   ------------------------------------------------------------------------- */

export async function getAccountState(): Promise<AccountState> {
  const stored = await readSettings()
  const account = stored.account ?? null
  return {
    configured: account !== null,
    connected: session !== null && session.client.usable,
    account: account
      ? {
          host: account.host,
          port: account.port,
          secure: account.secure,
          user: account.user,
          smtp: account.smtp,
          auth: account.auth ?? 'password',
          oauth: account.oauth
        }
      : null,
    passwordStored: Boolean(account?.secret || account?.refreshToken)
  }
}

/** Credenciales descifradas para el motor de envío. */
/** Credenciales para el motor de envío (contraseña o access token OAuth). */
export async function getCredentials(): Promise<
  { account: AccountConfig; password: string | null; accessToken: string | null } | null
> {
  const stored = await readSettings()
  if (!stored.account) return null

  const account: AccountConfig = {
    host: stored.account.host,
    port: stored.account.port,
    secure: stored.account.secure,
    user: stored.account.user,
    smtp: stored.account.smtp,
    auth: stored.account.auth ?? 'password',
    oauth: stored.account.oauth
  }

  const auth = await authFor(stored.account)
  return {
    account,
    password: 'password' in auth ? auth.password : null,
    accessToken: 'accessToken' in auth ? auth.accessToken : null
  }
}

export async function connectAccount(
  config: AccountConfig,
  password: string
): Promise<ImapResult<AccountState>> {
  try {
    await serial(() =>
      openSession(
        { host: config.host, port: config.port, secure: config.secure, user: config.user },
        { password }
      )
    )
    return { ok: true, data: await getAccountState() }
  } catch (error) {
    return { ok: false, code: classify(error), detail: describe(error) }
  }
}

/**
 * OAuth2: corre el flujo en el navegador, valida el token contra IMAP y guarda
 * el refresh token cifrado. El `user` es el correo de la cuenta.
 */
export async function connectAccountOAuth(config: AccountConfig): Promise<ImapResult<AccountState>> {
  if (!config.oauth) return { ok: false, code: 'unknown', detail: 'Falta la configuración OAuth' }

  try {
    const tokens = await authorize(config.oauth)
    const user = config.user.trim() !== '' ? config.user.trim() : (tokens.email ?? '')
    if (user === '') {
      return { ok: false, code: 'unknown', detail: 'El proveedor no devolvió el correo de la cuenta' }
    }

    await serial(() =>
      openSession(
        { host: config.host, port: config.port, secure: config.secure, user },
        { accessToken: tokens.accessToken }
      )
    )

    // El refresh token es lo único que permite reconectar sin volver al navegador.
    const encrypted = tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : null
    await writeSettings({
      account: {
        host: config.host,
        port: config.port,
        secure: config.secure,
        user,
        smtp: config.smtp,
        auth: 'oauth2',
        oauth: config.oauth,
        ...(encrypted ? { refreshToken: encrypted } : {})
      }
    })

    return { ok: true, data: await getAccountState() }
  } catch (error) {
    return { ok: false, code: classify(error), detail: describe(error) }
  }
}

export async function disconnectAccount(): Promise<void> {
  await serial(closeSession)
}
