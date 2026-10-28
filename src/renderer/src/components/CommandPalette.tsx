import { useEffect, useMemo, useRef, useState } from 'react'
import type { Thread } from '../data/demo'
import { useI18n } from '../i18n'
import { usePresence } from '../lib/usePresence'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface CommandPaletteProps {
  open: boolean
  threads: readonly Thread[]
  onClose: () => void
  onOpenThread: (id: string) => void
  onCompose: () => void
  onArchive: () => void
  onSelectFolder: (folder: string) => void
  onOpenSettings: () => void
}

interface Item {
  id: string
  label: string
  hint?: string
  icon: string
  badge?: string
  keys?: string[]
  run: () => void
}

interface Group {
  title: string
  icon: string
  accent?: boolean
  items: Item[]
}

export function CommandPalette({
  open,
  threads,
  onClose,
  onOpenThread,
  onCompose,
  onArchive,
  onSelectFolder,
  onOpenSettings
}: CommandPaletteProps): React.JSX.Element | null {
  const { t } = useI18n()
  const { mounted, closing } = usePresence(open, 140)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    inputRef.current?.focus()
  }, [open])

  const groups = useMemo<Group[]>(() => {
    const run = (action: () => void): (() => void) => () => {
      onClose()
      action()
    }

    return [
      {
        title: t('palette.threads'),
        icon: 'inbox',
        items: threads.map((thread) => ({
          id: `thread-${thread.id}`,
          label: thread.subject,
          hint: thread.participants[0]?.name ?? '',
          icon: thread.unread ? 'mark_email_unread' : 'drafts',
          run: run(() => onOpenThread(thread.id))
        }))
      },
      {
        title: t('palette.recent'),
        icon: 'history',
        items: [
          {
            id: 'search-elena',
            label: 'from:elena "term sheet"',
            hint: t('palette.query'),
            icon: 'saved_search',
            badge: t('palette.results', { count: 3 }),
            run: onClose
          },
          {
            id: 'search-legal',
            label: 'has:attachment label:legal',
            hint: t('palette.filter'),
            icon: 'search',
            badge: t('palette.results', { count: 12 }),
            run: onClose
          },
          {
            id: 'search-unread',
            label: 'unread before:friday',
            hint: t('palette.time'),
            icon: 'filter_alt',
            badge: t('palette.results', { count: 7 }),
            run: onClose
          }
        ]
      },
      {
        title: t('palette.quick'),
        icon: 'bolt',
        items: [
          { id: 'compose', label: t('palette.compose'), icon: 'edit_square', keys: ['C'], run: run(onCompose) },
          { id: 'archive', label: t('palette.archiveCurrent'), icon: 'done_all', keys: ['E'], run: run(onArchive) },
          { id: 'block', label: t('palette.block'), icon: 'block', keys: ['B', 'D'], run: onClose }
        ]
      },
      {
        title: t('palette.nav'),
        icon: 'explore',
        items: [
          { id: 'nav-inbox', label: t('palette.goInbox'), icon: 'inbox', keys: ['G', 'I'], run: run(() => onSelectFolder('inbox')) },
          { id: 'nav-starred', label: t('palette.goStarred'), icon: 'star', keys: ['G', 'S'], run: run(() => onSelectFolder('starred')) },
          { id: 'nav-drafts', label: t('palette.goDrafts'), icon: 'draft', keys: ['G', 'D'], run: run(() => onSelectFolder('drafts')) },
          { id: 'nav-settings', label: t('palette.goSettings'), icon: 'settings', keys: ['G', ','], run: run(onOpenSettings) }
        ]
      }
    ]
  }, [threads, onClose, onCompose, onArchive, onOpenThread, onSelectFolder, onOpenSettings, t])

  const filtered = useMemo<Group[]>(() => {
    const needle = query.trim().toLowerCase()
    return groups
      .map((group) => ({
        ...group,
        items: needle
          ? group.items.filter(
              (item) =>
                item.label.toLowerCase().includes(needle) ||
                (item.hint?.toLowerCase().includes(needle) ?? false)
            )
          : group.items
      }))
      .filter((group) => group.items.length > 0)
  }, [groups, query])

  const flat = useMemo(() => filtered.flatMap((group) => group.items), [filtered])

  useEffect(() => {
    setActive((current) => (current >= flat.length ? 0 : current))
  }, [flat.length])

  useEffect(() => {
    if (!open) return

    const handle = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((current) => (flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        flat[active]?.run()
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, flat, active])

  const activeId = flat[active]?.id

  if (!mounted) return null

  return (
    <div
      className={cx('overlay', closing && 'overlay--closing')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.placeholder')}>
        <div className="palette__input-row">
          <Icon name="terminal" size={22} className="palette__prompt" />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('palette.placeholder')}
          />
          <button className="tool-btn" type="button" onClick={onClose}>
            {t('common.close')} <kbd className="kbd">ESC</kbd>
          </button>
        </div>

        <div className="palette__meta">
          <span>
            <span className="dot pulse" />
            {t('palette.mode')}
          </span>
          <span>{t('palette.indexed')}</span>
        </div>

        <div className="palette__list">
          {filtered.map((group) => (
            <div key={group.title} className="cmd-group">
              <div className={cx('cmd-group__title', group.accent && 'cmd-group__title--accent')}>
                <Icon name={group.icon} size={14} />
                {group.title}
              </div>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className={cx('cmd', item.id === activeId && 'cmd--active')}
                  onMouseEnter={() => setActive(flat.findIndex((entry) => entry.id === item.id))}
                  onClick={() => item.run()}
                  role="button"
                  tabIndex={-1}
                >
                  <span className="cmd__main">
                    <Icon name={item.icon} size={18} />
                    <span className="cmd__text">
                      <span className="cmd__label">{item.label}</span>
                      {item.hint && <span className="cmd__hint">{item.hint}</span>}
                    </span>
                  </span>
                  <span className="cmd__aside">
                    {item.badge && <span>{item.badge}</span>}
                    {item.keys?.map((key) => (
                      <kbd key={key} className="kbd">
                        {key}
                      </kbd>
                    ))}
                    {item.id === activeId && <kbd className="kbd">↵</kbd>}
                  </span>
                </div>
              ))}
            </div>
          ))}

          {filtered.length === 0 && (
            <p className="muted" style={{ padding: '20px 8px' }}>
              {t('palette.noResults', { q: query })}
            </p>
          )}
        </div>

        <div className="palette__foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> {t('palette.select')}
          </span>
          <span>
            <kbd className="kbd">↵</kbd> {t('palette.run')}
          </span>
          <span>
            <kbd className="kbd">Tab</kbd> {t('palette.autocomplete')}
          </span>
          <span>
            <kbd className="kbd">⌘↵</kbd> {t('palette.secondary')}
          </span>
          <span style={{ marginLeft: 'auto' }}>{t('palette.engine')}</span>
        </div>
      </div>
    </div>
  )
}
