import { trackNewMail } from './notificationCursor'
import { isDraftMailbox, isSpamMailbox } from '@shared/mailboxes'
import { createHash } from 'node:crypto'
import { ImapFlow, type MessageStructureObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import type {
  Draft,
  DraftServerRef,
  AccountConfig,
  AccountState,
  AccountActivity,
  AccountSummary,
  CachedResult,
  Envelope,
  EnvelopeListOptions,
  EnvelopeListResult,
  EnvelopeAddress,
  ImapAccountConfig,
  ImapErrorCode,
  ImapResult,
  MailboxInfo,
  MessageAttachment,
  MessageDetail,
  SearchHit,
  SyncMeta,
  SyncProgress
} from '@shared/ipc'
import {
  clearMailbox,
  clearAccountCache,
  deleteAccountCache,
  cachedUids,
  countMessages,
  countBodies,
  countUnread,
  adjustMailboxUnseen,
  deleteMessageRow,
  getMailboxMeta,
  getMeta,
  messagesByUids,
  missingEnvelopeMetadata,
  missingBodyUids,
  openAccountCache,
  readBody,
  readEnvelope,
  readEnvelopes,
  relatedMessageUids,
  readMailboxes,
  replaceMailboxes,
  pruneExcept,
  readDraft as readLocalDraft,
  enqueueOutbox,
  saveDraft as storeDraft,
  saveBody,
  saveMailboxSync,
  searchMessages,
  setFlagged as cacheFlagged,
  setMeta,
  setUnread as cacheUnread,
  cacheAccountId,
  upsertEnvelopes,
} from './db'
import { authorize, getAccessToken } from './oauth'
import { applyRulesToNew } from './rules'
import { decryptSecret, encryptSecret, readSettings, readActiveAccount, readAccounts, removeAccount, revealOAuthSecret, sealOAuthSecret, saveAccount, setActiveAccount, updateAccount, writeSettings, type StoredAccount } from './settings'

/**
 * Topes de memoria/red. Un cliente de correo procesa contenido de terceros:
 * estos límites evitan que un mensaje o adjunto grande tumbe el proceso antes
 * de poder mostrar un error. Los cuerpos que se guardan para lectura offline
 * omiten los mensajes enormes.
 */
const MAX_MESSAGE_BYTES = 50 * 1024 * 1024
const MAX_BODY_BYTES = 30 * 1024 * 1024
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_ENVELOPE_LIMIT = 1000
const MAX_OFFLINE_MESSAGE_BYTES = 30 * 1024 * 1024

interface Session {
  client: ImapFlow
  config: ImapAccountConfig
  /** Cuenta dueña de la conexión; nunca se reutiliza para otra. */
  accountId: string
}

let session: Session | null = null
let newMailListener: ((account: StoredAccount, path: string, messages: Envelope[]) => void) | null = null
export function setNewMailListener(listener: NonNullable<typeof newMailListener>): void {
  newMailListener = listener
}

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
  // `tls` y `auth` no son falta de conexión: son fallos de configuración o
  // credenciales y deben mostrarse como tales, no reintentarse como offline.
  return code === 'dns' || code === 'refused' || code === 'timeout' || code === 'network'
}

type ImapAuth = { password: string } | { accessToken: string }

function createClient(config: ImapAccountConfig, auth: ImapAuth): ImapFlow {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // XOAUTH2 cuando la cuenta es OAuth2; si no, SASL PLAIN con la contraseña.
    auth: 'accessToken' in auth ? { user: config.user, accessToken: auth.accessToken } : { user: config.user, pass: auth.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
    tls: { rejectUnauthorized: true }
  })

  // Sin listener, un error de socket tira abajo el proceso principal.
  client.on('error', () => undefined)
  client.on('close', () => {
    if (session?.client === client) session = null
  })

  return client
}

async function openSession(config: ImapAccountConfig, auth: ImapAuth, accountId: string): Promise<void> {
  await closeSession()
  const client = createClient(config, auth)
  await client.connect()
  session = { client, config, accountId }
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
    if (!account.refreshToken) throw new Error('La cuenta OAuth no tiene refresh token')
    const oauth = await revealOAuthSecret(account)
    if (!oauth) throw new Error('La cuenta OAuth no tiene configuración')
    const refreshToken = await decryptSecret(account.refreshToken)
    if (!refreshToken) throw new Error('No se pudo descifrar el refresh token')

    const token = await getAccessToken(oauth, refreshToken)
    if (token.refreshToken) {
      // Microsoft rota el refresh token: se persiste el nuevo.
      const encrypted = await encryptSecret(token.refreshToken)
      if (encrypted) await updateAccount(account.id, { refreshToken: encrypted })
    }
    return { accessToken: token.accessToken }
  }

  const password = account.secret ? await decryptSecret(account.secret) : null
  if (!password) throw new Error('Stored password unavailable')
  return { password }
}

/** Conecta con la cuenta activa si hace falta. Lanza si no hay credenciales usables. */
async function ensureClient(): Promise<ImapFlow> {
  if (session?.client.usable && session.accountId === cacheAccountId()) return session.client
  // Una sesión de otra cuenta no se reutiliza jamás: se cierra antes de abrir
  // la de la cuenta que la caché tiene abierta.
  if (session) await closeSession()

  const stored = await readActiveAccount()
  if (!stored) throw new Error('No account configured')

  const auth = await authFor(stored)

  await openSession(
    {
      host: stored.host,
      port: stored.port,
      secure: stored.secure,
      user: stored.user
    },
    auth,
    stored.id
  )

  if (!session) throw new Error('Connection failed')
  return session.client
}

/* ---------------------------------------------------------------------------
   Cuentas
   ------------------------------------------------------------------------- */

/** Conserva ids existentes; las cuentas nuevas tienen una caché propia por identidad. */
export async function accountIdFor(host: string, port: number, user: string): Promise<string> {
  const { accounts } = await readAccounts()
  const existing = accounts.find(
    (item) => item.user === user && item.host === host && (item.port ?? 993) === port
  )
  if (existing) return existing.id
  return `acc-${createHash('sha256').update(JSON.stringify([host, port, user])).digest('hex')}`
}

/**
 * Guarda la cuenta y la deja activa: cierra la sesión anterior y reapunta la
 * caché a la cuenta nueva, así no se mezclan carpetas de dos cuentas.
 */
export async function activateAccount(account: StoredAccount): Promise<void> {
  syncGeneration += 1
  pendingFullSync.clear()
  pendingSyncs.clear()
  publishProgress(null)
  const sealed = await sealOAuthSecret(account)
  // Guardar, activar, cerrar la sesión y reapuntar la caché forman una sola
  // unidad serial: la UI nunca ve una cuenta activa con la caché de otra.
  await serial(async () => {
    await saveAccount(sealed)
    if (!(await setActiveAccount(sealed.id))) throw new Error('No se pudo activar la cuenta')
    await closeSession()
    openAccountCache(account.id)
    notify('*')
  })
}

function classify(error: unknown): ImapErrorCode {
  const value = error as { code?: string; message?: string; authenticationFailed?: boolean; cause?: { code?: string; message?: string } } | null
  const code = (value?.code ?? value?.cause?.code ?? '').toUpperCase()
  const message = [value?.message, value?.cause?.message].filter(Boolean).join(' ').toLowerCase()

  if (value?.authenticationFailed) return 'auth'
  if (code.includes('AUTH') || message.includes('authentication') || message.includes('invalid credentials')) return 'auth'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns'
  if (code === 'ECONNREFUSED') return 'refused'
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ESOCKETTIMEDOUT' || code === 'ECONNABORTED' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout'
  if (code.includes('CERT') || code.includes('TLS') || message.includes('certificate')) return 'tls'
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EHOSTDOWN', 'UND_ERR_SOCKET'].includes(code) || (code.startsWith('E') && code.includes('NETWORK')) || (!code && message === 'fetch failed')) return 'network'
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

/** La tarea pertenece a una cuenta que dejó de ser la activa. */
function accountChangedError(): Error {
  const error = new Error('La cuenta activa cambió') as Error & { code?: string }
  error.code = 'ACCOUNT_CHANGED'
  return error
}

/**
 * Acumula un stream con un tope. Al superarlo se corta la descarga en vez de
 * esperar a tener cientos de MB en memoria para recién validar el tamaño.
 */
async function readLimited(stream: AsyncIterable<Uint8Array>, maxBytes: number, message: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error(message)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
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

function hasAttachments(part: MessageStructureObject | undefined): boolean {
  if (!part) return false
  return part.disposition?.toLowerCase() === 'attachment' || Boolean(part.dispositionParameters?.filename || part.parameters?.name) || (part.childNodes?.some(hasAttachments) ?? false)
}

async function fetchRange(client: ImapFlow, range: string, byUid: boolean): Promise<Envelope[]> {
  const envelopes: Envelope[] = []
  const options = byUid ? { uid: true } : undefined

  for await (const message of client.fetch(
    range,
    { envelope: true, bodyStructure: true, headers: ['Importance', 'Priority', 'X-Priority', 'X-MSMail-Priority', 'Message-ID', 'In-Reply-To', 'References'], flags: true, uid: true, size: true, internalDate: true },
    options
  )) {
    const parsedHeaders = message.headers ? await simpleParser(message.headers) : null
    const priority = parsedHeaders?.headers.get('priority')
    envelopes.push({
      priority: priority === 'high' || priority === 'low' ? priority : 'normal',
      uid: message.uid,
      hasAttachments: hasAttachments(message.bodyStructure),
      messageId: message.envelope?.messageId ?? parsedHeaders?.messageId,
      inReplyTo: message.envelope?.inReplyTo ?? parsedHeaders?.inReplyTo,
      references: typeof parsedHeaders?.references === 'string' ? [parsedHeaders.references] : parsedHeaders?.references ?? [],
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

  replaceMailboxes(result)
  setMeta('lastSync', String(Date.now()))
  offline = false
  return result
}

async function syncMessages(path: string, limit: number): Promise<void> {
  const client = await ensureClient()
  const account = await readActiveAccount()

  // STATUS fresco: si el buzón ya estaba seleccionado, `client.mailbox` puede
  // tener EXISTS/UIDNEXT viejos y el sync se quedaría dormido.
  let statusFresh = false
  let exists: number | null = null
  let unseen: number | null = null
  let uidNext: number | null = null
  let uidValidity: number | null = null
  try {
    const status = await client.status(path, { messages: true, unseen: true, uidNext: true, uidValidity: true })
    if (status) {
      statusFresh = status.messages !== undefined && status.uidNext != null && status.uidValidity != null
      exists = status.messages ?? null
      unseen = status.unseen ?? null
      uidNext = status.uidNext != null ? Number(status.uidNext) : null
      uidValidity = status.uidValidity != null ? Number(status.uidValidity) : null
    }
  } catch {
    // El fallback se lee después del lock, cuando está seleccionada esta carpeta.
  }

  const lock = await client.getMailboxLock(path)

  // Mensajes que aparecen por primera vez: sobre esos se evalúan las reglas.
  // El relleno histórico de la sync completa no cuenta (no son "nuevos").
  const nuevos: number[] = []
  const cached = getMailboxMeta(path)
  let fetchedFromUid: number | null = null
  let fullSync = false

  try {
    const box = client.mailbox || null
    exists ??= box ? box.exists : null
    uidNext ??= box?.uidNext != null ? Number(box.uidNext) : null
    uidValidity ??= box?.uidValidity != null ? Number(box.uidValidity) : null
    if (exists === null || uidNext === null || uidValidity === null) throw new Error('No se pudo verificar el estado de la carpeta; se conservó la caché')
    if (!Number.isSafeInteger(exists) || exists < 0 || !Number.isSafeInteger(uidNext) || uidNext < 1 || !Number.isSafeInteger(uidValidity) || uidValidity < 1) throw new Error('El servidor devolvió un estado de carpeta inválido; se conservó la caché')
    if (!statusFresh && cached?.uidValidity === uidValidity && cached.uidNext !== null) uidNext = Math.max(uidNext, cached.uidNext)
    // Menos mensajes puede significar borrados normales, no una caché inválida.
    const reset = statusFresh && cached?.uidNext != null && uidNext < cached.uidNext
    fullSync = cached?.uidValidity == null || cached.uidValidity !== uidValidity || reset

    if (fullSync) {
      clearMailbox(path)
      const start = Math.max(1, exists - limit + 1)
      const envelopes = await fetchRange(client, `${start}:*`, false)
      // El relleno histórico no es "correo nuevo": no se evalúan reglas sobre
      // él para que una regla no archive/elimine en masa correo antiguo.
      upsertEnvelopes(path, envelopes)
      if (exists <= limit) pruneExcept(path, envelopes.map((envelope) => envelope.uid))
    } else {
      const fromUid = cached?.uidNext ?? 1
      if (uidNext != null && uidNext > fromUid) {
        fetchedFromUid = fromUid
        nuevos.push(...upsertEnvelopes(path, await fetchRange(client, `${fromUid}:*`, true)))
      }
    }

    if (!fullSync && countMessages(path) > exists) {
      const cached = cachedUids(path)
      // En buzones pequeños una sola búsqueda es lo más barato. En uno grande,
      // se pregunta por tandas de UIDs cacheados: la respuesta queda acotada y
      // no se materializa la lista completa del servidor en memoria.
      if (cached.length <= 2000) {
        const uids = await client.search({ all: true }, { uid: true })
        if (!uids) throw new Error('No se pudo comprobar qué mensajes siguen en la carpeta')
        pruneExcept(path, uids)
      } else {
        const existing = new Set<number>()
        for (let offset = 0; offset < cached.length; offset += 1000) {
          const batch = cached.slice(offset, offset + 1000)
          const batchSet = new Set(batch)
          const found = await client.search({ uid: batch.join(',') }, { uid: true })
          if (!found) throw new Error('No se pudo comprobar qué mensajes siguen en la carpeta')
          for (const uid of found) if (batchSet.has(uid)) existing.add(uid)
        }
        pruneExcept(path, [...existing])
      }
    }

    saveMailboxSync(path, {
      uidValidity,
      uidNext,
      messages: exists,
      // Con la carpeta entera cacheada se cuenta local; si no, manda el STATUS
      // del servidor (la ventana cacheada no representa al total).
      unseen: unseen ?? (exists <= limit ? countUnread(path) : (cached?.unseen ?? countUnread(path)))
    })
    setMeta('lastSync', String(Date.now()))
    offline = false

    // Si el servidor tiene más de lo cacheado, se sigue bajando en segundo plano.
    void ensureFullSync(path)

    // Refresca flags y cabeceras del tramo visible. Si la sincronización
    // incremental ya bajó desde `fetchedFromUid`, solo falta el hueco anterior
    // y no se vuelve a pedir la misma ventana.
    if (exists > 0) {
      const recentStart = Math.max(1, exists - limit + 1)
      if (fullSync) {
        // La descarga inicial ya cubrió recentStart:*.
      } else if (fetchedFromUid !== null) {
        if (recentStart < fetchedFromUid) {
          // Hueco anterior al tramo nuevo: solo refresca flags, no es correo nuevo.
          upsertEnvelopes(path, await fetchRange(client, `${recentStart}:${fetchedFromUid - 1}`, false))
        }
      } else {
        upsertEnvelopes(path, await fetchRange(client, `${recentStart}:*`, false))
      }
    }

    // Reconciliación: si el servidor cuenta más mensajes de los que tenemos, el
    // UIDNEXT pudo quedar desfasado (entrega a mitad de camino). Se re-lee el
    // tramo final por secuencia, que es idempotente.
    if (countMessages(path) < exists) {
      const start = Math.max(1, exists - limit + 1)
      const envelopes = await fetchRange(client, `${start}:*`, false)
      if (fullSync) upsertEnvelopes(path, envelopes)
      else nuevos.push(...upsertEnvelopes(path, envelopes))
      // Si el tramo cubre todo el buzón, también se poda lo que ya no existe.
      if (exists <= limit) pruneExcept(path, envelopes.map((envelope) => envelope.uid))
      saveMailboxSync(path, {
        uidValidity,
        uidNext,
        messages: exists,
        unseen: unseen ?? (exists <= limit ? countUnread(path) : (cached?.unseen ?? countUnread(path)))
      })
    }
  } finally {
    lock.release()
  }

  // Avisos y reglas no necesitan el lock del buzón: el servidor ya no se toca.
  if (account && uidValidity !== null && uidNext !== null && /^inbox$/i.test(path)) {
    const messages = [...new Set(nuevos)]
      .map(uid => readEnvelope(path, uid))
      .filter((message): message is Envelope => message !== null)
    const baseline = cached?.uidValidity != null && cached.uidNext != null
      ? { uidValidity: cached.uidValidity, uidNext: cached.uidNext } : undefined
    const fresh = await trackNewMail(account.id, { uidValidity, uidNext }, messages, baseline, fullSync)
    if (fresh.length) newMailListener?.(account, path, fresh)
  }

  // Las reglas actúan sobre lo que acaba de llegar. Las acciones se encolan
  // y el listener las aplica en el servidor.
  if (nuevos.length > 0 && !readMailboxes().some(box => box.path === path && isDraftMailbox(box))) {
    const matched = applyRulesToNew(path, nuevos)
    if (matched > 0) rulesListener?.()
  }
}

/* ---------------------------------------------------------------------------
   Sincronización completa en segundo plano
   ------------------------------------------------------------------------- */

let progress: SyncProgress | null = null
let fullSyncRunning = false
let syncGeneration = 0
const pendingFullSync = new Set<string>()
let progressListener: ((progress: SyncProgress | null) => void) | null = null
let rulesListener: (() => void) | null = null

/** Avisa que una regla encoló algo: el dueño del proceso drena la cola. */
export function setRulesListener(listener: () => void): void {
  rulesListener = listener
}

export function setSyncProgressListener(listener: (progress: SyncProgress | null) => void): void {
  progressListener = listener
}

export function getSyncProgress(): SyncProgress | null {
  return progress
}

function publishProgress(next: SyncProgress | null): void {
  progress = next
  progressListener?.(next)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Una sola sincronización pendiente por cuenta y carpeta: varias navegaciones
// seguidas no deben encolar el mismo trabajo una y otra vez.
const pendingSyncs = new Set<string>()

function scheduleSync(path: string, limit: number, broadcast = false): void {
  const key = `${cacheAccountId()}:${path}`
  if (pendingSyncs.has(key)) return
  pendingSyncs.add(key)
  void serial(() => syncMessages(path, limit))
    .then(() => {
      notify(path)
      if (broadcast) notify('*')
    })
    .catch((error: unknown) => {
      offline = isOfflineError(classify(error))
      notify(path)
    })
    .finally(() => pendingSyncs.delete(key))
}

/** Descarga los UID existentes por tandas; los huecos no detienen la sincronización. */
async function fullSyncMailbox(path: string, chunk: number): Promise<void> {
  fullSyncRunning = true
  const generation = syncGeneration
  try {
    const uids = await serial(async () => {
      if (generation !== syncGeneration) return []
      const client = await ensureClient()
      const lock = await client.getMailboxLock(path)
      try {
        const found = await client.search({ all: true }, { uid: true })
        if (!found) throw new Error('No se pudo listar el buzón para sincronizar')
        return found.sort((a, b) => a - b)
      } finally {
        lock.release()
      }
    })

    const pendingMetadata = new Set(missingEnvelopeMetadata(path))
    for (let end = uids.length; end > 0; end -= chunk) {
      if (generation !== syncGeneration) return
      const batch = uids.slice(Math.max(0, end - chunk), end)
      const fetched = await serial(async () => {
        if (generation !== syncGeneration) return false
        const cached = new Set(messagesByUids(path, batch).map((message) => message.uid))
        const missing = batch.filter((uid) => !cached.has(uid) || pendingMetadata.has(uid))
        if (missing.length === 0) return false
        const client = await ensureClient()
        const lock = await client.getMailboxLock(path)
        try {
          const envelopes = await fetchRange(client, missing.join(','), true)
          if (generation === syncGeneration) upsertEnvelopes(path, envelopes)
          return generation === syncGeneration
        } finally {
          lock.release()
        }
      })
      if (generation !== syncGeneration) return
      if (fetched) {
        publishProgress({ mailbox: path, cached: countMessages(path), total: uids.length, running: true, phase: 'headers' })
        notify(path)
        await sleep(120)
      }
    }
    if (generation !== syncGeneration) return
    if ((await readSettings()).offlineDownload !== true) return
    const missingBodies = new Set(missingBodyUids(path))
    const bodyUids = uids.filter(uid => missingBodies.has(uid))
    let available = countBodies(path)
    publishProgress({ mailbox: path, cached: available, total: uids.length, running: true, phase: 'bodies' })
    for (let index = bodyUids.length - 1; index >= 0; index--) {
      if (generation !== syncGeneration) return
      const uid = bodyUids[index]!
      const downloaded = await serial(async () => {
        const envelope = readEnvelope(path, uid)
        if (generation !== syncGeneration || !envelope || readBody(path, uid).fetched) return false
        if (envelope.size > MAX_OFFLINE_MESSAGE_BYTES) return false
        if ((await readSettings()).offlineDownload !== true || generation !== syncGeneration) return false
        await cacheMessageBody(path, uid)
        return generation === syncGeneration
      })
      if (generation !== syncGeneration) return
      if (!downloaded && (await readSettings()).offlineDownload !== true) break
      if (downloaded) available++
      if (index % chunk === 0) available = countBodies(path)
      if (downloaded || index % chunk === 0) {
        publishProgress({ mailbox: path, cached: available, total: uids.length, running: true, phase: 'bodies' })
        notify(path)
      }
      if (downloaded) await sleep(20)
    }
  } catch (error) {
    if (generation === syncGeneration && isOfflineError(classify(error))) offline = true
    console.error('[imap] background sync failed:', describe(error))
  } finally {
    fullSyncRunning = false
    if (generation === syncGeneration) {
      publishProgress(null)
      notify(path)
    }
    while (!fullSyncRunning && pendingFullSync.size > 0) {
      const next = pendingFullSync.values().next().value!
      pendingFullSync.delete(next)
      void ensureFullSync(next)
    }
  }
}

export function resumeOfflineDownload(): void {
  const mailbox = session?.client.mailbox
  if (mailbox && session?.client?.usable) void ensureFullSync(mailbox.path)
}

/** Arranca (si hace falta) la descarga completa del buzón en segundo plano. */
async function ensureFullSync(path: string): Promise<void> {
  if (fullSyncRunning) {
    pendingFullSync.add(path)
    return
  }
  const meta = getMailboxMeta(path)
  if (!meta) return
  const headersComplete = meta.messages <= countMessages(path) && missingEnvelopeMetadata(path).length === 0
  // Sin descarga offline, los cuerpos faltantes son lo normal: no se relanza
  // un SEARCH ALL del buzón en cada sincronización.
  const bodiesPending = (await readSettings()).offlineDownload === true && countBodies(path) < countMessages(path)
  if (headersComplete && !bodiesPending) return
  void fullSyncMailbox(path, 100)
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
      .catch((error: unknown) => {
        // Un certificado o una contraseña inválidos no significan "sin conexión".
        offline = isOfflineError(classify(error))
        // Sin este aviso la UI no se entera de que pasó a modo offline.
        notify('*')
      })
  }

  return { ok: true, data: cached, meta: syncMeta() }
}

export async function listEnvelopes(
  path: string,
  limit: number,
  sync = true,
  options: EnvelopeListOptions = {}
): Promise<EnvelopeListResult> {
  limit = Math.min(Math.max(1, Math.trunc(limit)), MAX_ENVELOPE_LIMIT)
  const result = (): EnvelopeListResult => ({ ok: true, data: readEnvelopes(path, limit, options), meta: syncMeta(), counts: { total: countMessages(path), unread: countUnread(path), availableOffline: countBodies(path) } })
  const cached = result()

  if (!sync) return cached

  if (countMessages(path) === 0) {
    try {
      await serial(() => syncMessages(path, limit))
      return result()
    } catch (error) {
      const code = classify(error)
      if (!isOfflineError(code)) return { ok: false, code, detail: describe(error) }
      offline = true
      return { ok: true, data: [], meta: syncMeta() }
    }
  }

  scheduleSync(path, limit)

  return cached
}

/** Guarda únicamente los cuerpos de lectura; los binarios siguen bajo demanda. */
async function cacheMessageBody(path: string, uid: number): Promise<void> {
  const generation = syncGeneration
  const envelope = readEnvelope(path, uid)
  // Los mensajes enormes no se guardan para offline: se abren bajo demanda.
  if (!envelope || envelope.size > MAX_OFFLINE_MESSAGE_BYTES) return
  const client = await ensureClient()
  const lock = await client.getMailboxLock(path)
  try {
    const validity = getMailboxMeta(path)?.uidValidity
    if (validity == null || !client.mailbox || String(client.mailbox.uidValidity) !== String(validity)) throw new Error('La identidad de la carpeta cambió; no se guardó el cuerpo')
    const message = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true })
    if (!message || message.uid !== uid || !message.bodyStructure) throw new Error('No se encontró la estructura del mensaje')
    const parts: { part: string; type: string }[] = []
    const attachments: { name: string; size: number; type: string; part?: string }[] = []
    const collect = (node: MessageStructureObject): void => {
      const filename = node.dispositionParameters?.filename ?? node.parameters?.name
      const attached = node.disposition?.toLowerCase() === 'attachment' || Boolean(filename) || node.type.toLowerCase() === 'message/rfc822'
      if (!attached && node.childNodes?.length) { node.childNodes.forEach(collect); return }
      if (!attached && ['text/plain', 'text/html'].includes(node.type.toLowerCase())) {
        parts.push({ part: node.part || '1', type: node.type.toLowerCase() })
      } else {
        attachments.push({ name: filename || `adjunto-${attachments.length + 1}`, size: node.size ?? 0, type: node.type, part: node.part || undefined })
      }
    }
    collect(message.bodyStructure)
    const text: string[] = [], html: string[] = []
    for (const part of parts) {
      const download = await client.download(String(uid), part.part, { uid: true })
      if (!download.content) throw new Error('El cuerpo del mensaje no está disponible')
      const content = (await readLimited(download.content, MAX_BODY_BYTES, 'El cuerpo del mensaje supera el límite de tamaño')).toString('utf8')
      if (part.type === 'text/html') html.push(content)
      else text.push(content)
    }
    const markup = html.length ? html.join('\n') : null
    const plain = text.length ? text.join('\n') : markup
      ? (await simpleParser(Buffer.from(`Content-Type: text/html; charset=utf-8\r\n\r\n${markup}`))).text ?? '' : ''
    if (generation !== syncGeneration || !readEnvelope(path, uid)) return
    saveBody(path, uid, {
      text: plain, html: markup,
      to: (message.envelope?.to ?? []).flatMap(address => toAddress(address) ?? []),
      cc: (message.envelope?.cc ?? []).flatMap(address => toAddress(address) ?? []), attachments
    })
  } finally { lock.release() }
}

async function fetchMessage(path: string, uid: number): Promise<MessageDetail> {
  const client = await ensureClient()
  const lock = await client.getMailboxLock(path)

  try {
    const cachedEnvelope = readEnvelope(path, uid)
    if (cachedEnvelope && cachedEnvelope.size > MAX_MESSAGE_BYTES) throw new Error('El mensaje supera el límite de 50 MB para abrirlo')
    const download = await client.download(String(uid), undefined, { uid: true })
    if (!download.content) throw new Error('Message body unavailable')

    const raw = await readLimited(download.content, MAX_MESSAGE_BYTES, 'El mensaje supera el límite de 50 MB para abrirlo')

    const parsed = await simpleParser(raw)
    const priority = parsed.headers.get('priority')

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

    const envelope = cachedEnvelope

    return {
      uid,
      priority: priority === 'high' || priority === 'low' ? priority : 'normal',
      messageId: parsed.messageId ?? envelope?.messageId,
      inReplyTo: parsed.inReplyTo ?? envelope?.inReplyTo,
      references: typeof parsed.references === 'string' ? [parsed.references] : parsed.references ?? envelope?.references ?? [],
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

/** Localiza las copias de Enviados que pertenecen al hilo abierto. */
export async function getSentReplies(path: string, uids: number[], cachedOnly = false): Promise<CachedResult<{ mailbox: string; uid: number }[]>> {
  if (typeof path !== 'string' || !Array.isArray(uids) || !uids.every(uid => Number.isSafeInteger(uid) && uid > 0)) {
    return { ok: false, code: 'unknown', detail: 'Identificadores de conversación inválidos' }
  }
  const generation = syncGeneration
  const sent = readMailboxes().find(box => box.specialUse === '\\Sent' || /^sent$/i.test(box.path))?.path
  const ids = [...new Set(uids.flatMap(uid => {
    const message = readEnvelope(path, uid)
    return message ? [message.messageId, message.inReplyTo, ...(message.references ?? [])].filter((id): id is string => Boolean(id)) : []
  }))]
  if (!sent || sent === path || ids.length === 0) return { ok: true, data: [], meta: syncMeta() }
  const locations = (matches: number[]): { mailbox: string; uid: number }[] => matches.map(uid => ({ mailbox: sent, uid }))
  if (cachedOnly) return { ok: true, data: locations(relatedMessageUids(sent, ids)), meta: syncMeta() }
  try {
    const matches = await serial(async () => {
      if (generation !== syncGeneration) throw accountChangedError()
      const client = await ensureClient()
      const lock = await client.getMailboxLock(sent)
      try {
        if (!client.mailbox) throw new Error('No se pudo abrir Enviados')
        const validity = String(client.mailbox.uidValidity)
        const previous = getMeta(`sentRepliesValidity:${sent}`) ?? getMailboxMeta(sent)?.uidValidity?.toString()
        if (previous && previous !== validity) clearMailbox(sent)
        setMeta(`sentRepliesValidity:${sent}`, validity)
        const found = await client.search({ or: ids.flatMap(id => ['Message-ID', 'In-Reply-To', 'References'].map(header => ({ header: { [header]: id } }))) }, { uid: true })
        if (!found) throw new Error('No se pudieron consultar las respuestas enviadas')
        if (found.length > 0) upsertEnvelopes(sent, await fetchRange(client, found.join(','), true))
        const current = new Set(found)
        return relatedMessageUids(sent, ids).filter(uid => current.has(uid))
      } finally {
        lock.release()
      }
    })
    if (generation !== syncGeneration) throw accountChangedError()
    return { ok: true, data: locations(matches), meta: syncMeta() }
  } catch (error) {
    if (generation !== syncGeneration) return { ok: false, code: 'unknown', detail: 'La cuenta activa cambió' }
    const code = classify(error)
    if (isOfflineError(code)) return { ok: true, data: locations(relatedMessageUids(sent, ids)), meta: { ...syncMeta(), offline: true } }
    return { ok: false, code, detail: describe(error) }
  }
}

export async function getMessage(path: string, uid: number, cachedOnly = false): Promise<CachedResult<MessageDetail>> {
  const generation = syncGeneration
  const body = readBody(path, uid)
  const inlineImagesPending = /\bcid:/i.test(body.html ?? '')
  if (body.fetched && (cachedOnly || !inlineImagesPending)) {
    const detail = cachedDetail(path, uid)
    if (detail) return { ok: true, data: detail, meta: { ...syncMeta(), inlineImagesPending } }
  }

  if (cachedOnly) {
    const detail = cachedDetail(path, uid)
    return detail ? { ok: true, data: detail, meta: { ...syncMeta(), partial: true } } : { ok: false, code: 'unknown', detail: 'No se encontró el mensaje en la caché' }
  }

  try {
    const detail = await serial(async () => {
      if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
      const current = readBody(path, uid)
      if (current.fetched && !/\bcid:/i.test(current.html ?? '')) {
        const cached = cachedDetail(path, uid)
        if (cached) return cached
      }
      const fetched = await fetchMessage(path, uid)
      if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
      // El parser completo no conoce la numeración MIME del servidor; se
      // conserva la parte que ya había guardado la sincronización de cuerpo.
      const previous = readBody(path, uid)?.attachments ?? []
      const attachments = fetched.attachments.map((attachment, index) => ({
        ...attachment,
        part: previous[index]?.part
      }))
      saveBody(path, uid, { text: fetched.text, html: fetched.html, to: fetched.to, cc: fetched.cc, attachments })
      notify(path)
      offline = false
      return fetched
    })
    return { ok: true, data: detail, meta: syncMeta() }
  } catch (error) {
    if (generation !== syncGeneration) return { ok: false, code: 'unknown', detail: 'La cuenta activa cambió' }
    const code = classify(error)
    const fallback = cachedDetail(path, uid)
    if (fallback && isOfflineError(code)) {
      offline = true
      return { ok: true, data: fallback, meta: { ...syncMeta(), partial: !body.fetched, inlineImagesPending } }
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
export function searchMail(query: string, limit = 60, offset = 0): SearchHit[] {
  const names = new Map(readMailboxes().map((box) => [box.path, box.name]))

  return searchMessages(query, limit, offset).map((row) => ({
    mailbox: row.mailbox,
    mailboxName: names.get(row.mailbox) ?? row.mailbox,
    uid: row.uid,
    subject: row.subject,
    subjectMatch: row.subjectMatch,
    from: row.fromAddr ? { name: row.fromName, address: row.fromAddr } : null,
    date: new Date(row.date).toISOString(),
    unread: row.unread,
    flagged: row.flagged,
    snippet: row.snippet
  }))
}

/** Actualización manual: espera a la red y devuelve el error al usuario. */
export function syncMailbox(path: string): Promise<ImapResult<boolean>> {
  const generation = syncGeneration
  return serial(async () => {
    try {
      if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
      await syncMailboxes()
      if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
      await syncMessages(path, 50)
      notify('*')
      return { ok: true, data: true }
    } catch (error) {
      return { ok: false, code: classify(error), detail: describe(error) }
    }
  })
}

/** Sincroniza la bandeja de entrada y avisa a la UI. Silencioso ante errores. */
export async function syncInbox(limit = 50): Promise<void> {
  const inbox = readMailboxes().find((box) => box.specialUse === '\\Inbox' || /^inbox$/i.test(box.path))?.path
  if (!inbox) return
  scheduleSync(inbox, limit, true)
}

export function setSeen(path: string, uid: number, seen: boolean, accountId?: string): Promise<ImapResult<boolean>> {
  return serial(async () => {
    if (accountId && accountId !== cacheAccountId()) throw accountChangedError()
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
      notify(path)
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
): Promise<{ name: string; content: Buffer; type: string }> {
  const generation = syncGeneration
  return serial(async () => {
    if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
    const client = await ensureClient()
    const lock = await client.getMailboxLock(path)

    try {
      const cachedEnvelope = readEnvelope(path, uid)
      const cachedAttachment = readBody(path, uid)?.attachments[index]
      // Con la parte MIME cacheada se baja solo el adjunto, no el mensaje entero.
      if (cachedAttachment?.part) {
        if (cachedAttachment.size > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto supera el límite de 25 MB')
        const part = await client.download(String(uid), cachedAttachment.part, { uid: true })
        if (!part.content) throw new Error('El adjunto no tiene contenido')
        const content = await readLimited(part.content, MAX_ATTACHMENT_BYTES, 'El adjunto supera el límite de 25 MB')
        return { type: cachedAttachment.type, name: cachedAttachment.name, content }
      }
      if (cachedEnvelope && cachedEnvelope.size > MAX_MESSAGE_BYTES) throw new Error('El mensaje supera el límite de 50 MB; no se puede extraer el adjunto')
      const download = await client.download(String(uid), undefined, { uid: true })
      if (!download.content) throw new Error('El mensaje no tiene contenido')

      const raw = await readLimited(download.content, MAX_MESSAGE_BYTES, 'El mensaje supera el límite de 50 MB; no se puede extraer el adjunto')

      const parsed = await simpleParser(raw)
      if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
      const attachment = parsed.attachments[index]
      if (!attachment?.content) throw new Error('Adjunto no encontrado')
      const content = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content)
      if (content.length > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto supera el límite de 25 MB')

      return {
        type: attachment.contentType,
        name: attachment.filename ?? `adjunto-${index + 1}`,
        content
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

export function trashPath(): string | null {
  const boxes = readMailboxes()
  return (boxes.find((box) => box.specialUse === '\\Trash') ?? boxes.find((box) =>
    /^(trash|deleted items|deleted messages|papelera|elementos eliminados)$/i.test(box.name) ||
    /(^|\/)(trash|deleted items|papelera)$/i.test(box.path)
  ))?.path ?? null
}

/** Copia el mensaje en Enviados después de un envío correcto (best effort). */
export function appendToSent(raw: Buffer, accountId?: string): Promise<void> {
  return serial(async () => {
    if (accountId && accountId !== cacheAccountId()) throw accountChangedError()
    const client = await ensureClient()
    const sent = readMailboxes().find((box) => box.specialUse === '\\Sent' || /^sent$/i.test(box.path))?.path
    if (!sent) return
    await client.append(sent, raw, ['\\Seen'])
  })
}

/**
 * ¿El mensaje con este `Message-ID` ya está en Enviados? Se consulta antes de
 * reintentar un envío cuyo intento anterior pudo aceptarse sin confirmación.
 */
export function sentContains(messageId: string, accountId?: string): Promise<boolean> {
  if (!/^<[^<>\r\n]+@[^<>\r\n]+>$/.test(messageId)) return Promise.resolve(false)
  return serial(async () => {
    if (accountId && accountId !== cacheAccountId()) throw accountChangedError()
    const client = await ensureClient()
    const sent = readMailboxes().find((box) => box.specialUse === '\\Sent' || /^sent$/i.test(box.path))?.path
    if (!sent) return false
    const lock = await client.getMailboxLock(sent)
    try {
      const uids = await client.search({ header: { 'Message-ID': messageId } }, { uid: true })
      return Array.isArray(uids) && uids.length > 0
    } finally {
      lock.release()
    }
  })
}

export function moveMessage(path: string, uid: number, target: string, uidValidity?: string, accountId?: string): Promise<void> {
  return serial(async () => {
    if (accountId && accountId !== cacheAccountId()) throw accountChangedError()
    const client = await ensureClient()
    const lock = await client.getMailboxLock(path)
    try {
      if (uidValidity !== undefined && (!client.mailbox || String(client.mailbox.uidValidity) !== uidValidity)) throw new Error('La identidad de la carpeta cambió; no se movió el mensaje')
      if (!client.capabilities.has('MOVE') && !client.capabilities.has('UIDPLUS')) throw new Error('El servidor no permite mover solo este mensaje de forma segura')
      if (!await client.messageMove(String(uid), target, { uid: true })) throw new Error('El servidor no confirmó el movimiento')
    } finally {
      lock.release()
    }
    const removed = deleteMessageRow(path, uid)
    if (removed?.unread) adjustMailboxUnseen(path, -1)
    notify(path)
    await syncMailboxes().catch((error: unknown) => console.error('[imap] folder refresh failed:', describe(error)))
    notify('*')
  })
}

export function deleteMessage(
  path: string,
  uid: number,
  permanent = false,
  identity?: { accountId?: string; uidValidity?: string }
): Promise<void> {
  return serial(async () => {
    if (identity?.accountId && identity.accountId !== cacheAccountId()) throw accountChangedError()
    const client = await ensureClient()
    if (!trashPath()) await syncMailboxes()
    const trash = trashPath()
    if (!trash) throw new Error('No se encontró la carpeta Papelera; no se eliminó el mensaje')
    if (path === trash && !permanent) throw new Error('El borrado definitivo requiere confirmación')
    const lock = await client.getMailboxLock(path)
    try {
      // Un UID puede reciclarse si la carpeta se recreó: antes de borrar hay que
      // comprobar que sigue siendo la misma carpeta que cuando se encoló.
      if (identity?.uidValidity && (!client.mailbox || String(client.mailbox.uidValidity) !== identity.uidValidity)) {
        throw new Error('La identidad de la carpeta cambió; no se eliminó el mensaje')
      }
      if (!client.capabilities.has('UIDPLUS') && (path === trash || !client.capabilities.has('MOVE'))) {
        throw new Error('El servidor no permite eliminar solo este mensaje de forma segura')
      }
      const result = path === trash
        ? await client.messageDelete(String(uid), { uid: true })
        : await client.messageMove(String(uid), trash, { uid: true })
      if (!result) throw new Error('El servidor no confirmó la eliminación')
    } finally {
      lock.release()
    }
    const removed = deleteMessageRow(path, uid)
    if (removed?.unread) adjustMailboxUnseen(path, -1)
    notify(path)
    await syncMailboxes().catch((error: unknown) => console.error('[imap] folder refresh failed:', describe(error)))
    notify('*')
  })
}

export function mailboxDeletionSnapshot(path: string): Promise<{ uids: number[]; uidValidity: string }> {
  const generation = syncGeneration
  return serial(async () => {
    if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
    const client = await ensureClient()
    const lock = await client.getMailboxLock(path)
    try {
      const uids = await client.search({ all: true }, { uid: true })
      if (!uids || !client.mailbox || !client.mailbox.uidValidity || generation !== syncGeneration) throw new Error('No se pudo obtener una lista segura de mensajes')
      return { uids, uidValidity: String(client.mailbox.uidValidity) }
    } finally { lock.release() }
  })
}

export async function deleteMessageBatch(path: string, uids: number[], permanent: boolean, uidValidity: string, onProgress?: (completed: number) => void, accountId?: string): Promise<void> {
  const generation = syncGeneration
  for (let offset = 0; offset < uids.length; offset += 100) {
    await serial(async () => {
      if (generation !== syncGeneration || (accountId && accountId !== cacheAccountId())) throw accountChangedError()
      const client = await ensureClient()
      const trash = trashPath()
      const box = readMailboxes().find(item => item.path === path)
      if (permanent ? path !== trash && (!box || !isSpamMailbox(box)) : !trash || path === trash) throw new Error('Destino de borrado inválido')
      const lock = await client.getMailboxLock(path)
      try {
        if (generation !== syncGeneration || !client.mailbox || String(client.mailbox.uidValidity) !== uidValidity) throw new Error('La identidad de la carpeta cambió; no se eliminaron mensajes')
        if (!client.capabilities.has('UIDPLUS') && (permanent || !client.capabilities.has('MOVE'))) throw new Error('El servidor no permite eliminar solo estos mensajes de forma segura')
        const batch = uids.slice(offset, offset + 100)
        const range = batch.join(',')
        const result = permanent ? await client.messageDelete(range, { uid: true }) : await client.messageMove(range, trash!, { uid: true })
        if (!result) throw new Error('El servidor no confirmó la eliminación')
        for (const uid of batch) {
          const removed = deleteMessageRow(path, uid)
          if (removed?.unread) adjustMailboxUnseen(path, -1)
        }
        onProgress?.(offset + batch.length)
        notify(path)
      } finally { lock.release() }
    })
  }
  // El refresco de carpetas se hace una sola vez y con el lock ya liberado.
  await syncMailboxes().catch((error: unknown) => console.error('[imap] folder refresh failed:', describe(error)))
  notify('*')
}

/* ---------------------------------------------------------------------------
   Cuenta
   ------------------------------------------------------------------------- */

export async function getAccountState(): Promise<AccountState> {
  const account = await readActiveAccount()
  return {
    configured: account !== null,
    connected: session !== null && session.client.usable,
    account: account
      ? {
          host: account.host,
          port: account.port,
          secure: account.secure,
          user: account.user,
          label: account.label,
          smtp: account.smtp,
          auth: account.auth ?? 'password',
          // El secreto de cliente no sale del proceso principal; el diálogo lo
          // conserva en el guardado de la cuenta si el usuario no lo reescribe.
          oauth: account.oauth ? { ...account.oauth, clientSecret: '' } : undefined
        }
      : null,
    passwordStored: Boolean(account?.secret || account?.refreshToken || account?.oauthSecret)
  }
}

/** Todas las cuentas guardadas, con la activa marcada. */
export async function listAccounts(): Promise<AccountSummary[]> {  const { accounts, active } = await readAccounts()
  return accounts.map((account) => ({
    id: account.id,
    label: account.label || account.user,
    user: account.user,
    host: account.host,
    port: account.port,
    auth: account.auth ?? 'password',
    active: account.id === active
  }))
}

/**
 * Revisa el INBOX de todas las cuentas con una sesión corta y
 * marca cuáles sumaron no leídos desde la revisión anterior. Es lo que permite
 * avisar de correo en las cuentas que no están activas sin abrir la bandeja.
 */
let activityCheck: Promise<AccountActivity[]> | null = null
export function checkAccountsActivity(): Promise<AccountActivity[]> {
  if (!activityCheck) activityCheck = pollAccountsActivity().finally(() => { activityCheck = null })
  return activityCheck
}

async function pollAccountsActivity(): Promise<AccountActivity[]> {
  const { accounts, active } = await readAccounts()

  const activity: AccountActivity[] = []
  for (const account of accounts) {
    const isActive = account.id === active
    let unseen = 0

    if (isActive) {
      // La cuenta activa ya se sincroniza sola: su contador sale de la caché.
      unseen = readMailboxes().find((box) => box.specialUse === '\\Inbox' || /^inbox$/i.test(box.path))?.unseen ?? 0
    } else {
      try {
        const auth = await authFor(account)
        const client = createClient(account, auth)
        await client.connect()
        try {
          const status = await client.status('INBOX', { unseen: true, uidNext: true, uidValidity: true })
          unseen = status !== false ? Number(status.unseen ?? 0) : 0
          if (status && status.uidValidity != null && status.uidNext != null) {
            const cursor = { uidValidity: Number(status.uidValidity), uidNext: Number(status.uidNext) }
            const previous = (await readSettings()).mailNotificationCursors?.[account.id]
            let messages: Envelope[] = []
            if (previous?.uidValidity === cursor.uidValidity && cursor.uidNext > previous.uidNext) {
              const lock = await client.getMailboxLock('INBOX')
              try { messages = await fetchRange(client, `${previous.uidNext}:*`, true) }
              finally { lock.release() }
            }
            const fresh = await trackNewMail(account.id, cursor, messages)
            if (fresh.length) newMailListener?.(account, 'INBOX', fresh)
          }
        } finally {
          await client.logout().catch(() => undefined)
        }
      } catch {
        // Sin red o credenciales vencidas: se conserva el último valor conocido.
        unseen = lastUnseen.get(account.id) ?? 0
      }
    }

    const previous = lastUnseen.get(account.id)
    lastUnseen.set(account.id, unseen)

    activity.push({
      id: account.id,
      label: account.label || account.user,
      host: account.host,
      port: account.port,
      unseen,
      // Avisa solo cuando sube, nunca al bajar ni la primera vez que se ve.
      fresh: previous !== undefined && unseen > previous && !isActive,
      active: isActive
    })
  }

  return activity
}

const lastUnseen = new Map<string, number>()

/**
 * Cambia de cuenta: corta la sesión, reapunta la caché a la cuenta elegida y
 * avisa a la UI para que relea todo. No hay dos conexiones abiertas a la vez.
 */
export async function selectAccount(id: string): Promise<ImapResult<AccountState>> {
  syncGeneration += 1
  pendingFullSync.clear()
  pendingSyncs.clear()
  publishProgress(null)
  const previous = (await readAccounts()).active
  try {
    // Cambiar la cuenta activa, cerrar la sesión y reapuntar la caché son una
    // sola operación serial: ninguna tarea pendiente puede observar una cuenta
    // nueva con la caché anterior (ni al revés).
    const changed = await serial(async () => {
      const ok = await setActiveAccount(id)
      if (!ok) return false
      await closeSession()
      openAccountCache(id)
      notify('*')
      return true
    })
    if (!changed) return { ok: false, code: 'unknown', detail: 'Esa cuenta no existe' }

    return { ok: true, data: await getAccountState() }
  } catch (error) {
    // Si la caché no se pudo abrir, se intenta volver a la cuenta anterior.
    if (previous && previous !== id) {
      await setActiveAccount(previous).catch(() => undefined)
      try { openAccountCache(previous) } catch { /* la siguiente apertura lo reintenta */ }
    }
    return { ok: false, code: classify(error), detail: describe(error) }
  }
}

/** Credenciales para el motor de envío (contraseña o access token OAuth). */
export async function getCredentials(expectedAccountId?: string): Promise<
  { account: AccountConfig; password: string | null; accessToken: string | null } | null
> {
  const stored = await readActiveAccount()
  if (!stored) return null
  if (expectedAccountId && stored.id !== expectedAccountId) throw accountChangedError()

  const account: AccountConfig = {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    user: stored.user,
    smtp: stored.smtp,
    auth: stored.auth ?? 'password',
    oauth: stored.oauth
  }

  const auth = await authFor(stored)
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
    const accountId = await accountIdFor(config.host, config.port, config.user)
    await serial(() =>
      openSession(
        { host: config.host, port: config.port, secure: config.secure, user: config.user },
        { password },
        accountId
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
export async function connectAccountOAuth(config: AccountConfig, onAuthUrl?: (url: string) => void): Promise<ImapResult<AccountState>> {
  if (!config.oauth) return { ok: false, code: 'unknown', detail: 'Falta la configuración OAuth' }

  try {
    const knownUser = config.user.trim()
    const existing = knownUser === ''
      ? undefined
      : (await readAccounts()).accounts.find((item) =>
          item.user === knownUser && item.host === config.host && (item.port ?? 993) === config.port)
    const existingOauth = existing ? await revealOAuthSecret(existing) : null
    const oauth = {
      ...config.oauth,
      // Al editar una cuenta existente el renderer ya no recibe el secreto;
      // si el campo llega vacío se reutiliza el guardado (cifrado o heredado).
      clientSecret: config.oauth.clientSecret || existingOauth?.clientSecret || ''
    }
    const tokens = await authorize(oauth, 300_000, onAuthUrl)
    const user = knownUser !== '' ? knownUser : (tokens.email ?? '')
    if (user === '') {
      return { ok: false, code: 'unknown', detail: 'El proveedor no devolvió el correo de la cuenta' }
    }

    const accountId = await accountIdFor(config.host, config.port, user)
    await serial(() =>
      openSession(
        { host: config.host, port: config.port, secure: config.secure, user },
        { accessToken: tokens.accessToken },
        accountId
      )
    )

    // El refresh token es lo único que permite reconectar sin volver al navegador.
    const encrypted = tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : null
    await activateAccount({
      id: accountId,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user,
      label: config.label,
      smtp: config.smtp,
      auth: 'oauth2',
      oauth,
      ...(encrypted ? { refreshToken: encrypted } : {})
    })

    return { ok: true, data: await getAccountState() }
  } catch (error) {
    return { ok: false, code: classify(error), detail: describe(error) }
  }
}

export async function disconnectAccount(expectedId: string): Promise<void> {
  const { active } = await readAccounts()
  if (!active || active !== expectedId) throw new Error('La cuenta activa cambió')
  syncGeneration += 1
  pendingFullSync.clear()
  publishProgress(null)
  await serial(async () => {
    if ((await readAccounts()).active !== active) throw new Error('La cuenta activa cambió')
    await closeSession()
    try {
      await deleteAccountCache(active)
      const { active: next } = await removeAccount(active)
      openAccountCache(next ?? 'default')
      if (!next) await writeSettings({ onboarded: false })
    } catch (error) {
      openAccountCache((await readAccounts()).active ?? 'default')
      throw error
    }
    notify('*')
  })
}

export function clearCachedMail(accountId: string): Promise<void> {
  return serial(() => clearAccountCache(accountId))
}

export function notifyDraftsChanged(): void { notify('*') }

export function downloadDraft(path: string, uid: number): Promise<{ raw: Buffer; server: DraftServerRef }> {
  const generation = syncGeneration
  return serial(async () => {
    if (!readMailboxes().some(box => box.path === path && isDraftMailbox(box))) throw new Error('La carpeta no es de borradores')
    const client = await ensureClient()
    if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
    const lock = await client.getMailboxLock(path)
    try {
      const result = await client.download(String(uid), undefined, { uid: true })
      if (!result.content || !client.mailbox) throw new Error('No se pudo abrir el borrador')
      const raw = await readLimited(result.content, MAX_MESSAGE_BYTES, 'El borrador supera el límite de 50 MB')
      if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
      return { raw, server: { path, uid, uidValidity: String(client.mailbox.uidValidity) } }
    } finally { lock.release() }
  })
}

async function removeDraftWithClient(client: ImapFlow, reference: DraftServerRef): Promise<void> {
  if (!readMailboxes().some(box => box.path === reference.path && isDraftMailbox(box))) throw new Error('La carpeta no es de borradores')
  const lock = await client.getMailboxLock(reference.path)
  try {
    if (!client.mailbox || String(client.mailbox.uidValidity) !== reference.uidValidity) throw new Error('La identidad de la carpeta de borradores cambió')
    if (!client.capabilities.has('UIDPLUS')) throw new Error('El servidor no permite eliminar solo este borrador de forma segura')
    const exists = await client.fetchOne(String(reference.uid), { uid: true }, { uid: true })
    if (exists && !await client.messageDelete(String(reference.uid), { uid: true })) throw new Error('No se pudo quitar el borrador anterior')
    deleteMessageRow(reference.path, reference.uid)
  } finally { lock.release() }
}

export function removeServerDraft(reference: DraftServerRef, accountId?: string): Promise<void> {
  const generation = syncGeneration
  return serial(async () => {
    if (generation !== syncGeneration || (accountId && accountId !== cacheAccountId())) throw accountChangedError()
    const client = await ensureClient()
    await removeDraftWithClient(client, reference)
    await syncMessages(reference.path, 50)
    notify(reference.path)
  })
}

export function uploadDraft(draft: Draft, raw: Buffer, messageId: string, accountId?: string): Promise<void> {
  const generation = syncGeneration
  return serial(async () => {
    if (generation !== syncGeneration || (accountId && accountId !== cacheAccountId())) throw accountChangedError()
    const client = await ensureClient()
    if (!readMailboxes().some(isDraftMailbox)) await syncMailboxes()
    const folder = readMailboxes().find(box => box.path === draft.server?.path && isDraftMailbox(box)) ?? readMailboxes().find(box => box.specialUse === '\\Drafts') ?? readMailboxes().find(isDraftMailbox)
    if (!folder) throw new Error('No se encontró la carpeta de borradores del servidor')
    if (draft.previousServer) await removeDraftWithClient(client, draft.previousServer)
    let saved: Draft = draft
    if (draft.syncedAt !== draft.updatedAt) {
      const lock = await client.getMailboxLock(folder.path)
      try {
        if (!client.capabilities.has('UIDPLUS') || !client.mailbox) throw new Error('El servidor no permite actualizar borradores de forma segura')
        const found = await client.search({ header: { 'Message-ID': messageId } }, { uid: true })
        let uid = found ? found[0] : undefined
        if (!uid) {
          const result = await client.append(folder.path, raw, ['\\Draft', '\\Seen'])
          uid = result ? result.uid : undefined
        }
        if (!uid) throw new Error('El servidor no confirmó la identidad del borrador guardado')
        if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
        const reference = { path: folder.path, uid, uidValidity: String(client.mailbox.uidValidity) }
        const current = readLocalDraft(draft.id)
        if (!current) {
          enqueueOutbox({ kind: 'draft-delete', payload: { server: reference }, accountId, uidValidity: reference.uidValidity })
          notify(folder.path)
          return
        }
        // Una edición hecha durante APPEND conserva su contenido y queda pendiente de otra revisión.
        saved = { ...current, previousServer: draft.server, server: reference, syncedAt: draft.updatedAt }
        storeDraft(saved)
      } finally { lock.release() }
    }
    if (saved.previousServer && (saved.previousServer.uid !== saved.server?.uid || saved.previousServer.path !== saved.server?.path)) await removeDraftWithClient(client, saved.previousServer)
    if (generation !== syncGeneration) throw new Error('La cuenta activa cambió')
    const current = readLocalDraft(draft.id)
    if (current) storeDraft({ ...current, server: saved.server, syncedAt: draft.updatedAt, previousServer: undefined })
    await syncMessages(folder.path, 50)
    notify(folder.path)
  })
}
