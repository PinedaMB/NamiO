import type { Envelope } from '@shared/ipc'
import { readSettings, writeSettings } from './settings'

export interface MailNotificationCursor {
  uidValidity: number
  uidNext: number
}

let tracking: Promise<unknown> = Promise.resolve()

/** Guarda el límite por cuenta antes de avisar, compartido por ambas formas de sincronizar. */
export function trackNewMail(accountId: string, cursor: MailNotificationCursor, messages: Envelope[], baseline?: MailNotificationCursor, reset = false): Promise<Envelope[]> {
  const run = tracking.then(async () => {
    const settings = await readSettings()
    // Un correo puede llegar entre STATUS y FETCH; incluímos esos UID en el límite.
    const next = messages.reduce((value, message) => Math.max(value, message.uid + 1), cursor.uidNext)
    const stored = settings.mailNotificationCursors?.[accountId]
    const previous = stored ?? baseline
    if (!reset && stored?.uidValidity === cursor.uidValidity && stored.uidNext >= next) return []
    const fresh = !reset && previous?.uidValidity === cursor.uidValidity
      ? messages.filter(message => message.unread && message.uid >= previous.uidNext)
      : []
    await writeSettings(current => ({
      mailNotificationCursors: { ...current.mailNotificationCursors, [accountId]: { ...cursor, uidNext: next } }
    }))
    return fresh
  })
  tracking = run.catch(() => undefined)
  return run
}
