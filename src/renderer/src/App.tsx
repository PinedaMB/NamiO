import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AccountState,
  AccountActivity,
  AccountSummary,
  AppSettings,
  CoreStatus,
  ImapErrorCode,
  MailboxInfo,
  OutboxItem,
  SearchHit,
  SyncProgress
} from '@shared/ipc'
import { ACTION_ITEMS, BRIEF, COPILOT_DRAFT, FOLDERS, SLOTS, THREADS, type Thread } from './data/demo'
import { detailToMessage, envelopeToThread, mailboxToFolder, type FolderView } from './data/live'
import { Sidebar } from './components/Sidebar'
import { Topbar, type FilterId } from './components/Topbar'
import { ThreadList } from './components/ThreadList'
import { SearchResults } from './components/SearchResults'
import { ThreadPane, ThreadPaneEmpty } from './components/ThreadPane'
import { ContextRail } from './components/ContextRail'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { ComposeOverlay } from './components/ComposeOverlay'
import { Settings } from './components/Settings'
import { AccountDialog, ERROR_KEYS } from './components/AccountDialog'
import { BootSplash } from './components/BootSplash'
import { Onboarding } from './components/Onboarding'
import { Icon } from './components/Icon'
import { useI18n } from './i18n'
import { useShortcuts } from './settings/ShortcutsProvider'
import { actionForCombo, comboFromEvent } from './settings/shortcuts'

interface ComposeState {
  to: string
  subject: string
  body: string
}

type View = 'mailbox' | 'settings'

const PAGE_SIZE = 50

function matchesFilter(thread: Thread, filter: FilterId): boolean {
  switch (filter) {
    case 'focused':
      return thread.unread
    case 'other':
      return !thread.unread
    case 'vip':
      return thread.vip
    case 'files':
      return thread.messages.some((message) => (message.attachments?.length ?? 0) > 0)
    case 'needs-reply':
      // Heurística de demo: lo que es VIP y sigue sin leer es lo que espera respuesta.
      return thread.unread && thread.vip
    default:
      return true
  }
}

function matchesFolder(thread: Thread, folder: string): boolean {
  if (folder === 'starred') return thread.starred
  if (folder === 'vip') return thread.vip
  if (folder === 'trash') return false
  return true
}

/**
 * Al pedir otra tanda se reconstruyen los hilos desde los sobres (sin cuerpo).
 * Hay que conservar el cuerpo ya cargado del mensaje abierto, o vuelve el estado
 * de carga y el lector parpadea.
 */
function mergeLoaded(previous: readonly Thread[], next: readonly Thread[]): Thread[] {
  const known = new Map(previous.map((thread) => [thread.id, thread]))
  return next.map((thread) => {
    const old = known.get(thread.id)
    if (!old || old.messages.length === 0) return thread
    return { ...thread, messages: old.messages }
  })
}

function uidOf(threadId: string): number | null {
  if (!threadId.startsWith('live:')) return null
  const uid = Number(threadId.slice(5))
  return Number.isInteger(uid) ? uid : null
}

function formatAgo(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

export function App(): React.JSX.Element {
  const { t, locale } = useI18n()
  const { bindings } = useShortcuts()

  const [view, setView] = useState<View>('mailbox')
  const [threads, setThreads] = useState<readonly Thread[]>(THREADS)
  const [selectedId, setSelectedId] = useState<string | null>(THREADS[0]?.id ?? null)
  const [filter, setFilter] = useState<FilterId>('focused')
  const [folder, setFolder] = useState('inbox')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [compose, setCompose] = useState<ComposeState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(true)

  const [account, setAccount] = useState<AccountState | null>(null)
  const [accounts, setAccounts] = useState<readonly AccountSummary[]>([])
  const [activity, setActivity] = useState<readonly AccountActivity[]>([])
  const [accountOpen, setAccountOpen] = useState(false)
  const [settings, setSettings] = useState<Partial<AppSettings>>({})
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [mailboxes, setMailboxes] = useState<readonly MailboxInfo[]>([])
  const [liveError, setLiveError] = useState<{ code: ImapErrorCode; detail: string } | null>(null)
  const [loadingFolder, setLoadingFolder] = useState(false)
  const [sync, setSync] = useState<{ offline: boolean; syncedAt: number | null }>({
    offline: false,
    syncedAt: null
  })
  const [now, setNow] = useState(() => Date.now())
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const busySwitch = useRef(false)

  /** Guarda los no leídos por cuenta y avisa cuando llegó correo a otra cuenta. */
  const applyActivity = useCallback(
    (list: readonly AccountActivity[]): void => {
      setActivity(list)
      const fresh = list.find((item) => item.fresh)
      if (fresh) {
        // Con dos cuentas del mismo usuario, el host:puerto es lo que distingue.
        setToast(
          t('account.newMail', { label: `${fresh.label} (${fresh.host}:${fresh.port})`, count: fresh.unseen })
        )
      }
    },
    [t]
  )

  const refreshAccounts = useCallback(async (): Promise<void> => {
    const list = await window.api?.accounts?.().catch(() => null)
    if (list) setAccounts(list)

    // Aprovecha para refrescar los no leídos de cada cuenta (STATUS del INBOX).
    const next = await window.api?.checkAccounts?.().catch(() => null)
    if (next) applyActivity(next)
  }, [applyActivity])
  /** Cuántos mensajes se piden a la caché (crece al llegar al final de la lista). */
  const [listLimit, setListLimit] = useState(PAGE_SIZE)
  const loadingMoreRef = useRef(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  /** Solo se marca leído lo que el usuario abrió; la selección automática no cuenta. */
  const userNavigated = useRef(false)

  // "live" = hay cuenta configurada. La conexión puede faltar: en ese caso se
  // sirve la caché local (modo offline), no los datos de demostración.
  const live = account?.configured === true

  const accountIdentity = useRef<string | null>(null)
  const accountGeneration = useRef(0)
  const applyAccount = useCallback((state: AccountState): void => {
    const identity = state.account
      ? JSON.stringify([state.account.host, state.account.port, state.account.user])
      : null
    if (identity !== accountIdentity.current) {
      accountIdentity.current = identity
      accountGeneration.current += 1
      setThreads([])
      setSelectedId(null)
      setMailboxes([])
      setQuery('')
      setHits([])
      setSearching(false)
      setLoadingFolder(false)
      setFolder('inbox')
      setLiveError(null)
      setSync({ offline: false, syncedAt: null })
      setSyncProgress(null)
      setOutbox([])
    }
    setAccount(state)
  }, [])

  const visible = useMemo(() => {
    if (live) {
      // El hilo abierto sigue visible aunque se marque leído: si desapareciera
      // del filtro, la selección saltaría al siguiente y lo marcaría leído
      // también (cascada de mensajes "leídos" sin abrir).
      if (filter === 'focused') return threads.filter((thread) => thread.unread || thread.id === selectedId)
      if (filter === 'other') return threads.filter((thread) => !thread.unread)
      if (filter === 'all') return threads
      return threads
    }
    return threads.filter((thread) => matchesFolder(thread, folder) && matchesFilter(thread, filter))
  }, [live, threads, filter, folder, selectedId])

  const selected = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? visible[0] ?? null,
    [threads, selectedId, visible]
  )

  const unreadCount = threads.filter((thread) => thread.unread).length
  const otherCount = threads.filter((thread) => !thread.unread).length
  const allCount = threads.length
  const vipCount = threads.filter((thread) => thread.vip).length

  const folderViews = useMemo<readonly FolderView[]>(() => {
    if (live) return mailboxes.map(mailboxToFolder)
    return FOLDERS.map((item) => ({
      id: item.id,
      icon: item.icon,
      label: t(item.labelKey),
      count: item.count,
      accent: item.accent
    }))
  }, [live, mailboxes, t])

  const loadFolder = useCallback(
    async (path: string, focusUid?: number): Promise<void> => {
      const generation = accountGeneration.current
      setLoadingFolder(true)
      setFolder(path)
      setListLimit(PAGE_SIZE)
      if (focusUid === undefined) setSelectedId(null)
      const result = await window.api.listEnvelopes(path, PAGE_SIZE, true).catch(() => null)
      if (generation !== accountGeneration.current) return
      setLoadingFolder(false)

      if (!result) return
      if (!result.ok) {
        setLiveError({ code: result.code, detail: result.detail })
        return
      }

      setSync({ offline: result.meta.offline, syncedAt: result.meta.syncedAt })
      const mapped = result.data.map((envelope) => envelopeToThread(envelope, locale))
      setThreads(mapped)
      userNavigated.current = false
      setSelectedId(focusUid !== undefined ? `live:${focusUid}` : (mapped[0]?.id ?? null))
      setLiveError(null)
    },
    [locale]
  )

  /** Marca leído un hilo concreto (estado local + `\Seen` en el servidor). */
  const markRead = useCallback(
    (path: string, uid: number, id: string): void => {
      setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, unread: false } : thread)))
      if (live) void window.api.setSeen(path, uid, true).catch(() => undefined)
    },
    [live]
  )

  /** Abre un resultado de búsqueda: cambia de buzón si hace falta y selecciona el mensaje. */
  const openHit = useCallback(
    (hit: SearchHit): void => {
      setFilter(hit.unread ? 'focused' : 'other')
      userNavigated.current = true
      const id = `live:${hit.uid}`

      if (hit.mailbox !== folder) {
        void loadFolder(hit.mailbox, hit.uid)
      } else {
        setSelectedId(id)
      }

      if (hit.unread) markRead(hit.mailbox, hit.uid, id)
    },
    [folder, loadFolder, markRead]
  )

  // Búsqueda con debounce: 2 caracteres mínimo y una sola consulta en vuelo.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setHits([])
      setSearching(false)
      return
    }

    let cancelled = false
    const generation = accountGeneration.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      void window.api
        .search(trimmed, 60)
        .then((result) => {
          if (cancelled || generation !== accountGeneration.current) return
          setHits(result)
          setSearching(false)
        })
        .catch(() => {
          if (!cancelled && generation === accountGeneration.current) setSearching(false)
        })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  /** Relee la caché sin tocar la red: lo usa el aviso de "buzón sincronizado". */
  const refreshFromCache = useCallback(async (): Promise<void> => {
    const generation = accountGeneration.current
    const boxes = await window.api.listMailboxes(false).catch(() => null)
    if (generation !== accountGeneration.current) return
    if (boxes?.ok) setMailboxes(boxes.data)

    const list = await window.api.listEnvelopes(folder, listLimit, false).catch(() => null)
    if (generation !== accountGeneration.current || !list?.ok) return

    setSync({ offline: list.meta.offline, syncedAt: list.meta.syncedAt })
    const mapped = list.data.map((envelope) => envelopeToThread(envelope, locale))
    setThreads((previous) => mergeLoaded(previous, mapped))
    setSelectedId((current) => (mapped.some((thread) => thread.id === current) ? current : (mapped[0]?.id ?? null)))
  }, [folder, locale, listLimit])

  /** Trae otra tanda de la caché (la descarga completa ya está en disco). */
  const loadMore = useCallback(async (): Promise<void> => {
    if (!live || loadingFolder || loadingMoreRef.current) return
    const next = Math.min(listLimit + 100, 2000)
    if (next === listLimit) return

    const generation = accountGeneration.current
    loadingMoreRef.current = true
    setListLimit(next)
    try {
      const result = await window.api.listEnvelopes(folder, next, false).catch(() => null)
      if (generation !== accountGeneration.current || !result?.ok) return

      const mapped = result.data.map((envelope) => envelopeToThread(envelope, locale))
      setThreads((previous) => mergeLoaded(previous, mapped))
      setSelectedId((current) =>
        mapped.some((thread) => thread.id === current) ? current : (mapped[0]?.id ?? null)
      )
    } finally {
      loadingMoreRef.current = false
    }
  }, [live, loadingFolder, listLimit, folder, locale])

  /** Progreso de la descarga completa del buzón. */
  useEffect(() => {
    void window.api
      .syncProgress()
      .then((value) => setSyncProgress(value))
      .catch(() => undefined)

    const unsubscribe = window.api?.onSyncProgress?.((value) => setSyncProgress(value))
    return () => unsubscribe?.()
  }, [])

  /** No leídos por cuenta: la activa la sincroniza el motor y las demás el sondeo. */
  useEffect(() => {
    const unsubscribe = window.api?.onAccountsActivity?.((list) => applyActivity(list))
    return () => unsubscribe?.()
  }, [applyActivity])

  const loadMailboxes = useCallback(
    async (state: AccountState): Promise<void> => {
      const generation = accountGeneration.current
      const result = await window.api.listMailboxes(true).catch(() => null)
      if (generation !== accountGeneration.current || !result) return
      if (!result.ok) {
        setLiveError({ code: result.code, detail: result.detail })
        return
      }

      setSync({ offline: result.meta.offline, syncedAt: result.meta.syncedAt })
      setMailboxes(result.data)
      const inbox =
        result.data.find((box) => box.specialUse === '\\Inbox' || box.path.toUpperCase() === 'INBOX') ?? result.data[0]
      if (inbox) await loadFolder(inbox.path)
      void state
    },
    [loadFolder]
  )

  const refreshAccount = useCallback(async (): Promise<void> => {
    const generation = accountGeneration.current
    const state = await window.api.accountStatus().catch(() => null)
    if (generation !== accountGeneration.current || !state) return
    applyAccount(state)
    void refreshAccounts()
    if (state.configured) {
      await loadMailboxes(state)
      return
    }

    const preferences = await window.api.getSettings()
    setSettings(preferences ?? {})
    // Sin cuenta se limpia el estado real y se recupera la bienvenida.
    setThreads(THREADS)
    setSelectedId(THREADS[0]?.id ?? null)
    setMailboxes([])
    setFolder('inbox')
    setLiveError(null)
  }, [loadMailboxes, applyAccount])

  /** El núcleo reporta su versión; en un navegador (sin preload) simplemente no hay dato. */
  useEffect(() => {
    const bridge = (window as unknown as { api?: { getCoreStatus?: () => Promise<CoreStatus> } }).api
    if (!bridge?.getCoreStatus) return
    let alive = true
    bridge
      .getCoreStatus()
      .then((status) => {
        if (alive) setAppVersion(status.appVersion)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    void refreshAccount()
  }, [refreshAccount])

  /** Preferencias sueltas (por ahora, si ya pasó por la bienvenida). */
  useEffect(() => {
    void window.api
      .getSettings()
      .then((value) => {
        setSettings(value ?? {})
        setSettingsLoaded(true)
      })
      .catch(() => setSettingsLoaded(true))
  }, [])

  const markOnboarded = useCallback((): void => {
    setSettings((current) => ({ ...current, onboarded: true }))
    void window.api.setSettings({ onboarded: true }).catch(() => undefined)
  }, [])

  // Sin `settingsLoaded` la bienvenida parpadearía un frame si la cuenta llega antes.
  // Con cuenta real se abre en "Todos": la bandeja con los últimos mensajes.
  useEffect(() => {
    if (live) setFilter('all')
  }, [live])

  const onboarding =
    settingsLoaded && account !== null && !account.configured && settings.onboarded !== true

  const refreshOutbox = useCallback(async (): Promise<void> => {
    const generation = accountGeneration.current
    const items = await window.api.listOutbox().catch(() => null)
    if (generation !== accountGeneration.current) return
    if (items) setOutbox(items)
  }, [])

  useEffect(() => {
    void refreshOutbox()
    const unsubscribe = window.api?.onOutboxChanged?.(() => void refreshOutbox())
    return () => unsubscribe?.()
  }, [refreshOutbox])

  /** Ticker para el "sincronizado hace…" del rail. */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  /** El motor avisa cuando terminó de sincronizar un buzón: se relee la caché. */
  useEffect(() => {
    if (!live) return
    const unsubscribe = window.api?.onCacheChanged?.((mailbox) => {
      if (mailbox === '*' || mailbox === folder) void refreshFromCache()
    })
    return () => unsubscribe?.()
  }, [live, folder, refreshFromCache])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.api
      ?.getSettings?.()
      .then((settings) => {
        if (typeof settings?.contextPanel === 'boolean') setContextOpen(settings.contextPanel)
      })
      .catch(() => undefined)
  }, [])

  /** La preferencia de layout se guarda como el idioma o los atajos. */
  const toggleContext = (): void => {
    // El efecto va FUERA del updater: StrictMode lo invoca dos veces y
    // persistiría el valor descartado.
    const next = !contextOpen
    setContextOpen(next)
    window.api?.setSettings?.({ contextPanel: next }).catch(() => undefined)
  }

  useEffect(() => {
    if (selectedId && visible.some((thread) => thread.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [visible, selectedId])

  /** En modo real, abrir un hilo dispara una descarga de la fuente del mensaje. */
  useEffect(() => {
    if (!live || !selected || selected.messages.length > 0) return
    const uid = uidOf(selected.id)
    if (uid === null) return

    let cancelled = false
    const generation = accountGeneration.current
    window.api
      .getMessage(folder, uid)
      .then((result) => {
        if (cancelled || generation !== accountGeneration.current) return
        if (!result.ok) {
          setLiveError({ code: result.code, detail: result.detail })
          return
        }
        if (result.meta.partial) setToast(t('offline.bodyUnavailable'))
        const message = detailToMessage(result.data, locale, result.meta.partial === true)
        setThreads((current) =>
          current.map((thread) => (thread.id === selected.id ? { ...thread, messages: [message] } : thread))
        )
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [live, selected, folder, locale])

  const select = (id: string): void => {
    userNavigated.current = true
    setSelectedId(id)

    const thread = threads.find((item) => item.id === id)
    const uid = uidOf(id)
    if (thread?.unread && uid !== null) markRead(folder, uid, id)
  }

  const selectFolder = (id: string): void => {
    setView('mailbox')
    if (live) {
      void loadFolder(id)
      return
    }
    setFolder(id)
  }

  const openSettings = (): void => {
    setPaletteOpen(false)
    setView('settings')
  }

  const step = (delta: number): void => {
    if (visible.length === 0) return
    const current = visible.findIndex((thread) => thread.id === selected?.id)
    const next = visible[(current + delta + visible.length) % visible.length]
    if (next) select(next.id)
  }

  /** Descarga un adjunto y lo guarda donde el usuario elija. */
  const openAttachment = (index: number): void => {
    if (!selected) return
    if (!live) {
      setToast(t('toast.attachmentOffline'))
      return
    }
    const uid = uidOf(selected.id)
    if (uid === null) return

    void window.api
      .saveAttachment(folder, uid, index)
      .then((saved) => {
        if (saved) setToast(t('toast.saved', { path: saved }))
      })
      .catch((error: unknown) => {
        setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'adjunto' }))
      })
  }

  /** Alterna leído/no leído; en modo real escribe `\Seen` en el servidor. */
  const toggleRead = (): void => {
    if (!selected) return
    const next = !selected.unread
    setThreads((current) =>
      current.map((thread) => (thread.id === selected.id ? { ...thread, unread: next } : thread))
    )
    setToast(next ? t('toast.markedRead') : t('toast.markedUnread'))

    if (!live) return
    const uid = uidOf(selected.id)
    if (uid === null) return

    void window.api.setSeen(folder, uid, next).then((result) => {
      if (result.ok) return
      // Si el servidor rechaza, se revierte para no mentir en pantalla.
      setThreads((current) =>
        current.map((thread) => (thread.id === selected.id ? { ...thread, unread: !next } : thread))
      )
      setToast(t('toast.actionFailed', { error: result.detail }))
    })
  }

  const archive = (): void => {
    if (!selected) return
    const index = visible.findIndex((thread) => thread.id === selected.id)
    const next = visible[index + 1] ?? visible[index - 1] ?? null

    if (live) {
      const uid = uidOf(selected.id)
      if (uid === null) return
      // Optimista: la cola se encarga; si falla, el próximo sync lo restituye.
      setThreads((current) => current.filter((thread) => thread.id !== selected.id))
      setSelectedId(next?.id ?? null)
      void window.api.archiveMessage(folder, uid).then((result) => {
        if (!result.ok) setToast(t('toast.actionFailed', { error: result.error ?? '' }))
        void refreshOutbox()
      })
      return
    }

    setThreads((current) => current.filter((thread) => thread.id !== selected.id))
    setSelectedId(next?.id ?? null)
    setToast(t('toast.archived'))
  }

  const toggleStar = (): void => {
    if (!selected) return

    if (live) {
      const uid = uidOf(selected.id)
      if (uid === null) return
      const next = !selected.starred
      setThreads((current) =>
        current.map((thread) => (thread.id === selected.id ? { ...thread, starred: next } : thread))
      )
      window.api
        .setFlagged(folder, uid, next)
        .then((result) => {
          if (result.ok) setToast(next ? t('toast.starred') : t('toast.unstarred'))
          else setLiveError({ code: result.code, detail: result.detail })
        })
        .catch(() => undefined)
      return
    }

    setThreads((current) =>
      current.map((thread) => (thread.id === selected.id ? { ...thread, starred: !thread.starred } : thread))
    )
    setToast(selected.starred ? t('toast.unstarred') : t('toast.starred'))
  }

  const openReply = (body = ''): void => {
    if (!selected) return
    const sender = selected.participants[0]
    const message = selected.messages[0]
    const quoted = (message?.body ?? []).map((line) => `> ${line}`).join('\n')
    const attribution = message ? `${message.sentAt}, ${sender?.name ?? ''} <${sender?.email ?? ''}>:` : ''
    const prefix = selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`

    setCompose({
      to: sender?.email ?? '',
      subject: prefix,
      body: [body, attribution, quoted].filter((part) => part !== '').join('\n\n')
    })
  }

  const openCompose = (): void => {
    setCompose({ to: '', subject: '', body: '' })

    // Si quedó un borrador guardado, se retoma en vez de empezar en blanco.
    void window.api
      .getDraft()
      .then((draft) => {
        if (!draft) return
        const empty = draft.to === '' && draft.subject === '' && draft.body === ''
        if (empty) return
        setCompose({ to: draft.to, subject: draft.subject, body: draft.body })
        setToast(t('draft.restored'))
      })
      .catch(() => undefined)
  }

  const onConnected = (state: AccountState): void => {
    applyAccount(state)
    setAccountOpen(false)
    markOnboarded()
    void refreshAccounts()
    void loadMailboxes(state)
  }

  /** Cambia la cuenta activa: el núcleo reapunta la caché y acá se relee todo. */
  const handleSelectAccount = async (id: string): Promise<void> => {
    if (busySwitch.current) return
    busySwitch.current = true
    try {
      const result = await window.api.selectAccount(id).catch(() => null)
      if (!result?.ok) {
        setToast(t('account.switchFailed'))
        return
      }
      applyAccount(result.data)
      await refreshAccounts()
      await loadMailboxes(result.data)
      setToast(t('account.switched'))
    } finally {
      busySwitch.current = false
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (event.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false)
          return
        }
        if (compose) {
          // El compositor escucha Escape en fase de captura y guarda el borrador.
          return
        }
        if (accountOpen) {
          setAccountOpen(false)
          return
        }
        if (view === 'settings') setView('mailbox')
        return
      }

      const combo = comboFromEvent(event)
      if (!combo) return
      const action = actionForCombo(bindings, combo)

      // Paleta y ajustes funcionan en cualquier vista, incluso con el foco en un input.
      if (action === 'palette') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (action === 'settings') {
        event.preventDefault()
        setView((current) => (current === 'settings' ? 'mailbox' : 'settings'))
        return
      }

      if (typing || paletteOpen || compose !== null || accountOpen || view === 'settings') return

      switch (action) {
        case 'next':
          event.preventDefault()
          step(1)
          break
        case 'prev':
          event.preventDefault()
          step(-1)
          break
        case 'archive':
          archive()
          break
        case 'star':
          toggleStar()
          break
        case 'snooze':
          setToast(live ? t('toast.readOnly') : t('toast.snoozed'))
          break
        case 'read':
          toggleRead()
          break
        case 'reply':
          openReply()
          break
        case 'compose':
          openCompose()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const accountLabel = live
    ? account?.account?.user ?? ''
    : account?.configured
      ? t('account.connect')
      : t('account.demo')

  const syncLabel = !live
    ? t('sidebar.demo')
    : sync.offline
      ? t('sidebar.offline')
      : sync.syncedAt
        ? t('sidebar.syncedAgo', { time: formatAgo(now - sync.syncedAt) })
        : t('sidebar.syncing')

  const outboxFailed = outbox.find((item) => item.status === 'failed') ?? null

  // Mientras no sepamos si hay cuenta ni si ya pasó por la bienvenida, no se
  // pinta la bandeja: sin este corte, la demo aparece y el onboarding encima.
  const booting = account === null || !settingsLoaded
  if (booting) return <BootSplash />

  return (
    <div className="app">
      <Sidebar
        activeFolder={folder}
        folders={folderViews}
        accountLabel={accountLabel}
        accountConnected={live}
        accounts={accounts}
        activity={activity}
        showTags={!live}
        syncLabel={syncLabel}
        offline={live && sync.offline}
        onSelectFolder={selectFolder}
        onCompose={openCompose}
        onOpenSettings={openSettings}
        onOpenAccount={() => setAccountOpen(true)}
        onExitDemo={() => {
          void window.api.setSettings({ onboarded: false }).then(() => {
            setSettings((current) => ({ ...current, onboarded: false }))
            setAccountOpen(false)
            setPaletteOpen(false)
            setCompose(null)
            setToast(null)
            setView('mailbox')
          }).catch((error: unknown) => {
            setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'IPC' }))
          })
        }}
        onAddAccount={() => setAccountOpen(true)}
        onSelectAccount={(id) => void handleSelectAccount(id)}
        onRefreshAccounts={() => void refreshAccounts()}
      />

      <div className="shell">
        <Topbar
          unreadCount={unreadCount}
          filter={filter}
          live={live}
          query={query}
          onQuery={(next) => {
            setQuery(next)
            setView('mailbox')
          }}
          onFilter={(next) => {
            setFilter(next)
            setView('mailbox')
          }}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={openSettings}
        />

        {live && sync.offline && (
          <div className="offline-strip" role="status">
            <Icon name="cloud_off" size={15} />
            <strong>{t('offline.title')}</strong>
            <span>{t('offline.detail')}</span>
            <button className="offline-strip__retry" type="button" onClick={() => void refreshAccount()}>
              <Icon name="refresh" size={13} />
              {t('offline.retry')}
            </button>
          </div>
        )}

        <div className="panes">
          {view === 'settings' ? (
            <Settings onBack={() => setView('mailbox')} />
          ) : (
            <>
              {query.trim().length >= 2 ? (
                <SearchResults
                  query={query.trim()}
                  hits={hits}
                  loading={searching}
                  selectedKey={selected ? `${folder}:${uidOf(selected.id) ?? ''}` : null}
                  onOpen={openHit}
                />
              ) : (
                <ThreadList
                threads={visible}
                selectedId={selected?.id ?? null}
                filter={filter}
                unreadCount={unreadCount}
                otherCount={otherCount}
                allCount={allCount}
                vipCount={vipCount}
                loading={loadingFolder}
                emptyLabel={
                  live
                    ? filter === 'focused'
                      ? t('list.emptyUnread')
                      : filter === 'other'
                        ? t('list.emptyRead')
                        : t('account.liveEmpty')
                    : undefined
                }
                onFilter={setFilter}
                onSelect={select}
                showVip={!live}
                live={live}
                hasMore={live && threads.length >= listLimit}
                onLoadMore={loadMore}
              />
              )}

              {selected ? (
                <ThreadPane
                  thread={selected}
                  position={Math.max(1, visible.findIndex((thread) => thread.id === selected.id) + 1)}
                  total={visible.length}
                  bindings={bindings}
                  contextOpen={contextOpen}
                  canToggleContext={!live}
                  canMutate={true}
                  unread={selected.unread}
                  onToggleContext={toggleContext}
                  onArchive={archive}
                  onToggleRead={toggleRead}
                  onSnooze={() => setToast(live ? t('toast.readOnly') : t('toast.snoozed'))}
                  onDelete={() => {
                    if (!selected) return
                    if (live) {
                      const uid = uidOf(selected.id)
                      if (uid === null) return
                      setThreads((current) => current.filter((thread) => thread.id !== selected.id))
                      setToast(t('toast.trashed'))
                      void window.api.deleteMessage(folder, uid).then((result) => {
                        if (!result.ok) setToast(t('toast.actionFailed', { error: result.error ?? '' }))
                        void refreshOutbox()
                      })
                      return
                    }
                    setThreads((current) => current.filter((thread) => thread.id !== selected.id))
                    setToast(t('toast.trashed'))
                  }}
                  onStar={toggleStar}
                  onReply={() => openReply()}
                  onOpenAttachment={openAttachment}
                  onQuickDraft={() => openReply(COPILOT_DRAFT)}
                  onPrev={() => step(-1)}
                  onNext={() => step(1)}
                />
              ) : (
                <ThreadPaneEmpty label={live ? t('account.liveEmpty') : undefined} />
              )}

              {!live && (
                <div
                  className={contextOpen ? 'context-shell' : 'context-shell context-shell--closed'}
                  aria-hidden={!contextOpen}
                  inert={!contextOpen}
                >
                  <ContextRail
                    brief={BRIEF}
                    actions={ACTION_ITEMS}
                    slots={SLOTS}
                    onInsertSlot={(slot) => openReply(`Tomorrow at ${slot} works perfectly for the founder call.`)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <StatusBar
          appVersion={appVersion}
          bindings={bindings}
          pending={outbox.length}
          progress={syncProgress}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        threads={visible}
        onClose={() => setPaletteOpen(false)}
        onOpenThread={select}
        onCompose={openCompose}
        onArchive={archive}
        onSnooze={() => setToast(live ? t('toast.readOnly') : t('toast.snoozed'))}
        onSelectFolder={selectFolder}
        onOpenSettings={openSettings}
      />

      <ComposeOverlay
        open={compose !== null}
        to={compose?.to ?? ''}
        subject={compose?.subject ?? ''}
        body={compose?.body ?? ''}
        copilot={!live}
        onClose={(values) => {
          setCompose(null)
          if (!live || !values) return
          const hasContent = values.to.trim() !== '' || values.subject.trim() !== '' || values.body.trim() !== ''
          if (!hasContent) return
          void window.api
            .saveDraft({ ...values, cc: '', updatedAt: Date.now() })
            .then(() => setToast(t('toast.draftSaved')))
            .catch(() => undefined)
        }}
        onPickAttachments={live ? () => window.api.pickAttachments() : undefined}
        onSend={({ to, subject, body, attachments }) => {
          setCompose(null)
          void window.api
            .sendMail({ to, cc: '', subject, text: body, attachments: attachments.map((file) => file.id) })
            .then((result) => {
              if (result.ok) {
                void window.api.clearDraft().catch(() => undefined)
                setToast(result.queued ? t('toast.queued') : t('toast.sent'))
              } else {
                setToast(t('toast.sendFailed', { error: result.error ?? '' }))
              }
              void refreshOutbox()
            })
            .catch(() => setToast(t('toast.sendFailed', { error: 'IPC' })))
        }}
      />

      <AccountDialog
        open={accountOpen}
        account={account}
        onClose={() => {
          setAccountOpen(false)
          void refreshAccount()
        }}
        onConnected={onConnected}
      />

      {onboarding && (
        <Onboarding
          onConnected={onConnected}
          onDemo={() => {
            markOnboarded()
            setToast(t('onboarding.demoStarted'))
          }}
        />
      )}

      {liveError && (
        <div className="live-banner" role="alert">
          <Icon name="error" size={16} />
          <div>
            <strong>{t(ERROR_KEYS[liveError.code])}</strong>
            <span>{liveError.detail}</span>
          </div>
          <button className="icon-btn" type="button" onClick={() => setLiveError(null)} title={t('common.close')}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {outboxFailed && (
        <div className="live-banner" role="alert">
          <Icon name="outbox" size={16} />
          <div>
            <strong>{t('outbox.failed', { label: outboxFailed.label })}</strong>
            <span>{outboxFailed.lastError ?? ''}</span>
          </div>
          <button className="btn btn--primary" type="button" onClick={() => void window.api.retryOutbox(outboxFailed.id)}>
            {t('offline.retry')}
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={() => void window.api.cancelOutbox(outboxFailed.id)}
            title={t('common.close')}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Icon name="check_circle" size={16} />
          {toast}
        </div>
      )}
    </div>
  )
}

export default App
