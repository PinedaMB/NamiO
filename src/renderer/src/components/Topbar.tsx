import { ACCOUNT } from '../data/demo'
import { LOCALES, useI18n } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

export type FilterId = 'focused' | 'other' | 'vip' | 'files' | 'needs-reply'

interface TopbarProps {
  unreadCount: number
  filter: FilterId
  onFilter: (filter: FilterId) => void
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
  onFilter,
  onOpenPalette,
  onOpenSettings
}: TopbarProps): React.JSX.Element {
  const { t, locale, setLocale } = useI18n()

  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="zero-pill">
          <span className="dot" />
          <strong>{t('topbar.zero')}</strong>
          <span>· {t('topbar.remaining', { count: unreadCount })}</span>
        </div>

        <div className="vsep" />

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
      </div>

      <button className="search" type="button" onClick={onOpenPalette}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="search" size={16} />
          {t('topbar.search')}
        </span>
        <span className="search__hint">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>

      <div className="topbar__right">
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
