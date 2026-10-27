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
  accountsList: 'accounts:list',
  accountSelect: 'accounts:select',
  accountsCheck: 'accounts:check',
  accountsActivity: 'accounts:activity',
  accountConnect: 'account:connect',
  accountConnectOAuth: 'account:connect-oauth',
  accountDisconnect: 'account:disconnect',
  accountRename: 'account:rename',
  mailboxesList: 'mailboxes:list',
  messagesList: 'messages:list',
  messageGet: 'message:get',
  messageFlag: 'message:flag',
  messageSeen: 'message:seen',
  messageArchive: 'message:archive',
  messageDelete: 'message:delete',
  attachmentSave: 'attachment:save',
  shellOpen: 'shell:open',
  cacheChanged: 'cache:changed',
  mailSend: 'mail:send',
  attachmentPick: 'attachment:pick',
  draftGet: 'draft:get',
  draftSave: 'draft:save',
  draftClear: 'draft:clear',
  outboxList: 'outbox:list',
  outboxRetry: 'outbox:retry',
  outboxCancel: 'outbox:cancel',
  outboxChanged: 'outbox:changed',
  searchQuery: 'search:query',
  syncProgress: 'sync:progress',
  syncMailbox: 'sync:mailbox',
  senderLogo: 'sender:logo',
  rulesList: 'rules:list',
  rulesSave: 'rules:save',
  rulesDelete: 'rules:delete',
  rulesApply: 'rules:apply'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Etapa actual del desarrollo; el núcleo la reporta para que la UI no mienta. */
export type Milestone = 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8'

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

/** Lienzo del cuerpo HTML: papel claro del correo o invertido para leer de noche. */
export type BodyTheme = 'light' | 'dark'

export interface AppSettings {
  language: Language
  /** Acción → combinación normalizada (`j`, `mod+k`). */
  shortcuts?: Record<string, string>
  /** Panel de contexto (IA) visible en la bandeja. */
  contextPanel?: boolean
  /** Imágenes remotas en el HTML de los correos: bloqueadas salvo que se permita. */
  remoteImages?: RemoteImagePolicy
  /** Lienzo del cuerpo HTML: claro (papel del correo) u oscuro (invertido). */
  bodyTheme?: BodyTheme
  /** Ya eligió cuenta o demo: no se vuelve a mostrar la bienvenida. */
  onboarded?: boolean
}

export type RemoteImagePolicy = 'block' | 'allow'

/* ---------------------------------------------------------------------------
   IMAP
   ------------------------------------------------------------------------- */

export interface ImapAccountConfig {
  host: string
  port: number
  secure: boolean
  user: string
}

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
}

/** Cuenta completa: recepción (IMAP) y envío (SMTP). */
export interface AccountConfig extends ImapAccountConfig {
  label?: string
  smtp: SmtpConfig
  /** `password` (usuario + contraseña) u `oauth2` (XOAUTH2 con token). */
  auth?: AuthMethod
  oauth?: OAuthConfig
}

export type AuthMethod = 'password' | 'oauth2'

export type OAuthProvider = 'google' | 'microsoft' | 'custom'

export interface OAuthConfig {
  provider: OAuthProvider
  clientId: string
  /** Los clientes de escritorio de Google lo llaman "secret" pero no lo es. */
  clientSecret: string
  /** Obligatorios solo con `provider: 'custom'`. */
  authUrl?: string
  tokenUrl?: string
  scope?: string
}

export type ImapErrorCode = 'auth' | 'dns' | 'refused' | 'timeout' | 'tls' | 'network' | 'unknown'

export interface AccountState {
  configured: boolean
  connected: boolean
  account: AccountConfig | null
  /** `false` cuando el SO no ofrece cifrado y la contraseña no se persiste. */
  passwordStored: boolean
}

/** Cuenta para el conmutador del rail (sin secretos). */
export interface AccountSummary {
  id: string
  label: string
  user: string
  host: string
  port: number
  auth: AuthMethod
  active: boolean
}

/** Estado de una cuenta para los avisos: no leídos y si llegó algo nuevo. */
export interface AccountActivity {
  id: string
  label: string
  host: string
  port: number
  unseen: number
  /** `true` cuando aumentó desde la última revisión. */
  fresh: boolean
  active: boolean
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
  hasAttachments?: boolean
  messageId?: string
  inReplyTo?: string
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
  /** Posición en el mensaje original; la usa el guardado. */
  index: number
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

/** Origen de los datos: caché local primero; `offline` indica que la red falló. */
export interface SyncMeta {
  offline: boolean
  syncedAt: number | null
  /** El mensaje está en caché pero sin cuerpo (se leyó sin conexión). */
  partial?: boolean
}

export type CachedResult<T> = { ok: true; data: T; meta: SyncMeta } | { ok: false; code: ImapErrorCode; detail: string }

/* ---------------------------------------------------------------------------
   Cola de salida
   ------------------------------------------------------------------------- */

export type OutboxKind = 'send' | 'archive' | 'delete' | 'move' | 'seen'
export type OutboxStatus = 'queued' | 'failed'

export interface OutboxItem {
  id: string
  kind: OutboxKind
  status: OutboxStatus
  attempts: number
  lastError: string | null
  createdAt: number
  /** Asunto o descripción corta para mostrar. */
  label: string
}

export interface SendMailPayload {
  to: string
  cc: string
  subject: string
  text: string
  /** Ids devueltos por `pickAttachments`; los archivos los lee el proceso principal. */
  attachments?: string[]
}

export interface Draft {
  to: string
  cc: string
  subject: string
  body: string
  updatedAt: number
}

/** Archivo elegido para adjuntar (el contenido no viaja al renderer). */
export interface PickedAttachment {
  id: string
  name: string
  size: number
}

/** Progreso de la sincronización completa de un buzón (segundo plano). */
export interface SyncProgress {
  mailbox: string
  cached: number
  total: number
  running: boolean
}

/* ---------------------------------------------------------------------------
   Reglas locales
   ------------------------------------------------------------------------- */

export type RuleField = 'from' | 'subject' | 'to' | 'any'
export type RuleOp = 'contains' | 'equals' | 'starts'
export type RuleAction = 'archive' | 'delete' | 'move' | 'read'

export interface Rule {
  id: number
  name: string
  enabled: boolean
  field: RuleField
  op: RuleOp
  value: string
  action: RuleAction
  /** Buzón destino cuando `action` es `move`. */
  target: string | null
  /** Veces que la regla actuó sobre un mensaje. */
  hits: number
  createdAt: number
}

export interface RuleDraft {
  name: string
  enabled: boolean
  field: RuleField
  op: RuleOp
  value: string
  action: RuleAction
  target: string | null
}

export interface SearchHit {  mailbox: string
  mailboxName: string
  uid: number
  subject: string
  from: EnvelopeAddress | null
  date: string
  unread: boolean
  flagged: boolean
  /** Fragmento con marcadores ⟦…⟧ alrededor de las coincidencias. */
  snippet: string
}

export interface MailAction {
  ok: boolean
  canceled?: boolean
  /** `true` si quedó en la cola en vez de aplicarse en el acto. */
  queued: boolean
  error?: string
}

export interface MailApi {
  getCoreStatus(): Promise<CoreStatus>
  /** Devuelve solo lo que el usuario ya configuró (puede venir vacío). */
  getSettings(): Promise<Partial<AppSettings>>
  setSettings(settings: Partial<AppSettings>): Promise<void>

  accountStatus(): Promise<AccountState>
  /** Cuentas guardadas para el conmutador (la activa viene marcada). */
  accounts(): Promise<AccountSummary[]>
  /** Cambia la cuenta activa: corta la sesión y reapunta la caché. */
  selectAccount(id: string): Promise<ImapResult<AccountState>>
  /** Revisa el INBOX de cada cuenta (incluidas las inactivas) y devuelve no leídos. */
  checkAccounts(): Promise<AccountActivity[]>
  onAccountsActivity(listener: (activity: AccountActivity[]) => void): () => void
  accountConnect(config: AccountConfig, password: string): Promise<ImapResult<AccountState>>
  /** OAuth2: abre el navegador, espera el redirect y guarda el refresh token. */
  accountConnectOAuth(config: AccountConfig): Promise<ImapResult<AccountState>>
  accountRename(label: string): Promise<ImapResult<AccountState>>
  accountDisconnect(): Promise<void>

  /** `sync` dispara una actualización en segundo plano cuando ya hay caché. */
  listMailboxes(sync?: boolean): Promise<CachedResult<MailboxInfo[]>>
  listEnvelopes(path: string, limit: number, sync?: boolean): Promise<CachedResult<Envelope[]>>
  getMessage(path: string, uid: number): Promise<CachedResult<MessageDetail>>
  /** Marca/desmarca `\Flagged` (destacado) en el servidor y en la caché. */
  setFlagged(path: string, uid: number, flagged: boolean): Promise<ImapResult<boolean>>
  /** Marca/desmarca `\Seen` (leído) en el servidor y en la caché. */
  setSeen(path: string, uid: number, seen: boolean): Promise<ImapResult<boolean>>
  /** Archivar y eliminar pasan por la cola de salida (idempotente, con reintentos). */
  archiveMessage(path: string, uid: number): Promise<MailAction>
  deleteMessage(path: string, uid: number): Promise<MailAction>
  /** Descarga un adjunto y lo guarda donde el usuario elija. Devuelve la ruta o null si canceló. */
  saveAttachment(path: string, uid: number, index: number): Promise<string | null>

  sendMail(payload: SendMailPayload): Promise<MailAction>
  /** Abre el diálogo del sistema y devuelve los archivos a adjuntar. */
  pickAttachments(): Promise<PickedAttachment[]>
  /** Borrador único del compositor, persistido en la caché. */
  getDraft(): Promise<Draft | null>
  saveDraft(draft: Draft): Promise<void>
  clearDraft(): Promise<void>
  listOutbox(): Promise<OutboxItem[]>
  retryOutbox(id: string): Promise<void>
  cancelOutbox(id: string): Promise<void>
  onOutboxChanged(listener: () => void): () => void
  /** Búsqueda de texto completo sobre la caché local. */
  search(query: string, limit?: number): Promise<SearchHit[]>
  /** Progreso de la descarga completa del buzón (o null si no hay una en curso). */
  senderLogo(email: string, mailbox: string): Promise<string | null>
  syncMailbox(path: string): Promise<ImapResult<boolean>>
  syncProgress(): Promise<SyncProgress | null>
  onSyncProgress(listener: (progress: SyncProgress | null) => void): () => void

  /** Reglas locales: se aplican a los mensajes nuevos y a pedido a los existentes. */
  rules(): Promise<Rule[]>
  saveRule(rule: RuleDraft & { id?: number }): Promise<Rule[]>
  deleteRule(id: number): Promise<Rule[]>
  /** Repasa la caché y devuelve cuántos mensajes quedaron afectados. */
  applyRules(): Promise<{ matched: number }>

  /** Abre un enlace en el navegador del sistema. Solo http(s) y mailto. */
  openExternal(url: string): Promise<boolean>
  /** Avisa cuando el motor terminó de sincronizar un buzón. Devuelve el unsubscribe. */
  onCacheChanged(listener: (mailbox: string) => void): () => void
}
