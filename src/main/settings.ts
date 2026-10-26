import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AppSettings, AuthMethod, OAuthConfig, SmtpConfig } from '@shared/ipc'

/** Cuenta guardada: las credenciales solo se persisten cifradas por el SO. */
export interface StoredAccount {
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

export async function writeSettings(patch: Partial<StoredSettings>): Promise<void> {
  const current = await readSettings()
  await writeFile(settingsPath(), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf8')
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
