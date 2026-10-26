import { ACCOUNT, FOLDERS, TAGS } from '../data/demo'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface SidebarProps {
  activeFolder: string
  onSelectFolder: (id: string) => void
  onCompose: () => void
  onOpenSettings: () => void
}

export function Sidebar({
  activeFolder,
  onSelectFolder,
  onCompose,
  onOpenSettings
}: SidebarProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <aside className="rail">
      <div>
        <div className="rail__brand">
          <div className="rail__brand-left">
            <div className="rail__logo">N</div>
            <span className="rail__wordmark">NamiO</span>
          </div>
          <button className="icon-btn" type="button" title={t('sidebar.collapse')} aria-label={t('sidebar.collapse')}>
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
              {t('sidebar.compose')}
            </span>
            <kbd className="kbd">C</kbd>
          </button>
        </div>

        <nav className="rail__nav" aria-label={t('sidebar.inbox')}>
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
                {t(folder.labelKey)}
              </span>
              {folder.count !== undefined && (
                <span className={cx('nav-item__count', folder.accent && 'nav-item__count--accent')}>
                  {folder.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="rail__tags">
          <div className="rail__section-head">
            <span>{t('common.tags')}</span>
            <button className="icon-btn" type="button" title={t('sidebar.newTag')} aria-label={t('sidebar.newTag')}>
              <Icon name="add" size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {TAGS.map((tag) => (
              <button key={tag.labelKey} type="button" className="tag-item">
                <span className={`dot dot--${tag.tone === 'error' ? 'error' : tag.tone === 'secondary' ? 'tertiary' : ''}`} />
                {t(tag.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rail__foot">
        <div className="sync-pill">
          <span className="sync-pill__state">
            <span className="dot dot--tertiary pulse" />
            {t('sidebar.synced')}
          </span>
          <button
            className="icon-btn"
            type="button"
            title={t('sidebar.settings')}
            aria-label={t('sidebar.settings')}
            onClick={onOpenSettings}
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
