import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import { isSpamMailbox } from '@shared/mailboxes'
import { readMailboxes } from './db'
import { readSettings } from './settings'

const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.es', 'hotmail.com', 'hotmail.es', 'live.com', 'live.com.mx', 'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me'])
const requests = new Map<string, Promise<string | null>>()

export async function senderLogo(email: string, mailbox: string): Promise<string | null> {
  if (typeof email !== 'string' || email.length > 320 || typeof mailbox !== 'string') return null
  const box = readMailboxes().find((item) => item.path === mailbox)
  if (!box || isSpamMailbox(box) || (await readSettings()).remoteImages !== 'allow') return null
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  if (!email.includes('@') || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || PERSONAL.has(domain)) return null
  let request = requests.get(domain)
  if (!request) {
    request = loadLogo(domain).catch(() => null)
    requests.set(domain, request)
  }
  return request
}

async function loadLogo(domain: string): Promise<string | null> {
  const directory = join(app.getPath('userData'), 'sender-icons')
  const path = join(directory, `${domain}.png`)
  const cached = await readFile(path).catch(() => null)
  if (cached) return `data:image/png;base64,${cached.toString('base64')}`

  // Un servicio fijo evita conectar directamente con servidores de remitentes desconocidos.
  const response = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, {
    signal: AbortSignal.timeout(5000), credentials: 'omit', referrerPolicy: 'no-referrer'
  })
  if (!response.ok || !response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 256 * 1024) { await reader.cancel(); return null }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const image = nativeImage.createFromBuffer(Buffer.concat(chunks))
  if (image.isEmpty()) return null
  const png = image.resize({ width: 64, height: 64 }).toPNG()
  await mkdir(directory, { recursive: true })
  await writeFile(path, png)
  return `data:image/png;base64,${png.toString('base64')}`
}
