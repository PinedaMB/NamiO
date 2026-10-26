import type { Tag, Thread } from '../data/demo'
import type { FilterId } from './Topbar'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface ThreadListProps {
  threads: readonly Thread[]
  selectedId: string | null
  filter: FilterId
  unreadCount: number
  otherCount: number
  vipCount: number
  onFilter: (filter: FilterId) => void
  onSelect: (id: string) => void
}

const QUEUE_LABEL: Record<FilterId, string> = {
  focused: 'High Priority',
  other: 'Everything Else',
  vip: 'VIP Only',
  files: 'With Attachments',
  'needs-reply': 'Needs Reply'
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
  selectedId,
  filter,
  unreadCount,
  otherCount,
  vipCount,
  onFilter,
  onSelect
}: ThreadListProps): React.JSX.Element {
  return (
    <section className="list" aria-label="Cola de conversaciones">
      <div className="list__filters">
        <div className="list__filters-row">
          <div className="seg" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'focused'}
              className={cx('seg__btn', filter === 'focused' && 'seg__btn--active')}
              onClick={() => onFilter('focused')}
            >
              Focused <span className="seg__count">{unreadCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'other'}
              className={cx('seg__btn', filter === 'other' && 'seg__btn--active')}
              onClick={() => onFilter('other')}
            >
              Other <span className="seg__count">{otherCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'vip'}
              className={cx('seg__btn', filter === 'vip' && 'seg__btn--active')}
              onClick={() => onFilter('vip')}
            >
              <Icon name="star" size={13} className="seg__star" />
              VIP <span className="seg__count">{vipCount}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="icon-btn" type="button" title="Ordenar" aria-label="Ordenar">
              <Icon name="swap_vert" size={15} />
            </button>
            <button className="icon-btn" type="button" title="Filtrar" aria-label="Filtrar">
              <Icon name="filter_list" size={15} />
            </button>
          </div>
        </div>

        <div className="list__queue">
          <span>QUEUE: {QUEUE_LABEL[filter].toUpperCase()}</span>
          <strong>Triaged 8m ago</strong>
        </div>
      </div>

      <div className="thread-list">
        {threads.map((thread) => {
          const sender = thread.participants[0]
          const active = thread.id === selectedId
          return (
            <article
              key={thread.id}
              className={cx('thread', active && 'thread--active')}
              onClick={() => onSelect(thread.id)}
              onKeyDown={(event) => {
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
                    <span className={cx('avatar', active ? 'avatar--accent' : 'avatar--tertiary')}>
                      {sender?.initials ?? '??'}
                    </span>
                    {thread.unread && <span className="thread__presence" />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="thread__name">{sender?.name ?? 'Desconocido'}</span>
                      {sender?.org && <span className="thread__org">{sender.org}</span>}
                    </div>
                  </div>
                </div>

                <div className="thread__meta">
                  <span className="thread__time">{thread.receivedAt}</span>
                </div>
              </div>

              <div className="thread__subject">
                <span>{thread.subject}</span>
                {thread.messageCount > 1 && <span className="thread__count">{thread.messageCount}</span>}
              </div>

              <p className="thread__preview">{thread.preview}</p>

              <div className="thread__tags">
                {thread.tags.map((tag) => (
                  <span key={tag.label} className={tagClass(tag)}>
                    {tag.icon && <Icon name={tag.icon} size={11} />}
                    {tag.label}
                  </span>
                ))}
              </div>
            </article>
          )
        })}

        {threads.length === 0 && (
          <p className="muted" style={{ padding: '24px 12px', textAlign: 'center' }}>
            Nothing in this view. Try another filter.
          </p>
        )}
      </div>
    </section>
  )
}
