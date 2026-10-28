import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import { simpleParser } from 'mailparser'
import type { Draft } from '@shared/ipc'
import { cacheAccountId, clearDraft, deleteOutbox, enqueueOutbox, listDrafts, listOutbox, readDraft, readPickedAttachment, saveDraft, storePickedAttachment, updateOutbox } from './db'
import { downloadDraft, notifyDraftsChanged, uploadDraft } from './imap'
import { readActiveAccount } from './settings'

export function queueDraftSave(input: Draft): Draft {
  if (!input || ['to', 'cc', 'subject', 'body'].some(key => typeof input[key as 'to'] !== 'string')) throw new Error('Borrador inválido')
  if (input.priority !== undefined && !['high', 'normal', 'low'].includes(input.priority)) throw new Error('Importancia inválida')
  if (input.id !== undefined && !/^[a-z0-9-]{1,80}$/i.test(input.id)) throw new Error('Identificador de borrador inválido')
  if (input.html !== undefined && typeof input.html !== 'string') throw new Error('HTML de borrador inválido')
  if ((input.inReplyTo !== undefined && (typeof input.inReplyTo !== 'string' || /[\r\n]/.test(input.inReplyTo))) || (input.references !== undefined && (!Array.isArray(input.references) || input.references.some(id => typeof id !== 'string' || /[\r\n]/.test(id))))) throw new Error('Cabeceras de borrador inválidas')
  if (input.bcc !== undefined && typeof input.bcc !== 'string') throw new Error('CCO inválido')
  if (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.some(file => typeof file?.id !== 'string' || !readPickedAttachment(file.id)))) throw new Error('Falta un adjunto del borrador')
  const existing = input.id ? readDraft(input.id) : null
  const draft: Draft = { ...input, id: input.id ?? randomUUID(), server: existing?.server, previousServer: existing?.previousServer, syncedAt: existing?.syncedAt, updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1) }
  saveDraft(draft)
  const pending = listOutbox().find(row => row.kind === 'draft-save' && JSON.parse(row.payload ?? '{}').draftId === draft.id)
  if (pending) updateOutbox(pending.id, { status: 'queued', attempts: 0, lastError: null })
  else enqueueOutbox({ kind: 'draft-save', payload: { draftId: draft.id } })
  notifyDraftsChanged()
  return draft
}

export function queueDraftDelete(id?: string): void {
  const draft = readDraft(id)
  if (!draft) return
  for (const row of listOutbox()) if (row.kind === 'draft-save' && JSON.parse(row.payload ?? '{}').draftId === draft.id) deleteOutbox(row.id)
  for (const server of [draft.previousServer, draft.server]) if (server) enqueueOutbox({ kind: 'draft-delete', payload: { server } })
  clearDraft(draft.id)
  notifyDraftsChanged()
}

export async function syncDraft(id: string): Promise<void> {
  const owner = cacheAccountId()
  const draft = readDraft(id)
  if (!draft) return
  const account = await readActiveAccount()
  if (!account || account.id !== owner || owner !== cacheAccountId()) throw new Error('La cuenta activa cambió')
  const messageId = `<namio-draft-${draft.id}-${draft.updatedAt}@namio.local>`
  const message = new MailComposer({
    from: account.user, to: draft.to, cc: draft.cc, bcc: draft.bcc,
    subject: draft.subject, text: draft.body, html: draft.html,
    messageId, inReplyTo: draft.inReplyTo, references: draft.references,
    headers: { 'X-NamiO-Draft-Id': draft.id!, Importance: draft.priority ?? 'normal' },
    attachments: (draft.attachments ?? []).map(file => {
      const stored = readPickedAttachment(file.id)
      if (!stored) throw new Error('Falta un adjunto del borrador')
      return { filename: stored.name, content: Buffer.from(stored.data) }
    })
  }).compile()
  message.keepBcc = true // Los otros dispositivos necesitan recuperar también los destinatarios CCO del borrador.
  const raw = await message.build()
  if (owner !== cacheAccountId()) throw new Error('La cuenta activa cambió')
  await uploadDraft(draft, raw, messageId)
}

export async function openServerDraft(path: string, uid: number): Promise<Draft> {
  if (typeof path !== 'string' || !Number.isInteger(uid) || uid <= 0) throw new Error('Borrador inválido')
  const existing = listDrafts().find(draft => draft.server?.path === path && draft.server.uid === uid)
  if (existing) return existing
  const owner = cacheAccountId()
  const { raw, server } = await downloadDraft(path, uid)
  const parsed = await simpleParser(raw)
  const priority = parsed.headers.get('priority')
  if (owner !== cacheAccountId()) throw new Error('La cuenta activa cambió')
  const id = randomUUID()
  const addresses = (entry: typeof parsed.to): string => (entry ? Array.isArray(entry) ? entry : [entry] : [])
    .flatMap(item => item.value.map(value => value.address ?? '')).filter(Boolean).join(', ')
  const updatedAt = Date.now()
  const draft: Draft = {
    id, server, priority: priority === 'high' || priority === 'low' ? priority : 'normal', to: addresses(parsed.to), cc: addresses(parsed.cc), bcc: addresses(parsed.bcc),
    subject: parsed.subject ?? '', body: parsed.text ?? '', html: typeof parsed.html === 'string' ? parsed.html : undefined,
    inReplyTo: parsed.inReplyTo, references: typeof parsed.references === 'string' ? [parsed.references] : parsed.references,
    updatedAt, syncedAt: updatedAt,
    attachments: parsed.attachments.map(file => {
      const fileId = randomUUID()
      const name = file.filename ?? 'attachment'
      storePickedAttachment(fileId, name, file.content)
      return { id: fileId, name, size: file.content.length }
    })
  }
  saveDraft(draft)
  return draft
}
