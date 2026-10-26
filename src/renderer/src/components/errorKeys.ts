import type { ImapErrorCode } from '@shared/ipc'
import type { TranslationKey } from '../i18n'

/** Código de error del motor → clave de traducción del título. */
export const ERROR_KEYS: Record<ImapErrorCode, TranslationKey> = {
  auth: 'account.error.auth',
  dns: 'account.error.dns',
  refused: 'account.error.refused',
  timeout: 'account.error.timeout',
  tls: 'account.error.tls',
  network: 'account.error.network',
  unknown: 'account.error.unknown'
}
