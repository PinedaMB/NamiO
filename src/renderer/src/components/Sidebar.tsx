import { useState } from 'react'
import type { AccountActivity, AccountSummary } from '@shared/ipc'
import logo from '../assets/logo.png'
import { TAGS } from '../data/demo'
import type { FolderView } from '../data/live'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface SidebarProps {
  activeFolder: string
  folders: readonly FolderView[]
  accountLabel: string
  accountConnected: boolean
  /** Cuentas guardadas: con más de una aparece el conmutador. */
  accounts: readonly AccountSummary[]
  /** No leídos por cuenta (incluidas las inactivas). */
  activity?: readonly AccountActivity[]
  showTags: boolean
  syncLabel: string
  offline: boolean
  onSelectFolder: (id: string) => void
  onCompose: () => void
  onOpenSettings: () => void
  onOpenAccount: () => void
  onExitDemo: () => void
  onAddAccount: () => void
  onSelectAccount: (id: string) => void
  /** Se llama al abrir el menú: la lista de cuentas puede haber cambiado. */
  onRefreshAccounts?: () => void
}

export function Sidebar({
  activeFolder,
  folders,
  accountLabel,
  accountConnected,
  accounts = [],
  activity = [],
  showTags,
  syncLabel,
  offline,
  onSelectFolder,
  onCompose,
  onOpenSettings,
  onOpenAccount,
  onExitDemo,
  onAddAccount,
  onSelectAccount,
  onRefreshAccounts
}: SidebarProps): React.JSX.Element {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  /** El rail tiene `overflow-y`, así que el menú se posiciona contra la ventana. */
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null)

  const toggleMenu = (element: HTMLElement): void => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = element.getBoundingClientRect()
    setAnchor({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    setMenuOpen(true)
    onRefreshAccounts?.()
  }

  const unseenOf = (id: string): number => activity.find((item) => item.id === id)?.unseen ?? 0
  const inactiveUnseen = activity
    .filter((item) => !item.active && item.unseen > 0)
    .reduce((total, item) => total + item.unseen, 0)

  return (
    <aside className="rail">
      <div>
        <div className="rail__brand">
          <div className="rail__brand-left">
            <img className="rail__logo" src={logo} alt="" aria-hidden="true" />
            <span className="rail__wordmark">NamiO</span>
          </div>
          <button className="icon-btn" type="button" title={t('sidebar.collapse')} aria-label={t('sidebar.collapse')}>
            <Icon name="dock_to_left" size={16} />
          </button>
        </div>

        <div className="rail__block">
          <button
            className="account"
            type="button"
            onClick={(event) => toggleMenu(event.currentTarget)}
            title={t('account.switch')}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="account__id">
              <span className={cx('dot', !accountConnected && 'dot--idle')} />
              <span className="account__mail">{accountLabel}</span>
            </span>
            {inactiveUnseen > 0 && (
              <span className="account__alert" title={t('account.inactiveMail', { count: inactiveUnseen })}>
                {inactiveUnseen}
              </span>
            )}
            <Icon name={accounts.length > 1 ? 'expand_more' : accountConnected ? 'tune' : 'add'} size={16} />
          </button>

          {menuOpen && anchor && (
            <div
              className="account-menu"
              role="menu"
              style={{ position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width }}
            >
              {accounts.length > 0 && (
                <div className="account-menu__list">
                  {accounts.map((item) => (
                    <button
                      key={item.id}
                      className={cx('account-menu__item', item.active && 'account-menu__item--active')}
                      type="button"
                      role="menuitemradio"
                      aria-checked={item.active}
                      onClick={() => {
                        setMenuOpen(false)
                        onSelectAccount(item.id)
                      }}
                    >
                      <span className="account-menu__text">
                        <span className="account-menu__label">{item.label}</span>
                        <span className="account-menu__host">
                          {item.host}:{item.port}
                        </span>
                      </span>
                      {unseenOf(item.id) > 0 && (
                        <span className={cx('account-menu__count', item.active && 'account-menu__count--active')}>
                          {unseenOf(item.id)}
                        </span>
                      )}
                      {item.active && <Icon name="check" size={15} />}
                    </button>
                  ))}
                </div>
              )}

              <button
                className="account-menu__action"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onAddAccount()
                }}
              >
                <Icon name="add" size={15} />
                {t('account.add')}
              </button>
              <button
                className="account-menu__action"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onOpenAccount()
                }}
              >
                <Icon name="tune" size={15} />
                {t('account.manage')}
              </button>
            </div>
          )}
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
          {folders.map((folder) => (
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
              {folder.count !== undefined && folder.count > 0 && (
                <span className={cx('nav-item__count', folder.accent && 'nav-item__count--accent')}>
                  {folder.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {showTags && (
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
        )}
      </div>

      <div className="rail__foot">
        {!accountConnected && (
          <button className="account-menu__action" type="button" onClick={onExitDemo}>
            <Icon name="logout" size={15} />
            {t('onboarding.exitDemo')}
          </button>
        )}
        <div className="sync-pill">
          <span className="sync-pill__state">
            <span
              className={cx('dot', offline ? 'dot--error' : 'dot--tertiary', accountConnected && !offline && 'pulse')}
            />
            {syncLabel}
          </span>
          <button className="icon-btn" type="button" title={t('sidebar.settings')} aria-label={t('sidebar.settings')} onClick={onOpenSettings}>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
