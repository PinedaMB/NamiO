/**
 * Contrato entre el proceso principal y la UI.
 *
 * Regla del proyecto: el renderer NUNCA habla con la red ni con el disco.
 * Todo pasa por estos canales, que son la única superficie pública del núcleo.
 */

export const IPC = {
  coreStatus: 'core:status',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Etapa actual del desarrollo; el núcleo la reporta para que la UI no mienta. */
export type Milestone = 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'

export interface CoreStatus {
  appVersion: string
  platform: string
  electronVersion: string
  isPackaged: boolean
  stage: Milestone
  /** Cuentas configuradas. En M0 siempre es 0. */
  accountCount: number
}

export type Language = 'es' | 'en'

export interface AppSettings {
  language: Language
  /** Acción → combinación normalizada (`j`, `mod+k`). */
  shortcuts?: Record<string, string>
  /** Panel de contexto (IA) visible en la bandeja. */
  contextPanel?: boolean
}

export interface MailApi {
  getCoreStatus(): Promise<CoreStatus>
  /** Devuelve solo lo que el usuario ya configuró (puede venir vacío). */
  getSettings(): Promise<Partial<AppSettings>>
  setSettings(settings: Partial<AppSettings>): Promise<void>
}
