import { readdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
}

interface MessageRow {
  priority: Envelope['priority'] | null
  has_attachments: number | null
  message_id: string | null
  in_reply_to: string | null
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
}

let db: DatabaseSync | null = null
let openedAccountId = ''
export function cacheAccountId(): string { return openedAccountId }

export function initCache(accountId: string = 'default'): void {
  if (db) return
  openAccountCache(accountId)
}

/**
 * Abre la caché de una cuenta. Cada cuenta tiene su propio archivo
 * (`cache-<id>.db`): carpetas, búsqueda, cola y reglas quedan separadas sin
 * cambiar el esquema. La cuenta `default` conserva `cache.db` (compatibilidad).
 */
export function openAccountCache(accountId: string): void {
  if (db) closeCache()

  const file = accountCacheFile(accountId)

  db = new DatabaseSync(join(app.getPath('userData'), file))
  openedAccountId = accountId
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS mailboxes (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      special_use TEXT,
      uid_validity INTEGER,
      uid_next INTEGER,
      messages INTEGER NOT NULL DEFAULT 0,
      unseen INTEGER NOT NULL DEFAULT 1,
      synced_at INTEGER
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
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
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
  `)

  db.exec('CREATE TABLE IF NOT EXISTS recipient_cache (email TEXT PRIMARY KEY, uses INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)')
  db.exec('CREATE TABLE IF NOT EXISTS picked_attachments (id TEXT PRIMARY KEY, name TEXT NOT NULL, data BLOB NOT NULL)')
  const draftColumns = db.prepare('PRAGMA table_info(drafts)').all() as unknown as { name: string }[]
  if (!draftColumns.some(column => column.name === 'metadata_json')) db.exec('ALTER TABLE drafts ADD COLUMN metadata_json TEXT')

  const columns = db.prepare('PRAGMA table_info(messages)').all() as unknown as { name: string }[]
  for (const column of ['message_id', 'in_reply_to', 'has_attachments', 'priority']) {
    if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE messages ADD COLUMN ${column} ${column === 'has_attachments' ? 'INTEGER' : 'TEXT'}`)
  }

  // Migración aditiva: la tabla ya existe en instalaciones previas.
  try {
    db.exec('ALTER TABLE messages ADD COLUMN attachments_json TEXT')
  } catch {
    // la columna ya estaba
  }
}

function handle(): DatabaseSync {
  if (!db) throw new Error('La caché no está inicializada')
  return db
}

export function closeCache(): void {
  db?.close()
  db = null
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
      database.prepare('DELETE FROM search WHERE mailbox = ?').run(box.path)
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

export function readMailboxes(): MailboxInfo[] {
  const rows = handle()
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
  const row = handle()
    .prepare('SELECT * FROM mailboxes WHERE path = ?')
    .get(path) as unknown as MailboxRow | undefined

  if (!row) return null
  return {
    path: row.path,
    uidValidity: row.uid_validity,
    uidNext: row.uid_next,
    messages: row.messages,
    unseen: row.unseen,
    syncedAt: row.synced_at
  }
}

export function clearMailbox(path: string): void {
  const database = handle()
  database.prepare('DELETE FROM messages WHERE mailbox = ?').run(path)
  database
    .prepare('UPDATE mailboxes SET uid_validity = NULL, uid_next = NULL, synced_at = NULL WHERE path = ?')
    .run(path)
}

export function saveMailboxSync(
  path: string,
  sync: { uidValidity: number | null; uidNext: number | null; messages: number; unseen: number }
): void {
  handle()
    .prepare(
      `INSERT INTO mailboxes (path, name, uid_validity, uid_next, messages, unseen, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         uid_validity = excluded.uid_validity,
         uid_next = excluded.uid_next,
         messages = excluded.messages,
         unseen = excluded.unseen,
         synced_at = excluded.synced_at`
    )
    .run(path, path, sync.uidValidity, sync.uidNext, sync.messages, sync.unseen, Date.now())
}

/** Inserta/actualiza sobres y devuelve los UID que **no** estaban en la caché. */
export function upsertEnvelopes(mailbox: string, envelopes: readonly Envelope[]): number[] {
  const database = handle()

  const previos = new Set<number>()
  if (envelopes.length > 0) {
    const placeholders = envelopes.map(() => '?').join(',')
    const rows = database
      .prepare(`SELECT uid FROM messages WHERE mailbox = ? AND uid IN (${placeholders})`)
      .all(mailbox, ...envelopes.map((envelope) => envelope.uid)) as unknown as { uid: number }[]
    for (const row of rows) previos.add(row.uid)
  }

  const statement = database.prepare(`
    INSERT INTO messages (mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged, message_id, in_reply_to, has_attachments, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      has_attachments = excluded.has_attachments,
      priority = excluded.priority
  `)

  database.exec('BEGIN')
  try {
    for (const envelope of envelopes) {
      statement.run(
        mailbox,
        envelope.uid,
        envelope.subject,
        envelope.from?.name ?? '',
        envelope.from?.address ?? '',
        new Date(envelope.date).getTime(),
        envelope.size,
        envelope.unread ? 1 : 0,
        envelope.flagged ? 1 : 0,
        envelope.messageId ?? null,
        envelope.inReplyTo ?? null,
        envelope.hasAttachments === undefined ? null : envelope.hasAttachments ? 1 : 0,
        envelope.priority ?? 'normal'
      )
      reindexMessage(mailbox, envelope.uid)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return envelopes.map((envelope) => envelope.uid).filter((uid) => !previos.has(uid))
}

export function readEnvelopes(mailbox: string, limit: number, options: EnvelopeListOptions = {}): Envelope[] {
  const condition = options.filter === 'unread' ? ' AND (unread = 1 OR uid = ?)' : options.filter === 'read' ? ' AND (unread = 0 OR uid = ?)' : ''
  const direction = options.oldestFirst ? 'ASC' : 'DESC'
  const rows = handle()
    .prepare(
      `SELECT mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged, message_id, in_reply_to, has_attachments, priority
       FROM messages WHERE mailbox = ?${condition} ORDER BY date ${direction}, uid ${direction} LIMIT ?`
    )
    .all(...(condition ? [mailbox, options.includeUid ?? -1, limit] : [mailbox, limit])) as unknown as MessageRow[]

  const envelopes: Envelope[] = rows.map((row) => ({
    uid: row.uid,
    hasAttachments: Number(row.has_attachments) === 1,
    priority: row.priority ?? 'normal',
    messageId: row.message_id ?? undefined,
    inReplyTo: row.in_reply_to ?? undefined,
    subject: row.subject,
    from: row.from_addr ? { name: row.from_name, address: row.from_addr } : null,
    date: new Date(row.date).toISOString(),
    unread: row.unread === 1,
    flagged: row.flagged === 1,
    size: row.size
  }))
  // La selección abierta puede quedar fuera del LIMIT durante una sincronización.
  if (options.includeUid !== undefined && !envelopes.some(envelope => envelope.uid === options.includeUid)) {
    const selected = readEnvelope(mailbox, options.includeUid)
    if (selected) envelopes.push(selected)
  }
  return envelopes
}

export function readEnvelope(mailbox: string, uid: number): Envelope | null {
  const row = handle()
    .prepare(
      `SELECT mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged, message_id, in_reply_to, has_attachments, priority
       FROM messages WHERE mailbox = ? AND uid = ?`
    )
    .get(mailbox, uid) as unknown as MessageRow | undefined

  if (!row) return null
  return {
    uid: row.uid,
    hasAttachments: Number(row.has_attachments) === 1,
    priority: row.priority ?? 'normal',
    messageId: row.message_id ?? undefined,
    inReplyTo: row.in_reply_to ?? undefined,
    subject: row.subject,
    from: row.from_addr ? { name: row.from_name, address: row.from_addr } : null,
    date: new Date(row.date).toISOString(),
    unread: row.unread === 1,
    flagged: row.flagged === 1,
    size: row.size
  }
}

export function setFlagged(mailbox: string, uid: number, flagged: boolean): void {
  handle()
    .prepare('UPDATE messages SET flagged = ? WHERE mailbox = ? AND uid = ?')
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
  const row = handle()
    .prepare('SELECT unread FROM messages WHERE mailbox = ? AND uid = ?')
    .get(mailbox, uid) as unknown as { unread: number } | undefined
  handle().prepare('DELETE FROM messages WHERE mailbox = ? AND uid = ?').run(mailbox, uid)
  return row ? { unread: row.unread === 1 } : null
}

/**
 * Ajusta el contador de no leídos de la carpeta sin inventar el total: cuando
 * una acción (o una regla) saca un mensaje sin leer, el badge baja en el acto.
 */
export function adjustMailboxUnseen(mailbox: string, delta: number): void {
  handle()
    .prepare('UPDATE mailboxes SET unseen = MAX(0, unseen + ?) WHERE path = ?')
    .run(delta, mailbox)
}

/** Borra de la caché lo que ya no existe en el servidor (solo si la lista es completa). */
export function pruneExcept(mailbox: string, uids: readonly number[]): void {
  const database = handle()
  if (uids.length === 0) {
    database.prepare('DELETE FROM messages WHERE mailbox = ?').run(mailbox)
    return
  }
  const placeholders = uids.map(() => '?').join(', ')
  database
    .prepare(`DELETE FROM messages WHERE mailbox = ? AND uid NOT IN (${placeholders})`)
    .run(mailbox, ...uids)
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
  const drafts = listDrafts()
  return (id ? drafts.find(draft => draft.id === id) : drafts[0]) ?? null
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
  status: string
  attempts: number
  lastError: string | null
  createdAt: number
}

interface OutboxDbRow {
  id: string
  kind: string
  mailbox: string | null
  uid: number | null
  payload: string | null
  status: string
  attempts: number
  last_error: string | null
  created_at: number
}

function toOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    kind: row.kind,
    mailbox: row.mailbox,
    uid: row.uid,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at
  }
}

export function enqueueOutbox(input: {
  kind: string
  payload?: unknown
  mailbox?: string | null
  uid?: number | null
}): string {
  const id = randomUUID()
  handle()
    .prepare(
      `INSERT INTO outbox (id, kind, mailbox, uid, payload, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)`
    )
    .run(
      id,
      input.kind,
      input.mailbox ?? null,
      input.uid ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
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
  patch: { status?: string; attempts?: number; lastError?: string | null }
): void {
  const current = getOutbox(id)
  if (!current) return
  handle()
    .prepare('UPDATE outbox SET status = ?, attempts = ?, last_error = ? WHERE id = ?')
    .run(
      patch.status ?? current.status,
      patch.attempts ?? current.attempts,
      patch.lastError === undefined ? current.lastError : patch.lastError,
      id
    )
}

export function deleteOutbox(id: string): void {
  handle().prepare('DELETE FROM outbox WHERE id = ?').run(id)
}

export function countUnread(mailbox: string): number {
  const row = handle()
    .prepare('SELECT COUNT(*) AS total FROM messages WHERE mailbox = ? AND unread = 1')
    .get(mailbox) as unknown as { total: number }
  return row.total
}

export function countMessages(mailbox: string): number {
  const row = handle()
    .prepare('SELECT COUNT(*) AS total FROM messages WHERE mailbox = ?')
    .get(mailbox) as unknown as { total: number }
  return row.total
}

/** UID más bajo cacheado: desde ahí se sigue bajando en la sync completa. */
export function lowestUid(mailbox: string): number | null {
  const row = handle()
    .prepare('SELECT MIN(uid) AS uid FROM messages WHERE mailbox = ?')
    .get(mailbox) as unknown as { uid: number | null }
  return row.uid ?? null
}

export interface CachedBody {
  text: string | null
  html: string | null
  to: { name: string; address: string }[]
  cc: { name: string; address: string }[]
  attachments: { name: string; size: number; type: string }[]
  fetched: boolean
}

export function missingBodyUids(mailbox: string): number[] {
  const rows = handle().prepare('SELECT uid FROM messages WHERE mailbox = ? AND body_text IS NULL AND body_html IS NULL')
    .all(mailbox) as { uid: number }[]
  return rows.map(row => row.uid)
}

export function countBodies(mailbox: string): number {
  const row = handle().prepare('SELECT COUNT(*) AS count FROM messages WHERE mailbox = ? AND (body_text IS NOT NULL OR body_html IS NOT NULL)')
    .get(mailbox) as { count: number }
  return row.count
}

export function readBody(mailbox: string, uid: number): CachedBody {
  const row = handle()
    .prepare('SELECT body_text, body_html, to_json, cc_json, attachments_json FROM messages WHERE mailbox = ? AND uid = ?')
    .get(mailbox, uid) as unknown as (MessageRow & { attachments_json: string | null }) | undefined

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

  return {
    text: row?.body_text ?? null,
    html: row?.body_html ?? null,
    to: parseAddresses(row?.to_json ?? null),
    cc: parseAddresses(row?.cc_json ?? null),
    attachments: parseAttachments(row?.attachments_json ?? null),
    fetched: row != null && (row.body_text !== null || row.body_html !== null)
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
    attachments: { name: string; size: number; type: string }[]
  }
): void {
  handle()
    .prepare(
      `UPDATE messages SET body_text = ?, body_html = ?, to_json = ?, cc_json = ?, attachments_json = ?
       WHERE mailbox = ? AND uid = ?`
    )
    .run(
      body.text,
      body.html,
      JSON.stringify(body.to),
      JSON.stringify(body.cc),
      JSON.stringify(body.attachments),
      mailbox,
      uid
    )

  // El cuerpo recién descargado entra al índice de búsqueda.
  reindexMessage(mailbox, uid)
}

/** Reindexa un mensaje (asunto, remitentes y cuerpo si ya se descargó). */
export function reindexMessage(mailbox: string, uid: number): void {
  const database = handle()
  const row = database
    .prepare('SELECT subject, from_name, from_addr, body_text FROM messages WHERE mailbox = ? AND uid = ?')
    .get(mailbox, uid) as unknown as
    | { subject: string; from_name: string; from_addr: string; body_text: string | null }
    | undefined

  database.prepare('DELETE FROM search WHERE mailbox = ? AND uid = ?').run(mailbox, uid)
  if (!row) return

  const peers = [row.from_name, row.from_addr].filter((part) => part !== '').join(' ')
  database
    .prepare('INSERT INTO search (subject, peers, body, mailbox, uid) VALUES (?, ?, ?, ?, ?)')
    .run(row.subject, peers, row.body_text ?? '', mailbox, uid)
}

/** Convierte lo que escribe el usuario en una consulta FTS5 segura (prefijos). */
function toFtsQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/["'()*:^~{}[\]-]/g, ''))
    .filter((token) => token.length > 0)
  return tokens.map((token) => `"${token}"*`).join(' ')
}

export function searchMessages(query: string, limit: number, offset = 0): {
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
  const expression = toFtsQuery(query)
  if (expression === '') return []

  const rows = handle()
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
       WHERE search MATCH ?
       ORDER BY m.date DESC, search.mailbox ASC, search.uid DESC
       LIMIT ? OFFSET ?`
    )
    .all(expression, limit, offset) as unknown as {
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
  const placeholders = uids.map(() => '?').join(',')
  const rows = handle()
    .prepare(
      `SELECT mailbox, uid, subject, from_name, from_addr, to_json
       FROM messages WHERE mailbox = ? AND uid IN (${placeholders})`
    )
    .all(mailbox, ...uids) as unknown as {
    mailbox: string
    uid: number
    subject: string
    from_name: string
    from_addr: string
    to_json: string | null
  }[]
  return rows.map(mapMessage)
}

export function allCachedMessages(limit: number = 5000): CachedMessage[] {
  const rows = handle()
    .prepare(
      `SELECT mailbox, uid, subject, from_name, from_addr, to_json
       FROM messages WHERE mailbox NOT IN (SELECT path FROM mailboxes WHERE special_use = '\\Sent')
       ORDER BY date DESC LIMIT ?`
    )
    .all(limit) as unknown as {
    mailbox: string
    uid: number
    subject: string
    from_name: string
    from_addr: string
    to_json: string | null
  }[]
  return rows.map(mapMessage)
}

/** Sobres anteriores a la detección de adjuntos: se actualizan sin descargar cuerpos. */
export function missingEnvelopeMetadata(mailbox: string): number[] {
  const rows = handle().prepare('SELECT uid FROM messages WHERE mailbox = ? AND (has_attachments IS NULL OR priority IS NULL)')
    .all(mailbox) as unknown as { uid: number }[]
  return rows.map(row => row.uid)
}

function accountCacheFile(accountId: string): string {
  const safe = accountId.replace(/[^a-z0-9_-]/gi, '')
  return accountId === 'default' || safe === '' ? 'cache.db' : `cache-${safe}.db`
}

export async function cacheUsage(accounts: readonly { id: string }[]): Promise<CacheUsage> {
  const directory = app.getPath('userData')
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
  if (openedAccountId === accountId) closeCache()
  const file = join(app.getPath('userData'), accountCacheFile(accountId))
  for (const suffix of ['-wal', '-shm', '-journal', '']) await rm(file + suffix, { force: true })
}

/** Libera cuerpos descargados sin tocar sobres, borradores, reglas ni la cola. */
export async function clearAccountCache(accountId: string): Promise<void> {
  const file = join(app.getPath('userData'), accountCacheFile(accountId))
  try {
    await stat(file)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
  const database = new DatabaseSync(file)
  try {
    database.exec('BEGIN IMMEDIATE')
    try {
      const columns = database.prepare('PRAGMA table_info(messages)').all() as unknown as { name: string }[]
      const attachments = columns.some(column => column.name === 'attachments_json') ? ', attachments_json = NULL' : ''
      database.exec(`UPDATE messages SET body_text = NULL, body_html = NULL${attachments}`)
      if (database.prepare("SELECT name FROM sqlite_master WHERE name = 'search'").get()) {
        database.exec("UPDATE search SET body = ''; INSERT INTO search(search) VALUES('rebuild')")
      }
      database.exec('COMMIT')
    } catch (cause) {
      database.exec('ROLLBACK')
      throw cause
    }
    database.exec('VACUUM')
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    database.close()
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
  return handle().prepare(`
    SELECT email, MAX(name) AS name FROM (
      SELECT email, '' AS name, uses AS score, updated_at AS recent FROM recipient_cache
      UNION ALL
      SELECT lower(from_addr) AS email, from_name AS name, 0 AS score, MAX(date) AS recent
      FROM messages WHERE from_addr != '' GROUP BY lower(from_addr), from_name
    ) WHERE instr(lower(email || ' ' || name), ?) > 0
    GROUP BY email ORDER BY MAX(score) DESC, MAX(recent) DESC, email LIMIT 8
  `).all(query.trim().toLowerCase()) as unknown as RecipientSuggestion[]
}
