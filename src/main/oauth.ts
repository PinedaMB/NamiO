import { createHash, randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell, BrowserWindow } from 'electron'
import type { OAuthConfig, OAuthProvider } from '@shared/ipc'
import { GOOGLE_CLIENT_ID } from '@shared/oauth'
import { GOOGLE_CLIENT_SECRET } from './googleOAuth'

/**
 * OAuth2 para clientes de escritorio, sin backend:
 * - PKCE (S256) para no depender de un secreto real.
 * - Redirect a un servidor efímero en 127.0.0.1 (los proveedores exigen loopback
 *   para apps nativas, y así no hay esquema propio registrado).
 * - El refresh token se guarda cifrado por el SO; el access token vive en memoria.
 */

export interface ProviderPreset {
  authUrl: string
  tokenUrl: string
  scope: string
}

/** Presets con los endpoints públicos de cada proveedor. */
export const PROVIDERS: Record<'google' | 'microsoft', ProviderPreset> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile https://mail.google.com/'
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope:
      'openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send'
  }
}

/** Los endpoints personalizados deben ir por TLS: el código y los tokens viajan ahí. */
function requireHttps(value: string, label: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} inválido`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${label} debe usar HTTPS`)
  return value
}

export function endpointsFor(config: OAuthConfig): ProviderPreset {
  if (config.provider === 'custom') {
    return {
      authUrl: config.authUrl ?? '',
      tokenUrl: config.tokenUrl ?? '',
      scope: config.scope ?? ''
    }
  }
  return PROVIDERS[config.provider]
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  /** Correo leído del id_token, si el proveedor lo expone. */
  email: string | null
}

const base64url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const pkce = (): { verifier: string; challenge: string } => {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Lee `email` del id_token (JWT sin firmar de verificar: llega por TLS del emisor). */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  const payload = idToken.split('.')[1]
  if (!payload) return null

  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const claims = JSON.parse(json) as { email?: string; preferred_username?: string; upn?: string }
    return claims.email ?? claims.preferred_username ?? claims.upn ?? null
  } catch {
    return null
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  error?: string
  error_description?: string
}

function clientCredentials(config: OAuthConfig): Record<string, string> {
  const secret = config.clientSecret || (config.provider === 'google' && config.clientId === GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_SECRET : '')
  return { client_id: config.clientId, ...(secret ? { client_secret: secret } : {}) }
}

async function postToken(endpoint: string, params: Record<string, string>): Promise<OAuthTokens> {
  requireHttps(endpoint, 'Endpoint de token')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params)
  })

  const data = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? `El proveedor respondió ${response.status}`)
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email: emailFromIdToken(data.id_token)
  }
}

/**
 * `shell.openExternal` no siempre lanza el navegador (asociaciones de Windows,
 * sesiones sin escritorio). Se usa primero el abridor nativo del sistema y,
 * como respaldo, `shell.openExternal`. El error final incluye la URL para poder
 * abrirla a mano.
 */
async function openAuthUrl(url: string): Promise<void> {
  const command: [string, string[]] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
  const run = (): Promise<void> => new Promise((resolve, reject) => {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true }) as ChildProcess
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`el abridor terminó con código ${code ?? 'desconocido'}`))
    })
  })

  let nativeError: unknown
  try {
    await run()
    return
  } catch (error) {
    nativeError = error
  }
  try {
    await shell.openExternal(url)
  } catch (shellError) {
    const detail = [nativeError, shellError].map((error) => error instanceof Error ? error.message : String(error)).join(' / ')
    throw new Error(`No se pudo abrir el navegador (${detail}). Abre esta URL a mano: ${url}`)
  }
}

/**
 * Flujo interactivo: levanta el loopback, abre el navegador y espera el `code`.
 * Devuelve los tokens ya canjeados.
 */
export async function authorize(config: OAuthConfig, timeoutMs = 300_000, onAuthUrl?: (url: string) => void): Promise<OAuthTokens> {
  const { authUrl, tokenUrl, scope } = endpointsFor(config)
  if (!authUrl || !tokenUrl) throw new Error('Faltan los endpoints OAuth del proveedor')
  requireHttps(authUrl, 'Endpoint de autorización')
  requireHttps(tokenUrl, 'Endpoint de token')

  const { verifier, challenge } = pkce()
  const state = base64url(randomBytes(16))
  let authWindow: BrowserWindow | null = null
  let settled = false
  const closeAuthWindow = (): void => {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close()
    authWindow = null
  }

  const callback = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        response.writeHead(404).end()
        return
      }

      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const receivedState = url.searchParams.get('state')

      // El state se valida primero: una petición de terceros no puede cancelar
      // el flujo ni consumir el callback antes que el proveedor legítimo.
      if (receivedState !== state) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('state inválido')
        return
      }

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><html lang="es"><meta charset="utf-8"><title>NamiO</title>` +
          `<body style="font-family:system-ui;background:#0f131c;color:#dfe2ee;display:grid;place-items:center;height:100vh;margin:0">` +
          `<div style="text-align:center"><h1 style="font-size:18px">${
            code ? 'Cuenta autorizada' : 'No se pudo autorizar'
          }</h1><p style="color:#908fa0">Ya puedes cerrar esta pestaña y volver a NamiO.</p></div></body></html>`
      )

      server.close()

      if (settled) return
      settled = true
      closeAuthWindow()

      if (error) {
        reject(new Error(error))
        return
      }
      if (!code) {
        reject(new Error('El proveedor no devolvió un código'))
        return
      }

      resolve({ code, redirectUri })
    })

    let redirectUri = ''
    // Google acepta loopback en 127.0.0.1 con cualquier puerto; Microsoft exige
    // `localhost` (ignora el puerto), así que en ese caso se escucha en todas las
    // interfaces para que localhost resuelva por IPv4 o IPv6.
    const loopbackHost = config.provider === 'microsoft' ? 'localhost' : '127.0.0.1'

    server.listen(0, loopbackHost === 'localhost' ? undefined : '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      redirectUri = `http://${loopbackHost}:${port}/callback`

      const url = new URL(authUrl)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', scope)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')

      // Queda en el log: si el navegador no abre, la URL sirve para abrirla a mano.
      console.log('[oauth] authorize', url.toString())
      onAuthUrl?.(url.toString())
      if (config.provider === 'microsoft') {
        // Outlook se autentica en una ventana propia: no depende de que Windows
        // tenga un navegador predeterminado ni de que `shell` abra una pestaña.
        const window = new BrowserWindow({
          width: 520,
          height: 760,
          show: false,
          autoHideMenuBar: true,
          backgroundColor: '#0f131c',
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            devTools: false,
            partition: 'oauth'
          }
        })
        authWindow = window
        window.once('ready-to-show', () => window.show())
        window.on('closed', () => {
          if (settled) return
          settled = true
          server.close()
          reject(new Error('Se cerró la ventana de autorización'))
        })
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        const allowNavigation = (target: string): boolean => {
          try {
            const parsed = new URL(target)
            return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
          } catch {
            return false
          }
        }
        window.webContents.on('will-navigate', (event, target) => {
          if (!allowNavigation(target)) event.preventDefault()
        })
        window.webContents.on('will-redirect', (event, target) => {
          if (!allowNavigation(target)) event.preventDefault()
        })
        void window.loadURL(url.toString()).catch((error: unknown) => {
          if (settled) return
          settled = true
          closeAuthWindow()
          server.close()
          reject(error instanceof Error ? error : new Error(String(error)))
        })
        return
      }
      void openAuthUrl(url.toString()).catch((error: unknown) => {
        console.error('[oauth] no se pudo abrir el navegador', error)
        if (settled) return
        settled = true
        server.close()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })

    setTimeout(() => {
      if (settled) return
      settled = true
      closeAuthWindow()
      server.close()
      reject(new Error('Se agotó el tiempo para autorizar la cuenta'))
    }, timeoutMs)
  })

  return postToken(tokenUrl, {
    grant_type: 'authorization_code',
    code: callback.code,
    redirect_uri: callback.redirectUri,
    ...clientCredentials(config),
    code_verifier: verifier
  })
}

/** Canjea el refresh token por un access token nuevo. */
export async function refresh(config: OAuthConfig, refreshToken: string): Promise<OAuthTokens> {
  const { tokenUrl } = endpointsFor(config)
  if (!tokenUrl) throw new Error('Falta el endpoint de token')

  return postToken(tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    ...clientCredentials(config)
  })
}

/* ---------------------------------------------------------------------------
   Caché en memoria: un access token sirve para IMAP y SMTP hasta que expira.
   ------------------------------------------------------------------------- */

const cache = new Map<string, { accessToken: string; expiresAt: number }>()
const pending = new Map<string, Promise<OAuthTokens>>()

const cacheKey = (config: OAuthConfig, refreshToken: string): string =>
  `${config.provider}:${config.clientId}:${createHash('sha256').update(refreshToken).digest('hex').slice(0, 16)}`

export interface AccessToken {
  accessToken: string
  expiresAt: number
  /** Nuevo refresh token cuando el proveedor lo rota (Microsoft lo hace). */
  refreshToken: string | null
}

export async function getAccessToken(config: OAuthConfig, refreshToken: string): Promise<AccessToken> {
  const key = cacheKey(config, refreshToken)
  const cached = cache.get(key)
  if (cached && cached.expiresAt - Date.now() > 60_000) {
    return { accessToken: cached.accessToken, expiresAt: cached.expiresAt, refreshToken: null }
  }

  // Un solo refresco por credencial. Sin esto, IMAP y SMTP podían canjear el
  // mismo refresh token a la vez; Microsoft lo rota y el segundo canje falla.
  let request = pending.get(key)
  if (!request) {
    request = refresh(config, refreshToken)
      .then((tokens) => {
        cache.set(key, { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt })
        return tokens
      })
      .catch((error: unknown) => {
        cache.delete(key)
        throw error
      })
      .finally(() => { pending.delete(key) })
    pending.set(key, request)
  }

  const tokens = await request
  return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, refreshToken: tokens.refreshToken }
}

export function forgetAccessToken(config: OAuthConfig, refreshToken: string): void {
  const key = cacheKey(config, refreshToken)
  cache.delete(key)
  pending.delete(key)
}

export type { OAuthProvider }
