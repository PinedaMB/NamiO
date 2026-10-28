import { isDraftMailbox, isSpamMailbox } from '@shared/mailboxes'
export { isSpamMailbox } from '@shared/mailboxes'
import type { AccountConfig, Draft, Envelope, EnvelopeAddress, MailboxInfo, MessageDetail } from '@shared/ipc'
import type { Attachment, Message, Person, Thread } from './demo'
import { formatMessageDate, formatMessageDateTime } from '../lib/dates'

/** Cuenta que la UI usa para pintar el rail izquierdo. */
export interface FolderView {
  id: string
  icon: string
  label: string
  count?: number
  accent?: boolean
  spam?: boolean
}

function initialsOf(name: string, address: string): string {
  // Solo partes con letras: "testuser@127.0.0.1" no debe dar "T1".
  const source = (name.trim() || address).split(/[\s.@_-]+/).filter((part) => /[a-z]/i.test(part))
  const first = source[0]?.[0] ?? address[0] ?? '?'
  const second = source[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}

function personFrom(address: EnvelopeAddress | null, fallbackEmail = ''): Person {
  const email = address?.address ?? fallbackEmail
  const name = address?.name?.trim() || email
  return {
    name,
    email,
    initials: initialsOf(address?.name ?? '', email),
    org: address?.name?.trim() ? email : undefined
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentKind(name: string, type: string): Attachment['kind'] {
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon)$/i.test(type)) return 'image'
  const lower = name.toLowerCase()
  if (type === 'text/plain' || (type === 'application/octet-stream' && lower.endsWith('.txt'))) return 'text'
  if (type.includes('pdf') || lower.endsWith('.pdf')) return 'pdf'
  if (type.includes('sheet') || /\.(xlsx?|csv|ods)$/.test(lower)) return 'sheet'
  if (type.includes('calendar') || lower.endsWith('.ics')) return 'calendar'
  return 'file'
}

export function envelopeToThread(envelope: Envelope, locale: string): Thread {
  const sender = personFrom(envelope.from)
  return {
    id: `live:${envelope.uid}`,
    hasAttachments: envelope.hasAttachments,
    subject: envelope.subject || '—',
    preview: '',
    date: envelope.date,
    receivedAt: formatMessageDate(envelope.date, locale),
    unread: envelope.unread,
    starred: envelope.flagged,
    priority: envelope.priority,
    vip: false,
    messageCount: 1,
    tags: [],
    participants: [sender],
    messages: []
  }
}

/** Relaciona respuestas por sus cabeceras, nunca solo por un asunto parecido. */
// shortcut: solo sobres cargados de la carpeta; ampliar la búsqueda para incluir Enviados y otras carpetas.
export function envelopesToThreads(envelopes: Envelope[], locale: string): Thread[] {
  const parents = new Map<string, string>()
  const root = (id: string): string => {
    let current = id
    while (parents.has(current)) current = parents.get(current)!
    return current
  }
  for (const envelope of envelopes) {
    if (!envelope.messageId || !envelope.inReplyTo) continue
    const child = root(envelope.messageId)
    const parent = root(envelope.inReplyTo)
    if (child !== parent) parents.set(child, parent)
  }
  const groups = new Map<string, Envelope[]>()
  for (const envelope of envelopes) {
    const key = envelope.messageId ? root(envelope.messageId) : `uid:${envelope.uid}`
    const group = groups.get(key) ?? []
    group.push(envelope)
    groups.set(key, group)
  }
  return envelopes.map(envelope => {
    const key = envelope.messageId ? root(envelope.messageId) : `uid:${envelope.uid}`
    const group = groups.get(key)!
    const messageIds = [...group].sort((a, b) => {
      const left = Date.parse(a.date)
      const right = Date.parse(b.date)
      if (Number.isNaN(left)) return Number.isNaN(right) ? a.uid - b.uid : 1
      if (Number.isNaN(right)) return -1
      return left - right || a.uid - b.uid
    }).map(item => item.uid)
    return { ...envelopeToThread(envelope, locale), messageIds, messageCount: messageIds.length }
  })
}

export function detailToMessage(detail: MessageDetail, locale: string, partial = false): Message {
  const body = detail.text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')

  return {
    priority: detail.priority,
    id: `live:${detail.uid}`,
    messageId: detail.messageId,
    inReplyTo: detail.inReplyTo,
    from: personFrom(detail.from),
    to: detail.to.map((address) => personFrom(address)),
    date: detail.date,
    sentAt: formatMessageDateTime(detail.date, locale),
    body: body.length > 0 ? body : [''],
    html: detail.html ?? undefined,
    partial,
    attachments: detail.attachments.map((attachment) => ({
      name: attachment.name,
      size: formatBytes(attachment.size),
      detail: attachment.type,
      kind: attachmentKind(attachment.name, attachment.type)
    }))
  }
}

const SPECIAL_USE_ICON: Record<string, string> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'send',
  '\\Drafts': 'draft',
  '\\Trash': 'delete',
  '\\Junk': 'report',
  '\\Archive': 'archive',
  '\\All': 'all_inbox',
  '\\Flagged': 'star'
}

export function mailboxToFolder(mailbox: MailboxInfo): FolderView {
  // Papelera muestra el total; las demás carpetas muestran los no leídos.
  const spam = isSpamMailbox(mailbox)
  const trash = mailbox.specialUse === '\\Trash' ||
    /^(trash|deleted items|deleted messages|papelera|elementos eliminados)$/i.test(mailbox.name) ||
    /(^|\/)(trash|deleted items|papelera)$/i.test(mailbox.path)
  const count = trash || isDraftMailbox(mailbox) ? mailbox.messages : mailbox.unseen
  return {
    id: mailbox.path,
    spam,
    icon: spam ? 'report' : (mailbox.specialUse && SPECIAL_USE_ICON[mailbox.specialUse]) ?? 'folder',
    label: mailbox.name,
    count: count > 0 ? count : undefined,
    accent: mailbox.specialUse === '\\Inbox' || mailbox.path.toUpperCase() === 'INBOX'
  }
}

export function configFromAccount(account: AccountConfig | null): AccountConfig {
  return (
    account ?? {
      host: '',
      port: 993,
      secure: true,
      user: '',
      smtp: { host: '', port: 465, secure: true }
    }
  )
}

export function pendingDraftThreads(threads: readonly Thread[], drafts: readonly Draft[], path: string, locale: string, label: string): Thread[] {
  const pending = drafts.filter(draft => !draft.server || draft.syncedAt !== draft.updatedAt || draft.previousServer)
  const replaced = new Set(pending.flatMap(draft => [draft.server, draft.previousServer]
    .filter(reference => reference?.path === path).map(reference => `live:${reference!.uid}`)))
  return [...pending.map(draft => ({
    id: `draft:${draft.id}`, subject: draft.subject || label, preview: draft.body.slice(0, 120),
    date: draft.updatedAt,
    receivedAt: formatMessageDate(draft.updatedAt, locale),
    priority: draft.priority, unread: false, starred: false, vip: false, messageCount: 1, tags: [],
    participants: [personFrom(null, draft.to || label)],
    messages: [{ id: `draft:${draft.id}`, from: personFrom(null, label), to: [], date: draft.updatedAt, sentAt: formatMessageDateTime(draft.updatedAt, locale), body: [draft.body], html: draft.html }], hasAttachments: Boolean(draft.attachments?.length)
  })), ...threads.filter(thread => !replaced.has(thread.id)).map(thread => ({ ...thread, messageIds: undefined, messageCount: 1 }))]
}
