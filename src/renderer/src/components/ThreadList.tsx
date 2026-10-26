import type { Tag, Thread } from '../data/demo'
import type { FilterId } from './Topbar'
import { useI18n, type TranslationKey } from '../i18n'
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

const QUEUE_LABEL: Record<FilterId, TranslationKey> = {
  focused: 'list.highPriority',
  other: 'list.everythingElse',
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
  selectedId,
  filter,
  unreadCount,
  otherCount,
  vipCount,
  onFilter,
  onSelect
}: ThreadListProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <section className="list" aria-label={t('list.queue', { name: t(QUEUE_LABEL[filter]) })}>
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
              {t('list.focused')} <span className="seg__count">{unreadCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'other'}
              className={cx('seg__btn', filter === 'other' && 'seg__btn--active')}
              onClick={() => onFilter('other')}
            >
              {t('list.other')} <span className="seg__count">{otherCount}</span>
            </button>
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
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="icon-btn" type="button" title={t('list.sort')} aria-label={t('list.sort')}>
              <Icon name="swap_vert" size={15} />
            </button>
            <button className="icon-btn" type="button" title={t('list.filter')} aria-label={t('list.filter')}>
              <Icon name="filter_list" size={15} />
            </button>
          </div>
        </div>

        <div className="list__queue">
          <span>{t('list.queue', { name: t(QUEUE_LABEL[filter]).toUpperCase() })}</span>
          <strong>{t('list.triaged')}</strong>
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
                      <span className="thread__name">{sender?.name ?? ''}</span>
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
                  <span key={tag.labelKey} className={tagClass(tag)}>
                    {tag.icon && <Icon name={tag.icon} size={11} />}
                    {t(tag.labelKey, tag.count !== undefined ? { count: tag.count } : undefined)}
                  </span>
                ))}
              </div>
            </article>
          )
        })}

        {threads.length === 0 && (
          <p className="muted" style={{ padding: '24px 12px', textAlign: 'center' }}>
            {t('list.empty')}
          </p>
        )}
      </div>
    </section>
  )
}
