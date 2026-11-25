import { usePreferences } from '../settings/PreferencesProvider'
import type { SearchHit } from '@shared/ipc'
import { useI18n } from '../i18n'
import { cx } from '../lib/cx'
import { Icon } from './Icon'
import { formatMessageDate, formatMessageDateTime } from '../lib/dates'

interface SearchResultsProps {
  query: string
  hits: readonly SearchHit[]
  loading: boolean
  error: boolean
  hasMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  onUpdateQuery?: (next: string) => void
  selectedKey: string | null
  onOpen: (hit: SearchHit) => void
}

const QUICK_FILTERS = [
  { token: 'has:attachment', labelKey: 'search.filterAttachments', icon: 'attach_file' },
  { token: 'is:unread', labelKey: 'search.filterUnread', icon: 'mark_email_unread' },
  { token: 'is:starred', labelKey: 'search.filterStarred', icon: 'star' }
] as const

function toggleSearchToken(query: string, token: string): string {
  const re = new RegExp(`(?:^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i')
  if (re.test(query)) return query.replace(re, ' ').replace(/\s+/g, ' ').trim()
  return `${query.trim()} ${token}`.trim()
}

/** El snippet llega con ⟦…⟧ alrededor de las coincidencias: se resalta sin HTML. */
function HighlightedText({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/[⟦⟧]/)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
      )}
    </>
  )
}

export function SearchResults({
  query,
  hits,
  loading,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  onUpdateQuery,
  selectedKey,
  onOpen
}: SearchResultsProps): React.JSX.Element {
  const { timeFormat } = usePreferences()
  const { t, locale } = useI18n()

  return (
    <section className="list" aria-label={t('search.label')}>
      <div className="list__filters">
        <div className="list__filters-row">
          <span className="search-summary">
            <Icon name="search" size={14} />
            {loading
              ? t('search.searching')
              : t(hasMore ? 'search.shown' : hits.length === 1 ? 'search.resultOne' : 'search.results', { count: hits.length })}
          </span>
        </div>
        <div className="list__queue">
          <span>{t('search.scope')}</span>
          <strong>{query}</strong>
        </div>
        {onUpdateQuery && (
          <div className="search-chips" role="group" aria-label={t('search.filters')}>
            {QUICK_FILTERS.map((item) => {
              const active = new RegExp(`(?:^|\\s)${item.token}(?=\\s|$)`, 'i').test(query)
              return (
                <button
                  key={item.token}
                  type="button"
                  className={cx('search-chip', active && 'search-chip--active')}
                  aria-pressed={active}
                  onClick={() => onUpdateQuery(toggleSearchToken(query, item.token))}
                >
                  <Icon name={item.icon} size={13} />
                  {t(item.labelKey)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <p className="search-local-hint">{t('search.localHint')}</p>
      <div className="thread-list search-results-list" aria-busy={loading}>
        {loading && (
          <div className="list-loading">
            <Icon name="progress_activity" size={16} className="spin" />
            {t('search.searching')}
          </div>
        )}

        {!loading && !error && hits.length === 0 && <div className="list-empty">{t('search.empty', { query })}</div>}

        {hits.map((hit) => {
            const key = `${hit.mailbox}:${hit.uid}`
            return (
              <article
                key={key}
                className={cx('thread', 'search-hit', selectedKey === key && 'thread--active', hit.unread && 'thread--unread')}
                onClick={() => onOpen(hit)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen(hit)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-current={selectedKey === key ? 'true' : undefined}
              >
                <div className="search-hit__location">
                  <Icon name="folder" size={14} />
                  {hit.accountLabel && <span className="search-hit__folder">{hit.accountLabel}</span>}
                  <span className="search-hit__folder">{hit.mailboxName}</span>
                  <span className="thread__time" title={formatMessageDateTime(hit.date, locale, false, timeFormat)}>{formatMessageDate(hit.date, locale, Date.now(), timeFormat)}</span>
                </div>
                <div className="search-hit__subject"><HighlightedText text={hit.subjectMatch ?? hit.subject} /></div>
                <div className="search-hit__head">
                  <span className="thread__name">{hit.from?.name || hit.from?.address || '—'}</span>
                  {hit.unread && (
                    <span className="thread__unread" role="img" aria-label={t('list.unread')} title={t('list.unread')}>
                      <Icon name="mark_email_unread" size={16} />
                    </span>
                  )}
                </div>
                {hit.snippet.trim() !== '' && <p className="search-hit__snippet"><HighlightedText text={hit.snippet} /></p>}
              </article>
            )
          })}
        {error && <div className="list-empty" role="alert">
          <p>{t('search.failed')}</p>
          <button className="btn" type="button" onClick={onRetry}>{t('search.retry')}</button>
        </div>}
        {!error && hasMore && <button className="btn" type="button" disabled={loading} onClick={onLoadMore}>
          {t(loading ? 'search.searching' : 'list.loadMore')}
        </button>}
      </div>
    </section>
  )
}
