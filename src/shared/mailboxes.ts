export function isSpamMailbox(mailbox: { path: string; name?: string; specialUse?: string | null }): boolean {
  if (mailbox.specialUse === '\\Junk') return true
  return [mailbox.name ?? '', ...mailbox.path.split(/[\/\\]/)].some((name) =>
    /^(spam|junk|junk e-?mail|correo no deseado|correo basura|bulk mail)$/i.test(name.trim())
  )
}

