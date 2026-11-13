import { resolveMx, resolveSrv } from 'node:dns/promises'
import { connect as tlsConnect } from 'node:tls'
import type { SmtpConfig } from '@shared/ipc'

export interface DiscoveredMailConfig {
  imap: { host: string; port: number; secure: boolean }
  smtp: SmtpConfig
  source: 'known' | 'autoconfig' | 'srv' | 'mx' | 'probe'
}

const KNOWN_DOMAINS: Record<string, { imap: { host: string; port: number; secure: boolean }; smtp: SmtpConfig }> = {
  'gmail.com': { imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } },
  'googlemail.com': { imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } },
  'outlook.com': { imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false } },
  'outlook.es': { imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false } },
  'hotmail.com': { imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false } },
  'hotmail.es': { imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false } },
  'live.com': { imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false } },
  'yahoo.com': { imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true } },
  'yahoo.es': { imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true } },
  'icloud.com': { imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false } },
  'me.com': { imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false } },
  'mac.com': { imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false } },
  'zoho.com': { imap: { host: 'imap.zoho.com', port: 993, secure: true }, smtp: { host: 'smtp.zoho.com', port: 465, secure: true } },
  'zohomail.com': { imap: { host: 'imap.zoho.com', port: 993, secure: true }, smtp: { host: 'smtp.zoho.com', port: 465, secure: true } },
  'fastmail.com': { imap: { host: 'imap.fastmail.com', port: 993, secure: true }, smtp: { host: 'smtp.fastmail.com', port: 465, secure: true } },
  'gmx.com': { imap: { host: 'imap.gmx.com', port: 993, secure: true }, smtp: { host: 'mail.gmx.com', port: 465, secure: true } },
  'gmx.net': { imap: { host: 'imap.gmx.net', port: 993, secure: true }, smtp: { host: 'mail.gmx.net', port: 465, secure: true } },
  'gmx.de': { imap: { host: 'imap.gmx.net', port: 993, secure: true }, smtp: { host: 'mail.gmx.net', port: 465, secure: true } },
  'aol.com': { imap: { host: 'imap.aol.com', port: 993, secure: true }, smtp: { host: 'smtp.aol.com', port: 465, secure: true } },
  'yandex.com': { imap: { host: 'imap.yandex.com', port: 993, secure: true }, smtp: { host: 'smtp.yandex.com', port: 465, secure: true } }
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`, 'i'))
  return match?.[1]?.trim() ?? ''
}

function parseAutoconfigXml(xml: string): DiscoveredMailConfig | null {
  const imapBlock = xml.match(/<incomingServer\b[^>]*type=["']imap["'][^>]*>([\s\S]*?)<\/incomingServer>/i)?.[1]
  const smtpBlock = xml.match(/<outgoingServer\b[^>]*type=["']smtp["'][^>]*>([\s\S]*?)<\/outgoingServer>/i)?.[1]
  if (!imapBlock || !smtpBlock) return null

  const imapHost = extractTag(imapBlock, 'hostname')
  const imapPort = Number(extractTag(imapBlock, 'port')) || 993
  const imapSocket = extractTag(imapBlock, 'socketType').toUpperCase()
  const smtpHost = extractTag(smtpBlock, 'hostname')
  const smtpPort = Number(extractTag(smtpBlock, 'port')) || 465
  const smtpSocket = extractTag(smtpBlock, 'socketType').toUpperCase()

  if (!imapHost || !smtpHost) return null
  return {
    imap: { host: imapHost, port: imapPort, secure: imapSocket === 'SSL' || imapPort === 993 },
    smtp: { host: smtpHost, port: smtpPort, secure: smtpSocket === 'SSL' || smtpPort === 465 },
    source: 'autoconfig'
  }
}

async function fetchAutoconfig(domain: string, email: string): Promise<DiscoveredMailConfig | null> {
  const urls = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
    `https://autoconfig.thunderbird.net/v1.1/${domain}`
  ]
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
      if (!response.ok) continue
      const parsed = parseAutoconfigXml(await response.text())
      if (parsed) return parsed
    } catch {
      // Siguiente fuente
    }
  }
  return null
}

async function lookupSrv(name: string): Promise<{ name: string; port: number } | null> {
  try {
    const records = await Promise.race([
      resolveSrv(name),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
    ])
    const sorted = [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight)
    const first = sorted[0]
    if (!first || !first.name || first.name === '.') return null
    return { name: first.name.replace(/\.$/, ''), port: first.port }
  } catch {
    return null
  }
}

async function discoverFromSrv(domain: string): Promise<DiscoveredMailConfig | null> {
  const [imaps, imap, submissions, submission] = await Promise.all([
    lookupSrv(`_imaps._tcp.${domain}`),
    lookupSrv(`_imap._tcp.${domain}`),
    lookupSrv(`_submissions._tcp.${domain}`),
    lookupSrv(`_submission._tcp.${domain}`)
  ])
  const incoming = imaps ? { host: imaps.name, port: imaps.port || 993, secure: true }
    : imap ? { host: imap.name, port: imap.port || 143, secure: false }
    : null
  const outgoing = submissions ? { host: submissions.name, port: submissions.port || 465, secure: true }
    : submission ? { host: submission.name, port: submission.port || 587, secure: false }
    : null
  if (!incoming || !outgoing) return null
  return { imap: incoming, smtp: outgoing, source: 'srv' }
}

async function discoverFromMx(domain: string): Promise<DiscoveredMailConfig | null> {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
    ])
    const exchanges = records.map((r) => r.exchange.toLowerCase())
    if (exchanges.some((mx) => mx.includes('google.com') || mx.includes('googlemail.com'))) {
      return { ...KNOWN_DOMAINS['gmail.com']!, source: 'mx' }
    }
    if (exchanges.some((mx) => mx.includes('outlook.com') || mx.includes('hotmail.com'))) {
      return { ...KNOWN_DOMAINS['outlook.com']!, source: 'mx' }
    }
    if (exchanges.some((mx) => mx.includes('zoho.com') || mx.includes('zoho.eu'))) {
      return { ...KNOWN_DOMAINS['zoho.com']!, source: 'mx' }
    }
    if (exchanges.some((mx) => mx.includes('fastmail.com') || mx.includes('messagingengine.com'))) {
      return { ...KNOWN_DOMAINS['fastmail.com']!, source: 'mx' }
    }
  } catch {
    // Sin MX resoluble
  }
  return null
}

function probeTls(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port, servername: host, timeout: 1500 }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => { socket.destroy(); resolve(false) })
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
  })
}

async function probeCommonHosts(domain: string): Promise<DiscoveredMailConfig | null> {
  const imapCandidates = [`imap.${domain}`, `mail.${domain}`]
  const smtpCandidates = [`smtp.${domain}`, `mail.${domain}`]
  const [imapHits, smtpHits] = await Promise.all([
    Promise.all(imapCandidates.map(async (host) => ((await probeTls(host, 993)) ? host : null))),
    Promise.all(smtpCandidates.map(async (host) => ((await probeTls(host, 465)) ? host : null)))
  ])
  const imapHost = imapHits.find(Boolean)
  const smtpHost = smtpHits.find(Boolean)
  if (!imapHost || !smtpHost) return null
  return {
    imap: { host: imapHost, port: 993, secure: true },
    smtp: { host: smtpHost, port: 465, secure: true },
    source: 'probe'
  }
}

export async function autodiscoverAccount(email: string): Promise<DiscoveredMailConfig | null> {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return null
  const domain = trimmed.slice(at + 1)
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null

  const known = KNOWN_DOMAINS[domain]
  if (known) return { ...known, source: 'known' }

  const autoconfig = await fetchAutoconfig(domain, trimmed)
  if (autoconfig) return autoconfig

  const srv = await discoverFromSrv(domain)
  if (srv) return srv

  const mx = await discoverFromMx(domain)
  if (mx) return mx

  return probeCommonHosts(domain)
}
