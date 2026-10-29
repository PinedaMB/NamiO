import { app, BrowserWindow, Notification } from 'electron'
import { execFile } from 'node:child_process'
import icon from '../../build/notification.png?asset'
import { IPC, type Envelope } from '@shared/ipc'
import { readAccounts, readSettings, type StoredAccount } from './settings'

// Conserva los objetos hasta que el sistema cierre o active el aviso.
const active = new Set<Notification>()

function show(title: string, body: string, silent: boolean, click?: () => void): void {
  if (!Notification.isSupported()) throw new Error('Notifications are not supported on this system')
  const linuxSound = process.platform === 'linux' && !silent
  const notification = new Notification({ title, body, icon, silent: silent || linuxSound })
  if (linuxSound) notification.once('show', () => {
    // shortcut: Linux requiere canberra-gtk-play; empaquetar audio si se soportan escritorios sin libcanberra.
    execFile('canberra-gtk-play', ['--id', 'message-new-email', '--description', 'NamiO'], { timeout: 5000 }, (error) => {
      if (error) console.warn('NamiO notification sound:', error.message)
    })
  })
  active.add(notification)
  notification.once('close', () => active.delete(notification))
  notification.once('failed', () => active.delete(notification))
  notification.once('click', () => {
    active.delete(notification)
    click?.()
  })
  notification.show()
}

export async function testNotification(): Promise<void> {
  const settings = await readSettings()
  const es = (settings.language ?? app.getLocale()).startsWith('es')
  show('NamiO', es ? 'Las notificaciones están listas.' : 'Notifications are ready.', settings.notificationSound === false)
}

export async function showNewMail(account: StoredAccount, path: string, messages: Envelope[], getWindow: () => BrowserWindow | null): Promise<void> {
  const settings = await readSettings()
  if (settings.notifications === false || messages.length === 0) return
  const { accounts } = await readAccounts()
  if (!accounts.some(item => item.id === account.id)) return
  const es = (settings.language ?? app.getLocale()).startsWith('es')
  const latest = messages[messages.length - 1]
  if (!latest) return
  const generic = es ? 'Tienes correo nuevo' : 'You have new mail'
  const line = (value: string | undefined, fallback: string, limit: number): string => (value?.replace(/\s+/g, ' ').trim() || fallback).slice(0, limit)
  const title = `NamiO · ${line(account.label || account.user, account.user, 80)}`
  const sender = line(latest.from?.name || latest.from?.address, es ? 'Remitente desconocido' : 'Unknown sender', 80)
  const subject = line(latest.subject, es ? 'Sin asunto' : 'No subject', 150)
  const body = settings.notificationPrivate !== false ? generic : messages.length > 1
    ? `${messages.length} ${es ? 'correos nuevos' : 'new messages'}\n${sender} — ${subject}`
    : `${sender}\n${subject}`
  show(title, body, settings.notificationSound === false, () => {
    void readAccounts().then(({ accounts }) => {
      const window = getWindow()
      if (!window || window.isDestroyed() || !accounts.some(item => item.id === account.id)) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      window.webContents.send(IPC.notificationOpen, {
        accountId: account.id, identity: JSON.stringify([account.host, account.port, account.user]), path, uid: latest.uid
      })
    }).catch(() => undefined)
  })
}
