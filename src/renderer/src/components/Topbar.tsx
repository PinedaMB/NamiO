import { ACCOUNT } from '../data/demo'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

export type FilterId = 'focused' | 'other' | 'vip' | 'files' | 'needs-reply'

interface TopbarProps {
  unreadCount: number
  filter: FilterId
  onFilter: (filter: FilterId) => void
  onOpenPalette: () => void
}

const FILTERS: ReadonlyArray<{ id: FilterId; label: string; icon?: string }> = [
  { id: 'focused', label: 'Unread', icon: 'mark_email_unread' },
  { id: 'needs-reply', label: 'Needs Reply' },
  { id: 'vip', label: 'VIPs' },
  { id: 'files', label: 'Files', icon: 'attachment' }
]

export function Topbar({ unreadCount, filter, onFilter, onOpenPalette }: TopbarProps): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="zero-pill">
          <span className="dot" />
          <strong>Inbox Zero in sight</strong>
          <span>· {unreadCount} remaining</span>
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
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <button className="search" type="button" onClick={onOpenPalette}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="search" size={16} />
          Search messages, people, or commands…
        </span>
        <span className="search__hint">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>

      <div className="topbar__right">
        <button className="icon-btn" type="button" title="Sync" aria-label="Sync">
          <Icon name="sync" size={18} />
        </button>
        <button className="icon-btn" type="button" title="Preferences" aria-label="Preferences">
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
