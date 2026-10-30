import type { TimeFormat } from '@shared/ipc'

function validDate(value: string | number): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const regionFor = (locale: string): string => locale.startsWith('es') ? 'es-MX' : 'en-US'

export function formatMessageDate(value: string | number, locale: string, now = Date.now(), timeFormat: TimeFormat = '24h'): string {
  const date = validDate(value)
  if (!date) return '—'
  const today = new Date(now)
  const region = regionFor(locale)
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(region, { hour: '2-digit', minute: '2-digit', hourCycle: timeFormat === '12h' ? 'h12' : 'h23' }).format(date)
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    const label = new Intl.RelativeTimeFormat(region, { numeric: 'auto' }).format(-1, 'day')
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return new Intl.DateTimeFormat(region, {
    day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {})
  }).format(date)
}

export function formatMessageDateTime(value: string | number, locale: string, compact = false, timeFormat: TimeFormat = '24h'): string {
  const date = validDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(regionFor(locale), {
    day: compact ? '2-digit' : 'numeric', month: compact ? '2-digit' : 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(compact ? { weekday: 'short' as const } : { timeZoneName: 'short' as const }),
    hourCycle: timeFormat === '12h' ? 'h12' : 'h23'
  }).format(date)
}

export function formatElapsed(milliseconds: number, locale: string): string {
  if (!Number.isFinite(milliseconds)) return '—'
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  // shortcut: meses de 30 días y años de 365 para el indicador relativo; usar calendario si se calculan plazos.
  const units: [Intl.NumberFormatOptions['unit'], number][] = [
    ['year', 365 * 86400], ['month', 30 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]
  ]
  const [unit, divisor] = units.find(([, size]) => seconds >= size) ?? ['second', 1]
  return new Intl.NumberFormat(regionFor(locale), { style: 'unit', unit, unitDisplay: 'long' }).format(Math.floor(seconds / divisor))
}
