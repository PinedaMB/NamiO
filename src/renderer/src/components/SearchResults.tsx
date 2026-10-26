import type { SearchHit } from '@shared/ipc'
import { useI18n } from '../i18n'
import { cx } from '../lib/cx'
import { Icon } from './Icon'

interface SearchResultsProps {
  query: string
  hits: readonly SearchHit[]
  loading: boolean
  selectedKey: string | null
  onOpen: (hit: SearchHit) => void
}

function formatWhen(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = new Date().toDateString() === date.toDateString()
  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }
  ).format(date)
}

/** El snippet llega con ⟦…⟧ alrededor de las coincidencias: se resalta sin HTML. */
function Snippet({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/[⟦⟧]/)
  return (
    <p className="search-hit__snippet">
      {parts.map((part, index) =>
        index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
      )}
    </p>
  )
}

export function SearchResults({
  query,
  hits,
  loading,
  selectedKey,
  onOpen
}: SearchResultsProps): React.JSX.Element {
  const { t, locale } = useI18n()

  return (
    <section className="list" aria-label={t('search.label')}>
      <div className="list__filters">
        <div className="list__filters-row">
          <span className="search-summary">
            <Icon name="search" size={14} />
            {loading
              ? t('search.searching')
              : t(hits.length === 1 ? 'search.resultOne' : 'search.results', { count: hits.length })}
          </span>
        </div>
        <div className="list__queue">
          <span>{t('search.scope')}</span>
          <strong>{query}</strong>
        </div>
      </div>

      <div className="thread-list">
        {loading && (
          <div className="list-loading">
            <Icon name="progress_activity" size={16} className="spin" />
            {t('search.searching')}
          </div>
        )}

        {!loading && hits.length === 0 && <div className="list-empty">{t('search.empty', { query })}</div>}

        {!loading &&
          hits.map((hit) => {
            const key = `${hit.mailbox}:${hit.uid}`
            return (
              <article
                key={key}
                className={cx('thread', 'search-hit', selectedKey === key && 'thread--active')}
                onClick={() => onOpen(hit)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen(hit)
                  }
                }}
                tabIndex={0}
                role="button"
              >
                <div className="search-hit__head">
                  <span className="thread__name">{hit.from?.name || hit.from?.address || '—'}</span>
                  <span className="search-hit__folder">{hit.mailboxName}</span>
                  <span className="thread__time">{formatWhen(hit.date, locale)}</span>
                </div>
                <div className="thread__subject">{hit.subject}</div>
                {hit.snippet.trim() !== '' && <Snippet text={hit.snippet} />}
              </article>
            )
          })}
      </div>
    </section>
  )
}
