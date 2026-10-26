/**
 * Contrato entre el proceso principal y la UI.
 *
 * Regla del proyecto: el renderer NUNCA habla con la red ni con el disco.
 * Todo pasa por estos canales, que son la única superficie pública del núcleo.
 */

export const IPC = {
  coreStatus: 'core:status',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  accountStatus: 'account:status',
  accountConnect: 'account:connect',
  accountDisconnect: 'account:disconnect',
  mailboxesList: 'mailboxes:list',
  messagesList: 'messages:list',
  messageGet: 'message:get',
  messageFlag: 'message:flag',
  shellOpen: 'shell:open'
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
  /** Cuentas configuradas. */
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

/* ---------------------------------------------------------------------------
   IMAP
   ------------------------------------------------------------------------- */

export interface ImapAccountConfig {
  host: string
  port: number
  secure: boolean
  user: string
}

export type ImapErrorCode = 'auth' | 'dns' | 'refused' | 'timeout' | 'tls' | 'network' | 'unknown'

export interface AccountState {
  configured: boolean
  connected: boolean
  account: ImapAccountConfig | null
  /** `false` cuando el SO no ofrece cifrado y la contraseña no se persiste. */
  passwordStored: boolean
}

export interface MailboxInfo {
  path: string
  name: string
  specialUse: string | null
  messages: number
  unseen: number
}

export interface EnvelopeAddress {
  name: string
  address: string
}

export interface Envelope {
  uid: number
  subject: string
  from: EnvelopeAddress | null
  date: string
  unread: boolean
  flagged: boolean
  size: number
}

export interface MessageAttachment {
  name: string
  size: number
  type: string
}

export interface MessageDetail extends Envelope {
  to: EnvelopeAddress[]
  cc: EnvelopeAddress[]
  text: string
  /** HTML crudo del mensaje: lo sanitiza el renderer antes de mostrarlo. */
  html: string | null
  attachments: MessageAttachment[]
}

export type ImapResult<T> = { ok: true; data: T } | { ok: false; code: ImapErrorCode; detail: string }

export interface MailApi {
  getCoreStatus(): Promise<CoreStatus>
  /** Devuelve solo lo que el usuario ya configuró (puede venir vacío). */
  getSettings(): Promise<Partial<AppSettings>>
  setSettings(settings: Partial<AppSettings>): Promise<void>

  accountStatus(): Promise<AccountState>
  accountConnect(config: ImapAccountConfig, password: string): Promise<ImapResult<AccountState>>
  accountDisconnect(): Promise<void>

  listMailboxes(): Promise<ImapResult<MailboxInfo[]>>
  listEnvelopes(path: string, limit: number): Promise<ImapResult<Envelope[]>>
  getMessage(path: string, uid: number): Promise<ImapResult<MessageDetail>>
  /** Marca/desmarca `\Flagged` (destacado) en el servidor. */
  setFlagged(path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>>
  /** Abre un enlace en el navegador del sistema. Solo http(s) y mailto. */
  openExternal(url: string): Promise<boolean>
}
