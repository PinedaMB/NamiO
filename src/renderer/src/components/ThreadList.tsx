import { SenderAvatar } from './SenderAvatar'
import { usePreferences } from '../settings/PreferencesProvider'
import { ContextMenu, type ContextAnchor } from './ContextMenu'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TooltipButton } from './Tooltip'
import type { Message, Thread } from '../data/demo'
import type { FilterId } from './Topbar'
import { useI18n, type TranslationKey } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'
import { formatMessageDate, formatMessageDateTime } from '../lib/dates'

interface ThreadListProps {
  folderLabel: string
  threads: readonly Thread[]
  allThreads?: readonly Thread[]
  sentReplies?: Readonly<Record<string, readonly Message[]>>
  arrivalKey?: string
  mailbox: string
  spam: boolean
  selectedMessageId?: string | null
  selectedId: string | null
  checkedIds: readonly string[]
  onCheck: (id: string) => void
  onCheckAll: () => void
  onClearChecked: () => void
  onBulkAction: (action: 'read' | 'archive' | 'delete') => void
  deletingId?: string | null
  bulkBusy: boolean
  filter: FilterId
  unreadCount: number
  otherCount: number
  /** Total de mensajes en la caché del buzón (sin filtrar). */
  availableOffline?: number
  allCount: number
  vipCount: number
  loading?: boolean
  emptyLabel?: string
  /** El filtro VIP es de la demo: en modo real no hay datos para él. */
  showVip?: boolean
  /** Cuenta real: las pestañas dicen "sin leer / leídos" en vez de prioridad. */
  live?: boolean
  /** Quedan mensajes en la caché por mostrar. */
  hasMore?: boolean
  onLoadMore?: () => void
  onFilter: (filter: FilterId) => void
  oldestFirst: boolean
  onSort: (oldestFirst: boolean) => void
  onContextMenu?: (anchor: ContextAnchor, id: string, messageId?: string) => void
  onSelect: (id: string, messageId?: string) => void
}

const QUEUE_LABEL: Record<FilterId, TranslationKey> = {
  focused: 'list.highPriority',
  other: 'list.everythingElse',
  all: 'list.all',
  vip: 'list.vipOnly',
  files: 'list.withAttachments',
  'needs-reply': 'list.needsReply'
}

const uidOf = (id: string): number | null => {
  if (!id.startsWith('live:')) return null
  const uid = Number(id.slice(5))
  return Number.isInteger(uid) ? uid : null
}

const conversationKey = (thread: Thread): string => thread.messageIds?.join(',') ?? thread.id

// A partir de este tamaño solo se montan las filas visibles (más un margen).
// Las listas pequeñas se pintan enteras: menos complejidad y cero saltos.
const VIRTUAL_THRESHOLD = 120
const VIRTUAL_OVERSCAN = 6
const BASE_ROW_HEIGHT = 82

interface MemberRow {
  id: string
  messageId: string
  sender: Thread['participants'][number] | undefined
  date: string
  unread: boolean
  timestamp?: string | number
  sent?: boolean
}

export function ThreadList({
  folderLabel,
  threads,
  allThreads = threads,
  sentReplies,
  selectedId,
  selectedMessageId,
  mailbox,
  spam,
  arrivalKey = mailbox,
  checkedIds,
  onCheck,
  onCheckAll,
  onClearChecked,
  onBulkAction,
  bulkBusy,
  deletingId,
  filter,
  allCount,
  availableOffline = 0,
  loading = false,
  emptyLabel,
  live = false,
  hasMore = false,
  onLoadMore,
  onFilter,
  oldestFirst,
  onSort,
  onContextMenu,
  onSelect
}: ThreadListProps): React.JSX.Element {
  const { timeFormat } = usePreferences()
  const { t, locale } = useI18n()
  const [menu, setMenu] = useState<{ kind: 'sort' | 'filter'; anchor: ContextAnchor } | null>(null)
  const [arrivals, setArrivals] = useState<Set<string>>(new Set())
  const arrivalBaseline = useRef<{ key: string; uid: number | null }>({ key: arrivalKey, uid: null })
  const listRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef({ top: 0, height: 900 })
  const rowHeights = useRef(new Map<string, number>())
  const measureFrame = useRef(0)
  useEffect(() => {
    if (arrivalBaseline.current.key !== arrivalKey || !live) {
      arrivalBaseline.current = { key: arrivalKey, uid: null }
      setArrivals(new Set())
    }
    if (!live || loading) return
    let newest = arrivalBaseline.current.uid ?? 0
    const added: string[] = []
    for (const thread of allThreads) {
      if (!thread.id.startsWith('live:')) continue
      const uid = Number(thread.id.slice(5))
      if (arrivalBaseline.current.uid !== null && uid > arrivalBaseline.current.uid) added.push(thread.id)
      newest = Math.max(newest, uid)
    }
    arrivalBaseline.current.uid = newest
    if (added.length) setArrivals(current => new Set([...current, ...added]))
  }, [allThreads, arrivalKey, live, loading])
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = (kind: 'sort' | 'filter', trigger: HTMLElement): void => {
    const rect = trigger.getBoundingClientRect()
    setMenu({ kind, anchor: { x: rect.left, y: rect.bottom + 6, trigger } })
  }
  // En modo real las pestañas no son "prioridad": son todos / sin leer / leídos,
  // y el pie no puede decir "clasificado hace…" porque nadie clasifica nada.
  const focusedLabel = live ? t('list.unread') : t('list.focused')
  const otherLabel = live ? t('list.read') : t('list.other')
  const activeLabel = live
    ? filter === 'all'
      ? t('list.all')
      : filter === 'other'
        ? otherLabel
        : filter === 'focused' ? focusedLabel : t(QUEUE_LABEL[filter])
    : t(QUEUE_LABEL[filter])

  const minute = Math.floor(Date.now() / 60_000)
  // Basta recalcular las fechas cuando cambia el minuto, no en cada render.
  const now = useMemo(() => Date.now(), [minute])
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds])

  const conversations = useMemo(() => {
    const seen = new Set<string>()
    return threads.filter(thread => {
      const key = conversationKey(thread)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [threads])

  const virtual = conversations.length > VIRTUAL_THRESHOLD
  const layout = useMemo(() => {
    if (!virtual) return { start: 0, end: conversations.length, top: 0, bottom: 0 }
    const len = conversations.length
    const offsets = new Array<number>(len)
    let total = 0
    for (let index = 0; index < len; index += 1) {
      offsets[index] = total
      total += rowHeights.current.get(conversationKey(conversations[index]!)) ?? BASE_ROW_HEIGHT
    }
    const height = Math.max(viewportRef.current.height, 320)
    const top = viewportRef.current.top
    let start = 0
    while (start < len && offsets[start]! + (rowHeights.current.get(conversationKey(conversations[start]!)) ?? BASE_ROW_HEIGHT) < top) start += 1
    start = Math.max(0, start - VIRTUAL_OVERSCAN)
    let end = start
    while (end < len && offsets[end]! < top + height) end += 1
    end = Math.min(len, end + VIRTUAL_OVERSCAN)
    return {
      start,
      end,
      top: offsets[start] ?? 0,
      bottom: Math.max(0, total - (offsets[end] ?? total))
    }
  }, [conversations, virtual, arrivals])

  const measureRow = useCallback((key: string, node: HTMLDivElement | null) => {
    if (!virtual || !node) return
    const height = node.getBoundingClientRect().height
    const rowHeight = height + 2 // incluye el gap de 2 px de `.thread-list`
    if (height <= 0 || Math.abs(rowHeight - (rowHeights.current.get(key) ?? BASE_ROW_HEIGHT)) <= 1) return
    rowHeights.current.set(key, rowHeight)
    if (measureFrame.current !== 0) return
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = 0
      setArrivals(current => new Set(current))
    })
  }, [virtual])

  useEffect(() => {
    const element = listRef.current
    if (!virtual || !element) return
    const syncHeight = (): void => {
      viewportRef.current.height = element.clientHeight
      setArrivals(current => new Set(current))
    }
    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [virtual])

  // Si j/k lleva la selección fuera de la ventana montada, la lista la sigue.
  useEffect(() => {
    const element = listRef.current
    if (!virtual || !selectedId || !element) return
    const index = conversations.findIndex(thread => thread.id === selectedId || thread.messageIds?.some(id => String(id) === selectedId))
    if (index < 0) return
    let top = 0
    for (let cursor = 0; cursor < index; cursor += 1) {
      top += rowHeights.current.get(conversationKey(conversations[cursor]!)) ?? BASE_ROW_HEIGHT
    }
    const height = rowHeights.current.get(conversationKey(conversations[index]!)) ?? BASE_ROW_HEIGHT
    const viewport = viewportRef.current
    if (top < viewport.top || top + height > viewport.top + viewport.height) {
      element.scrollTop = Math.max(0, top - viewport.height / 2)
      viewport.top = element.scrollTop
      setArrivals(current => new Set(current))
    }
  }, [selectedId, virtual, conversations])

  // Una sola pasada por todos los mensajes; antes cada fila filtraba el array
  // completo y el coste era O(n²) en listas largas.
  const grouped = useMemo(() => {
    const groups = new Map<string, Thread[]>()
    for (const thread of allThreads) {
      const key = conversationKey(thread)
      const group = groups.get(key)
      if (group) group.push(thread)
      else groups.set(key, [thread])
    }
    return groups
  }, [allThreads])

  const memberRows = useMemo(() => {
    const rows = new Map<string, MemberRow[]>()
    for (const [key, group] of grouped) {
      const order = new Map((group[0]?.messageIds ?? []).map((uid, index) => [uid, index]))
      const sorted = [...group].sort((a, b) =>
        (order.get(uidOf(a.id) ?? -1) ?? Number.MAX_SAFE_INTEGER) - (order.get(uidOf(b.id) ?? -1) ?? Number.MAX_SAFE_INTEGER))
      rows.set(key, sorted.map(item => ({
        id: item.id,
        messageId: item.id,
        sender: item.participants[0],
        date: item.date !== undefined ? formatMessageDate(item.date, locale, now, timeFormat) : item.receivedAt,
        timestamp: item.date,
        unread: item.unread
      })))
    }
    for (const [key, messages] of Object.entries(sentReplies ?? {})) {
      const members = rows.get(key) ?? []
      const thread = grouped.get(key)?.[0]
      if (!thread) continue
      for (const message of messages) {
        if (!message.mailbox || members.some(member => member.messageId === message.id)) continue
        members.push({ id: thread.id, messageId: message.id, sender: message.from,
          date: message.date !== undefined ? formatMessageDate(message.date, locale, now, timeFormat) : message.sentAt,
          timestamp: message.date, unread: false, sent: true })
      }
      members.sort((a, b) => new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime())
      rows.set(key, members)
    }
    return rows
  }, [grouped, sentReplies, locale, timeFormat, now])

  const filesByConversation = useMemo(() => {
    const files = new Map<string, boolean>()
    for (const [key, group] of grouped) {
      files.set(key, group.some(item => item.hasAttachments || item.messages.some(message => (message.attachments?.length ?? 0) > 0)))
    }
    return files
  }, [grouped])

  const allChecked = threads.length > 0 && threads.every(thread => checkedSet.has(thread.id))

  return (
    <section className="list" aria-label={t('list.queue', { name: activeLabel })}>
      <div className="list__filters">
        <div className="list__filters-row">
          <h2 className="list__title">{folderLabel}</h2>
          <div className="list__tools">
            <TooltipButton className="icon-btn" type="button" title={t(oldestFirst ? 'list.oldestFirst' : 'list.newestFirst')} aria-label={t('list.sort')} aria-haspopup="menu" aria-expanded={menu?.kind === 'sort'} onClick={event => openMenu('sort', event.currentTarget)}><Icon name="swap_vert" size={18} /></TooltipButton>
            <TooltipButton className={cx('icon-btn', filter !== 'all' && 'tool-btn--active')} type="button" title={`${t('list.filter')}: ${activeLabel}`} aria-label={t('list.filter')} aria-haspopup="menu" aria-expanded={menu?.kind === 'filter'} onClick={event => openMenu('filter', event.currentTarget)}><Icon name="filter_list" size={18} /></TooltipButton>
          </div>
        </div>
        <span className="sr-only list__queue">{live ? t('list.liveQueue', { count: allCount, loaded: threads.length, offline: availableOffline }).toUpperCase() : activeLabel}</span>
        {filter !== 'all' && <button className="list__active-filter" type="button" onClick={() => onFilter('all')}>{activeLabel}<Icon name="close" size={14} /></button>}
      </div>
      {menu && <ContextMenu anchor={menu.anchor} label={t(menu.kind === 'sort' ? 'list.sort' : 'list.filter')} onClose={closeMenu}
        actions={menu.kind === 'sort'
          ? [false, true].map(value => ({ label: t(value ? 'list.oldestFirst' : 'list.newestFirst'), icon: oldestFirst === value ? 'check' : 'swap_vert', run: () => onSort(value) }))
          : (live ? ['all', 'focused', 'other'] as const : ['all', 'focused', 'other', 'vip', 'files', 'needs-reply'] as const).map(value => ({
            label: value === 'focused' ? focusedLabel : value === 'other' ? otherLabel : t(QUEUE_LABEL[value]),
            icon: filter === value ? 'check' : 'filter_list', run: () => onFilter(value)
          }))} />}

      {checkedIds.length > 0 && (
        <div className="list-selection">
          <label className="list-selection__all" data-tooltip={t('list.selectLoaded')}>
            <input type="checkbox" aria-label={t('list.selectLoaded')}
              checked={allChecked}
              ref={(node) => { if (node) node.indeterminate = !allChecked }}
              onChange={onCheckAll} disabled={bulkBusy || threads.length === 0} />
            <span className="list-selection__count" role="status">
              {t(checkedIds.length === 1 ? 'list.selectedOne' : 'list.selectedCount', { count: checkedIds.length })}
            </span>
          </label>
          <div className="list-selection__actions">
            <TooltipButton className="icon-btn" type="button" title={t('common.markRead')} onClick={() => onBulkAction('read')} disabled={bulkBusy}><Icon name="mark_email_read" size={16} /></TooltipButton>
            <TooltipButton className="icon-btn" type="button" title={t('common.archive')} onClick={() => onBulkAction('archive')} disabled={bulkBusy}><Icon name="archive" size={16} /></TooltipButton>
            <TooltipButton className="icon-btn btn--danger" type="button" title={t('common.delete')} onClick={() => onBulkAction('delete')} disabled={bulkBusy}><Icon name="delete" size={16} /></TooltipButton>
            <TooltipButton className="icon-btn" type="button" title={t('list.clearSelection')} onClick={onClearChecked} disabled={bulkBusy}><Icon name="close" size={16} /></TooltipButton>
          </div>
        </div>
      )}

      <div
        ref={listRef}
        className="thread-list"
        onScroll={(event) => {
          const element = event.currentTarget
          viewportRef.current.top = element.scrollTop
          viewportRef.current.height = element.clientHeight
          if (virtual) setArrivals(current => new Set(current))
          if (!hasMore || !onLoadMore) return
          // A 300 px del final se pide la siguiente tanda (ya está en la caché).
          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 300) onLoadMore()
        }}
      >
        {loading && threads.length === 0 && (
          <div className="list-loading">
            <Icon name="progress_activity" size={18} className="spin" />
            {t('list.loading')}
          </div>
        )}

        {virtual && layout.top > 0 && <div aria-hidden="true" style={{ height: layout.top, flex: '0 0 auto' }} />}

        {conversations.slice(layout.start, layout.end).map((thread) => {
          const sender = thread.participants[0]
          const key = conversationKey(thread)
          const members: MemberRow[] = thread.messageIds
            ? memberRows.get(key) ?? []
            : thread.messages.map(message => ({
                id: thread.id,
                messageId: message.id,
                sender: message.from,
                date: message.date !== undefined ? formatMessageDateTime(message.date, locale, false, timeFormat) : message.sentAt,
                unread: thread.unread
              }))
          const hasFiles = filesByConversation.get(key) ?? false
          const active = thread.id === selectedId || members.some(member => member.id === selectedId)
          const arrivingIds = [thread.id, ...members.map(member => member.id)].filter(id => arrivals.has(id))
          const deleting = deletingId === thread.id || members.some(member => member.id === deletingId)
          return (
            <div className="thread-group" key={thread.id} ref={node => measureRow(key, node)}>
            <article
              onContextMenu={event => { if (!onContextMenu) return; event.preventDefault(); onContextMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget.querySelector<HTMLElement>('.thread__content')! }, thread.id) }}
              aria-busy={deleting}
              className={cx('thread', active && 'thread--active', thread.unread && 'thread--unread', arrivingIds.length > 0 && 'thread--arriving')}
              onAnimationEnd={event => {
                if (event.target !== event.currentTarget || event.animationName !== 'mail-arrival') return
                setArrivals(current => new Set([...current].filter(id => !arrivingIds.includes(id))))
              }}
            >
              <div className="thread__content"
              onClick={() => onSelect(thread.id)}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu?.({ x: rect.left, y: rect.bottom, trigger: event.currentTarget }, thread.id); return
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(thread.id)
                }
              }}
              role="button"
              tabIndex={0}
              aria-current={active ? 'true' : undefined}
            >
              <div className="thread__row">
                <div className="thread__who">
                  <div className="thread__avatar-wrap">
                    <label className="thread__select" onClick={event => event.stopPropagation()}
                      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation() }}>
                      <input className="thread__check" type="checkbox" checked={checkedSet.has(thread.id)}
                        onChange={() => onCheck(thread.id)} disabled={bulkBusy || thread.id.startsWith('draft:')}
                        aria-label={t('list.selectMessage', { subject: thread.subject })} />
                    </label>
                    <SenderAvatar email={sender?.email ?? ''} initials={sender?.initials ?? '??'} mailbox={mailbox} blocked={spam || !live} />
                  </div>
                  <div className="thread__sender">
                    <div className="thread__identity">
                      <span className="thread__name" title={sender?.name}>{sender?.name ?? ''}</span>
                    </div>
                  </div>
                </div>

                <div className="thread__meta">
                  {thread.priority && thread.priority !== 'normal' && <span className={cx('mail-priority', thread.priority === 'high' && 'mail-priority--high')} role="img" aria-label={t(thread.priority === 'high' ? 'mail.priorityHigh' : 'mail.priorityLow')} data-tooltip={t(thread.priority === 'high' ? 'mail.priorityHigh' : 'mail.priorityLow')}>
                    <Icon name={thread.priority === 'high' ? 'priority_high' : 'arrow_downward'} size={16} />
                  </span>}
                  {thread.sendStatus && <span className="thread__processing" role="status">
                    <Icon name={thread.sendStatus === 'failed' ? 'error' : 'schedule'} size={15} />
                    {t(thread.sendStatus === 'failed' ? 'mail.sendFailed' : 'mail.sending')}
                  </span>}
                  {deleting && <span className="thread__processing" role="status"><Icon name="progress_activity" size={15} className="spin" />{t('common.deleting')}</span>}
                  {hasFiles && <span role="img" aria-label={t('thread.attachments')} title={t('thread.attachments')}><Icon name="attach_file" size={15} /></span>}
                  {thread.unread && (
                    <span className="thread__unread" role="img" aria-label={t('list.unread')} title={t('list.unread')}>
                      <span className="dot" />
                    </span>
                  )}
                  <span className="thread__time" title={thread.date !== undefined ? formatMessageDateTime(thread.date, locale, false, timeFormat) : undefined}>{thread.date !== undefined ? formatMessageDate(thread.date, locale, now, timeFormat) : thread.receivedAt}</span>
                </div>
              </div>

              <div className="thread__subject">
                <span>{thread.subject}</span>
                {thread.messageCount > 1 && members.length < 2 && <span className="thread__count">{thread.messageCount}</span>}
              </div>

              {thread.preview !== '' && <p className="thread__preview">{thread.preview}</p>}


              </div>
            </article>
            {members.length > 1 && (
              <details className="thread-group__messages">
                <summary aria-label={t('list.conversationMessages', { count: members.length })} title={t('list.conversationMessages', { count: members.length })}>
                  <Icon name="expand_more" size={18} className="thread-group__chevron" />
                  <span>{members.length}</span>
                </summary>
                <div className="thread-group__items">
                  {members.map(member => (
                    <div className="thread-group__item" key={member.messageId}>
                    {live && !member.sent && <input type="checkbox" checked={checkedSet.has(member.id)} disabled={bulkBusy}
                      onChange={() => onCheck(member.id)} aria-label={t('list.selectMessage', { subject: `${thread.subject} · ${member.sender?.name ?? ''}` })} />}
                    <button type="button"
                      aria-busy={deletingId === member.id}
                      aria-current={member.messageId === selectedMessageId ? 'true' : undefined}
                      className={cx('thread-group__message', member.messageId === selectedMessageId && 'thread-group__message--active', member.unread && 'thread-group__message--unread')}
                      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (member.sent) return; onContextMenu?.({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }, member.id, member.messageId) }}
                      onKeyDown={event => { if (member.sent) return; if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu?.({ x: rect.left, y: rect.bottom, trigger: event.currentTarget }, member.id, member.messageId) } }}
                      onClick={() => onSelect(member.id, member.messageId)}>
                      <Icon className={deletingId === member.id ? 'spin' : undefined} name={deletingId === member.id ? 'progress_activity' : member.sent ? 'send' : member.unread ? 'mark_email_unread' : 'mail'} size={15} />
                      <span className="thread-group__sender">
                        <strong title={member.sender?.name}>{member.sender?.name}</strong>
                        <span title={member.sender?.email}>{member.sent ? t('thread.sent') : member.sender?.email}</span>
                      </span>
                      <span className="thread__time">{member.date}</span>
                    </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
            </div>
          )
        })}

        {virtual && layout.bottom > 0 && <div aria-hidden="true" style={{ height: layout.bottom, flex: '0 0 auto' }} />}

        {threads.length === 0 && !loading && (
          <p className="muted" style={{ padding: '24px 12px', textAlign: 'center' }}>
            {emptyLabel ?? t('list.empty')}
          </p>
        )}
        {hasMore && onLoadMore && <button className="btn" type="button" onClick={onLoadMore}>{t('list.loadMore')}</button>}
      </div>
    </section>
  )
}
