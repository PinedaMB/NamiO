import { Buffer } from 'node:buffer'
import { readdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { app } from 'electron'
import type { CacheUsage, Draft, Envelope, EnvelopeListOptions, MailboxInfo, RecipientSuggestion } from '@shared/ipc'

/**
 * Caché local. Es la fuente de verdad para la UI: la red solo la actualiza.
 * Usa `node:sqlite` (incluido en Node 24, sin módulos nativos que recompilar).
 */

interface MailboxRow {
  path: string
  name: string
  special_use: string | null
  uid_validity: number | null
  uid_next: number | null
  messages: number
  unseen: number
  synced_at: number | null
  highest_modseq?: string | null
}

interface MessageRow {
  priority: Envelope['priority'] | null
  has_attachments: number | null
  message_id: string | null
  in_reply_to: string | null
  references_json: string | null
  mailbox: string
  uid: number
  subject: string
  from_name: string
  from_addr: string
  date: number
  size: number
  unread: number
  flagged: number
  to_json: string | null
  cc_json: string | null
  body_text: string | null
  body_html: string | null
}

export interface MailboxMeta {
  path: string
  uidValidity: number | null
  uidNext: number | null
  messages: number
  unseen: number
  syncedAt: number | null
  highestModseq?: string | null
}

const handles = new Map<string, DatabaseSync>()
const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>()
let savepointSeq = 0
let db: DatabaseSync | null = null

function stmt(database: DatabaseSync, sql: string): StatementSync {
  let cache = statementCache.get(database)
  if (!cache) {
    cache = new Map()
    statementCache.set(database, cache)
  }
  let prepared = cache.get(sql)
  if (!prepared) {
    prepared = database.prepare(sql)
    cache.set(sql, prepared)
  }
  return prepared
}

const COMPRESS_MIN_BYTES = 256
const zstdCompress = (zlib as unknown as { zstdCompressSync?: (buf: Buffer) => Buffer }).zstdCompressSync
const zstdDecompress = (zlib as unknown as { zstdDecompressSync?: (buf: Uint8Array) => Buffer }).zstdDecompressSync

function encodeBody(value: string | null): string | Buffer | null {
  if (value === null) return null
  if (value.length < COMPRESS_MIN_BYTES) return value
  const raw = Buffer.from(value, 'utf8')
  if (typeof zstdCompress === 'function') return zstdCompress(raw)
  return zlib.gzipSync(raw, { level: 6 })
}

function decodeBody(value: string | Uint8Array | null | undefined): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  // Zstandard magic number: 0x28 0xB5 0x2F 0xFD
  if (value.length >= 4 && value[0] === 0x28 && value[1] === 0xb5 && value[2] === 0x2f && value[3] === 0xfd && typeof zstdDecompress === 'function') {
    return zstdDecompress(value).toString('utf8')
  }
  // Gzip magic number: 0x1F 0x8B
  if (value.length >= 2 && value[0] === 0x1f && value[1] === 0x8b) {
    return zlib.gunzipSync(value).toString('utf8')
  }
  return Buffer.from(value).toString('utf8')
}

function inAtomic<T>(database: DatabaseSync, fn: () => T): T {
  const name = `sp_${++savepointSeq}`
  database.exec(`SAVEPOINT ${name}`)
  try {
    const result = fn()
    database.exec(`RELEASE SAVEPOINT ${name}`)
    return result
  } catch (error) {
    database.exec(`ROLLBACK TO SAVEPOINT ${name}`)
    database.exec(`RELEASE SAVEPOINT ${name}`)
    throw error
  }
}
let openedAccountId = ''
let openedCacheFile = ''
export function cacheAccountId(): string { return openedAccountId }

export function initCache(accountId: string = 'default'): void {
  if (db) return
  openAccountCache(accountId)
}

function userDataDir(): string {
  return (globalThis as { __namioUserData?: string }).__namioUserData ?? app.getPath('userData')
}

function openDatabase(accountId: string): DatabaseSync {
  const existing = handles.get(accountId)
  if (existing) return existing

  const file = accountCacheFile(accountId)
  const database = new DatabaseSync(join(userDataDir(), file))
  handles.set(accountId, database)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA synchronous = NORMAL')
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec('PRAGMA temp_store = MEMORY')
  database.exec('PRAGMA cache_size = -16000')
  database.exec('PRAGMA mmap_size = 67108864')
  database.exec(`
    CREATE TABLE IF NOT EXISTS mailboxes (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      special_use TEXT,
      uid_validity INTEGER,
      uid_next INTEGER,
      messages INTEGER NOT NULL DEFAULT 0,
      unseen INTEGER NOT NULL DEFAULT 1,
      synced_at INTEGER,
      highest_modseq TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      mailbox TEXT NOT NULL,
      uid INTEGER NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT '',
      from_addr TEXT NOT NULL DEFAULT '',
      date INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 1,
      flagged INTEGER NOT NULL DEFAULT 0,
      to_json TEXT,
      cc_json TEXT,
      body_text TEXT,
      body_html TEXT,
      PRIMARY KEY (mailbox, uid)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_date ON messages (mailbox, date DESC);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      to_field TEXT NOT NULL DEFAULT '',
      cc TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      mailbox TEXT,
      uid INTEGER,
      payload TEXT,
      account_id TEXT,
      uid_validity TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      last_error TEXT,
      attempted_at INTEGER,
      created_at INTEGER NOT NULL
    );

    -- Reglas locales: la primera que coincide gana, en orden de creación.
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      field TEXT NOT NULL,
      op TEXT NOT NULL,
      value TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      hits INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- Búsqueda de texto completo. remove_diacritics permite encontrar
    -- "valoración" buscando "valoracion"; el índice vive en la caché local.
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
      subject,
      peers,
      body,
      mailbox UNINDEXED,
      uid UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Identidad estable de cada fila del índice: search.rowid toma este id.
    -- El rowid implícito de messages cambia con VACUUM (su PK es compuesta),
    -- así que no sirve como clave del índice.
    CREATE TABLE IF NOT EXISTS search_ids (
      id INTEGER PRIMARY KEY,
      mailbox TEXT NOT NULL,
      uid INTEGER NOT NULL,
      UNIQUE (mailbox, uid)
    );

    CREATE TABLE IF NOT EXISTS message_bodies (
      mailbox TEXT NOT NULL,
      uid INTEGER NOT NULL,
      body_text BLOB,
      body_html BLOB,
      to_json TEXT,
      cc_json TEXT,
      attachments_json TEXT,
      PRIMARY KEY (mailbox, uid)
    );

    CREATE TABLE IF NOT EXISTS message_refs (
      mailbox TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      uid INTEGER NOT NULL,
      PRIMARY KEY (mailbox, ref_id, uid)
    ) WITHOUT ROWID;
  `)

  database.exec('CREATE TABLE IF NOT EXISTS recipient_cache (email TEXT PRIMARY KEY, uses INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)')
  database.exec('CREATE TABLE IF NOT EXISTS picked_attachments (id TEXT PRIMARY KEY, name TEXT NOT NULL, data BLOB NOT NULL)')
  const mailboxColumns = database.prepare('PRAGMA table_info(mailboxes)').all() as unknown as { name: string }[]
  if (!mailboxColumns.some(column => column.name === 'highest_modseq')) database.exec('ALTER TABLE mailboxes ADD COLUMN highest_modseq TEXT')
  const draftColumns = database.prepare('PRAGMA table_info(drafts)').all() as unknown as { name: string }[]
  if (!draftColumns.some(column => column.name === 'metadata_json')) database.exec('ALTER TABLE drafts ADD COLUMN metadata_json TEXT')

  const columns = database.prepare('PRAGMA table_info(messages)').all() as unknown as { name: string }[]
  for (const column of ['message_id', 'in_reply_to', 'has_attachments', 'priority', 'references_json']) {
    if (!columns.some(item => item.name === column)) database.exec(`ALTER TABLE messages ADD COLUMN ${column} ${column === 'has_attachments' ? 'INTEGER' : 'TEXT'}`)
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages (mailbox, message_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages (mailbox, in_reply_to)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (mailbox, date DESC, uid DESC) WHERE unread = 1')
  database.exec("CREATE INDEX IF NOT EXISTS idx_messages_from ON messages (from_addr, from_name, date DESC) WHERE from_addr != ''")
  database.exec('CREATE INDEX IF NOT EXISTS idx_messages_all_date ON messages (date DESC)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_message_refs_uid ON message_refs (mailbox, uid)')

  // Migración aditiva: la tabla ya existe en instalaciones previas.
  try {
    database.exec('ALTER TABLE messages ADD COLUMN attachments_json TEXT')
  } catch {
    // la columna ya estaba
  }

  // Migraciones aditivas: cuerpos separados con compresión y tabla de referencias.
  migrateMessageBodies(database)
  migrateMessageRefs(database)
  // El índice de búsqueda usa identificadores estables.
  migrateSearchIndex(database)

  // La cola guarda a qué cuenta y a qué identidad de carpeta pertenece cada
  // operación. Las filas antiguas se asignan a la cuenta de esta caché; su
  // UIDVALIDITY se resuelve al procesarlas.
  const outboxColumns = database.prepare('PRAGMA table_info(outbox)').all() as unknown as { name: string }[]
  for (const [column, type] of [['account_id', 'TEXT'], ['uid_validity', 'TEXT'], ['attempted_at', 'INTEGER'], ['next_attempt_at', 'INTEGER'], ['failures', 'INTEGER NOT NULL DEFAULT 0']] as const) {
    if (!outboxColumns.some((item) => item.name === column)) database.exec(`ALTER TABLE outbox ADD COLUMN ${column} ${type}`)
  }
  database.prepare('UPDATE outbox SET account_id = ? WHERE account_id IS NULL').run(accountId)
  return database
}

/**
 * Abre la caché de una cuenta. Cada cuenta tiene su propio archivo
 * (`cache-<id>.db`): carpetas, búsqueda, cola y reglas quedan separadas sin
 * cambiar el esquema. La cuenta `default` conserva `cache.db` (compatibilidad).
 */
export function openAccountCache(accountId: string): void {
  const database = openDatabase(accountId)
  db = database
  openedAccountId = accountId
  openedCacheFile = accountCacheFile(accountId)
}

function handle(accountId?: string): DatabaseSync {
  if (accountId !== undefined) return openDatabase(accountId)
  if (!db) throw new Error('La caché no está inicializada')
  return db
}

/** Ejecuta varias escrituras como una sola unidad atómica. */
export function inTransaction<T>(fn: () => T, accountId?: string): T {
  const database = handle(accountId)
  database.exec('BEGIN')
  try {
    const result = fn()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function closeAccountCache(accountId: string): void {
  const target = handles.get(accountId)
  if (target) {
    try { target.exec("INSERT INTO search(search) VALUES('merge', 200)") } catch { /* ignore */ }
    try { target.exec('PRAGMA optimize') } catch { /* ignore */ }
    target.close()
    handles.delete(accountId)
  }
  if (openedAccountId === accountId || db === target) {
    db = null
    openedAccountId = ''
    openedCacheFile = ''
  }
}

export function closeCache(): void {
  for (const database of handles.values()) {
    try { database.exec("INSERT INTO search(search) VALUES('merge', 200)") } catch { /* ignore */ }
    try { database.exec('PRAGMA optimize') } catch { /* ignore */ }
    database.close()
  }
  handles.clear()
  db = null
  openedAccountId = ''
  openedCacheFile = ''
}

/* ------------------------------------------------------------------------- */

export function upsertMailboxes(mailboxes: readonly MailboxInfo[]): void {
  const statement = handle().prepare(`
    INSERT INTO mailboxes (path, name, special_use, messages, unseen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      special_use = excluded.special_use,
      messages = excluded.messages,
      unseen = excluded.unseen
  `)

  for (const box of mailboxes) {
    statement.run(box.path, box.name, box.specialUse, box.messages, box.unseen)
  }
}

/** Reconcilia solo tras recibir un LIST completo; conserva borradores y cola de salida. */
export function replaceMailboxes(mailboxes: readonly MailboxInfo[]): void {
  const database = handle()
  const paths = new Set(mailboxes.map((box) => box.path))
  database.exec('BEGIN')
  try {
    for (const box of readMailboxes()) {
      if (paths.has(box.path)) continue
      database.prepare('DELETE FROM search WHERE rowid IN (SELECT id FROM search_ids WHERE mailbox = ?)').run(box.path)
      database.prepare('DELETE FROM search_ids WHERE mailbox = ?').run(box.path)
      database.prepare('DELETE FROM message_bodies WHERE mailbox = ?').run(box.path)
      database.prepare('DELETE FROM message_refs WHERE mailbox = ?').run(box.path)
      database.prepare('DELETE FROM messages WHERE mailbox = ?').run(box.path)
      database.prepare('DELETE FROM mailboxes WHERE path = ?').run(box.path)
    }
    upsertMailboxes(mailboxes)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function readMailboxes(accountId?: string): MailboxInfo[] {
  const rows = handle(accountId)
    .prepare('SELECT path, name, special_use, messages, unseen FROM mailboxes ORDER BY path')
    .all() as unknown as MailboxRow[]

  return rows.map((row) => ({
    path: row.path,
    name: row.name,
    specialUse: row.special_use,
    messages: row.messages,
    unseen: row.unseen
  }))
}

export function getMailboxMeta(path: string): MailboxMeta | null {
  const row = stmt(handle(), 'SELECT * FROM mailboxes WHERE path = ?')
    .get(path) as unknown as MailboxRow | undefined

  if (!row) return null
  return {
    path: row.path,
    uidValidity: row.uid_validity,
    uidNext: row.uid_next,
    messages: row.messages,
    unseen: row.unseen,
    syncedAt: row.synced_at,
    highestModseq: row.highest_modseq ?? null
  }
}

export function clearMailbox(path: string): void {
  const database = handle()
  database.exec('BEGIN')
  try {
    // El id de `search` es estable: borrar por id evita el escaneo completo del
    // índice por su columna `mailbox` (UNINDEXED).
    database.prepare('DELETE FROM search WHERE rowid IN (SELECT id FROM search_ids WHERE mailbox = ?)').run(path)
    database.prepare('DELETE FROM search_ids WHERE mailbox = ?').run(path)
    database.prepare('DELETE FROM message_bodies WHERE mailbox = ?').run(path)
    database.prepare('DELETE FROM message_refs WHERE mailbox = ?').run(path)
    database.prepare('DELETE FROM messages WHERE mailbox = ?').run(path)
    database
      .prepare('UPDATE mailboxes SET uid_validity = NULL, uid_next = NULL, synced_at = NULL, highest_modseq = NULL WHERE path = ?')
      .run(path)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function saveMailboxSync(
  path: string,
  sync: { uidValidity: number | null; uidNext: number | null; messages: number; unseen: number; highestModseq?: string | null },
  accountId?: string
): void {
  handle(accountId)
    .prepare(
      `INSERT INTO mailboxes (path, name, uid_validity, uid_next, messages, unseen, synced_at, highest_modseq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         uid_validity = excluded.uid_validity,
         uid_next = excluded.uid_next,
         messages = excluded.messages,
         unseen = excluded.unseen,
         synced_at = excluded.synced_at,
         highest_modseq = COALESCE(excluded.highest_modseq, mailboxes.highest_modseq)`
    )
    .run(path, path, sync.uidValidity, sync.uidNext, sync.messages, sync.unseen, Date.now(), sync.highestModseq ?? null)
}

/** Inserta/actualiza sobres y devuelve los UID que **no** estaban en la caché. */
export function upsertEnvelopes(mailbox: string, envelopes: readonly Envelope[], accountId?: string): number[] {
  const database = handle(accountId)

  const previos = new Map<number, { subject: string; fromName: string; fromAddr: string; refs: string | null }>()
  if (envelopes.length > 0) {
    for (let offset = 0; offset < envelopes.length; offset += 500) {
      const batch = envelopes.slice(offset, offset + 500)
      const placeholders = batch.map(() => '?').join(',')
      const rows = database
        .prepare(`SELECT uid, subject, from_name, from_addr, references_json FROM messages WHERE mailbox = ? AND uid IN (${placeholders})`)
        .all(mailbox, ...batch.map((envelope) => envelope.uid)) as unknown as { uid: number; subject: string; from_name: string; from_addr: string; references_json: string | null }[]
      for (const row of rows) previos.set(row.uid, { subject: row.subject, fromName: row.from_name, fromAddr: row.from_addr, refs: row.references_json })
    }
  }

  const statement = stmt(database, `
    INSERT INTO messages (mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged, message_id, in_reply_to, references_json, has_attachments, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mailbox, uid) DO UPDATE SET
      subject = excluded.subject,
      from_name = excluded.from_name,
      from_addr = excluded.from_addr,
      date = excluded.date,
      size = excluded.size,
      unread = excluded.unread,
      flagged = excluded.flagged,
      message_id = excluded.message_id,
      in_reply_to = excluded.in_reply_to,
      references_json = excluded.references_json,
      has_attachments = excluded.has_attachments,
      priority = excluded.priority
  `)
  const clearRefs = stmt(database, 'DELETE FROM message_refs WHERE mailbox = ? AND uid = ?')
  const insertRef = stmt(database, 'INSERT OR IGNORE INTO message_refs (mailbox, ref_id, uid) VALUES (?, ?, ?)')

  database.exec('BEGIN')
  try {
    for (const envelope of envelopes) {
      const fromName = envelope.from?.name ?? ''
      const fromAddr = envelope.from?.address ?? ''
      const refsList = envelope.references ?? []
      const refsJson = JSON.stringify(refsList)
      statement.run(
        mailbox,
        envelope.uid,
        envelope.subject,
        fromName,
        fromAddr,
        new Date(envelope.date).getTime(),
        envelope.size,
        envelope.unread ? 1 : 0,
        envelope.flagged ? 1 : 0,
        envelope.messageId ?? null,
        envelope.inReplyTo ?? null,
        refsJson,
        envelope.hasAttachments === undefined ? null : envelope.hasAttachments ? 1 : 0,
        envelope.priority ?? 'normal'
      )
      const previous = previos.get(envelope.uid)
      if (!previous || previous.refs !== refsJson) {
        if (previous) clearRefs.run(mailbox, envelope.uid)
        for (const refId of refsList) {
          if (refId) insertRef.run(mailbox, refId, envelope.uid)
        }
      }
      // Refrescar flags o fechas no cambia el texto indexado. Reindexar cada
      // sobre obligaba a un DELETE por columnas UNINDEXED (escaneo completo del
      // FTS) en cada sincronización; solo se reindexa si cambió lo que se busca.
      if (!previous || previous.subject !== envelope.subject || previous.fromName !== fromName || previous.fromAddr !== fromAddr) {
        reindexMessage(mailbox, envelope.uid)
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return envelopes.map((envelope) => envelope.uid).filter((uid) => !previos.has(uid))
}

export function readEnvelopes(mailbox: string, limit: number, options: EnvelopeListOptions = {}, accountId?: string): Envelope[] {
  const condition = options.filter === 'unread' ? ' AND (unread = 1 OR uid = ?)' : options.filter === 'read' ? ' AND (unread = 0 OR uid = ?)' : ''
  const direction = options.oldestFirst ? 'ASC' : 'DESC'
  const rows = handle(accountId)
    .prepare(
      `SELECT mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged, message_id, in_reply_to, references_json, has_attachments, priority
       FROM messages WHERE mailbox = ?${condition} ORDER BY date ${direction}, uid ${direction} LIMIT ?`
    )
    .all(...(condition ? [mailbox, options.includeUid ?? -1, limit] : [mailbox, limit])) as unknown as MessageRow[]

  const envelopes: Envelope[] = rows.map((row) => ({
    uid: row.uid,
    hasAttachments: Number(row.has_attachments) === 1,
    priority: row.priority ?? 'normal',
    messageId: row.message_id ?? undefined,
    inReplyTo: row.in_reply_to ?? undefined,
    references: row.references_json ? JSON.parse(row.references_json) : undefined,
    subject: row.subject,
    from: row.from_addr ? { name: row.from_name, address: row.from_addr } : null,
    date: new Date(row.date).toISOString(),
    unread: row.unread === 1,
    flagged: row.flagged === 1,
    size: row.size
  }))
  // La selección abierta puede quedar fuera del LIMIT durante una sincronización.
  if (options.includeUid !== undefined && !envelopes.some(envelope => envelope.uid === options.includeUid)) {
    const selected = readEnvelope(mailbox, options.includeUid, accountId)
    if (selected) envelopes.push(selected)
  }
  return envelopes
}

export function readUnifiedInbox(
  accountIds: readonly string[],
  limit: number,
  options: EnvelopeListOptions = {}
): { accountId: string; mailbox: string; envelope: Envelope }[] {
  const merged: { accountId: string; mailbox: string; envelope: Envelope; ts: number }[] = []
  for (const accountId of accountIds) {
    const boxes = readMailboxes(accountId)
    const inbox = boxes.find(box => box.specialUse === '\\Inbox' || /^inbox$/i.test(box.path))?.path ?? 'INBOX'
    for (const envelope of readEnvelopes(inbox, limit, options, accountId)) {
      merged.push({ accountId, mailbox: inbox, envelope, ts: Date.parse(envelope.date) })
    }
  }
  const direction = options.oldestFirst ? 1 : -1
  merged.sort((left, right) => {
    const diff = left.ts - right.ts
    if (diff !== 0) return diff * direction
    return (left.envelope.uid - right.envelope.uid) * direction
  })
  return merged.slice(0, limit).map(({ accountId, mailbox, envelope }) => ({ accountId, mailbox, envelope }))
}

/** Busca relaciones exactas, nunca coincidencias por asunto ni por subcadenas. */
export function relatedMessageUids(mailbox: string, ids: readonly string[]): number[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = handle().prepare(`SELECT m.uid FROM messages m
    WHERE m.mailbox = ? AND m.uid IN (
      SELECT uid FROM messages WHERE mailbox = ? AND message_id IN (${placeholders})
      UNION
      SELECT uid FROM messages WHERE mailbox = ? AND in_reply_to IN (${placeholders})
      UNION
      SELECT uid FROM message_refs WHERE mailbox = ? AND ref_id IN (${placeholders})
    ) ORDER BY m.date ASC, m.uid ASC`).all(mailbox, mailbox, ...ids, mailbox, ...ids, mailbox, ...ids) as unknown as { uid: number }[]
  return rows.map(row => row.uid)
}

export function readEnvelope(mailbox: string, uid: number, accountId?: string): Envelope | null {
  const row = stmt(
    handle(accountId),
    `SELECT mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged, message_id, in_reply_to, references_json, has_attachments, priority
     FROM messages WHERE mailbox = ? AND uid = ?`
  ).get(mailbox, uid) as unknown as MessageRow | undefined

  if (!row) return null
  return {
    uid: row.uid,
    hasAttachments: Number(row.has_attachments) === 1,
    priority: row.priority ?? 'normal',
    messageId: row.message_id ?? undefined,
    inReplyTo: row.in_reply_to ?? undefined,
    references: row.references_json ? JSON.parse(row.references_json) : undefined,
    subject: row.subject,
    from: row.from_addr ? { name: row.from_name, address: row.from_addr } : null,
    date: new Date(row.date).toISOString(),
    unread: row.unread === 1,
    flagged: row.flagged === 1,
    size: row.size
  }
}

export function setFlagged(mailbox: string, uid: number, flagged: boolean): void {
  stmt(handle(), 'UPDATE messages SET flagged = ? WHERE mailbox = ? AND uid = ?')
    .run(flagged ? 1 : 0, mailbox, uid)
}

export function setUnread(mailbox: string, uid: number, unread: boolean): void {
  const database = handle()
  database.exec('BEGIN')
  try {
    const previous = readEnvelope(mailbox, uid)
    database.prepare('UPDATE messages SET unread = ? WHERE mailbox = ? AND uid = ?')
      .run(unread ? 1 : 0, mailbox, uid)
    if (previous && previous.unread !== unread) adjustMailboxUnseen(mailbox, unread ? 1 : -1)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

/** Refresca solo los flags del tramo reciente (no toca asunto ni cuerpo). */
export function updateFlags(
  mailbox: string,
  rows: readonly { uid: number; unread: boolean; flagged: boolean }[]
): void {
  if (rows.length === 0) return
  const database = handle()
  const statement = database.prepare('UPDATE messages SET unread = ?, flagged = ? WHERE mailbox = ? AND uid = ?')
  database.exec('BEGIN')
  try {
    for (const row of rows) {
      statement.run(row.unread ? 1 : 0, row.flagged ? 1 : 0, mailbox, row.uid)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function deleteMessageRow(mailbox: string, uid: number): { unread: boolean } | null {
  const database = handle()
  return inAtomic(database, () => {
    const row = stmt(database, 'SELECT unread FROM messages WHERE mailbox = ? AND uid = ?')
      .get(mailbox, uid) as unknown as { unread: number } | undefined
    if (!row) return null
    const key = stmt(database, 'SELECT id FROM search_ids WHERE mailbox = ? AND uid = ?')
      .get(mailbox, uid) as unknown as { id: number } | undefined
    if (key) {
      stmt(database, 'DELETE FROM search WHERE rowid = ?').run(key.id)
      stmt(database, 'DELETE FROM search_ids WHERE id = ?').run(key.id)
    }
    stmt(database, 'DELETE FROM message_bodies WHERE mailbox = ? AND uid = ?').run(mailbox, uid)
    stmt(database, 'DELETE FROM message_refs WHERE mailbox = ? AND uid = ?').run(mailbox, uid)
    stmt(database, 'DELETE FROM messages WHERE mailbox = ? AND uid = ?').run(mailbox, uid)
    return { unread: row.unread === 1 }
  })
}

/**
 * Ajusta el contador de no leídos de la carpeta sin inventar el total: cuando
 * una acción (o una regla) saca un mensaje sin leer, el badge baja en el acto.
 */
export function adjustMailboxUnseen(mailbox: string, delta: number): void {
  stmt(handle(), 'UPDATE mailboxes SET unseen = MAX(0, unseen + ?) WHERE path = ?')
    .run(delta, mailbox)
}

/** Borra de la caché lo que ya no existe en el servidor (solo si la lista es completa). */
export function pruneExcept(mailbox: string, uids: readonly number[]): void {
  const database = handle()
  if (uids.length === 0) {
    inAtomic(database, () => {
      stmt(database, 'DELETE FROM search WHERE rowid IN (SELECT id FROM search_ids WHERE mailbox = ?)').run(mailbox)
      stmt(database, 'DELETE FROM search_ids WHERE mailbox = ?').run(mailbox)
      stmt(database, 'DELETE FROM message_bodies WHERE mailbox = ?').run(mailbox)
      stmt(database, 'DELETE FROM message_refs WHERE mailbox = ?').run(mailbox)
      stmt(database, 'DELETE FROM messages WHERE mailbox = ?').run(mailbox)
    })
    return
  }
  const keep = new Set(uids)
  const remove = cachedUids(mailbox).filter((uid) => !keep.has(uid))
  if (remove.length === 0) return
  inAtomic(database, () => {
    // Las listas de UIDs pueden superar el límite de variables de SQLite; se
    // borra por tandas en vez de construir un `NOT IN` gigante.
    for (let offset = 0; offset < remove.length; offset += 500) {
      const batch = remove.slice(offset, offset + 500)
      const placeholders = batch.map(() => '?').join(', ')
      database.prepare(`DELETE FROM search WHERE rowid IN (SELECT id FROM search_ids WHERE mailbox = ? AND uid IN (${placeholders}))`).run(mailbox, ...batch)
      database.prepare(`DELETE FROM search_ids WHERE mailbox = ? AND uid IN (${placeholders})`).run(mailbox, ...batch)
      database.prepare(`DELETE FROM message_bodies WHERE mailbox = ? AND uid IN (${placeholders})`).run(mailbox, ...batch)
      database.prepare(`DELETE FROM message_refs WHERE mailbox = ? AND uid IN (${placeholders})`).run(mailbox, ...batch)
      database.prepare(`DELETE FROM messages WHERE mailbox = ? AND uid IN (${placeholders})`).run(mailbox, ...batch)
    }
  })
}

/* ---------------------------------------------------------------------------
   Borrador del compositor
   ------------------------------------------------------------------------- */

export type DraftRow = Draft

export function saveDraft(draft: DraftRow): void {
  const id = draft.id ?? 'current'
  handle().prepare(`INSERT INTO drafts (id, to_field, cc, subject, body, updated_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET to_field=excluded.to_field, cc=excluded.cc,
    subject=excluded.subject, body=excluded.body, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json`)
    .run(id, draft.to, draft.cc, draft.subject, draft.body, draft.updatedAt,
      JSON.stringify({ priority: draft.priority, html: draft.html, bcc: draft.bcc, attachments: draft.attachments, inReplyTo: draft.inReplyTo,
        references: draft.references, server: draft.server, previousServer: draft.previousServer, syncedAt: draft.syncedAt }))
  prunePickedAttachments()
}

export function listDrafts(): DraftRow[] {
  const rows = handle().prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all() as unknown as {
    id: string; to_field: string; cc: string; subject: string; body: string; updated_at: number; metadata_json: string | null
  }[]
  return rows.map(row => ({ ...(row.metadata_json ? JSON.parse(row.metadata_json) : {}), id: row.id,
    to: row.to_field, cc: row.cc, subject: row.subject, body: row.body, updatedAt: row.updated_at }))
}

export function readDraft(id?: string): DraftRow | null {
  const database = handle()
  const row = (id
    ? stmt(database, 'SELECT * FROM drafts WHERE id = ?').get(id)
    : stmt(database, 'SELECT * FROM drafts ORDER BY updated_at DESC LIMIT 1').get()) as unknown as {
    id: string; to_field: string; cc: string; subject: string; body: string; updated_at: number; metadata_json: string | null
  } | undefined
  if (!row) return null
  return {
    ...(row.metadata_json ? JSON.parse(row.metadata_json) : {}),
    id: row.id,
    to: row.to_field,
    cc: row.cc,
    subject: row.subject,
    body: row.body,
    updatedAt: row.updated_at
  }
}

export function clearDraft(id?: string): void {
  const draft = readDraft(id)
  if (draft) handle().prepare('DELETE FROM drafts WHERE id = ?').run(draft.id!)
  prunePickedAttachments()
}

/* ---------------------------------------------------------------------------
   Cola de salida
   ------------------------------------------------------------------------- */

export interface OutboxRow {
  id: string
  kind: string
  mailbox: string | null
  uid: number | null
  payload: string | null
  /** Cuenta a la que pertenece la operación; nunca se ejecuta en otra. */
  accountId: string | null
  /** Identidad de la carpeta al encolar (UIDVALIDITY), para no tocar un UID reciclado. */
  uidValidity: string | null
  status: string
  attempts: number
  /** Fallos transitorios consecutivos; alimentan el backoff y no consumen intentos. */
  failures: number
  /** Epoch ms; la fila no se reintenta antes de esta hora. */
  nextAttemptAt: number | null
  lastError: string | null
  /** Momento del primer intento de envío; si existe, hay que verificar Enviados. */
  attemptedAt: number | null
  createdAt: number
}

interface OutboxDbRow {
  id: string
  kind: string
  mailbox: string | null
  uid: number | null
  payload: string | null
  account_id: string | null
  uid_validity: string | null
  status: string
  attempts: number
  failures: number
  next_attempt_at: number | null
  last_error: string | null
  attempted_at: number | null
  created_at: number
}

function toOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    kind: row.kind,
    mailbox: row.mailbox,
    uid: row.uid,
    payload: row.payload,
    accountId: row.account_id,
    uidValidity: row.uid_validity,
    status: row.status,
    attempts: row.attempts,
    failures: row.failures,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    attemptedAt: row.attempted_at,
    createdAt: row.created_at
  }
}

export function enqueueOutbox(input: {
  kind: string
  payload?: unknown
  mailbox?: string | null
  uid?: number | null
  accountId?: string | null
  uidValidity?: string | null
}): string {
  const id = randomUUID()
  handle()
    .prepare(
      `INSERT INTO outbox (id, kind, mailbox, uid, payload, account_id, uid_validity, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`
    )
    .run(
      id,
      input.kind,
      input.mailbox ?? null,
      input.uid ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.accountId ?? (openedAccountId || null),
      input.uidValidity ?? null,
      Date.now()
    )
  return id
}

export function listOutbox(): OutboxRow[] {
  const rows = handle()
    .prepare('SELECT * FROM outbox ORDER BY created_at ASC')
    .all() as unknown as OutboxDbRow[]
  return rows.map(toOutboxRow)
}

export function getOutbox(id: string): OutboxRow | null {
  const row = handle().prepare('SELECT * FROM outbox WHERE id = ?').get(id) as unknown as OutboxDbRow | undefined
  return row ? toOutboxRow(row) : null
}

export function updateOutbox(
  id: string,
  patch: { status?: string; attempts?: number; failures?: number; nextAttemptAt?: number | null; lastError?: string | null; attemptedAt?: number | null }
): void {
  const current = getOutbox(id)
  if (!current) return
  handle()
    .prepare('UPDATE outbox SET status = ?, attempts = ?, failures = ?, next_attempt_at = ?, last_error = ?, attempted_at = ? WHERE id = ?')
    .run(
      patch.status ?? current.status,
      patch.attempts ?? current.attempts,
      patch.failures ?? current.failures,
      patch.nextAttemptAt === undefined ? current.nextAttemptAt : patch.nextAttemptAt,
      patch.lastError === undefined ? current.lastError : patch.lastError,
      patch.attemptedAt === undefined ? current.attemptedAt : patch.attemptedAt,
      id
    )
}

export function deleteOutbox(id: string): void {
  handle().prepare('DELETE FROM outbox WHERE id = ?').run(id)
}

export function countUnread(mailbox: string): number {
  const row = stmt(handle(), 'SELECT COUNT(*) AS total FROM messages WHERE mailbox = ? AND unread = 1')
    .get(mailbox) as unknown as { total: number }
  return row.total
}

export function countMessages(mailbox: string): number {
  const row = stmt(handle(), 'SELECT COUNT(*) AS total FROM messages WHERE mailbox = ?')
    .get(mailbox) as unknown as { total: number }
  return row.total
}

export function cachedUids(mailbox: string): number[] {
  const rows = handle()
    .prepare('SELECT uid FROM messages WHERE mailbox = ? ORDER BY uid')
    .all(mailbox) as unknown as { uid: number }[]
  return rows.map((row) => row.uid)
}

export interface CachedBody {
  text: string | null
  html: string | null
  to: { name: string; address: string }[]
  cc: { name: string; address: string }[]
  attachments: { name: string; size: number; type: string; part?: string }[]
  fetched: boolean
}

export function missingBodyUids(mailbox: string): number[] {
  const rows = stmt(
    handle(),
    'SELECT m.uid FROM messages m LEFT JOIN message_bodies b ON b.mailbox = m.mailbox AND b.uid = m.uid WHERE m.mailbox = ? AND b.uid IS NULL'
  ).all(mailbox) as { uid: number }[]
  return rows.map(row => row.uid)
}

export function countBodies(mailbox: string): number {
  const row = stmt(handle(), 'SELECT COUNT(*) AS count FROM message_bodies WHERE mailbox = ?')
    .get(mailbox) as { count: number }
  return row.count
}

export function readBody(mailbox: string, uid: number): CachedBody {
  const row = stmt(handle(), 'SELECT body_text, body_html, to_json, cc_json, attachments_json FROM message_bodies WHERE mailbox = ? AND uid = ?')
    .get(mailbox, uid) as unknown as {
      body_text: string | Uint8Array | null
      body_html: string | Uint8Array | null
      to_json: string | null
      cc_json: string | null
      attachments_json: string | null
    } | undefined

  const parseAddresses = (value: string | null): { name: string; address: string }[] => {
    if (!value) return []
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as { name: string; address: string }[]) : []
    } catch {
      return []
    }
  }

  const parseAttachments = (value: string | null): { name: string; size: number; type: string }[] => {
    if (!value) return []
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as { name: string; size: number; type: string }[]) : []
    } catch {
      return []
    }
  }

  const text = decodeBody(row?.body_text)
  const html = decodeBody(row?.body_html)

  return {
    text,
    html,
    to: parseAddresses(row?.to_json ?? null),
    cc: parseAddresses(row?.cc_json ?? null),
    attachments: parseAttachments(row?.attachments_json ?? null),
    fetched: row != null && (text !== null || html !== null)
  }
}

export function saveBody(
  mailbox: string,
  uid: number,
  body: {
    text: string
    html: string | null
    to: { name: string; address: string }[]
    cc: { name: string; address: string }[]
    attachments: { name: string; size: number; type: string; part?: string }[]
  }
): void {
  const database = handle()
  inAtomic(database, () => {
    stmt(
      database,
      `INSERT INTO message_bodies (mailbox, uid, body_text, body_html, to_json, cc_json, attachments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mailbox, uid) DO UPDATE SET
         body_text = excluded.body_text,
         body_html = excluded.body_html,
         to_json = excluded.to_json,
         cc_json = excluded.cc_json,
         attachments_json = excluded.attachments_json`
    ).run(
      mailbox,
      uid,
      encodeBody(body.text),
      encodeBody(body.html),
      JSON.stringify(body.to),
      JSON.stringify(body.cc),
      JSON.stringify(body.attachments)
    )
    // El cuerpo recién descargado entra al índice de búsqueda.
    reindexMessage(mailbox, uid)
  })
}

/** Reindexa un mensaje (asunto, remitentes y cuerpo si ya se descargó). */
export function reindexMessage(mailbox: string, uid: number): void {
  const database = handle()
  const row = stmt(
    database,
    `SELECT m.subject, m.from_name, m.from_addr, b.body_text
     FROM messages m
     LEFT JOIN message_bodies b ON b.mailbox = m.mailbox AND b.uid = m.uid
     WHERE m.mailbox = ? AND m.uid = ?`
  ).get(mailbox, uid) as unknown as
    | { subject: string; from_name: string; from_addr: string; body_text: string | Uint8Array | null }
    | undefined

  const key = stmt(database, 'SELECT id FROM search_ids WHERE mailbox = ? AND uid = ?')
    .get(mailbox, uid) as unknown as { id: number } | undefined

  if (!row) {
    // Sin mensaje no hay nada que indexar; se retira también su identidad.
    if (key) {
      stmt(database, 'DELETE FROM search WHERE rowid = ?').run(key.id)
      stmt(database, 'DELETE FROM search_ids WHERE id = ?').run(key.id)
    }
    return
  }

  let id = key?.id
  if (id === undefined) {
    const inserted = stmt(database, 'INSERT OR IGNORE INTO search_ids (mailbox, uid) VALUES (?, ?)')
      .run(mailbox, uid)
    id = Number(inserted.changes) === 1
      ? Number(inserted.lastInsertRowid)
      : (stmt(database, 'SELECT id FROM search_ids WHERE mailbox = ? AND uid = ?')
          .get(mailbox, uid) as unknown as { id: number }).id
  }

  // Borrar e insertar por id es O(1); `WHERE mailbox = ? AND uid = ?` recorre
  // el índice completo porque ambas columnas son UNINDEXED.
  stmt(database, 'DELETE FROM search WHERE rowid = ?').run(id)
  const peers = [row.from_name, row.from_addr].filter((part) => part !== '').join(' ')
  stmt(database, 'INSERT INTO search (rowid, subject, peers, body, mailbox, uid) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, row.subject, peers, decodeBody(row.body_text) ?? '', mailbox, uid)
}

/** Migra cuerpos almacenados en `messages` a `message_bodies` con compresión. */
function migrateMessageBodies(database: DatabaseSync): void {
  const applied = database.prepare("SELECT value FROM meta WHERE key = 'bodies_table_v1'").get() as
    | { value: string }
    | undefined
  if (applied?.value === '1') return

  database.exec('BEGIN')
  try {
    const rows = database
      .prepare('SELECT mailbox, uid, body_text, body_html, to_json, cc_json, attachments_json FROM messages WHERE body_text IS NOT NULL OR body_html IS NOT NULL')
      .all() as unknown as {
      mailbox: string
      uid: number
      body_text: string | null
      body_html: string | null
      to_json: string | null
      cc_json: string | null
      attachments_json: string | null
    }[]
    const insertBody = database.prepare(
      `INSERT OR REPLACE INTO message_bodies (mailbox, uid, body_text, body_html, to_json, cc_json, attachments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      insertBody.run(
        row.mailbox,
        row.uid,
        encodeBody(row.body_text),
        encodeBody(row.body_html),
        row.to_json,
        row.cc_json,
        row.attachments_json
      )
    }
    if (rows.length > 0) {
      database.exec('UPDATE messages SET body_text = NULL, body_html = NULL, to_json = NULL, cc_json = NULL, attachments_json = NULL WHERE body_text IS NOT NULL OR body_html IS NOT NULL')
    }
    database
      .prepare("INSERT INTO meta (key, value) VALUES ('bodies_table_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
      .run()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

/** Puebla `message_refs` a partir de `messages.references_json` en instalaciones previas. */
function migrateMessageRefs(database: DatabaseSync): void {
  const applied = database.prepare("SELECT value FROM meta WHERE key = 'message_refs_v1'").get() as
    | { value: string }
    | undefined
  if (applied?.value === '1') return

  database.exec('BEGIN')
  try {
    const rows = database
      .prepare("SELECT mailbox, uid, references_json FROM messages WHERE references_json IS NOT NULL AND references_json != '[]' AND references_json != ''")
      .all() as unknown as { mailbox: string; uid: number; references_json: string }[]
    const insertRef = database.prepare('INSERT OR IGNORE INTO message_refs (mailbox, ref_id, uid) VALUES (?, ?, ?)')
    for (const row of rows) {
      try {
        const refs = JSON.parse(row.references_json)
        if (Array.isArray(refs)) {
          for (const refId of refs) {
            if (typeof refId === 'string' && refId) insertRef.run(row.mailbox, refId, row.uid)
          }
        }
      } catch {
        // Ignora JSON corrupto en sobres legacy.
      }
    }
    database
      .prepare("INSERT INTO meta (key, value) VALUES ('message_refs_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
      .run()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

/**
 * Cachés anteriores guardaban el índice FTS con rowid propio. La migración lo
 * reconstruye una sola vez y asigna un id estable a cada mensaje.
 */
function migrateSearchIndex(database: DatabaseSync): void {
  const applied = database.prepare("SELECT value FROM meta WHERE key = 'fts_rowid_layout'").get() as
    | { value: string }
    | undefined
  if (applied?.value === '1') return

  database.exec('BEGIN')
  try {
    database.exec('DELETE FROM search')
    database.exec('DELETE FROM search_ids')
    const rows = database
      .prepare(
        `SELECT m.subject, m.from_name, m.from_addr, COALESCE(b.body_text, m.body_text) AS body_text, m.mailbox, m.uid
         FROM messages m
         LEFT JOIN message_bodies b ON b.mailbox = m.mailbox AND b.uid = m.uid`
      )
      .all() as unknown as {
      subject: string
      from_name: string
      from_addr: string
      body_text: string | Uint8Array | null
      mailbox: string
      uid: number
    }[]
    const insertId = database.prepare('INSERT INTO search_ids (mailbox, uid) VALUES (?, ?)')
    const insertSearch = database.prepare('INSERT INTO search (rowid, subject, peers, body, mailbox, uid) VALUES (?, ?, ?, ?, ?, ?)')
    for (const row of rows) {
      const id = Number(insertId.run(row.mailbox, row.uid).lastInsertRowid)
      const peers = [row.from_name, row.from_addr].filter((part) => part !== '').join(' ')
      insertSearch.run(id, row.subject, peers, decodeBody(row.body_text) ?? '', row.mailbox, row.uid)
    }
    database
      .prepare("INSERT INTO meta (key, value) VALUES ('fts_rowid_layout', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
      .run()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

/** Convierte lo que escribe el usuario en una consulta FTS5 segura (prefijos). */
function toFtsQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/["'()*:^~{}[\]-]/g, ''))
    .filter((token) => token.length > 0)
  return tokens.map((token) => `"${token}"*`).join(' ')
}

interface ParsedSearch {
  fts: string
  clauses: string[]
  params: (string | number)[]
}

/** Extrae operadores estructurados (from:, subject:, has:attachment, is:unread/read/starred, in:, after:, before:). */
function parseSearchQuery(query: string): ParsedSearch {
  const clauses: string[] = []
  const params: (string | number)[] = []
  const freeTokens: string[] = []
  const tokenRe = /([a-z]+):(?:"([^"]+)"|(\S+))|(\S+)/gi
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(query)) !== null) {
    const key = match[1]?.toLowerCase()
    const value = (match[2] ?? match[3] ?? '').trim()
    if (!key) {
      freeTokens.push(match[4]!)
      continue
    }
    const lower = value.toLowerCase()
    if (key === 'from' && lower) {
      clauses.push("instr(lower(m.from_addr || ' ' || m.from_name), ?) > 0")
      params.push(lower)
    } else if (key === 'subject' && lower) {
      clauses.push('instr(lower(m.subject), ?) > 0')
      params.push(lower)
    } else if ((key === 'in' || key === 'folder') && lower) {
      clauses.push('instr(lower(m.mailbox), ?) > 0')
      params.push(lower)
    } else if (key === 'has' && (lower === 'attachment' || lower === 'attachments' || lower === 'adjunto' || lower === 'adjuntos')) {
      clauses.push('m.has_attachments = 1')
    } else if (key === 'is' && (lower === 'unread' || lower === 'noleido' || lower === 'sinleer')) {
      clauses.push('m.unread = 1')
    } else if (key === 'is' && (lower === 'read' || lower === 'leido')) {
      clauses.push('m.unread = 0')
    } else if (key === 'is' && (lower === 'starred' || lower === 'flagged' || lower === 'destacado')) {
      clauses.push('m.flagged = 1')
    } else if (key === 'after' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const ts = Date.parse(`${value}T00:00:00Z`)
      if (Number.isFinite(ts)) {
        clauses.push('m.date >= ?')
        params.push(ts)
      }
    } else if (key === 'before' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const ts = Date.parse(`${value}T23:59:59.999Z`)
      if (Number.isFinite(ts)) {
        clauses.push('m.date <= ?')
        params.push(ts)
      }
    } else {
      freeTokens.push(match[0])
    }
  }
  return { fts: toFtsQuery(freeTokens.join(' ')), clauses, params }
}

export function searchMessages(query: string, limit: number, offset = 0, accountId?: string): {
  mailbox: string
  uid: number
  subject: string
  subjectMatch: string
  fromName: string
  fromAddr: string
  date: number
  unread: boolean
  flagged: boolean
  snippet: string
}[] {
  const { fts, clauses, params } = parseSearchQuery(query)
  if (fts === '' && clauses.length === 0) return []

  const database = handle(accountId)
  const extraWhere = clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : ''
  const rows = (fts !== ''
    ? database
        .prepare(
          `SELECT search.mailbox AS mailbox,
                  search.uid AS uid,
                  search.subject AS subject,
                  highlight(search, 0, '⟦', '⟧') AS subject_match,
                  snippet(search, 2, '⟦', '⟧', '…', 14) AS snippet,
                  m.date AS date, m.from_name AS from_name, m.from_addr AS from_addr,
                  m.unread AS unread, m.flagged AS flagged
           FROM search
           JOIN messages m ON m.mailbox = search.mailbox AND m.uid = search.uid
           WHERE search MATCH ?${extraWhere}
           ORDER BY m.date DESC, search.mailbox ASC, search.uid DESC
           LIMIT ? OFFSET ?`
        )
        .all(fts, ...params, limit, offset)
    : database
        .prepare(
          `SELECT m.mailbox AS mailbox,
                  m.uid AS uid,
                  m.subject AS subject,
                  m.subject AS subject_match,
                  '' AS snippet,
                  m.date AS date, m.from_name AS from_name, m.from_addr AS from_addr,
                  m.unread AS unread, m.flagged AS flagged
           FROM messages m
           WHERE ${clauses.join(' AND ')}
           ORDER BY m.date DESC, m.mailbox ASC, m.uid DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset)) as unknown as {
    mailbox: string
    uid: number
    subject: string
    subject_match: string
    snippet: string
    date: number
    from_name: string
    from_addr: string
    unread: number
    flagged: number
  }[]

  return rows.map((row) => ({
    mailbox: row.mailbox,
    uid: row.uid,
    subject: row.subject,
    subjectMatch: row.subject_match,
    fromName: row.from_name,
    fromAddr: row.from_addr,
    date: row.date,
    unread: row.unread === 1,
    flagged: row.flagged === 1,
    snippet: row.snippet
  }))
}

export function getMeta(key: string): string | null {
  const row = handle().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  handle()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

/* ---------------------------------------------------------------------------
   Reglas locales
   ------------------------------------------------------------------------- */

export interface RuleRow {
  id: number
  name: string
  enabled: number
  field: string
  op: string
  value: string
  action: string
  target: string | null
  hits: number
  createdAt: number
}

interface RuleDbRow {
  id: number
  name: string
  enabled: number
  field: string
  op: string
  value: string
  action: string
  target: string | null
  hits: number
  created_at: number
}

function mapRule(row: RuleDbRow): RuleRow {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    field: row.field,
    op: row.op,
    value: row.value,
    action: row.action,
    target: row.target,
    hits: row.hits,
    createdAt: row.created_at
  }
}

export function listRules(): RuleRow[] {
  const rows = handle()
    .prepare('SELECT * FROM rules ORDER BY id ASC')
    .all() as unknown as RuleDbRow[]
  return rows.map(mapRule)
}

export function insertRule(input: {
  name: string
  enabled: boolean
  field: string
  op: string
  value: string
  action: string
  target: string | null
}): void {
  handle()
    .prepare(
      `INSERT INTO rules (name, enabled, field, op, value, action, target, hits, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      input.name,
      input.enabled ? 1 : 0,
      input.field,
      input.op,
      input.value,
      input.action,
      input.target,
      Date.now()
    )
}

export function updateRule(
  id: number,
  input: {
    name: string
    enabled: boolean
    field: string
    op: string
    value: string
    action: string
    target: string | null
  }
): void {
  handle()
    .prepare(
      `UPDATE rules SET name = ?, enabled = ?, field = ?, op = ?, value = ?, action = ?, target = ?
       WHERE id = ?`
    )
    .run(
      input.name,
      input.enabled ? 1 : 0,
      input.field,
      input.op,
      input.value,
      input.action,
      input.target,
      id
    )
}

export function deleteRuleRow(id: number): void {
  handle().prepare('DELETE FROM rules WHERE id = ?').run(id)
}

export function bumpRuleHits(id: number, count: number = 1): void {
  handle().prepare('UPDATE rules SET hits = hits + ? WHERE id = ?').run(count, id)
}

/** Buzón de archivo según lo que reportó el servidor (o "Archive" como respaldo). */
export function archiveMailboxPath(): string | null {
  const row = handle()
    .prepare(
      "SELECT path FROM mailboxes WHERE special_use = '\\Archive' ORDER BY path LIMIT 1"
    )
    .get() as unknown as { path: string } | undefined
  if (row?.path) return row.path
  const fallback = handle()
    .prepare("SELECT path FROM mailboxes WHERE LOWER(path) = 'archive' LIMIT 1")
    .get() as unknown as { path: string } | undefined
  return fallback?.path ?? null
}

export interface CachedMessage {
  mailbox: string
  uid: number
  subject: string
  fromName: string
  fromAddr: string
  to: string
}

function mapMessage(row: {
  mailbox: string
  uid: number
  subject: string
  from_name: string
  from_addr: string
  to_json: string | null
}): CachedMessage {
  return {
    mailbox: row.mailbox,
    uid: row.uid,
    subject: row.subject,
    fromName: row.from_name,
    fromAddr: row.from_addr,
    to: row.to_json ?? ''
  }
}

export function messagesByUids(mailbox: string, uids: readonly number[]): CachedMessage[] {
  if (uids.length === 0) return []
  const database = handle()
  const results: CachedMessage[] = []
  for (let offset = 0; offset < uids.length; offset += 500) {
    const batch = uids.slice(offset, offset + 500)
    const placeholders = batch.map(() => '?').join(',')
    const rows = database
      .prepare(
        `SELECT m.mailbox, m.uid, m.subject, m.from_name, m.from_addr, COALESCE(b.to_json, m.to_json) AS to_json
         FROM messages m
         LEFT JOIN message_bodies b ON b.mailbox = m.mailbox AND b.uid = m.uid
         WHERE m.mailbox = ? AND m.uid IN (${placeholders})`
      )
      .all(mailbox, ...batch) as unknown as {
      mailbox: string
      uid: number
      subject: string
      from_name: string
      from_addr: string
      to_json: string | null
    }[]
    for (const row of rows) results.push(mapMessage(row))
  }
  return results
}

export function allCachedMessages(limit: number = 5000, offset = 0): CachedMessage[] {
  const rows = stmt(
    handle(),
    `SELECT m.mailbox, m.uid, m.subject, m.from_name, m.from_addr, COALESCE(b.to_json, m.to_json) AS to_json
     FROM messages m
     LEFT JOIN message_bodies b ON b.mailbox = m.mailbox AND b.uid = m.uid
     WHERE m.mailbox NOT IN (SELECT path FROM mailboxes WHERE special_use = '\\Sent')
     ORDER BY m.date DESC LIMIT ? OFFSET ?`
  ).all(limit, offset) as unknown as {
    mailbox: string
    uid: number
    subject: string
    from_name: string
    from_addr: string
    to_json: string | null
  }[]
  return rows.map(mapMessage)
}

/** Completa metadatos de cachés anteriores sin descargar cuerpos ni borrar mensajes. */
export function missingEnvelopeMetadata(mailbox: string): number[] {
  const rows = handle().prepare('SELECT uid FROM messages WHERE mailbox = ? AND (has_attachments IS NULL OR priority IS NULL OR references_json IS NULL)')
    .all(mailbox) as unknown as { uid: number }[]
  return rows.map(row => row.uid)
}

function accountCacheFile(accountId: string): string {
  const safe = accountId.replace(/[^a-z0-9_-]/gi, '')
  return accountId === 'default' || safe === '' ? 'cache.db' : `cache-${safe}.db`
}

export async function cacheUsage(accounts: readonly { id: string }[]): Promise<CacheUsage> {
  const directory = userDataDir()
  const files = (await readdir(directory)).filter(name => /^cache(?:-[a-z0-9_-]+)?\.db(?:-wal|-shm|-journal)?$/i.test(name))
  const sizes = await Promise.all(files.map(async name => {
    try {
      return { name, bytes: (await stat(join(directory, name))).size }
    } catch (cause) {
      // SQLite puede retirar un WAL mientras se mide.
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { name, bytes: 0 }
      throw cause
    }
  }))
  const used = new Set<string>()
  const perAccount = accounts.map(account => {
    const base = accountCacheFile(account.id)
    let bytes = 0
    for (const file of sizes) {
      if (file.name === base || file.name.startsWith(`${base}-`)) {
        bytes += file.bytes
        used.add(file.name)
      }
    }
    return { id: account.id, bytes }
  })
  return {
    totalBytes: sizes.reduce((sum, file) => sum + file.bytes, 0),
    accounts: perAccount,
    unassignedBytes: sizes.filter(file => !used.has(file.name)).reduce((sum, file) => sum + file.bytes, 0)
  }
}

/** Retira todos los datos locales de una cuenta desvinculada. */
export async function deleteAccountCache(accountId: string): Promise<void> {
  if (!/^[a-z0-9_-]+$/i.test(accountId)) throw new Error('Cuenta inválida')
  closeAccountCache(accountId)
  const file = join(userDataDir(), accountCacheFile(accountId))
  for (const suffix of ['-wal', '-shm', '-journal', '']) await rm(file + suffix, { force: true })
}

/** Libera cuerpos descargados sin tocar sobres, borradores, reglas ni la cola. */
export async function clearAccountCache(accountId: string): Promise<void> {
  const file = join(userDataDir(), accountCacheFile(accountId))
  try {
    await stat(file)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
  // Si la cuenta está abierta, se cierra su conexión y se reabre al terminar.
  // En Windows no se puede abrir una segunda conexión al mismo WAL; se compara
  // también el archivo porque el id visible puede no coincidir con la caché abierta.
  const targetFile = accountCacheFile(accountId)
  const wasActive = db !== null && (
    openedAccountId === accountId ||
    openedCacheFile.toLowerCase() === targetFile.toLowerCase()
  )
  const wasPooled = handles.has(accountId)
  for (const [id] of handles) {
    if (id === accountId || accountCacheFile(id).toLowerCase() === targetFile.toLowerCase()) closeAccountCache(id)
  }
  if (wasActive) closeAccountCache(openedAccountId)
  let database: DatabaseSync
  try {
    database = new DatabaseSync(file)
  } catch (cause) {
    if (wasActive) openAccountCache(accountId)
    else if (wasPooled) openDatabase(accountId)
    throw cause
  }
  try {
    database.exec('PRAGMA temp_store = MEMORY')
    database.exec('PRAGMA busy_timeout = 5000')
    database.exec('BEGIN IMMEDIATE')
    try {
      const columns = database.prepare('PRAGMA table_info(messages)').all() as unknown as { name: string }[]
      const attachments = columns.some(column => column.name === 'attachments_json') ? ', attachments_json = NULL' : ''
      if (database.prepare("SELECT name FROM sqlite_master WHERE name = 'message_bodies'").get()) {
        database.exec('DELETE FROM message_bodies')
      }
      database.exec(`UPDATE messages SET body_text = NULL, body_html = NULL${attachments} WHERE body_text IS NOT NULL OR body_html IS NOT NULL`)
      if (database.prepare("SELECT name FROM sqlite_master WHERE name = 'search'").get()) {
        // Vaciar el cuerpo en el propio índice conserva asuntos y remitentes.
        // Se hace fila por fila para que FTS5 no tenga que abrir segmentos
        // temporales grandes, que es lo que falla en Windows.
        const rows = database.prepare("SELECT rowid FROM search WHERE body <> ''").all() as unknown as { rowid: number }[]
        const clearBody = database.prepare("UPDATE search SET body = '' WHERE rowid = ?")
        for (const row of rows) clearBody.run(row.rowid)
        try { database.exec("INSERT INTO search(search) VALUES('merge', 200)") } catch { /* ignore */ }
      }
      database.exec('COMMIT')
    } catch (cause) {
      database.exec('ROLLBACK')
      throw cause
    }
    // La limpieza ya está confirmada. Compactar es opcional: si el sistema de
    // archivos no deja crear el temporal de VACUUM, no se invalida el borrado.
    try {
      database.exec('VACUUM')
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // Se conserva la caché ya limpiada; el archivo se compactará en otra pasada.
    }
  } finally {
    try {
      database.close()
    } finally {
      if (wasActive) openAccountCache(accountId)
    }
  }
}

export function storePickedAttachment(id: string, name: string, data: Buffer): void {
  handle().prepare('INSERT INTO picked_attachments (id, name, data) VALUES (?, ?, ?)').run(id, name, data)
}

export function readPickedAttachment(id: string): { name: string; data: Uint8Array } | undefined {
  return handle().prepare('SELECT name, data FROM picked_attachments WHERE id = ?').get(id) as unknown as { name: string; data: Uint8Array } | undefined
}

export function prunePickedAttachments(): void {
  const database = handle()
  const references = new Set<string>()
  const rows = database.prepare('SELECT metadata_json AS payload FROM drafts UNION ALL SELECT payload FROM outbox').all() as unknown as { payload: string | null }[]
  try {
    for (const row of rows) {
      const data = row.payload ? JSON.parse(row.payload) : null
      if (Array.isArray(data?.attachments)) for (const file of data.attachments) {
        const id = typeof file === 'string' ? file : file?.id
        if (typeof id === 'string') references.add(id)
      }
    }
  } catch {
    return // Un borrador dañado no debe provocar la eliminación de sus archivos.
  }
  const files = database.prepare('SELECT id FROM picked_attachments').all() as unknown as { id: string }[]
  const remove = database.prepare('DELETE FROM picked_attachments WHERE id = ?')
  for (const file of files) if (!references.has(file.id)) remove.run(file.id)
}

/** Solo direcciones de envíos aceptados; cada cuenta tiene su propia tabla. */
export function rememberRecipients(addresses: string[]): void {
  const insert = handle().prepare(`INSERT INTO recipient_cache (email, uses, updated_at) VALUES (?, 1, ?)
    ON CONFLICT(email) DO UPDATE SET uses = uses + 1, updated_at = excluded.updated_at`)
  for (const email of new Set(addresses.map(address => address.toLowerCase()))) insert.run(email, Date.now())
}

export function suggestRecipients(query: string): RecipientSuggestion[] {
  const term = query.trim().toLowerCase()
  return stmt(handle(), `
    SELECT email, MAX(name) AS name FROM (
      SELECT email, '' AS name, uses AS score, updated_at AS recent
      FROM recipient_cache WHERE instr(lower(email), ?) > 0
      UNION ALL
      SELECT lower(from_addr) AS email, from_name AS name, 0 AS score, MAX(date) AS recent
      FROM messages WHERE from_addr != '' AND instr(lower(from_addr || ' ' || from_name), ?) > 0
      GROUP BY lower(from_addr), from_name
    )
    GROUP BY email ORDER BY MAX(score) DESC, MAX(recent) DESC, email LIMIT 8
  `).all(term, term) as unknown as RecipientSuggestion[]
}
