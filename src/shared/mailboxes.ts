import type { MailboxInfo } from './ipc'

export function isSpamMailbox(mailbox: { path: string; name?: string; specialUse?: string | null }): boolean {
  if (mailbox.specialUse === '\\Junk') return true
  return [mailbox.name ?? '', ...mailbox.path.split(/[\/\\]/)].some((name) =>
    /^(spam|junk|junk e-?mail|correo no deseado|correo basura|bulk mail)$/i.test(name.trim())
  )
}


/** Conserva la carpeta oficial y cualquier carpeta adicional que tenga contenido. */
export function sidebarMailboxes(mailboxes: readonly MailboxInfo[]): readonly MailboxInfo[] {
  if (!mailboxes.some(mailbox => mailbox.specialUse === '\\Junk')) return mailboxes
  return mailboxes.filter(mailbox =>
    mailbox.specialUse !== null ||
    !isSpamMailbox({ path: mailbox.name }) ||
    mailbox.messages !== 0 || mailbox.unseen !== 0 ||
    mailboxes.some(child => child.path !== mailbox.path &&
      (child.path.startsWith(`${mailbox.path}/`) || child.path.startsWith(`${mailbox.path}\\`)))
  )
}

export function isDraftMailbox(mailbox: { path: string; name?: string; specialUse?: string | null }): boolean {
  return mailbox.specialUse === '\\Drafts' || /^(drafts?|borradores)$/i.test(mailbox.name ?? mailbox.path.split('/').at(-1) ?? '')
}

export function isTrashMailbox(mailbox: { path: string; name?: string; specialUse?: string | null }): boolean {
  if (mailbox.specialUse === '\\Trash') return true
  return [mailbox.name ?? '', ...mailbox.path.split(/[\/\\]/)].some((name) =>
    /^(trash|deleted items|deleted messages|papelera|elementos eliminados)$/i.test(name.trim())
  )
}

export interface OrganizedMailbox {
  mailbox: MailboxInfo
  /** 0 para raíces; 1+ para subcarpetas. */
  depth: number
}

function parentPath(path: string): string | null {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : null
}

function rootRank(mailbox: MailboxInfo): number {
  const special = (mailbox.specialUse ?? '').toLowerCase()
  const name = `${mailbox.name} ${mailbox.path}`.toLowerCase()
  if (special === '\\inbox' || /(^|\s)inbox$/i.test(mailbox.path)) return 0
  if (isDraftMailbox(mailbox)) return 1
  if (special === '\\sent' || /\b(sent|enviados|sent items)\b/i.test(name)) return 2
  if (special === '\\archive' || /\b(archive|archivo|archivados)\b/i.test(name)) return 3
  if (isSpamMailbox(mailbox)) return 4
  if (isTrashMailbox(mailbox)) return 5
  if (special === '\\outbox' || /\b(outbox|bandeja de salida)\b/i.test(name)) return 6
  return 10
}

/**
 * Ordena el rail: especiales primero, luego las carpetas personales en árbol.
 * Las subcarpetas se muestran debajo de su padre y con `depth` para indentarlas.
 */
export function organizedSidebarMailboxes(mailboxes: readonly MailboxInfo[]): readonly OrganizedMailbox[] {
  const visible = sidebarMailboxes(mailboxes)
  const byPath = new Map(visible.map((mailbox) => [mailbox.path, mailbox]))
  const children = new Map<string, MailboxInfo[]>()
  const roots: MailboxInfo[] = []

  for (const mailbox of visible) {
    const parent = parentPath(mailbox.path)
    if (parent && byPath.has(parent)) {
      const list = children.get(parent)
      if (list) list.push(mailbox)
      else children.set(parent, [mailbox])
    } else {
      roots.push(mailbox)
    }
  }

  const byName = (a: MailboxInfo, b: MailboxInfo): number => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  const ordered: OrganizedMailbox[] = []
  const visit = (mailbox: MailboxInfo, depth: number): void => {
    ordered.push({ mailbox, depth })
    for (const child of (children.get(mailbox.path) ?? []).sort(byName)) visit(child, depth + 1)
  }
  roots.sort((a, b) => rootRank(a) - rootRank(b) || byName(a, b))
  for (const root of roots) visit(root, 0)
  return ordered
}
