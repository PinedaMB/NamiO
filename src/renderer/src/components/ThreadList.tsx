import { ContextMenu, type ContextAnchor } from './ContextMenu'
import { useCallback, useState } from 'react'
import { SenderAvatar } from './SenderAvatar'
import { TooltipButton } from './Tooltip'
import type { Tag, Thread } from '../data/demo'
import type { FilterId } from './Topbar'
import { useI18n, type TranslationKey } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'
import { formatMessageDate, formatMessageDateTime } from '../lib/dates'

interface ThreadListProps {
  threads: readonly Thread[]
  allThreads?: readonly Thread[]
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

function tagClass(tag: Tag): string {
  switch (tag.tone) {
    case 'secondary':
    case 'primary':
      return 'chip chip--primary'
    case 'tertiary':
      return 'chip chip--tertiary'
    case 'error':
      return 'chip chip--error'
    default:
      return 'chip'
  }
}

export function ThreadList({
  threads,
  allThreads = threads,
  selectedId,
  selectedMessageId,
  mailbox,
  spam,
  checkedIds,
  onCheck,
  onCheckAll,
  onClearChecked,
  onBulkAction,
  bulkBusy,
  deletingId,
  filter,
  unreadCount,
  otherCount,
  allCount,
  vipCount,
  loading = false,
  emptyLabel,
  showVip = true,
  live = false,
  hasMore = false,
  onLoadMore,
  onFilter,
  oldestFirst,
  onSort,
  onContextMenu,
  onSelect
}: ThreadListProps): React.JSX.Element {
  const { t, locale } = useI18n()
  const [menu, setMenu] = useState<{ kind: 'sort' | 'filter'; anchor: ContextAnchor } | null>(null)
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

  const seen = new Set<string>()
  const conversations = threads.filter(thread => {
    const key = thread.messageIds?.join(',') ?? thread.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return (
    <section className="list" aria-label={t('list.queue', { name: activeLabel })}>
      <div className="list__filters">
        <div className="list__filters-row">
          <div className="seg" role="tablist">
            {live && (
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'all'}
                className={cx('seg__btn', filter === 'all' && 'seg__btn--active')}
                onClick={() => onFilter('all')}
              >
                {t('list.all')} <span className="seg__count">{allCount}</span>
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'focused'}
              className={cx('seg__btn', filter === 'focused' && 'seg__btn--active')}
              onClick={() => onFilter('focused')}
            >
              {focusedLabel} <span className="seg__count">{unreadCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'other'}
              className={cx('seg__btn', filter === 'other' && 'seg__btn--active')}
              onClick={() => onFilter('other')}
            >
              {otherLabel} <span className="seg__count">{otherCount}</span>
            </button>
            {showVip !== false && (
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'vip'}
                className={cx('seg__btn', filter === 'vip' && 'seg__btn--active')}
                onClick={() => onFilter('vip')}
              >
                <Icon name="star" size={13} className="seg__star" />
                {t('list.vip')} <span className="seg__count">{vipCount}</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-sm)' }}>
            <TooltipButton className="icon-btn" type="button" title={t(oldestFirst ? 'list.oldestFirst' : 'list.newestFirst')} aria-label={t('list.sort')} aria-haspopup="menu" aria-expanded={menu?.kind === 'sort'} onClick={event => openMenu('sort', event.currentTarget)}>
              <Icon name="swap_vert" size={15} />
            </TooltipButton>
            <TooltipButton className="icon-btn" type="button" title={t('list.filter')} aria-label={t('list.filter')} aria-haspopup="menu" aria-expanded={menu?.kind === 'filter'} onClick={event => openMenu('filter', event.currentTarget)}>
              <Icon name="filter_list" size={15} />
            </TooltipButton>
          </div>
        </div>

        <div className="list__queue">
          <span>
            {live
              ? t('list.liveQueue', { count: allCount, loaded: threads.length }).toUpperCase()
              : t('list.queue', { name: t(QUEUE_LABEL[filter]).toUpperCase() })}
          </span>
          {!live && <strong>{t('list.triaged')}</strong>}
        </div>
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
              checked={threads.length > 0 && threads.every((thread) => checkedIds.includes(thread.id))}
              ref={(node) => { if (node) node.indeterminate = !threads.every((thread) => checkedIds.includes(thread.id)) }}
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
        className="thread-list"
        onScroll={(event) => {
          if (!hasMore || !onLoadMore) return
          const element = event.currentTarget
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

        {conversations.map((thread) => {
          const sender = thread.participants[0]
          const members = thread.messageIds
            ? allThreads.filter(item => thread.messageIds!.includes(Number(item.id.slice(5))))
                .sort((a, b) => thread.messageIds!.indexOf(Number(a.id.slice(5))) - thread.messageIds!.indexOf(Number(b.id.slice(5))))
                .map(item => ({ id: item.id, messageId: item.id, sender: item.participants[0], date: item.date !== undefined ? formatMessageDate(item.date, locale) : item.receivedAt, unread: item.unread }))
            : thread.messages.map(message => ({ id: thread.id, messageId: message.id, sender: message.from, date: message.date !== undefined ? formatMessageDateTime(message.date, locale) : message.sentAt, unread: thread.unread }))
          const hasFiles = allThreads.some(item =>
            (item.id === thread.id || thread.messageIds?.includes(Number(item.id.slice(5)))) &&
            (item.hasAttachments || item.messages.some(message => (message.attachments?.length ?? 0) > 0)))
          const active = thread.id === selectedId || members.some(member => member.id === selectedId)
          const deleting = deletingId === thread.id || members.some(member => member.id === deletingId)
          return (
            <div className="thread-group" key={thread.id}>
            <article
              onContextMenu={event => { if (!onContextMenu) return; event.preventDefault(); onContextMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget.querySelector<HTMLElement>('.thread__content')! }, thread.id) }}
              aria-busy={deleting}
              className={cx('thread', active && 'thread--active', thread.unread && 'thread--unread')}
            >
              <label className="thread__select">
                <input className="thread__check" type="checkbox" checked={checkedIds.includes(thread.id)}
                  onChange={() => onCheck(thread.id)} disabled={bulkBusy || thread.id.startsWith('draft:')}
                  aria-label={t('list.selectMessage', { subject: thread.subject })} />
              </label>
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
                    <SenderAvatar email={sender?.email ?? ''} initials={sender?.initials ?? '??'} mailbox={mailbox} blocked={spam || !live} className={active ? 'avatar--accent' : 'avatar--tertiary'} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="thread__name">{sender?.name ?? ''}</span>
                      {sender?.org && <span className="thread__org">{sender.org}</span>}
                    </div>
                  </div>
                </div>

                <div className="thread__meta">
                  {deleting && <span className="thread__processing" role="status"><Icon name="progress_activity" size={15} className="spin" />{t('common.deleting')}</span>}
                  {hasFiles && <span role="img" aria-label={t('thread.attachments')} title={t('thread.attachments')}><Icon name="attach_file" size={15} /></span>}
                  {thread.unread && (
                    <span className="thread__unread" role="img" aria-label={t('list.unread')} title={t('list.unread')}>
                      <Icon name="mark_email_unread" size={16} />
                    </span>
                  )}
                  <span className="thread__time" title={thread.date !== undefined ? formatMessageDateTime(thread.date, locale) : undefined}>{thread.date !== undefined ? formatMessageDate(thread.date, locale) : thread.receivedAt}</span>
                </div>
              </div>

              <div className="thread__subject">
                <span>{thread.subject}</span>
                {thread.messageCount > 1 && members.length < 2 && <span className="thread__count">{thread.messageCount}</span>}
              </div>

              {thread.preview !== '' && <p className="thread__preview">{thread.preview}</p>}

              <div className="thread__tags">
                {thread.tags.map((tag) => (
                  <span key={tag.labelKey} className={tagClass(tag)}>
                    {tag.icon && <Icon name={tag.icon} size={11} />}
                    {t(tag.labelKey, tag.count !== undefined ? { count: tag.count } : undefined)}
                  </span>
                ))}
              </div>
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
                    {live && <input type="checkbox" checked={checkedIds.includes(member.id)} disabled={bulkBusy}
                      onChange={() => onCheck(member.id)} aria-label={t('list.selectMessage', { subject: `${thread.subject} · ${member.sender?.name ?? ''}` })} />}
                    <button type="button"
                      aria-busy={deletingId === member.id}
                      aria-current={member.messageId === selectedMessageId ? 'true' : undefined}
                      className={cx('thread-group__message', member.messageId === selectedMessageId && 'thread-group__message--active', member.unread && 'thread-group__message--unread')}
                      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu?.({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }, member.id, member.messageId) }}
                      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu?.({ x: rect.left, y: rect.bottom, trigger: event.currentTarget }, member.id, member.messageId) } }}
                      onClick={() => onSelect(member.id, member.messageId)}>
                      <Icon className={deletingId === member.id ? 'spin' : undefined} name={deletingId === member.id ? 'progress_activity' : member.unread ? 'mark_email_unread' : 'mail'} size={15} />
                      <span className="thread-group__sender">
                        <strong title={member.sender?.name}>{member.sender?.name}</strong>
                        <span title={member.sender?.email}>{member.sender?.email}</span>
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
