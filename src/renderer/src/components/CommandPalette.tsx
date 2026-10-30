import { useFormatCombo, useShortcuts } from '../settings/ShortcutsProvider'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit } from '@shared/ipc'
import type { Thread } from '../data/demo'
import type { FolderView } from '../data/live'
import { useI18n } from '../i18n'
import { usePresence } from '../lib/usePresence'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface CommandPaletteProps {
  open: boolean
  threads: readonly Thread[]
  folders: readonly FolderView[]
  searchCache?: (query: string, limit: number, offset: number) => Promise<SearchHit[]>
  onOpenSearchHit?: (hit: SearchHit) => void
  canArchive: boolean
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
  keys?: string[]
  run: () => void
}

interface Group {
  title: string
  searchResults?: boolean
  icon: string
  items: Item[]
}

export function CommandPalette({
  open,
  threads,
  folders,
  canArchive,
  searchCache,
  onOpenSearchHit,
  onClose,
  onOpenThread,
  onCompose,
  onArchive,
  onSelectFolder,
  onOpenSettings
}: CommandPaletteProps): React.JSX.Element | null {
  const formatCombo = useFormatCombo()
  const { bindings } = useShortcuts()
  const listId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { t } = useI18n()
  const { mounted, closing } = usePresence(open, 140)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = query.trim()
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState<{ query: string; hits: SearchHit[]; more: boolean; loading: boolean; error: boolean }>({ query: '', hits: [], more: false, loading: false, error: false })
  const cachedHits = search.query === trimmed ? search.hits : []
  const cacheLoading = !!searchCache && !!trimmed && (search.query !== trimmed || search.loading)

  useEffect(() => {
    if (!open || !trimmed || !searchCache) return
    let cancelled = false
    setSearch(current => ({ query: trimmed, hits: offset === 0 ? [] : current.hits, more: offset > 0 && current.more, loading: true, error: false }))
    const timer = window.setTimeout(() => {
      void searchCache(trimmed, 61, offset).then(hits => {
        if (cancelled) return
        setSearch(current => ({ query: trimmed, hits: offset === 0 ? hits.slice(0, 60) : [...current.hits, ...hits.slice(0, 60)], more: hits.length > 60, loading: false, error: false }))
      }).catch(() => {
        if (!cancelled) setSearch(current => ({ ...current, loading: false, error: true }))
      })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, trimmed, offset, retry, searchCache])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setOffset(0)
    setSearch({ query: '', hits: [], more: false, loading: false, error: false })
    setActive(0)
  }, [open])

  useLayoutEffect(() => {
    if (!mounted) return
    const dialog = dialogRef.current
    const previous = document.activeElement
    dialog?.showModal()
    inputRef.current?.focus()
    return () => {
      const restore = document.activeElement === document.body || dialog?.contains(document.activeElement)
      dialog?.close()
      if (restore && previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [mounted])

  useEffect(() => {
    if (open && mounted) {
      if (!dialogRef.current?.open) dialogRef.current?.showModal()
      inputRef.current?.focus()
    }
  }, [open, mounted])

  const groups = useMemo<Group[]>(() => {
    const run = (action: () => void): (() => void) => () => {
      // Libera el foco modal antes de abrir el editor o cambiar de vista.
      dialogRef.current?.close()
      onClose()
      action()
    }

    return [
      {
        title: t('palette.threads'),
        searchResults: !!searchCache && !!trimmed,
        icon: 'inbox',
        items: searchCache && trimmed ? [
          ...cachedHits.map(hit => ({ id: `cached-${hit.mailbox}-${hit.uid}`, label: hit.subject, hint: `${hit.from?.name || hit.from?.address || ''} · ${hit.mailboxName}`, icon: hit.unread ? 'mark_email_unread' : 'drafts', run: run(() => onOpenSearchHit?.(hit)) })),
          ...(search.query === trimmed && search.more && !search.error ? [{ id: 'cache-more', label: t(cacheLoading ? 'search.searching' : 'list.loadMore'), icon: 'expand_more', run: () => { if (!cacheLoading) setOffset(offset + 60) } }] : []),
          ...(search.query === trimmed && search.error ? [{ id: 'cache-retry', label: t('search.retry'), icon: 'refresh', run: () => setRetry(value => value + 1) }] : [])
        ] : threads.map((thread) => ({
          id: `thread-${thread.id}`,
          label: thread.subject,
          hint: thread.participants[0]?.name ?? '',
          icon: thread.unread ? 'mark_email_unread' : 'drafts',
          run: run(() => onOpenThread(thread.id))
        }))
      },
      {
        title: t('palette.quick'),
        icon: 'bolt',
        items: [
          { id: 'compose', label: t('palette.compose'), icon: 'edit_square', keys: [formatCombo(bindings.compose)], run: run(onCompose) },
          ...(canArchive ? [{ id: 'archive', label: t('palette.archiveCurrent'), icon: 'done_all', keys: [formatCombo(bindings.archive)], run: run(onArchive) }] : [])
        ]
      },
      {
        title: t('palette.nav'),
        icon: 'explore',
        items: [
          ...folders.map(folder => ({ id: `folder-${folder.id}`, label: folder.label, hint: t('palette.folder'), icon: folder.icon, run: run(() => onSelectFolder(folder.id)) })),
          { id: 'nav-settings', label: t('palette.goSettings'), icon: 'settings', keys: [formatCombo(bindings.settings)], run: run(onOpenSettings) }
        ]
      }
    ]
  }, [threads, onClose, onCompose, onArchive, onOpenThread, onSelectFolder, onOpenSettings, folders, canArchive, bindings, formatCombo, t, searchCache, trimmed, cachedHits, search, cacheLoading, onOpenSearchHit, offset])

  const filtered = useMemo<Group[]>(() => {
    const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const needle = normalize(query.trim())
    return groups
      .map((group) => ({
        ...group,
        items: needle && !group.searchResults
          ? group.items.filter(
              (item) =>
                normalize(item.label).includes(needle) ||
                (item.hint ? normalize(item.hint).includes(needle) : false)
            )
          : group.items
      }))
      .filter((group) => group.items.length > 0)
  }, [groups, query])

  const flat = useMemo(() => filtered.flatMap((group) => group.items), [filtered])

  useEffect(() => {
    setActive((current) => (current >= flat.length ? 0 : current))
  }, [flat.length])

  const activeId = flat[active]?.id

  useEffect(() => {
    if (open && mounted) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, mounted, activeId, query])

  if (!mounted) return null

  return (
    <dialog ref={dialogRef} className={cx('palette', closing && 'palette--closing')} aria-label={t('palette.placeholder')}
      onCancel={event => { event.preventDefault(); onClose() }}
      onMouseDown={event => {
        if (event.target !== event.currentTarget) return
        const box = event.currentTarget.getBoundingClientRect()
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose()
      }}
      onKeyDown={event => {
        if (!open) { event.preventDefault(); event.stopPropagation(); return }
        if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation()
          setActive(current => flat.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length : 0)
        } else if (event.key === 'Enter' && event.target === inputRef.current) {
          event.preventDefault(); event.stopPropagation(); flat[active]?.run()
        }
      }}>
        <div className="palette__input-row">
          <Icon name="terminal" size={22} className="palette__prompt" />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOffset(0); setActive(0) }}
            role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            aria-describedby={`${listId}-scope`}
            aria-label={t('palette.placeholder')}
          />
          <button className="tool-btn" type="button" onClick={onClose}>
            {t('common.close')} <kbd className="kbd">ESC</kbd>
          </button>
        </div>

        <div className="palette__meta">
          <span id={`${listId}-scope`}>
            {t(searchCache ? 'palette.cacheScope' : 'palette.mode')}
          </span>
          <span>{searchCache ? (trimmed ? t('search.shown', { count: cachedHits.length }) : t('search.scope')) : t('palette.indexed', { count: threads.length })}</span>
        </div>

        <div ref={listRef} id={listId} className="palette__list" role="listbox" aria-label={t('palette.resultsLabel')} tabIndex={-1} aria-busy={cacheLoading}>
          {cacheLoading && <p role="status" className="muted">{t('search.searching')}</p>}
          {searchCache && trimmed && search.query === trimmed && search.error && <p role="alert" className="muted">{t('search.failed')}</p>}
          {filtered.map((group) => (
            <div key={group.title} className="cmd-group" role="group" aria-label={group.title}>
              <div className="cmd-group__title">
                <Icon name={group.icon} size={14} />
                {group.title}
              </div>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className={cx('cmd', item.id === activeId && 'cmd--active')}
                  onMouseEnter={() => setActive(flat.findIndex((entry) => entry.id === item.id))}
                  onClick={() => { if (open) item.run() }}
                  id={`${listId}-${flat.findIndex(entry => entry.id === item.id)}`}
                  role="option" aria-selected={item.id === activeId} aria-disabled={item.id === 'cache-more' && cacheLoading || undefined}
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

          {filtered.length === 0 && !cacheLoading && (
            <p role="status" className="muted" style={{ padding: '20px 8px' }}>
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
            <kbd className="kbd">Esc</kbd> {t('common.close')}
          </span>
        </div>
    </dialog>
  )
}
