import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import type { Envelope, MailboxInfo } from '@shared/ipc'

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

export function initCache(): void {
  if (db) return

  db = new DatabaseSync(join(app.getPath('userData'), 'cache.db'))
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
  `)

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

export function upsertEnvelopes(mailbox: string, envelopes: readonly Envelope[]): void {
  const database = handle()
  const statement = database.prepare(`
    INSERT INTO messages (mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mailbox, uid) DO UPDATE SET
      subject = excluded.subject,
      from_name = excluded.from_name,
      from_addr = excluded.from_addr,
      date = excluded.date,
      size = excluded.size,
      unread = excluded.unread,
      flagged = excluded.flagged
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
        envelope.flagged ? 1 : 0
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function readEnvelopes(mailbox: string, limit: number): Envelope[] {
  const rows = handle()
    .prepare(
      `SELECT mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged
       FROM messages WHERE mailbox = ? ORDER BY date DESC, uid DESC LIMIT ?`
    )
    .all(mailbox, limit) as unknown as MessageRow[]

  return rows.map((row) => ({
    uid: row.uid,
    subject: row.subject,
    from: row.from_addr ? { name: row.from_name, address: row.from_addr } : null,
    date: new Date(row.date).toISOString(),
    unread: row.unread === 1,
    flagged: row.flagged === 1,
    size: row.size
  }))
}

export function readEnvelope(mailbox: string, uid: number): Envelope | null {
  const row = handle()
    .prepare(
      `SELECT mailbox, uid, subject, from_name, from_addr, date, size, unread, flagged
       FROM messages WHERE mailbox = ? AND uid = ?`
    )
    .get(mailbox, uid) as unknown as MessageRow | undefined

  if (!row) return null
  return {
    uid: row.uid,
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

export function deleteMessageRow(mailbox: string, uid: number): void {
  handle().prepare('DELETE FROM messages WHERE mailbox = ? AND uid = ?').run(mailbox, uid)
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

export interface CachedBody {
  text: string | null
  html: string | null
  to: { name: string; address: string }[]
  cc: { name: string; address: string }[]
  attachments: { name: string; size: number; type: string }[]
  fetched: boolean
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
    fetched: Boolean(row?.body_text || row?.body_html)
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
