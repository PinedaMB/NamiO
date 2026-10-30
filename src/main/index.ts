import { join, resolve } from 'node:path'
import { app, BrowserWindow, session, shell, nativeTheme } from 'electron'
import { setupBackground } from './background'
import { IPC } from '@shared/ipc'
import { closeCache, initCache } from './db'
import { checkAccountsActivity, setNewMailListener, setCacheListener, setRulesListener, setSyncProgressListener, syncInbox } from './imap'
import { showNewMail } from './notifications'
import { readActiveAccount, readSettings } from './settings'
import { registerIpcHandlers } from './ipc'
import { outboxItems, processOutbox, setOutboxListener } from './mail'
import { setupAutoUpdate } from './updater'
import icon from '../../build/icon.png?asset'

const isDev = !app.isPackaged

/**
 * Perfil de Chromium alternativo. Necesario en entornos donde %APPDATA% no es
 * escribible (contenedores, jobs de CI, terminales embebidas): Chromium no
 * falla con un error legible, directamente muere con ACCESS_VIOLATION.
 */
const userDataOverride = process.env['CORREO_USER_DATA_DIR']
if (userDataOverride) {
  app.setPath('userData', resolve(userDataOverride))
}

/** Una sola instancia: dos procesos peleando por la misma caché SQLite es un bug garantizado. */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function openWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 700,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f131c' : '#f5f6fb',
    autoHideMenuBar: true,
    title: 'NamiO',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Un cliente de correo procesa contenido hostil: estos cuatro flags no se tocan.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true
    }
  })

  // Ctrl+A se resuelve según el foco del lector, antes del menú nativo.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && !input.alt && !input.shift && input.key.toLowerCase() === 'r') event.preventDefault()
    mainWindow?.webContents.setIgnoreMenuShortcuts(input.type === 'keyDown' && (input.control || input.meta) && !input.alt && !input.shift && input.key.toLowerCase() === 'a')
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  void setupBackground(() => mainWindow, openWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Ningún link abre una ventana de Electron: siempre al navegador del sistema.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // La UI no navega nunca fuera de la app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      if (url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** CSP estricta en producción; en dev la relaja el servidor de Vite (HMR por websocket). */
function hardenSession(): void {
  if (isDev) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https: http:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'"
          ].join('; ')
        ]
      }
    })
  })

  // Permisos: nada por defecto. Cada uno se habilita cuando una feature lo justifique.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

app.on('second-instance', openWindow)

void app.whenReady().then(async () => {
  const { appTheme } = await readSettings()
  nativeTheme.themeSource = appTheme === 'light' || appTheme === 'dark' ? appTheme : 'system'
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0f131c' : '#f5f6fb')
  })
  app.setAppUserModelId('dev.namio.app')
  hardenSession()
  setupAutoUpdate()

  // La caché es por cuenta: se abre la de la cuenta activa antes de todo.
  void readActiveAccount()
    .then((account) => initCache(account?.id ?? 'default'))
    .catch(() => initCache('default'))

  registerIpcHandlers()
  setNewMailListener((account, path, messages) => {
    void showNewMail(account, path, messages, () => mainWindow).catch(() => undefined)
  })

  // El motor avisa cuando terminó de sincronizar; la UI recarga desde la caché.
  setCacheListener((mailbox) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.cacheChanged, mailbox)
    }
  })

  // Progreso de la sincronización completa (barra en el pie).
  setSyncProgressListener((progress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.syncProgress, progress)
    }
  })

  // Una regla encoló una acción (archivar, mover, marcar leído): drenar ya.
  setRulesListener(() => {
    void processOutbox()
  })

  // La cola de salida también avisa a la UI cuando cambia.
  let lastOutboxSignature = ''
  setOutboxListener(() => {
    const signature = JSON.stringify(outboxItems().map((item) => [item.id, item.status, item.attempts, item.deletionProgress]))
    if (signature === lastOutboxSignature) return
    lastOutboxSignature = signature
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.outboxChanged)
    }
  })

  // Reintento periódico: si quedó algo encolado sin red, se drena solo.
  setInterval(() => {
    void processOutbox()
  }, 60_000)

  // Sondeo de la bandeja: sin IDLE, esto mantiene la vista al día sin recargar.
  setInterval(() => {
    void syncInbox()
  }, 60_000)

  // Avisos de las cuentas inactivas: INBOX cada 3 minutos.
  const pushActivity = async (): Promise<void> => {
    try {
      const activity = await checkAccountsActivity()
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.accountsActivity, activity)
      }
    } catch {
      // sin red: se reintenta en el próximo ciclo
    }
  }
  setTimeout(() => void pushActivity(), 20_000)
  setInterval(() => void pushActivity(), 180_000)

  createWindow()

  app.on('activate', () => {
    openWindow()
  })
})

app.on('will-quit', () => {
  closeCache()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
