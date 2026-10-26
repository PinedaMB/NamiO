import { ACCOUNT } from '../data/demo'
import { LOCALES, useI18n } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

export type FilterId = 'focused' | 'other' | 'vip' | 'files' | 'needs-reply'

interface TopbarProps {
  unreadCount: number
  filter: FilterId
  /** Cuenta real: se ocultan los filtros de demo y el resumen cambia de texto. */
  live?: boolean
  onFilter: (filter: FilterId) => void
  query: string
  onQuery: (value: string) => void
  onOpenPalette: () => void
  onOpenSettings: () => void
}

const FILTERS: ReadonlyArray<{ id: FilterId; labelKey: 'topbar.unread' | 'topbar.needsReply' | 'topbar.vips' | 'topbar.files'; icon?: string }> = [
  { id: 'focused', labelKey: 'topbar.unread', icon: 'mark_email_unread' },
  { id: 'needs-reply', labelKey: 'topbar.needsReply' },
  { id: 'vip', labelKey: 'topbar.vips' },
  { id: 'files', labelKey: 'topbar.files', icon: 'attachment' }
]

export function Topbar({
  unreadCount,
  filter,
  live = false,
  onFilter,
  query,
  onQuery,
  onOpenPalette,
  onOpenSettings
}: TopbarProps): React.JSX.Element {
  const { t, locale, setLocale } = useI18n()

  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="zero-pill">
          <span className="dot" />
          {live ? (
            <>
              <strong>{t('topbar.unread')}</strong>
              <span>{` · ${unreadCount}`}</span>
            </>
          ) : (
            <>
              <strong>{t('topbar.zero')}</strong>
              <span>
                ·{' '}
                {unreadCount === 1 ? t('topbar.remainingOne') : t('topbar.remaining', { count: unreadCount })}
              </span>
            </>
          )}
        </div>

        <div className="vsep" />

        {/* En modo real los filtros de demo (VIP, adjuntos, respuesta) no tienen
            datos: los reemplazan las pestañas "Sin leer / Leídos" de la lista. */}
        {!live && (
          <div className="filter-row">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cx('filter-chip', filter === item.id && 'filter-chip--active')}
                onClick={() => onFilter(item.id)}
              >
                {item.icon && <Icon name={item.icon} size={14} />}
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="search">
        <Icon name="search" size={16} className="search__icon" />
        <input
          className="search__input"
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onQuery('')
              event.currentTarget.blur()
            }
          }}
          placeholder={t('topbar.search')}
          aria-label={t('topbar.search')}
          spellCheck={false}
          autoComplete="off"
        />
        {query === '' ? (
          <span className="search__hint">
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">K</kbd>
          </span>
        ) : (
          <button className="search__clear" type="button" onClick={() => onQuery('')} title={t('common.close')}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="topbar__right">
        <button
          className="icon-btn"
          type="button"
          title={t('status.actions')}
          aria-label={t('status.actions')}
          onClick={onOpenPalette}
        >
          <Icon name="keyboard_command_key" size={18} />
        </button>
        <div className="lang-switch" role="group" aria-label={t('topbar.language')}>
          {LOCALES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx('lang-switch__btn', locale === item.id && 'lang-switch__btn--active')}
              onClick={() => setLocale(item.id)}
              aria-pressed={locale === item.id}
              title={t('topbar.language')}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="icon-btn" type="button" title={t('topbar.sync')} aria-label={t('topbar.sync')}>
          <Icon name="sync" size={18} />
        </button>
        <button
          className="icon-btn"
          type="button"
          title={t('topbar.preferences')}
          aria-label={t('topbar.preferences')}
          onClick={onOpenSettings}
        >
          <Icon name="tune" size={18} />
        </button>
        <div className="vsep" />
        <button className="avatar avatar--accent" type="button" title={ACCOUNT.name}>
          {ACCOUNT.initials}
        </button>
      </div>
    </header>
  )
}
