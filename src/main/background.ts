import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import icon from '../../build/icon.png?asset'
import { readSettings } from './settings'

let tray: Tray | null = null
let enabled = false
let quitting = false

export function setBackgroundMode(value: boolean): void {
  enabled = value
}

export async function setupBackground(getWindow: () => BrowserWindow | null, open: () => void): Promise<void> {
  const settings = await readSettings()
  enabled = settings.keepInBackground === true
  const es = (settings.language ?? app.getLocale()).startsWith('es')
  try {
    if (!tray) tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 22, height: 22 }))
    tray.setToolTip('NamiO')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: es ? 'Abrir NamiO' : 'Open NamiO', click: open },
      { type: 'separator' },
      { label: es ? 'Salir' : 'Quit', click: () => app.quit() }
    ]))
    tray.removeAllListeners('click')
    tray.on('click', open)
  } catch (error) {
    // Sin bandeja disponible se conserva el cierre normal para no ocultar una app inaccesible.
    tray?.destroy()
    tray = null
    console.warn('NamiO tray:', error)
  }
  const window = getWindow()
  window?.on('close', event => {
    if (enabled && tray && !quitting) {
      event.preventDefault()
      window.hide()
    }
  })
}

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => { tray?.destroy(); tray = null })
