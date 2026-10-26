import { useEffect, useMemo, useState } from 'react'
import type { CoreStatus } from '@shared/ipc'
import { ACTION_ITEMS, BRIEF, COPILOT_DRAFT, SLOTS, THREADS, type Thread } from './data/demo'
import { Sidebar } from './components/Sidebar'
import { Topbar, type FilterId } from './components/Topbar'
import { ThreadList } from './components/ThreadList'
import { ThreadPane, ThreadPaneEmpty } from './components/ThreadPane'
import { ContextRail } from './components/ContextRail'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { ComposeOverlay } from './components/ComposeOverlay'
import { Settings } from './components/Settings'
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

export function App(): React.JSX.Element {
  const { t } = useI18n()
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

  const visible = useMemo(
    () => threads.filter((thread) => matchesFolder(thread, folder) && matchesFilter(thread, filter)),
    [threads, folder, filter]
  )

  const selected = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? visible[0] ?? null,
    [threads, selectedId, visible]
  )

  const unreadCount = threads.filter((thread) => thread.unread).length
  const otherCount = threads.filter((thread) => !thread.unread).length
  const vipCount = threads.filter((thread) => thread.vip).length

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

  const select = (id: string): void => {
    setSelectedId(id)
  }

  const selectFolder = (id: string): void => {
    setFolder(id)
    setView('mailbox')
  }

  /** Filtrar desde Ajustes devuelve a la bandeja: el filtro no se aplica a una pantalla de opciones. */
  const filterBy = (next: FilterId): void => {
    setFilter(next)
    setView('mailbox')
  }

  const openSettings = (): void => {
    setPaletteOpen(false)
    setView('settings')
  }

  const step = (delta: number): void => {
    if (visible.length === 0) return
    const current = visible.findIndex((thread) => thread.id === selected?.id)
    const next = visible[(current + delta + visible.length) % visible.length]
    if (next) setSelectedId(next.id)
  }

  const archive = (): void => {
    if (!selected) return
    const index = visible.findIndex((thread) => thread.id === selected.id)
    const next = visible[index + 1] ?? visible[index - 1] ?? null
    setThreads((current) => current.filter((thread) => thread.id !== selected.id))
    setSelectedId(next?.id ?? null)
    setToast(t('toast.archived'))
  }

  const toggleStar = (): void => {
    if (!selected) return
    setThreads((current) =>
      current.map((thread) => (thread.id === selected.id ? { ...thread, starred: !thread.starred } : thread))
    )
    setToast(selected.starred ? t('toast.unstarred') : t('toast.starred'))
  }

  const openReply = (body = ''): void => {
    if (!selected) return
    const sender = selected.participants[0]
    setCompose({ to: sender?.email ?? '', subject: `Re: ${selected.subject}`, body })
  }

  const openCompose = (): void => {
    setCompose({ to: '', subject: '', body: '' })
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
          setCompose(null)
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

      if (typing || paletteOpen || compose !== null || view === 'settings') return

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
          setToast(t('toast.snoozed'))
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

  return (
    <div className="app">
      <Sidebar
        activeFolder={folder}
        onSelectFolder={selectFolder}
        onCompose={openCompose}
        onOpenSettings={openSettings}
      />

      <div className="shell">
        <Topbar
          unreadCount={unreadCount}
          filter={filter}
          onFilter={filterBy}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={openSettings}
        />

        <div className="panes">
          {view === 'settings' ? (
            <Settings onBack={() => setView('mailbox')} />
          ) : (
            <>
              <ThreadList
                threads={visible}
                selectedId={selected?.id ?? null}
                filter={filter}
                unreadCount={unreadCount}
                otherCount={otherCount}
                vipCount={vipCount}
                onFilter={filterBy}
                onSelect={select}
              />

              {selected ? (
                <ThreadPane
                  thread={selected}
                  position={Math.max(1, visible.findIndex((thread) => thread.id === selected.id) + 1)}
                  total={visible.length}
                  bindings={bindings}
                  contextOpen={contextOpen}
                  onToggleContext={toggleContext}
                  onArchive={archive}
                  onSnooze={() => setToast(t('toast.snoozed'))}
                  onDelete={() => {
                    setThreads((current) => current.filter((thread) => thread.id !== selected.id))
                    setToast(t('toast.trashed'))
                  }}
                  onStar={toggleStar}
                  onReply={() => openReply()}
                  onQuickDraft={() => openReply(COPILOT_DRAFT)}
                  onPrev={() => step(-1)}
                  onNext={() => step(1)}
                />
              ) : (
                <ThreadPaneEmpty />
              )}

              {contextOpen && (
                <ContextRail
                  brief={BRIEF}
                  actions={ACTION_ITEMS}
                  slots={SLOTS}
                  onInsertSlot={(slot) => openReply(`Tomorrow at ${slot} works perfectly for the founder call.`)}
                />
              )}
            </>
          )}
        </div>

        <StatusBar appVersion={appVersion} bindings={bindings} />
      </div>

      <CommandPalette
        open={paletteOpen}
        threads={visible}
        onClose={() => setPaletteOpen(false)}
        onOpenThread={select}
        onCompose={openCompose}
        onArchive={archive}
        onSnooze={() => setToast(t('toast.snoozed'))}
        onSelectFolder={selectFolder}
        onOpenSettings={openSettings}
      />

      <ComposeOverlay
        open={compose !== null}
        to={compose?.to ?? ''}
        subject={compose?.subject ?? ''}
        body={compose?.body ?? ''}
        onClose={() => setCompose(null)}
        onSend={({ to, subject }) => {
          setCompose(null)
          setToast(t('toast.sent', { to: to || '—', subject: subject || '—' }))
        }}
      />

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
