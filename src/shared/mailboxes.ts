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
