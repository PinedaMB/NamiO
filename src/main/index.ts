import { join, resolve } from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import { registerIpcHandlers } from './ipc'

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d1014',
    autoHideMenuBar: true,
    title: 'NamiO',
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

  mainWindow.on('ready-to-show', () => mainWindow?.show())
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
            "img-src 'self' data: blob:",
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

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

void app.whenReady().then(() => {
  hardenSession()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
