import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { MailNotificationCursor } from './notificationCursor'
import type { AppSettings, AuthMethod, OAuthConfig, SmtpConfig } from '@shared/ipc'

/** Cuenta guardada: las credenciales solo se persisten cifradas por el SO. */
export interface StoredAccount {
  /** Identidad estable de la cuenta; `default` se conserva para cuentas antiguas. */
  id: string
  /** Nombre corto para el rail; si falta se usa el usuario. */
  label?: string
  host: string
  port: number
  secure: boolean
  user: string
  smtp: SmtpConfig
  /** `password` por defecto; `oauth2` usa XOAUTH2 con refresh token. */
  auth?: AuthMethod
  oauth?: OAuthConfig
  /** base64 de `safeStorage.encryptString` del refresh token (OAuth2). */
  refreshToken?: string
  /** base64 de `safeStorage.encryptString`; ausente si el SO no ofrece cifrado. */
  secret?: string
}

export interface StoredSettings extends Partial<AppSettings> {
  mailNotificationCursors?: Record<string, MailNotificationCursor>
  /** Una o más cuentas. Una instalación vieja migra `account` a esta lista. */
  accounts?: StoredAccount[]
  /** Id de la cuenta activa: hay una sola conexión a la vez. */
  activeAccount?: string
  /** Formato anterior (una sola cuenta): solo se lee para migrar. */
  account?: StoredAccount
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<StoredSettings> {
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoredSettings) : {}
  } catch {
    // Primera ejecución o archivo corrupto: se arranca con los valores por defecto.
    return {}
  }
}

/**
 * Claves que la UI puede leer y escribir. `accounts`, `activeAccount` y
 * `mailNotificationCursors` viven en el mismo archivo, pero son del núcleo:
 * el renderer no debe recibirlos ni poder sustituirlos.
 */
const APP_SETTING_KEYS = [
  'appTheme',
  'offlineDownload',
  'keepInBackground',
  'notifications',
  'notificationSound',
  'notificationPrivate',
  'language',
  'shortcuts',
  'shortcutModifier',
  'contextPanel',
  'remoteImages',
  'timeFormat',
  'bodyTheme',
  'onboarded'
] as const satisfies readonly (keyof AppSettings)[]

const BOOLEAN_SETTINGS = [
  'offlineDownload',
  'keepInBackground',
  'notifications',
  'notificationSound',
  'notificationPrivate',
  'contextPanel',
  'onboarded'
] as const

const ENUM_SETTINGS: Partial<Record<keyof AppSettings, readonly string[]>> = {
  appTheme: ['light', 'dark', 'system'],
  language: ['es', 'en'],
  shortcutModifier: ['ctrl', 'command'],
  remoteImages: ['block', 'allow'],
  timeFormat: ['12h', '24h'],
  bodyTheme: ['light', 'dark']
}

/** Devuelve solo los ajustes públicos, sin cuentas ni cursores internos. */
export function pickAppSettings(settings: StoredSettings): Partial<AppSettings> {
  const result: Partial<AppSettings> = {}
  for (const key of APP_SETTING_KEYS) {
    const value = settings[key]
    if (value !== undefined) (result as Record<string, unknown>)[key] = value
  }
  return result
}

export async function readAppSettings(): Promise<Partial<AppSettings>> {
  return pickAppSettings(await readSettings())
}

/**
 * Valida y reconstruye un patch de ajustes. Rechaza claves internas y valores
 * fuera de tipo para que un renderer comprometido no pueda reescribir cuentas
 * ni persistir datos arbitrarios en `settings.json`.
 */
export function sanitizeSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error('Invalid settings')
  }

  const source = patch as Record<string, unknown>
  const allowed = new Set<string>(APP_SETTING_KEYS)
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new Error(`Unknown setting: ${key}`)
  }

  const result: Partial<AppSettings> = {}
  const target = result as Record<string, unknown>

  for (const key of BOOLEAN_SETTINGS) {
    if (source[key] === undefined) continue
    if (typeof source[key] !== 'boolean') throw new Error('Invalid setting value')
    target[key] = source[key]
  }

  for (const [key, values] of Object.entries(ENUM_SETTINGS)) {
    if (source[key] === undefined) continue
    if (typeof source[key] !== 'string' || !values.includes(source[key])) {
      if (key === 'appTheme') throw new Error('Invalid app theme')
      if (key === 'timeFormat') throw new Error('Invalid time format')
      if (key === 'shortcutModifier') throw new Error('Invalid shortcut modifier')
      throw new Error('Invalid setting value')
    }
    target[key] = source[key]
  }

  if (source.shortcuts !== undefined) {
    if (typeof source.shortcuts !== 'object' || source.shortcuts === null || Array.isArray(source.shortcuts)) {
      throw new Error('Invalid shortcuts')
    }
    const entries = Object.entries(source.shortcuts as Record<string, unknown>)
    if (entries.length > 32) throw new Error('Invalid shortcuts')
    const shortcuts: Record<string, string> = {}
    for (const [action, combo] of entries) {
      if (!/^[a-z][a-z0-9-]{0,31}$/i.test(action)) throw new Error('Invalid shortcuts')
      if (typeof combo !== 'string' || combo.length === 0 || combo.length > 32 || /[\r\n]/.test(combo)) {
        throw new Error('Invalid shortcuts')
      }
      shortcuts[action] = combo
    }
    result.shortcuts = shortcuts
  }

  return result
}

let settingsWrites: Promise<void> = Promise.resolve()

export function writeSettings(patch: Partial<StoredSettings> | ((current: StoredSettings) => Partial<StoredSettings>)): Promise<void> {
  const next = settingsWrites.then(async () => {
    const current = await readSettings()
    const updates = typeof patch === 'function' ? patch(current) : patch
    const path = settingsPath()
    await writeFile(`${path}.tmp`, `${JSON.stringify({ ...current, ...updates }, null, 2)}\n`, 'utf8')
    await rename(`${path}.tmp`, path)
  })
  settingsWrites = next.catch(() => undefined)
  return next
}

export async function updateAccount(id: string, patch: Partial<StoredAccount>): Promise<void> {
  await writeSettings((current) => ({
    accounts: (current.accounts ?? []).map((account) => account.id === id ? { ...account, ...patch } : account)
  }))
}

export async function encryptSecret(password: string): Promise<string | null> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return null
  const encrypted = await safeStorage.encryptStringAsync(password)
  return encrypted.toString('base64')
}

export async function decryptSecret(secret: string): Promise<string | null> {
  try {
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(secret, 'base64'))
    return decrypted.result
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
   Varias cuentas
   ------------------------------------------------------------------------- */

function accountsContain(accounts: readonly StoredAccount[], id: string | null): boolean {
  return id !== null && accounts.some((account) => account.id === id)
}

/**
 * Lista de cuentas y la activa, migrando el formato de una sola cuenta la
 * primera vez (y persistiendo esa migración).
 */
export async function readAccounts(): Promise<{ accounts: StoredAccount[]; active: string | null }> {
  const settings = await readSettings()
  const stored = Array.isArray(settings.accounts) ? settings.accounts : []

  if (stored.length > 0) {
    const active = settings.activeAccount ?? stored[0]?.id ?? null
    return { accounts: stored, active: accountsContain(stored, active) ? active : (stored[0]?.id ?? null) }
  }

  if (settings.account) {
    const migrated: StoredAccount = { ...settings.account, id: settings.account.id ?? 'default' }
    await writeSettings({ accounts: [migrated], activeAccount: migrated.id, account: undefined })
    return { accounts: [migrated], active: migrated.id }
  }

  return { accounts: [], active: null }
}

export async function writeAccounts(accounts: readonly StoredAccount[], active: string | null): Promise<void> {
  await writeSettings({ accounts: [...accounts], activeAccount: active ?? undefined, account: undefined })
}

export async function readActiveAccount(): Promise<StoredAccount | null> {
  const { accounts, active } = await readAccounts()
  return accounts.find((account) => account.id === active) ?? null
}

export async function setActiveAccount(id: string): Promise<boolean> {
  const { accounts } = await readAccounts()
  if (!accountsContain(accounts, id)) return false
  await writeSettings({ activeAccount: id })
  return true
}

/** Inserta o actualiza una cuenta por id; devuelve la lista resultante. */
export async function saveAccount(account: StoredAccount): Promise<StoredAccount[]> {
  await readAccounts()
  let next: StoredAccount[] = []
  await writeSettings((current) => {
    const accounts = current.accounts ?? []
    next = accounts.some((item) => item.id === account.id)
      ? accounts.map((item) => item.id === account.id ? { ...account, label: account.label ?? item.label } : item)
      : [...accounts, account]
    return { accounts: next, activeAccount: current.activeAccount ?? account.id }
  })
  return next
}

export async function removeAccount(id: string): Promise<{ accounts: StoredAccount[]; active: string | null }> {
  const { accounts, active } = await readAccounts()
  const rest = accounts.filter((account) => account.id !== id)
  const nextActive = active === id ? (rest[0]?.id ?? null) : active
  await writeAccounts(rest, nextActive)
  return { accounts: rest, active: nextActive }
}
