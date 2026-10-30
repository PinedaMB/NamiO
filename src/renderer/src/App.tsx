import { usePreferences } from './settings/PreferencesProvider'
import { isSelectAll, selectTextContents } from './lib/selection'
import { flushSync } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  NotificationTarget,
  AttachmentPreview,
  Draft,
  AccountState,
  AccountActivity,
  AccountSummary,
  AppSettings,
  CoreStatus,
  ImapErrorCode,
  MailboxInfo,
  OutboxItem,
  SearchHit,
  SyncProgress,
  EnvelopeListOptions
} from '@shared/ipc'
import { isDraftMailbox, isSpamMailbox, sidebarMailboxes } from '@shared/mailboxes'
import { ACTION_ITEMS, BRIEF, COPILOT_DRAFT, FOLDERS, SLOTS, THREADS, type Thread } from './data/demo'
import { detailToMessage, pendingDraftThreads, envelopesToThreads, mailboxToFolder, type FolderView } from './data/live'
import { Sidebar } from './components/Sidebar'
import { Topbar, type FilterId } from './components/Topbar'
import { ContextMenu, type ContextAnchor, type ContextAction } from './components/ContextMenu'
import { DocumentViewer } from './components/DocumentViewer'
import { ImageViewer } from './components/ImageViewer'
import { ThreadList } from './components/ThreadList'
import { SearchResults } from './components/SearchResults'
import { MoveDialog } from './components/MoveDialog'
import { ThreadPane, ThreadPaneEmpty } from './components/ThreadPane'
import { ContextRail } from './components/ContextRail'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { ComposeOverlay, type ReplyContext } from './components/ComposeOverlay'
import { Settings } from './components/Settings'
import { AccountDialog, ERROR_KEYS } from './components/AccountDialog'
import { BootSplash } from './components/BootSplash'
import { Onboarding } from './components/Onboarding'
import { Icon } from './components/Icon'
import { TooltipButton } from './components/Tooltip'
import { useI18n } from './i18n'
import { useShortcuts } from './settings/ShortcutsProvider'
import { actionForCombo, comboFromEvent } from './settings/shortcuts'
import { replyComposeHtml } from './lib/composeHtml'
import { formatElapsed, formatMessageDateTime } from './lib/dates'

type ComposeState = Omit<Draft, 'updatedAt' | 'cc'> & { cc?: string; reply?: ReplyContext }

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
      return Boolean(thread.hasAttachments) || thread.messages.some((message) => (message.attachments?.length ?? 0) > 0)
    case 'needs-reply':
      // Heurística de demo: lo que es VIP y sigue sin leer es lo que espera respuesta.
      return thread.unread && thread.vip
    default:
      return true
  }
}

function sortThreads(threads: readonly Thread[], oldestFirst: boolean): Thread[] {
  // La demo ya viene ordenada y usa fechas de presentación, sin timestamp.
  if (threads.every(thread => thread.date === undefined)) return oldestFirst ? [...threads].reverse() : [...threads]
  const timestamp = (thread: Thread): number => {
    const value = thread.date === undefined ? NaN : new Date(thread.date).getTime()
    return Number.isFinite(value) ? value : 0
  }
  return [...threads].sort((a, b) => oldestFirst ? timestamp(a) - timestamp(b) : timestamp(b) - timestamp(a))
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
    const ids = thread.messageIds ?? [uidOf(thread.id)]
    const messages = old.messages.filter(message => ids.includes(uidOf(message.id)))
    if (JSON.stringify({ ...old, messages: [] }) === JSON.stringify({ ...thread, messages: [] })) return old
    return { ...thread, messages }
  })
}

function uidOf(threadId: string): number | null {
  if (!threadId.startsWith('live:')) return null
  const uid = Number(threadId.slice(5))
  return Number.isInteger(uid) ? uid : null
}

export function App(): React.JSX.Element {
  const { timeFormat } = usePreferences()
  const { t, locale } = useI18n()
  const { bindings } = useShortcuts()

  const [openingNotification, setOpeningNotification] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [notificationTarget, setNotificationTarget] = useState<NotificationTarget | null>(null)
  const [view, setView] = useState<View>('mailbox')
  const [threads, setThreads] = useState<readonly Thread[]>(THREADS)
  const [contextMenu, setContextMenu] = useState<(ContextAnchor & { kind: 'message' | 'folder'; id: string; messageId?: string }) | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [individualMessageId, setIndividualMessageId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const bulkRunning = useRef(false)
  const togglingRead = useRef(false)
  const [filter, setFilter] = useState<FilterId>('focused')
  const [oldestFirst, setOldestFirst] = useState(false)
  const [folder, setFolder] = useState('inbox')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [localDrafts, setLocalDrafts] = useState<Draft[]>([])
  const [composeMinimized, updateComposeMinimized] = useState(false)
  const composeTransition = useRef<ViewTransition | null>(null)
  const setComposeMinimized = (minimized: boolean): void => {
    if (minimized === composeMinimized) return
    composeTransition.current?.skipTransition()
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      updateComposeMinimized(minimized)
      return
    }
    composeTransition.current = document.startViewTransition(() => {
      flushSync(() => updateComposeMinimized(minimized))
    })
    // Una restauración rápida interrumpe la captura anterior sin cancelar el cambio.
    void composeTransition.current.ready.catch(() => {})
  }
  const [composeSession, setComposeSession] = useState(0)
  const [compose, setCompose] = useState<ComposeState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [compactWindow, setCompactWindow] = useState(() => window.matchMedia('(max-width: 1280px)').matches)
  const [compactNavExpanded, setCompactNavExpanded] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const railCollapsed = compactWindow ? !compactNavExpanded : sidebarCollapsed
  useEffect(() => {
    if (messageOpen && window.matchMedia('(max-width: 960px)').matches) {
      document.querySelector<HTMLButtonElement>('.reading__back')?.focus()
    }
  }, [messageOpen])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1280px)')
    const update = (): void => { setCompactWindow(media.matches); setCompactNavExpanded(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const [contextOpen, setContextOpen] = useState(true)

  const [account, setAccount] = useState<AccountState | null>(null)
  const [accounts, setAccounts] = useState<readonly AccountSummary[]>([])
  const [activity, setActivity] = useState<readonly AccountActivity[]>([])
  const [accountOpen, setAccountOpen] = useState(false)
  const [addingAccount, setAddingAccount] = useState(false)
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
  const [query, setQueryValue] = useState('')
  const [searchOffset, setSearchOffset] = useState(0)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [searchRetry, setSearchRetry] = useState(0)
  const setQuery = (value: string): void => {
    setSearchOffset(0)
    setSearchHasMore(false)
    setQueryValue(value)
  }
  const [attachmentPreview, setAttachmentPreview] = useState<{ attachment?: AttachmentPreview; kind: 'image' | 'pdf' | 'text'; title: string; error?: boolean; save: () => void } | null>(null)
  const attachmentRequest = useRef(0)
  const [savingAttachment, setSavingAttachment] = useState<{ mailbox: string; messageId: string; index: number } | null>(null)
  const savingAttachmentRef = useRef(false)
  const [hits, setHits] = useState<readonly SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const busySwitch = useRef(false)
  const manualSyncBusy = useRef(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const deletingMessage = useRef(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; path: string; generation: number } | null>(null)
  const [manualSyncing, setManualSyncing] = useState(false)

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
  const [listCounts, setListCounts] = useState<{ total: number; unread: number } | null>(null)
  const listOptions = useRef<EnvelopeListOptions>({})
  const filterFocusUid = useRef<number | undefined>(undefined)
  listOptions.current = { filter: filter === 'focused' ? 'unread' : filter === 'other' ? 'read' : 'all', oldestFirst, includeUid: uidOf(selectedId ?? '') ?? undefined }
  const loadingMoreRef = useRef(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  /** Solo se marca leído lo que el usuario abrió; la selección automática no cuenta. */
  const userNavigated = useRef(false)

  // "live" = hay cuenta configurada. La conexión puede faltar: en ese caso se
  // sirve la caché local (modo offline), no los datos de demostración.
  const live = account?.configured === true

  const accountIdentity = useRef<string | null>(null)
  const accountGeneration = useRef(0)
  const folderRequest = useRef(0)
  const activeFolderRef = useRef('inbox')
  const applyAccount = useCallback((state: AccountState): void => {
    const identity = state.account
      ? JSON.stringify([state.account.host, state.account.port, state.account.user])
      : null
    if (identity !== accountIdentity.current) {
      accountIdentity.current = identity
      accountGeneration.current += 1
      setThreads([])
      setListCounts(null)
      setSelectedId(null)
      setIndividualMessageId(null)
      setLocalDrafts([])
      setMailboxes([])
      setQuery('')
      setHits([])
      setAttachmentPreview(null)
      attachmentRequest.current += 1
      setSearching(false)
      setLoadingFolder(state.configured)
      setFolder('inbox')
      activeFolderRef.current = 'inbox'
      folderRequest.current += 1
      setLiveError(null)
      setSync({ offline: false, syncedAt: null })
      setSyncProgress(null)
      setOutbox([])
    }
    setAccount(state)
  }, [])

  const draftsFolder = live && mailboxes.some(box => box.path === folder && isDraftMailbox(box))
  const listedThreads = useMemo(() => draftsFolder
    ? pendingDraftThreads(threads, localDrafts, folder, locale, t('draft.local')) : threads,
  [draftsFolder, threads, localDrafts, folder, locale, t])

  const filteredThreads = useMemo(() => {
    if (live) {
      // El hilo abierto sigue visible aunque se marque leído: si desapareciera
      // del filtro, la selección saltaría al siguiente y lo marcaría leído
      // también (cascada de mensajes "leídos" sin abrir).
      if (filter === 'focused') return listedThreads.filter((thread) => thread.unread || thread.id === selectedId)
      if (filter === 'other') return listedThreads.filter((thread) => !thread.unread || thread.id === selectedId)
      if (filter === 'all') return listedThreads
      return listedThreads
    }
    return listedThreads.filter((thread) => matchesFolder(thread, folder) && matchesFilter(thread, filter))
  }, [live, listedThreads, filter, folder, selectedId])
  const visible = useMemo(() => sortThreads(filteredThreads, oldestFirst), [filteredThreads, oldestFirst])

  useEffect(() => {
    setCheckedIds([])
    setContextMenu(null)
  }, [folder, filter, query, account?.account?.host, account?.account?.port, account?.account?.user])

  useEffect(() => {
    setCheckedIds((current) => current.filter((id) => threads.some((thread) => thread.id === id)))
  }, [threads])

  const bulkAction = async (action: 'read' | 'archive' | 'delete'): Promise<void> => {
    if (bulkRunning.current || deletingMessage.current) return
    bulkRunning.current = true
    setBulkBusy(true)
    const generation = accountGeneration.current
    const request = folderRequest.current
    try {
      if (live && action === 'delete') {
        const ids = checkedIds.filter(id => threads.some(thread => thread.id === id))
        const uids = ids.map(uidOf).filter((uid): uid is number => uid !== null)
        if (!uids.length) return
        const result = await window.api.deleteMessages(folder, uids)
        if (!result.ok) throw new Error(result.error ?? 'IPC')
        if (result.canceled || generation !== accountGeneration.current || request !== folderRequest.current) return
        setCheckedIds(current => current.filter(id => !ids.includes(id)))
        setToast(t('toast.deletingBackground'))
        return
      }
      for (const id of checkedIds) {
        if (generation !== accountGeneration.current || request !== folderRequest.current) break
        if (!threads.some((thread) => thread.id === id)) continue
        if (live) {
          const uid = uidOf(id)
          if (uid === null) continue
          const result = action === 'read'
            ? await window.api.setSeen(folder, uid, true)
            : await window.api.archiveMessage(folder, uid)
          if (generation !== accountGeneration.current || request !== folderRequest.current) break
          if (!result.ok) throw new Error('detail' in result ? result.detail : result.error ?? 'IPC')
          if ('canceled' in result && result.canceled) break
          if ('queued' in result && result.queued) {
            setToast(t('toast.queued'))
            setCheckedIds((current) => current.filter((checked) => checked !== id))
            continue
          }
        }
        setThreads((current) => action === 'read'
          ? current.map((thread) => thread.id === id ? { ...thread, unread: false } : thread)
          : current.filter((thread) => thread.id !== id))
        setCheckedIds((current) => current.filter((checked) => checked !== id))
      }
    } catch (error) {
      if (generation === accountGeneration.current) setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'IPC' }))
    } finally {
      bulkRunning.current = false
      setPendingDelete(null)
      setBulkBusy(false)
      void refreshOutbox()
    }
  }

  const selected = useMemo(
    () => selectedId === null ? null : listedThreads.find((thread) => thread.id === selectedId) ?? visible[0] ?? null,
    [listedThreads, selectedId, visible]
  )

  const unreadCount = live && listCounts ? listCounts.unread : listedThreads.filter((thread) => thread.unread).length
  const otherCount = live && listCounts ? listCounts.total - listCounts.unread : listedThreads.filter((thread) => !thread.unread).length
  const allCount = live && listCounts ? listCounts.total : listedThreads.length
  const vipCount = threads.filter((thread) => thread.vip).length

  const folderViews = useMemo<readonly FolderView[]>(() => {
    if (live) return sidebarMailboxes(mailboxes).map(mailboxToFolder)
    return FOLDERS.map((item) => ({
      id: item.id,
      icon: item.icon,
      label: t(item.labelKey),
      count: item.count,
      accent: item.accent
    }))
  }, [live, mailboxes, t])

  const loadFolder = useCallback(
    async (path: string, focusUid?: number, sync = true): Promise<void> => {
      const generation = accountGeneration.current
      const request = ++folderRequest.current
      activeFolderRef.current = path
      setThreads([])
      setSelectedId(null)
      setIndividualMessageId(null)
      setLoadingFolder(true)
      setFolder(path)
      setListLimit(PAGE_SIZE)
      setListCounts(null)
      if (focusUid === undefined) setSelectedId(null)
      try {
        const result = await window.api.listEnvelopes(path, PAGE_SIZE, sync, { ...listOptions.current, includeUid: focusUid }).catch(() => null)
        if (generation !== accountGeneration.current || request !== folderRequest.current) return
        const drafts = await window.api.listDrafts().catch(() => [])
        if (generation !== accountGeneration.current || request !== folderRequest.current) return
        setLocalDrafts(drafts)

        if (!result) return
        if (!result.ok) {
          setLiveError({ code: result.code, detail: result.detail })
          return
        }

        setSync({ offline: result.meta.offline, syncedAt: result.meta.syncedAt })
        setListCounts(result.counts ?? null)
        let envelopes = result.data
        if (focusUid !== undefined && !envelopes.some(envelope => envelope.uid === focusUid)) {
          const message = await window.api.getMessage(path, focusUid).catch(() => null)
          if (generation !== accountGeneration.current || request !== folderRequest.current) return
          if (!message?.ok) {
            setLiveError({ code: message && !message.ok ? message.code : 'unknown', detail: message && !message.ok ? message.detail : 'IPC' })
            return
          }
          envelopes = [...envelopes, message.data]
        }
        const mapped = envelopesToThreads(envelopes, locale)
        setThreads(mapped)
        userNavigated.current = false
        setSelectedId(focusUid !== undefined ? `live:${focusUid}` : null)
        setLiveError(null)
      } finally {
        if (generation === accountGeneration.current && request === folderRequest.current) setLoadingFolder(false)
      }
    },
    [locale]
  )

  useEffect(() => {
    const focusUid = filterFocusUid.current
    filterFocusUid.current = undefined
    if (live) void loadFolder(activeFolderRef.current, focusUid, false)
  }, [filter, oldestFirst])

  useEffect(() => {
    if (!live || !mailboxes.some(mailbox => mailbox.path === folder)) return
    if (sidebarMailboxes(mailboxes).some(mailbox => mailbox.path === folder)) return
    const junk = mailboxes.find(mailbox => mailbox.specialUse === '\\Junk')
    if (junk) void loadFolder(junk.path)
  }, [live, mailboxes, folder, loadFolder])

  /** Marca leído un hilo concreto (estado local + `\Seen` en el servidor). */
  const markRead = useCallback(
    (path: string, uid: number, id: string): void => {
      setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, unread: false } : thread)))
      if (live) void window.api.setSeen(path, uid, true).catch(() => undefined)
    },
    [live]
  )

  /** Carga el resultado explícito aunque esté fuera de la tanda visible. */
  const openHit = useCallback(
    (hit: SearchHit): void => {
      setMessageOpen(true)
      const generation = accountGeneration.current
      const pending = loadFolder(hit.mailbox, hit.uid, false)
      const request = folderRequest.current
      void pending.then(() => {
        if (generation !== accountGeneration.current || request !== folderRequest.current) return
        userNavigated.current = true
        setIndividualMessageId(`live:${hit.uid}`)
        if (hit.unread) markRead(hit.mailbox, hit.uid, `live:${hit.uid}`)
      })
    },
    [loadFolder, markRead]
  )

  // Cada página pide un resultado extra para saber si quedan más coincidencias.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setHits([])
      setSearching(false)
      setSearchHasMore(false)
      setSearchError(false)
      return
    }

    let cancelled = false
    const generation = accountGeneration.current
    setSearching(true)
    setSearchError(false)
    if (searchOffset === 0) setHits([])
    const timer = window.setTimeout(() => {
      void window.api
        .search(trimmed, 61, searchOffset)
        .then((result) => {
          if (cancelled || generation !== accountGeneration.current) return
          setHits(previous => searchOffset === 0 ? result.slice(0, 60) : [...previous, ...result.slice(0, 60)])
          setSearchHasMore(result.length > 60)
          setSearching(false)
        })
        .catch(() => {
          if (cancelled || generation !== accountGeneration.current) return
          setSearchError(true)
          setSearching(false)
        })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, searchOffset, searchRetry])

  /** Relee la caché sin tocar la red: lo usa el aviso de "buzón sincronizado". */
  const refreshFromCache = useCallback(async (): Promise<void> => {
    if (folder !== activeFolderRef.current) return
    const request = folderRequest.current
    const generation = accountGeneration.current
    const boxes = await window.api.listMailboxes(false).catch(() => null)
    if (generation !== accountGeneration.current || request !== folderRequest.current) return
    if (boxes?.ok) setMailboxes(boxes.data)

    const list = await window.api.listEnvelopes(folder, listLimit, false, listOptions.current).catch(() => null)
    if (generation !== accountGeneration.current || request !== folderRequest.current || !list?.ok) return

    const drafts = await window.api.listDrafts().catch(() => [])
    if (generation !== accountGeneration.current || request !== folderRequest.current) return
    setLocalDrafts(drafts)
    setListCounts(list.counts ?? null)
    setSync({ offline: list.meta.offline, syncedAt: list.meta.syncedAt })
    const mapped = envelopesToThreads(list.data, locale)
    setThreads((previous) => mergeLoaded(previous, mapped))
    setSelectedId((current) => (current === null || mapped.some((thread) => thread.id === current) ? current : (mapped[0]?.id ?? null)))
  }, [folder, locale, listLimit])

  const handleSync = async (path = folder): Promise<void> => {
    if (!live || manualSyncBusy.current) return
    manualSyncBusy.current = true
    setManualSyncing(true)
    const generation = accountGeneration.current
    const request = folderRequest.current
    try {
      const result = await window.api.syncMailbox(path)
      if (generation !== accountGeneration.current) return
      if (!result.ok) {
        setLiveError({ code: result.code, detail: result.detail })
        return
      }
      setLiveError(null)
      if (path === folder && request === folderRequest.current) await refreshFromCache()
      void refreshAccounts()
    } catch (error) {
      if (generation === accountGeneration.current) {
        setLiveError({ code: 'unknown', detail: error instanceof Error ? error.message : 'IPC' })
      }
    } finally {
      manualSyncBusy.current = false
      setManualSyncing(false)
    }
  }

  /** Trae otra tanda de la caché (la descarga completa ya está en disco). */
  const loadMore = useCallback(async (): Promise<void> => {
    if (!live || loadingFolder || loadingMoreRef.current || folder !== activeFolderRef.current) return
    const request = folderRequest.current
    const next = listLimit + 100

    const generation = accountGeneration.current
    loadingMoreRef.current = true
    try {
      const result = await window.api.listEnvelopes(folder, next, false, listOptions.current).catch(() => null)
      if (generation !== accountGeneration.current || request !== folderRequest.current || !result?.ok) return

      const mapped = envelopesToThreads(result.data, locale)
      setListLimit(next)
      setListCounts(result.counts ?? null)
      setThreads((previous) => mergeLoaded(previous, mapped))
      setSelectedId((current) =>
        current === null || mapped.some((thread) => thread.id === current) ? current : (mapped[0]?.id ?? null)
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
      setLoadingFolder(true)
      try {
        const result = await window.api.listMailboxes(true).catch(() => null)
        if (generation !== accountGeneration.current || !result) return
        if (!result.ok) {
          setLiveError({ code: result.code, detail: result.detail })
          return
        }
        setSync({ offline: result.meta.offline, syncedAt: result.meta.syncedAt })
        setMailboxes(result.data)
        const inbox = result.data.find(box => box.specialUse === '\\Inbox' || box.path.toUpperCase() === 'INBOX') ?? result.data[0]
        if (inbox) await loadFolder(inbox.path)
        void state
      } finally {
        if (generation === accountGeneration.current) setLoadingFolder(false)
      }
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
    setSelectedId(null)
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
    const drafts = await window.api.listDrafts().catch(() => [])
    if (generation === accountGeneration.current) setLocalDrafts(drafts)
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
    if (selectedId === null || visible.some((thread) => thread.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [visible, selectedId])

  /** En modo real, abrir un hilo dispara una descarga de la fuente del mensaje. */
  useEffect(() => {
    if (view === 'settings' || !live || !selected || folder !== activeFolderRef.current) return
    const request = folderRequest.current
    const uid = uidOf(selected.id)
    if (uid === null) return

    const missing = (selected.messageIds ?? [uid]).filter(messageUid => !selected.messages.some(message => message.id === `live:${messageUid}`))
    if (missing.length === 0) return
    let cancelled = false
    const generation = accountGeneration.current
    const firstUid = individualMessageId ? uidOf(individualMessageId) : selected.messageIds?.at(-1) ?? uid
    const ordered = [...missing].reverse()
    if (firstUid !== null && ordered.includes(firstUid)) {
      ordered.splice(ordered.indexOf(firstUid), 1)
      ordered.unshift(firstUid)
    }
    void (async () => {
      for (const messageUid of ordered) {
        if (cancelled) return
        const result = await window.api.getMessage(folder, messageUid).catch(() => null)
        if (cancelled || generation !== accountGeneration.current || request !== folderRequest.current) return
        if (!result?.ok) {
          setLiveError({ code: result && !result.ok ? result.code : 'unknown', detail: result && !result.ok ? result.detail : 'IPC' })
          continue
        }
        const message = detailToMessage(result.data, locale, result.meta.partial === true)
        if (result.meta.partial) setToast(t('offline.bodyUnavailable'))
        setThreads(current => current.map(thread => {
          if (thread.id !== selected.id) return thread
          const loaded = new Map([...thread.messages, message].map(item => [item.id, item]))
          return { ...thread, messages: (thread.messageIds ?? [uid]).flatMap(messageUid => loaded.get(`live:${messageUid}`) ?? []) }
        }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [live, selected?.id, selected?.messageIds?.join(','), individualMessageId, folder, locale, view])

  const select = (id: string, messageId?: string): void => {
    if (!draftsFolder) setMessageOpen(true)
    setIndividualMessageId(messageId ?? null)
    userNavigated.current = true
    setSelectedId(id)

    if (live && draftsFolder) {
      if (compose) { setComposeMinimized(false); setToast(t('compose.finishFirst')); return }
      const generation = accountGeneration.current
      const request = folderRequest.current
      const draft = id.startsWith('draft:') ? window.api.getDraft(id.slice(6)) : window.api.openDraft(folder, uidOf(id) ?? 0)
      void draft.then(value => {
        if (!value || generation !== accountGeneration.current || request !== folderRequest.current) return
        setComposeSession(session => session + 1)
        setCompose(value)
      }).catch(error => setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'IPC' })))
      return
    }
    const thread = threads.find((item) => item.id === id)
    const uid = uidOf(id)
    if (thread?.unread && uid !== null) markRead(folder, uid, id)
  }

  const selectFolder = (id: string): void => {
    setMessageOpen(false)
    setCompactNavExpanded(false)
    if (mailboxes.some(box => box.path === id && isDraftMailbox(box))) setFilter('all')
    setView('mailbox')
    if (live) {
      void loadFolder(id)
      return
    }
    setFolder(id)
  }

  const openSettings = (): void => {
    setPaletteOpen(false)
    setContextMenu(null)
    setView('settings')
  }

  const step = (delta: number): void => {
    if (visible.length === 0) return
    const current = visible.findIndex((thread) => thread.id === selected?.id)
    const next = visible[(current + delta + visible.length) % visible.length]
    if (next) select(next.id)
  }

  /** Descarga un adjunto y lo guarda donde el usuario elija. */
  const openAttachment = (index: number, messageId?: string): void => {
    if (!selected) return
    if (!live) {
      setToast(t('toast.attachmentOffline'))
      return
    }
    const uid = uidOf(messageId ?? selected.id)
    if (uid === null) return

    const generation = accountGeneration.current
    const save = async (): Promise<void> => {
      if (savingAttachmentRef.current) return
      savingAttachmentRef.current = true
      setSavingAttachment({ mailbox: folder, messageId: messageId ?? selected.id, index })
      try {
        const saved = await window.api.saveAttachment(folder, uid, index)
        if (saved && generation === accountGeneration.current) setToast(t('toast.saved', { path: saved }))
      } catch (error) {
        if (generation === accountGeneration.current) setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'adjunto' }))
      } finally {
        savingAttachmentRef.current = false
        setSavingAttachment(null)
      }
    }
    const message = selected.messages.find(item => item.id === (messageId ?? selected.id))
    const attachment = message?.attachments?.[index]
    if (!attachment || (attachment.kind !== 'image' && attachment.kind !== 'pdf' && attachment.kind !== 'text')) { void save(); return }
    const kind = attachment.kind
    const request = ++attachmentRequest.current
    setAttachmentPreview({ kind, title: attachment.name, save })
    void window.api.previewAttachment(folder, uid, index).then(image => {
      if (request === attachmentRequest.current && generation === accountGeneration.current) setAttachmentPreview({ kind, title: image.name, attachment: image, save })
    }).catch(() => {
      if (request === attachmentRequest.current && generation === accountGeneration.current) setAttachmentPreview({ kind, title: attachment.name, error: true, save })
    })
  }

  /** Alterna leído/no leído; en modo real escribe `\Seen` en el servidor. */
  const toggleRead = async (): Promise<void> => {
    if (!selected || togglingRead.current) return
    const nextUnread = !selected.unread
    const generation = accountGeneration.current
    const request = folderRequest.current
    togglingRead.current = true
    try {
      if (live) {
        const uid = uidOf(selected.id)
        if (uid === null) return
        const result = await window.api.setSeen(folder, uid, !nextUnread)
        if (generation !== accountGeneration.current || request !== folderRequest.current) return
        if (!result.ok) throw new Error(result.detail)
      }
      setThreads(current => current.map(thread => thread.id === selected.id ? { ...thread, unread: nextUnread } : thread))
      setToast(nextUnread ? t('toast.markedUnread') : t('toast.markedRead'))
    } catch (error) {
      if (generation === accountGeneration.current && request === folderRequest.current) {
        setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'IPC' }))
      }
    } finally {
      togglingRead.current = false
    }
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

  const moveSelected = (target: string): void => {
    if (!live || !selected || bulkRunning.current || deletingMessage.current || selected.id.startsWith('draft:') || target === folder || !mailboxes.some(box => box.path === target)) return
    const uid = uidOf(selected.id)
    if (uid === null) return
    const id = selected.id
    const generation = accountGeneration.current
    const request = folderRequest.current
    bulkRunning.current = true
    setBulkBusy(true)
    setMovingId(id)
    setMoveOpen(false)
    void window.api.moveMessage(folder, uid, target).then(result => {
      if (generation !== accountGeneration.current || request !== folderRequest.current) return
      if (!result.ok) setToast(t('toast.actionFailed', { error: result.error ?? '' }))
      else if (result.queued) setToast(t('toast.queued'))
      else {
        setThreads(current => current.filter(thread => thread.id !== id))
        setToast(t('move.done', { folder: target }))
      }
    }).catch((error: unknown) => {
      if (generation === accountGeneration.current && request === folderRequest.current) setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'IPC' }))
    }).finally(() => {
      bulkRunning.current = false
      setBulkBusy(false)
      setMovingId(null)
      void refreshOutbox()
    })
  }

  useEffect(() => { setMoveOpen(false) }, [folder, selectedId, account?.account?.host, account?.account?.port, account?.account?.user])

  const deleteSelected = (): void => {
    if (!selected || deletingMessage.current || bulkRunning.current) return
    if (live) {
      const uid = uidOf(selected.id)
      if (uid === null) return
      deletingMessage.current = true
      const id = selected.id
      const generation = accountGeneration.current
      const request = folderRequest.current
      setPendingDelete({ id, path: folder, generation })
      const permanent = mailboxes.some((box) => box.path === folder && (box.specialUse === '\\Trash' || /^(trash|deleted items|deleted messages|papelera|elementos eliminados)$/i.test(box.name)))
      void window.api.deleteMessage(folder, uid).then((result) => {
        if (generation !== accountGeneration.current || request !== folderRequest.current || result.canceled) return
        if (!result.ok) setToast(t('toast.actionFailed', { error: result.error ?? '' }))
        else if (result.queued) setToast(t('toast.queued'))
        else {
          setThreads((current) => current.filter((thread) => thread.id !== id))
          setToast(t(permanent ? 'toast.deleted' : 'toast.trashed'))
        }
        void refreshOutbox()
      }).catch((error: unknown) => {
        if (generation === accountGeneration.current && request === folderRequest.current) setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'IPC' }))
      }).finally(() => { deletingMessage.current = false; setPendingDelete(null) })
      return
    }
    setThreads((current) => current.filter((thread) => thread.id !== selected.id))
    setToast(t('toast.trashed'))
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

  const openReply = (body = '', replyAll = false): void => {
    if (compose) { setComposeMinimized(false); setToast(t('compose.finishFirst')); return }
    if (!selected) return
    setComposeMinimized(false)
    const message = selected.messages.find(item => item.id === (individualMessageId ?? selected.id)) ?? selected.messages.at(-1)
    const sender = message?.from ?? selected.participants[0]
    const seen = new Set([account?.account?.user.trim().toLowerCase() ?? ''])
    const recipients = (people: readonly { email: string }[]): string => people.map(person => person.email.trim()).filter(email => {
      const key = email.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).join(', ')
    const allTo = recipients([...(sender ? [sender] : []), ...(message?.to ?? [])])
    const allCc = recipients(message?.cc ?? [])
    const to = replyAll ? allTo : sender?.email ?? ''
    const cc = replyAll ? allCc : ''
    const original = (message?.body ?? []).join('\n\n')
    const quoted = original ? original.split('\n').map(line => `> ${line}`).join('\n') : ''
    const attribution = message ? `${message.date !== undefined ? formatMessageDateTime(message.date, locale, false, timeFormat) : message.sentAt}, ${sender?.name ?? ''} <${sender?.email ?? ''}>:` : ''
    const prefix = selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`

    setComposeSession(session => session + 1)
    setCompose({
      to,
      cc,
      reply: { mode: replyAll ? 'all' : 'sender', sender: sender?.email ?? '', to: allTo, cc: allCc },
      subject: prefix,
      inReplyTo: message?.messageId,
      references: [message?.inReplyTo, message?.messageId].filter((id): id is string => Boolean(id)),
      body: [body, attribution, quoted].filter((part) => part !== '').join('\n\n'),
      html: replyComposeHtml(body, attribution, original, t('compose.originalMessage'), message?.html)
    })
  }

  const openCompose = (): void => {
    if (compose) { setComposeMinimized(false); return }
    setComposeMinimized(false)
    setComposeSession(session => session + 1)
    setCompose({ to: '', subject: '', body: '' })
  }

  const restoreDraft = async (): Promise<void> => {
    const generation = accountGeneration.current
    const draft = await window.api.getDraft()
    if (generation !== accountGeneration.current) return
    if (!draft) { setToast(t('draft.empty')); return }
    setComposeSession(session => session + 1)
    setComposeMinimized(false)
    setCompose(draft)
    setToast(t('draft.restored'))
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
    if (compose) { setComposeMinimized(false); setToast(t('compose.finishFirst')); return }
    if (busySwitch.current) return
    busySwitch.current = true
    setSwitchingAccount(true)
    try {
      const result = await window.api.selectAccount(id).catch(() => null)
      if (!result?.ok) {
        setToast(t('account.switchFailed'))
        return
      }
      applyAccount(result.data)
      setMessageOpen(false)
      void refreshAccounts()
      await loadMailboxes(result.data)
      setToast(t('account.switched'))
    } finally {
      busySwitch.current = false
      setSwitchingAccount(false)
    }
  }

  useEffect(() => window.api?.onNotificationOpen?.((target) => {
    setNotificationTarget(target)
    if (compose && target.identity !== accountIdentity.current) {
      setComposeMinimized(false)
      setToast(t('compose.finishFirst'))
    }
  }), [compose, t])

  useEffect(() => {
    if (!notificationTarget || switchingAccount || openingNotification) return
    if (compose && notificationTarget.identity !== accountIdentity.current) return
    setOpeningNotification(true)
    const open = async (): Promise<void> => {
      try {
        if (notificationTarget.identity !== accountIdentity.current) {
          await handleSelectAccount(notificationTarget.accountId)
        }
        if (notificationTarget.identity === accountIdentity.current) {
          setView('mailbox')
          if (listOptions.current.filter !== 'all') filterFocusUid.current = notificationTarget.uid
          setFilter('all')
          setQuery('')
          await loadFolder(notificationTarget.path, notificationTarget.uid)
          setMessageOpen(true)
        }
      } finally {
        setNotificationTarget(current => current === notificationTarget ? null : current)
        setOpeningNotification(false)
      }
    }
    void open()
  }, [notificationTarget, compose, switchingAccount, openingNotification, loadFolder])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target !== null &&
        ((target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes((target as HTMLInputElement).type)) || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (isSelectAll(event)) {
        if (event.defaultPrevented || typing || target?.tagName === 'SELECT') return
        event.preventDefault()
        if (paletteOpen || accountOpen || (compose && !composeMinimized) || view === 'settings') return
        const list = target?.closest('.list')
        if (list) {
          if (query.trim().length >= 2) {
            const results = list.querySelector('.search-results-list')
            if (results) selectTextContents(results)
          } else if (!bulkBusy && pendingDelete === null) {
            setCheckedIds(visible.filter(thread => !thread.id.startsWith('draft:')).map(thread => thread.id))
          }
          return
        }
        const reading = target?.closest('.reading')
        if (reading || target === document.body) {
          const message = target?.closest('.thread-message[open]') ?? (reading ?? document.querySelector('.reading'))?.querySelector('.thread-message[open]')
          const frame = message?.querySelector<HTMLIFrameElement>('.email-body__frame')
          if (frame?.contentDocument?.body) {
            frame.focus()
            selectTextContents(frame.contentDocument.body)
          } else {
            const body = message?.querySelector('.body')
            if (body) selectTextContents(body)
          }
        }
        return
      }

      if (event.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false)
          return
        }
        if (compose && !composeMinimized) {
          // El compositor escucha Escape en fase de captura y guarda el borrador.
          return
        }
        if (accountOpen) {
          setAccountOpen(false)
          return
        }
        if (view === 'settings') {
          setView('mailbox')
          return
        }
        if (event.defaultPrevented || typing) return
        const activeRow = document.querySelector<HTMLElement>('.thread--active button, .thread--active [tabindex="0"]')
        setSelectedId(null)
        setIndividualMessageId(null)
        setMessageOpen(false)
        activeRow?.focus()
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

      if (typing || paletteOpen || (compose !== null && !composeMinimized) || accountOpen || view === 'settings') return

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
    ? account?.account?.label || account?.account?.user || ''
    : account?.configured
      ? t('account.connect')
      : t('account.demo')

  const syncLabel = !live
    ? t('sidebar.demo')
    : sync.offline
      ? t('sidebar.offline')
      : sync.syncedAt
        ? t('sidebar.synced')
        : t('sidebar.syncing')
  const syncDetail = live && !sync.offline && sync.syncedAt
    ? t('sidebar.syncedAgo', { time: formatElapsed(now - sync.syncedAt, locale) })
    : syncLabel

  const outboxFailed = outbox.find((item) => item.status === 'failed') ?? null

  const deletingId = pendingDelete?.path === folder && pendingDelete.generation === accountGeneration.current ? pendingDelete.id : null

  const emptyFolder = async (path: string): Promise<void> => {
    if (bulkRunning.current || deletingMessage.current) return
    bulkRunning.current = true
    setBulkBusy(true)
    const generation = accountGeneration.current
    try {
      const result = await window.api.deleteMessages(path)
      if (generation !== accountGeneration.current || result.canceled) return
      if (!result.ok) throw new Error(result.error ?? 'IPC')
      setToast(t(result.queued ? 'toast.deletingBackground' : 'toast.folderEmpty'))
    } catch (error) {
      if (generation === accountGeneration.current) setToast(t('toast.actionFailed', { error: error instanceof Error ? error.message : 'IPC' }))
    } finally {
      bulkRunning.current = false
      setBulkBusy(false)
      void refreshOutbox()
    }
  }

  const canEmptyMailbox = (path: string): boolean => mailboxes.some(box => box.path === path && (isSpamMailbox(box) || box.specialUse === '\\Trash' || /^(trash|deleted items|deleted messages|papelera|elementos eliminados)$/i.test(box.name) || /(^|\/)(trash|deleted items|papelera)$/i.test(box.path)))

  const spamFolder = mailboxes.find(box => box.specialUse === '\\Junk') ?? mailboxes.find(isSpamMailbox)
  const inSpam = mailboxes.some(box => box.path === folder && isSpamMailbox(box))
  const spamTarget = inSpam ? mailboxes.find(box => /^inbox$/i.test(box.path))?.path : spamFolder?.path
  const moveFolders = mailboxes.filter(box => box.path !== folder)

  const contextActions: ContextAction[] = contextMenu?.kind === 'folder'
    ? [
      { label: t('context.openFolder'), icon: 'folder_open', run: () => selectFolder(contextMenu.id) },
      { label: t('topbar.sync'), icon: 'sync', run: () => { void handleSync(contextMenu.id) }, disabled: !live || manualSyncing },
      ...(canEmptyMailbox(contextMenu.id) ? [{ label: t('context.emptyFolder'), icon: 'delete_sweep', run: () => { void emptyFolder(contextMenu.id) }, danger: true, disabled: !live || bulkBusy || pendingDelete !== null }] : [])
    ]
    : selected && selected.id === contextMenu?.id
      ? [
        { label: t(draftsFolder ? 'context.editDraft' : 'context.openMessage'), icon: draftsFolder ? 'edit_square' : 'mail', run: () => select(selected.id, contextMenu.messageId) },
        ...(!draftsFolder ? [
          { label: t('common.reply'), icon: 'reply', run: () => openReply() },
          { label: t('common.replyAll'), icon: 'reply_all', run: () => openReply('', true) },
          { label: t(selected.unread ? 'common.markRead' : 'common.markUnread'), icon: selected.unread ? 'drafts' : 'mark_email_unread', run: () => { void toggleRead() }, disabled: bulkBusy || pendingDelete !== null },
          { label: t(selected.starred ? 'context.unstar' : 'context.star'), icon: selected.starred ? 'star' : 'star_outline', run: toggleStar, disabled: bulkBusy || pendingDelete !== null },
          { label: t('common.move'), icon: 'drive_file_move', run: () => setMoveOpen(true), disabled: !live || !moveFolders.length || bulkBusy || pendingDelete !== null },
          { label: t(inSpam ? 'move.notSpam' : 'common.spam'), icon: inSpam ? 'mark_email_read' : 'report', run: () => { if (spamTarget) moveSelected(spamTarget) }, disabled: !live || !spamTarget || bulkBusy || pendingDelete !== null },
          { label: t('common.archive'), icon: 'archive', run: archive, disabled: bulkBusy || pendingDelete !== null },
          { label: t('common.delete'), icon: 'delete', run: deleteSelected, danger: true, disabled: bulkBusy || pendingDelete !== null }
        ] : [])
      ] : []

  // Mientras no sepamos si hay cuenta ni si ya pasó por la bienvenida, no se
  // pinta la bandeja: sin este corte, la demo aparece y el onboarding encima.
  const booting = account === null || !settingsLoaded
  if (booting) return <BootSplash />

  return (
    <div className={railCollapsed ? 'app app--rail-collapsed' : 'app'}>
      <Sidebar
        collapsed={railCollapsed}
        onToggleCollapsed={() => compactWindow ? setCompactNavExpanded(current => !current) : setSidebarCollapsed(current => !current)}
        activeFolder={folder}
        folders={folderViews}
        accountLabel={accountLabel}
        accountConnected={live}
        accounts={accounts}
        activity={activity}
        showTags={!live}
        syncLabel={syncLabel}
        syncDetail={syncDetail}
        offline={live && sync.offline}
        onFolderContextMenu={(anchor, id) => setContextMenu({ ...anchor, kind: 'folder', id })}
        onSelectFolder={selectFolder}
        onCompose={openCompose}
        onOpenSettings={openSettings}
        onOpenAccount={() => { setAddingAccount(false); setAccountOpen(true) }}
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
        onAddAccount={() => { setAddingAccount(true); setAccountOpen(true) }}
        onSelectAccount={(id) => void handleSelectAccount(id)}
        onRefreshAccounts={() => void refreshAccounts()}
      />

      <div className="shell">
        <Topbar
          unreadCount={unreadCount}
          onSync={() => void handleSync()}
          syncing={manualSyncing}
          filter={filter}
          live={live}
          query={query}
          onQuery={(next) => {
            setMessageOpen(false)
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

        <div className={messageOpen && selected ? 'panes panes--message-open' : 'panes'}>
          {view === 'settings' ? (
            <Settings
              onCacheCleared={(id) => {
                const cleared = accounts.find(item => item.id === id)
                if (cleared && JSON.stringify([cleared.host, cleared.port, cleared.user]) === accountIdentity.current) {
                  setThreads(current => current.map(thread => ({ ...thread, messages: [] })))
                }
              }}
              accountKey={accountIdentity.current ?? 'demo'}
              onBack={() => setView('mailbox')}
              accounts={accounts}
              onAddAccount={() => { setAddingAccount(true); setAccountOpen(true) }}
              onManageAccount={() => { setAddingAccount(false); setAccountOpen(true) }}
              onSelectAccount={(id) => void handleSelectAccount(id)}
            />
          ) : (
            <>
              {query.trim().length >= 2 ? (
                <SearchResults
                  query={query.trim()}
                  hits={hits}
                  loading={searching}
                  error={searchError}
                  hasMore={searchHasMore}
                  onLoadMore={() => setSearchOffset(hits.length)}
                  onRetry={() => { setSearchOffset(0); setSearchRetry(value => value + 1) }}
                  selectedKey={selected ? `${folder}:${uidOf(selected.id) ?? ''}` : null}
                  onOpen={openHit}
                />
              ) : (
                <ThreadList
                threads={visible}
                allThreads={listedThreads}
                arrivalKey={JSON.stringify([accountIdentity.current, folder, filter, oldestFirst, listLimit])}
                mailbox={folder}
                spam={folderViews.some((item) => item.id === folder && item.spam)}
                checkedIds={checkedIds}
                onCheck={(id) => setCheckedIds((current) => current.includes(id) ? current.filter((checked) => checked !== id) : [...current, id])}
                onCheckAll={() => setCheckedIds(visible.every((thread) => checkedIds.includes(thread.id)) ? [] : visible.map((thread) => thread.id))}
                onClearChecked={() => setCheckedIds([])}
                onBulkAction={(action) => void bulkAction(action)}
                bulkBusy={bulkBusy || pendingDelete !== null}
                deletingId={deletingId}
                selectedId={selected?.id ?? null}
                selectedMessageId={individualMessageId}
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
                oldestFirst={oldestFirst}
                onSort={setOldestFirst}
                onContextMenu={(anchor, id, messageId) => {
                  setSelectedId(id)
                  setIndividualMessageId(messageId ?? null)
                  userNavigated.current = true
                  setContextMenu({ ...anchor, kind: 'message', id, messageId })
                }}
                onSelect={select}
                showVip={!live}
                live={live}
                hasMore={live && threads.length >= listLimit}
                onLoadMore={loadMore}
              />
              )}

              {selected ? (
                <ThreadPane
                  onBack={() => {
                    setMessageOpen(false)
                    requestAnimationFrame(() => document.querySelector<HTMLElement>('.thread--active button, .thread--active [tabindex="0"]')?.focus())
                  }}
                  thread={individualMessageId && selected.messages.some(message => message.id === individualMessageId) ? { ...selected, messages: selected.messages.filter(message => message.id === individualMessageId) } : selected}
                  mailbox={folder}
                  spam={folderViews.some((item) => item.id === folder && item.spam)}
                  position={Math.max(1, visible.findIndex((thread) => thread.id === selected.id) + 1)}
                  total={visible.length}
                  bindings={bindings}
                  contextOpen={contextOpen}
                  canToggleContext={!live}
                  canMutate={!selected.id.startsWith('draft:') && !bulkBusy && pendingDelete === null}
                  deleting={deletingId === selected.id}
                  unread={selected.unread}
                  onToggleContext={toggleContext}
                  onMove={() => setMoveOpen(true)}
                  canMove={live && moveFolders.length > 0}
                  moving={movingId === selected.id}
                  onSpam={() => { if (spamTarget) moveSelected(spamTarget) }}
                  canSpam={live && Boolean(spamTarget)}
                  onArchive={archive}
                  onToggleRead={toggleRead}
                  onDelete={deleteSelected}
                  onEmptyFolder={live && canEmptyMailbox(folder) ? () => { void emptyFolder(folder) } : undefined}
                  onStar={toggleStar}
                  onOptions={anchor => setContextMenu({ ...anchor, kind: 'message', id: selected.id, messageId: individualMessageId ?? undefined })}
                  optionsOpen={contextMenu?.kind === 'message' && contextMenu.id === selected.id}
                  onReply={() => openReply()}
                  onReplyAll={() => openReply('', true)}
                  savingAttachment={savingAttachment}
                  onOpenAttachment={openAttachment}
                  onQuickDraft={() => openReply(COPILOT_DRAFT)}
                  onPrev={() => step(-1)}
                  onNext={() => step(1)}
                />
              ) : (
                <ThreadPaneEmpty bindings={bindings} onCompose={openCompose} onSearch={() => setPaletteOpen(true)} onSettings={openSettings} loading={loadingFolder} label={live && visible.length === 0 ? t('account.liveEmpty') : undefined} />
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
          deletion={outbox.find(item => item.deletionProgress?.running) ?? outbox.find(item => item.kind === 'delete-many' && item.status !== 'failed')}
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
        onSelectFolder={selectFolder}
        onOpenSettings={openSettings}
      />

      {moveOpen && selected && <MoveDialog subject={selected.subject} folders={moveFolders} onClose={() => setMoveOpen(false)} onMove={moveSelected} />}
      {contextMenu && contextActions.length > 0 && <ContextMenu anchor={contextMenu} label={contextMenu.kind === 'folder' ? folderViews.find(item => item.id === contextMenu.id)?.label ?? contextMenu.id : selected?.subject ?? ''} actions={contextActions} onClose={closeContextMenu} />}

      <ComposeOverlay
        key={`${accountIdentity.current ?? 'demo'}:${composeSession}`}
        open={compose !== null}
        minimized={composeMinimized}
        onRestore={() => setComposeMinimized(false)}
        onMinimize={async values => {
          const generation = accountGeneration.current
          const hasContent = values.to.trim() || values.cc.trim() || values.bcc?.trim() || values.subject.trim() || values.body.trim() || values.html?.includes('<img ') || values.attachments?.length
          if (live && hasContent) {
            const result = await window.api.saveDraft({ ...values, id: compose?.id, inReplyTo: compose?.inReplyTo, references: compose?.references, updatedAt: Date.now() })
            if (generation !== accountGeneration.current) return
            setCompose(current => current ? { ...current, id: result.id } : current)
          }
          setComposeMinimized(true)
        }}
        to={compose?.to ?? ''}
        sender={live && account?.account ? (account.account.user.includes('@') ? account.account.user : `${account.account.user}@${account.account.host || 'localhost'}`) : undefined}
        reply={compose?.reply}
        subject={compose?.subject ?? ''}
        body={compose?.body ?? ''}
        html={compose?.html}
        cc={compose?.cc ?? ''}
        bcc={compose?.bcc ?? ''}
        initialAttachments={compose?.attachments}
        priority={compose?.priority}
        copilot={!live}
        onRestoreDraft={live ? restoreDraft : undefined}
        onClose={async values => {
          const hasContent = values.to.trim() || values.cc.trim() || values.bcc?.trim() || values.subject.trim() || values.body.trim() || values.html?.includes('<img ') || values.attachments?.length
          let queued = false
          if (live && hasContent) ({ queued } = await window.api.saveDraft({ ...values, id: compose?.id, inReplyTo: compose?.inReplyTo, references: compose?.references, updatedAt: Date.now() }))
          setCompose(null)
          if (live && hasContent) setToast(t(queued ? 'draft.pendingSync' : 'toast.draftSaved'))
        }}
        onDiscard={async () => {
          if (live) await window.api.clearDraft(compose?.id)
          setCompose(null)
        }}
        onPickAttachments={live ? () => window.api.pickAttachments() : undefined}
        onSend={async ({ to, cc, bcc, subject, body, html, attachments, priority }) => {
          if (!live) { setCompose(null); setToast(t('toast.sent')); return }
          const generation = accountGeneration.current
          const result = await window.api.sendMail({ priority, draftId: compose?.id, to, cc, bcc, subject, text: body, html, attachments: attachments?.map(file => file.id), inReplyTo: compose?.inReplyTo, references: compose?.references })
          if (!result.ok) throw new Error(result.error ?? 'SMTP')
          if (generation !== accountGeneration.current) return
          setCompose(null)
          setToast(result.queued ? t('toast.queued') : t('toast.sent'))
          void refreshOutbox()
        }}
      />

      <AccountDialog
        open={accountOpen}
        account={addingAccount ? null : account}
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
          <TooltipButton className="icon-btn" type="button" onClick={() => setLiveError(null)} title={t('common.close')}>
            <Icon name="close" size={14} />
          </TooltipButton>
        </div>
      )}

      {outboxFailed && (
        <div className="live-banner" role="alert">
          <Icon name="outbox" size={16} />
          <div>
            <strong>{t('outbox.failed', { label: outboxFailed.kind === 'draft-save' ? t('draft.syncAction') : outboxFailed.kind === 'draft-delete' ? t('draft.removeAction') : outboxFailed.label })}</strong>
            <span>{outboxFailed.lastError ?? ''}</span>
          </div>
          <button className="btn btn--primary" type="button" onClick={() => void window.api.retryOutbox(outboxFailed.id)}>
            {t('offline.retry')}
          </button>
          <TooltipButton
            className="icon-btn"
            type="button"
            onClick={() => void window.api.cancelOutbox(outboxFailed.id)}
            title={t('common.close')}
          >
            <Icon name="close" size={14} />
          </TooltipButton>
        </div>
      )}

      {attachmentPreview && (attachmentPreview.kind === 'image'
        ? <ImageViewer src={attachmentPreview.attachment?.kind === 'image' ? attachmentPreview.attachment.src : undefined} title={attachmentPreview.title} error={attachmentPreview.error} saving={savingAttachment !== null} onSave={attachmentPreview.save}
          onClose={() => { attachmentRequest.current += 1; setAttachmentPreview(null) }} />
        : <DocumentViewer title={attachmentPreview.title} attachment={attachmentPreview.attachment} error={attachmentPreview.error} saving={savingAttachment !== null} onSave={attachmentPreview.save}
          onClose={() => { attachmentRequest.current += 1; setAttachmentPreview(null) }} />)}
      {savingAttachment && <div className="toast" role="status">
        <Icon name="progress_activity" size={16} className="spin" />
        {t('attachment.preparing')}
      </div>}
      {toast && !savingAttachment && (
        <div className="toast" role="status">
          <Icon name="check_circle" size={16} />
          {toast}
        </div>
      )}
    </div>
  )
}

export default App
