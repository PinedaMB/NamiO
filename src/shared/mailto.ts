import { validRecipients } from './mailAddresses'

export interface MailtoDraft {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
}

/** Only compose fields are accepted; external links cannot send mail or attach files. */
export function parseMailto(value: string): MailtoDraft | null {
  if (value.length > 65536 || !/^mailto:/i.test(value)) return null
  try {
    const url = new URL(value)
    const fields = new Map<string, string[]>()
    // URLSearchParams treats literal + as a space, but mailto addresses can contain +.
    for (const [key, text] of new URLSearchParams(url.search.replace(/\+/g, '%2B'))) {
      const name = key.toLowerCase()
      fields.set(name, [...(fields.get(name) ?? []), text])
    }
    const recipients = (key: string): string => [key === 'to' ? decodeURIComponent(url.pathname) : '', ...(fields.get(key) ?? [])].filter(Boolean).join(', ')
    const draft = { to: recipients('to'), cc: recipients('cc'), bcc: recipients('bcc'), subject: fields.get('subject')?.[0] ?? '', body: fields.get('body')?.[0] ?? '' }
    if ([draft.to, draft.cc, draft.bcc].some(text => /[\r\n\0]/.test(text) || (text !== '' && !validRecipients(text)))) return null
    if (/[\r\n\0]/.test(draft.subject) || draft.body.includes('\0')) return null
    return draft
  } catch {
    return null
  }
}
