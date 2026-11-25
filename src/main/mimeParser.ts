import { Worker } from 'node:worker_threads'
import { simpleParser, type ParsedMail } from 'mailparser'

const WORKER_THRESHOLD_BYTES = 64 * 1024

interface WorkerParsed {
  subject?: string
  text?: string
  html?: string | false
  inReplyTo?: string
  references?: string | string[]
  priority?: string
  to?: ParsedMail['to']
  cc?: ParsedMail['cc']
  bcc?: ParsedMail['bcc']
  attachments: {
    filename?: string
    contentType: string
    related?: boolean
    content: Uint8Array
  }[]
}

const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
const { simpleParser } = require('mailparser');
parentPort.on('message', async ({ id, raw }) => {
  try {
    const parsed = await simpleParser(Buffer.from(raw));
    const priority = parsed.headers?.get('priority');
    parentPort.postMessage({
      id,
      ok: true,
      result: {
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        priority: typeof priority === 'string' ? priority : undefined,
        to: parsed.to,
        cc: parsed.cc,
        bcc: parsed.bcc,
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          related: a.related,
          content: a.content ? new Uint8Array(a.content) : new Uint8Array(0)
        }))
      }
    });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
`

let worker: Worker | null = null
let requestSeq = 0
const pending = new Map<number, { resolve: (value: WorkerParsed) => void; reject: (reason: Error) => void }>()

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    const next = new Worker(WORKER_SOURCE, { eval: true })
    next.unref()
    next.on('message', (msg: { id: number; ok: boolean; result?: WorkerParsed; error?: string }) => {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.ok && msg.result) entry.resolve(msg.result)
      else entry.reject(new Error(msg.error ?? 'MIME worker failed'))
    })
    next.on('error', (error) => {
      for (const entry of pending.values()) entry.reject(error instanceof Error ? error : new Error(String(error)))
      pending.clear()
      worker = null
    })
    next.on('exit', () => {
      for (const entry of pending.values()) entry.reject(new Error('MIME worker exited'))
      pending.clear()
      worker = null
    })
    worker = next
    return worker
  } catch {
    return null
  }
}

/**
 * Parsea un mensaje MIME. Para payloads >= 64 KB usa un Worker Thread dedicado
 * para no bloquear el hilo principal de Electron; para mensajes pequeños o si el
 * worker no está disponible, usa `simpleParser` directamente.
 */
export async function parseMimeBuffer(raw: Buffer): Promise<ParsedMail> {
  if (raw.length < WORKER_THRESHOLD_BYTES) return simpleParser(raw)
  const w = getWorker()
  if (!w) return simpleParser(raw)
  const id = ++requestSeq
  const data = await new Promise<WorkerParsed>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, raw: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) })
  }).catch(() => null)
  if (!data) return simpleParser(raw)
  const headers = new Map<string, string>()
  if (data.priority) headers.set('priority', data.priority)
  return {
    ...data,
    headers,
    attachments: data.attachments.map(a => ({ ...a, content: Buffer.from(a.content) }))
  } as unknown as ParsedMail
}
