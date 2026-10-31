import type { TimeFormat } from '@shared/ipc'

function validDate(value: string | number): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const regionFor = (locale: string): string => locale.startsWith('es') ? 'es-MX' : 'en-US'

// Los formateadores son caros de construir y la lista los usa por celda. Se
// memorizan por región + opciones; el número de combinaciones es pequeño.
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()

function cached<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const existing = cache.get(key)
  if (existing) return existing
  const value = create()
  cache.set(key, value)
  return value
}

const dateTimeFormat = (region: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
  cached(dateFormatters, `${region}:${zoneKey()}:${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(region, options))

/**
 * El formateador captura la zona al construirse. En la app no cambia, pero las
 * pruebas y algunas herramientas ajustan `TZ` en caliente; incluirla en la
 * clave evita devolver horas de la zona anterior.
 */
function zoneKey(): string {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } }
  const environment = runtime.process?.env?.['TZ'] ?? ''
  // El desfase también cambia con el horario de verano y en pruebas que ajustan TZ.
  return `${environment}:${new Date().getTimezoneOffset()}`
}

export function formatMessageDate(value: string | number, locale: string, now = Date.now(), timeFormat: TimeFormat = '24h'): string {
  const date = validDate(value)
  if (!date) return '—'
  const today = new Date(now)
  const region = regionFor(locale)
  const hourCycle = timeFormat === '12h' ? 'h12' : 'h23'
  if (date.toDateString() === today.toDateString()) {
    return dateTimeFormat(region, { hour: '2-digit', minute: '2-digit', hourCycle }).format(date)
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    const label = cached(relativeFormatters, region, () => new Intl.RelativeTimeFormat(region, { numeric: 'auto' })).format(-1, 'day')
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return dateTimeFormat(region, {
    day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {})
  }).format(date)
}

export function formatMessageDateTime(value: string | number, locale: string, compact = false, timeFormat: TimeFormat = '24h'): string {
  const date = validDate(value)
  if (!date) return '—'
  return dateTimeFormat(regionFor(locale), {
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
  const region = regionFor(locale)
  const formatter = cached(numberFormatters, `${region}:${unit}`, () =>
    new Intl.NumberFormat(region, { style: 'unit', unit, unitDisplay: 'long' }))
  return formatter.format(Math.floor(seconds / divisor))
}
