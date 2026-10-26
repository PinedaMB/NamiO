import { ACCOUNT, FOLDERS, TAGS } from '../data/demo'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface SidebarProps {
  activeFolder: string
  onSelectFolder: (id: string) => void
  onCompose: () => void
}

export function Sidebar({ activeFolder, onSelectFolder, onCompose }: SidebarProps): React.JSX.Element {
  return (
    <aside className="rail">
      <div>
        <div className="rail__brand">
          <div className="rail__brand-left">
            <div className="rail__logo">V</div>
            <span className="rail__wordmark">Veloce</span>
          </div>
          <button className="icon-btn" type="button" title="Collapse rail" aria-label="Collapse rail">
            <Icon name="dock_to_left" size={16} />
          </button>
        </div>

        <div className="rail__block">
          <button className="account" type="button">
            <span className="account__id">
              <span className="dot" />
              <span className="account__mail">{ACCOUNT.email}</span>
            </span>
            <Icon name="unfold_more" size={16} />
          </button>
        </div>

        <div className="rail__block">
          <button className="compose-btn" type="button" onClick={onCompose}>
            <span className="compose-btn__label">
              <Icon name="edit_square" size={16} />
              Compose
            </span>
            <kbd className="kbd">C</kbd>
          </button>
        </div>

        <nav className="rail__nav" aria-label="Folders">
          {FOLDERS.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={cx('nav-item', activeFolder === folder.id && 'nav-item--active')}
              onClick={() => onSelectFolder(folder.id)}
              aria-current={activeFolder === folder.id ? 'page' : undefined}
            >
              <span className="nav-item__label">
                <Icon name={folder.icon} size={18} />
                {folder.label}
              </span>
              {folder.count !== undefined && (
                <span
                  className={cx('nav-item__count', folder.accent && 'nav-item__count--accent')}
                >
                  {folder.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="rail__tags">
          <div className="rail__section-head">
            <span>Tags</span>
            <button className="icon-btn" type="button" title="New tag" aria-label="New tag">
              <Icon name="add" size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {TAGS.map((tag) => (
              <button key={tag.label} type="button" className="tag-item">
                <span className={`dot dot--${tag.tone === 'error' ? 'error' : tag.tone === 'secondary' ? 'tertiary' : ''}`} />
                {tag.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rail__foot">
        <div className="sync-pill">
          <span className="sync-pill__state">
            <span className="dot dot--tertiary pulse" />
            Synced 12s ago
          </span>
          <button className="icon-btn" type="button" title="Settings" aria-label="Settings">
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
