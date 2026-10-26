import { useEffect, useMemo, useState } from 'react'
import type { CoreStatus } from '@shared/ipc'
import {
  ACTION_ITEMS,
  BRIEF,
  COPILOT_DRAFT,
  SLOTS,
  THREADS,
  type Thread
} from './data/demo'
import { Sidebar } from './components/Sidebar'
import { Topbar, type FilterId } from './components/Topbar'
import { ThreadList } from './components/ThreadList'
import { ThreadPane, ThreadPaneEmpty } from './components/ThreadPane'
import { ContextRail } from './components/ContextRail'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { ComposeOverlay } from './components/ComposeOverlay'
import { Icon } from './components/Icon'

interface ComposeState {
  to: string
  subject: string
  body: string
}

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
  const [threads, setThreads] = useState<readonly Thread[]>(THREADS)
  const [selectedId, setSelectedId] = useState<string | null>(THREADS[0]?.id ?? null)
  const [filter, setFilter] = useState<FilterId>('focused')
  const [folder, setFolder] = useState('inbox')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [compose, setCompose] = useState<ComposeState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)

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
    if (selectedId && visible.some((thread) => thread.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [visible, selectedId])

  const select = (id: string): void => {
    setSelectedId(id)
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
    setToast('Thread archived')
  }

  const toggleStar = (): void => {
    if (!selected) return
    setThreads((current) =>
      current.map((thread) => (thread.id === selected.id ? { ...thread, starred: !thread.starred } : thread))
    )
    setToast(selected.starred ? 'Removed from starred' : 'Starred')
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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (event.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false)
          return
        }
        if (compose) {
          setCompose(null)
        }
        return
      }

      if (typing || paletteOpen || compose) return

      switch (event.key.toLowerCase()) {
        case 'j':
          event.preventDefault()
          step(1)
          break
        case 'k':
          event.preventDefault()
          step(-1)
          break
        case 'e':
          archive()
          break
        case 's':
          toggleStar()
          break
        case 'r':
          openReply()
          break
        case 'c':
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
      <Sidebar activeFolder={folder} onSelectFolder={setFolder} onCompose={openCompose} />

      <div className="shell">
        <Topbar
          unreadCount={unreadCount}
          filter={filter}
          onFilter={setFilter}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <div className="panes">
          <ThreadList
            threads={visible}
            selectedId={selected?.id ?? null}
            filter={filter}
            unreadCount={unreadCount}
            otherCount={otherCount}
            vipCount={vipCount}
            onFilter={setFilter}
            onSelect={select}
          />

          {selected ? (
            <ThreadPane
              thread={selected}
              position={Math.max(1, visible.findIndex((thread) => thread.id === selected.id) + 1)}
              total={visible.length}
              onArchive={archive}
              onSnooze={() => setToast('Snoozed until tomorrow 9:00 AM')}
              onDelete={() => {
                setThreads((current) => current.filter((thread) => thread.id !== selected.id))
                setToast('Moved to trash')
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

          <ContextRail
            brief={BRIEF}
            actions={ACTION_ITEMS}
            slots={SLOTS}
            onInsertSlot={(slot) => openReply(`Tomorrow at ${slot} works perfectly for the founder call.`)}
          />
        </div>

        <StatusBar appVersion={appVersion} />
      </div>

      <CommandPalette
        open={paletteOpen}
        threads={visible}
        onClose={() => setPaletteOpen(false)}
        onOpenThread={select}
        onCompose={openCompose}
        onArchive={archive}
        onSnooze={() => setToast('Snoozed until tomorrow 9:00 AM')}
        onSelectFolder={setFolder}
      />

      <ComposeOverlay
        open={compose !== null}
        to={compose?.to ?? ''}
        subject={compose?.subject ?? ''}
        body={compose?.body ?? ''}
        onClose={() => setCompose(null)}
        onSend={({ to, subject }) => {
          setCompose(null)
          setToast(`Sent to ${to || 'recipient'} · "${subject || 'no subject'}" (demo)`)
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
