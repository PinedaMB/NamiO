import type { CalendarEvent } from './ipc'

/** Unfolds RFC 5545 folded lines (CRLF + space/tab). */
function unfold(raw: string): string[] {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

function parseIcsDate(value: string): string | null {
  const clean = value.trim()
  // YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(clean)
  if (dt) {
    const [, y, m, d, hh, mm, ss, z] = dt
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${z || ''}`
    const parsed = new Date(iso)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  // YYYYMMDD (all-day)
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(clean)
  if (day) {
    const [, y, m, d] = day
    return `${y}-${m}-${d}`
  }
  return null
}

function extractEmail(value: string): string | undefined {
  const match = /mailto:([^\s;,"'<>]+)/i.exec(value)
  return match ? match[1]!.trim() : undefined
}

function extractCn(params: string): string | undefined {
  const match = /CN=(?:"([^"]+)"|([^;:]+))/i.exec(params)
  const raw = match?.[1] ?? match?.[2]
  return raw ? unescapeIcs(raw) : undefined
}

/** Parsea el primer VEVENT de un archivo .ics / text/calendar. */
export function parseIcsEvent(raw: string): CalendarEvent | null {
  if (!raw || !/BEGIN:VEVENT/i.test(raw)) return null
  const lines = unfold(raw)
  let method: string | undefined
  let inEvent = false
  let uid = ''
  let summary = ''
  let start: string | null = null
  let end: string | null = null
  let location: string | undefined
  let organizerName: string | undefined
  let organizerEmail: string | undefined
  const attendees: { name?: string; email: string }[] = []

  for (const line of lines) {
    const upper = line.trim().toUpperCase()
    if (upper === 'BEGIN:VEVENT') { inEvent = true; continue }
    if (upper === 'END:VEVENT') { if (inEvent) break; continue }
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const left = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const semi = left.indexOf(';')
    const key = (semi === -1 ? left : left.slice(0, semi)).trim().toUpperCase()
    const params = semi === -1 ? '' : left.slice(semi + 1)

    if (!inEvent) {
      if (key === 'METHOD') method = value.trim().toUpperCase()
      continue
    }
    if (key === 'UID') uid = value.trim()
    else if (key === 'SUMMARY') summary = unescapeIcs(value)
    else if (key === 'DTSTART') start = parseIcsDate(value)
    else if (key === 'DTEND') end = parseIcsDate(value)
    else if (key === 'LOCATION') location = unescapeIcs(value) || undefined
    else if (key === 'ORGANIZER') {
      organizerEmail = extractEmail(value)
      organizerName = extractCn(params)
    } else if (key === 'ATTENDEE') {
      const email = extractEmail(value)
      if (email) attendees.push({ name: extractCn(params), email })
    }
  }

  if (!summary && !start) return null
  return {
    uid: uid || `ics-${Date.now()}`,
    summary: summary || '(Sin título)',
    start: start ?? '',
    end: end ?? undefined,
    location,
    organizerName,
    organizerEmail,
    method: method || 'REQUEST',
    attendees: attendees.slice(0, 20)
  }
}

/** Genera un bloque VCALENDAR iTIP METHOD:REPLY para aceptar/rechazar una invitación. */
export function buildIcsReply(
  event: CalendarEvent,
  attendeeEmail: string,
  status: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'
): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const fmtDate = (iso?: string): string | null => {
    if (!iso) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.replace(/-/g, '')
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  }
  const dtStart = fmtDate(event.start)
  const dtEnd = fmtDate(event.end)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NamiO//Mail Client//EN',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    ...(dtStart ? [`DTSTART:${dtStart}`] : []),
    ...(dtEnd ? [`DTEND:${dtEnd}`] : []),
    `SUMMARY:${event.summary.replace(/[\r\n]+/g, ' ')}`,
    ...(event.organizerEmail ? [`ORGANIZER:mailto:${event.organizerEmail}`] : []),
    `ATTENDEE;PARTSTAT=${status}:mailto:${attendeeEmail}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ]
  return `${lines.join('\r\n')}\r\n`
}

/** Parsea las cabeceras List-Unsubscribe y List-Unsubscribe-Post (RFC 2369 / RFC 8058). */
export function parseListUnsubscribe(
  headerValue: string | null | undefined,
  postHeaderValue?: string | null
): { url?: string; mailto?: string; oneClick?: boolean } | undefined {
  if (!headerValue || typeof headerValue !== 'string') return undefined
  const matches = [...headerValue.matchAll(/<([^>]+)>/g)].map(m => m[1]!.trim())
  const candidates = matches.length > 0 ? matches : [headerValue.trim()]
  let url: string | undefined
  let mailto: string | undefined
  for (const item of candidates) {
    if (!url && /^https:\/\//i.test(item)) url = item
    else if (!mailto && /^mailto:/i.test(item)) mailto = item
  }
  if (!url && !mailto) return undefined
  const oneClick = Boolean(url && postHeaderValue && /List-Unsubscribe\s*=\s*One-Click/i.test(postHeaderValue))
  return { ...(url ? { url } : {}), ...(mailto ? { mailto } : {}), ...(oneClick ? { oneClick: true } : {}) }
}

/** Analiza Authentication-Results (RFC 8601) y alerta solo ante fallos claros de DMARC o SPF+DKIM. */
export function parseAuthWarning(headerValue: string | null | undefined): 'dmarc-fail' | 'spf-dkim-fail' | undefined {
  if (!headerValue || typeof headerValue !== 'string') return undefined
  const lower = headerValue.toLowerCase()
  if (/\bdmarc\s*=\s*fail\b/.test(lower)) return 'dmarc-fail'
  if (/\bspf\s*=\s*(?:fail|softfail)\b/.test(lower) && /\bdkim\s*=\s*fail\b/.test(lower)) return 'spf-dkim-fail'
  return undefined
}
