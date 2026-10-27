import type { AccountConfig, Envelope, EnvelopeAddress, MailboxInfo, MessageDetail } from '@shared/ipc'
import type { Attachment, Message, Person, Thread } from './demo'

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

function formatTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = new Date().toDateString() === date.toDateString()
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(date)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentKind(name: string, type: string): Attachment['kind'] {
  const lower = name.toLowerCase()
  if (type.includes('pdf') || lower.endsWith('.pdf')) return 'pdf'
  if (type.includes('sheet') || /\.(xlsx?|csv|ods)$/.test(lower)) return 'sheet'
  if (type.includes('calendar') || lower.endsWith('.ics')) return 'calendar'
  return 'file'
}

export function envelopeToThread(envelope: Envelope, locale: string): Thread {
  const sender = personFrom(envelope.from)
  return {
    id: `live:${envelope.uid}`,
    subject: envelope.subject || '—',
    preview: '',
    receivedAt: formatTime(envelope.date, locale),
    unread: envelope.unread,
    starred: envelope.flagged,
    vip: false,
    messageCount: 1,
    tags: [],
    participants: [sender],
    messages: []
  }
}

export function detailToMessage(detail: MessageDetail, locale: string, partial = false): Message {
  const body = detail.text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')

  return {
    id: `live:${detail.uid}`,
    from: personFrom(detail.from),
    to: detail.to.map((address) => personFrom(address)),
    sentAt: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(detail.date)),
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

export function isSpamMailbox(mailbox: { path: string; name?: string; specialUse?: string | null }): boolean {
  if (mailbox.specialUse === '\\Junk') return true
  return [mailbox.name ?? '', ...mailbox.path.split(/[\/\\]/)].some((name) =>
    /^(spam|junk|junk e-?mail|correo no deseado|correo basura|bulk mail)$/i.test(name.trim())
  )
}

export function mailboxToFolder(mailbox: MailboxInfo): FolderView {
  // El contador de la carpeta es de NO LEÍDOS (como en cualquier cliente):
  // el total de mensajes no dice nada accionable.
  const spam = isSpamMailbox(mailbox)
  return {
    id: mailbox.path,
    spam,
    icon: spam ? 'report' : (mailbox.specialUse && SPECIAL_USE_ICON[mailbox.specialUse]) ?? 'folder',
    label: mailbox.name,
    count: mailbox.unseen > 0 ? mailbox.unseen : undefined,
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
