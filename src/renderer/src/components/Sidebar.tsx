import type { ContextAnchor } from './ContextMenu'
import { TooltipButton } from './Tooltip'
import { useEffect, useRef, useState } from 'react'
import type { AccountActivity, AccountSummary } from '@shared/ipc'
import logo from '../assets/logo.png'
import { TAGS } from '../data/demo'
import type { FolderView } from '../data/live'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
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
  syncDetail: string
  offline: boolean
  onFolderContextMenu?: (anchor: ContextAnchor, id: string) => void
  onSelectFolder: (id: string) => void
  onOpenSettings: () => void
  onOpenAccount: () => void
  onExitDemo: () => void
  onAddAccount: () => void
  onSelectAccount: (id: string) => void
  /** Se llama al abrir el menú: la lista de cuentas puede haber cambiado. */
  onRefreshAccounts?: () => void
}

const EXPANDED_GROUPS_KEY = 'namio.sidebar.expanded-groups'

function readExpandedGroups(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(EXPANDED_GROUPS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  activeFolder,
  folders,
  accountLabel,
  accountConnected,
  accounts = [],
  activity = [],
  showTags,
  syncLabel,
  syncDetail,
  offline,
  onSelectFolder,
  onFolderContextMenu,
  onOpenSettings,
  onOpenAccount,
  onExitDemo,
  onAddAccount,
  onSelectAccount,
  onRefreshAccounts
}: SidebarProps): React.JSX.Element {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(readExpandedGroups)

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...expandedGroups]))
    } catch {
      // Sin almacenamiento disponible: el estado sigue viviendo en memoria.
    }
  }, [expandedGroups])
  const accountMenu = useRef<HTMLDivElement>(null)
  /** El rail tiene `overflow-y`, así que el menú se posiciona contra la ventana. */
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !accountMenu.current?.contains(event.target)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setMenuOpen(false)
      accountMenu.current?.querySelector<HTMLButtonElement>('.account')?.focus()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  const toggleMenu = (element: HTMLElement): void => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = element.getBoundingClientRect()
    setAnchor({ top: rect.bottom + 6, left: rect.left, width: Math.max(224, rect.width) })
    setMenuOpen(true)
    onRefreshAccounts?.()
  }

  const unseenOf = (id: string): number => {
    if (accounts.find((account) => account.id === id)?.active) {
      return folders.find((folder) => folder.icon === 'inbox' || /^inbox$/i.test(folder.id))?.count ?? 0
    }
    return activity.find((item) => item.id === id)?.unseen ?? 0
  }
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const hiddenByGroup = (folder: FolderView): boolean => {
    let parent = folder.parentId ?? null
    while (parent) {
      if (!expandedGroups.has(parent)) return true
      parent = folderById.get(parent)?.parentId ?? null
    }
    return false
  }
  const toggleGroup = (id: string): void => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
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
          <TooltipButton className="icon-btn" type="button" title={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')} aria-label={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')} aria-expanded={!collapsed} onClick={() => { setMenuOpen(false); onToggleCollapsed() }}>
            <Icon name={collapsed ? 'dock_to_right' : 'dock_to_left'} size={16} />
          </TooltipButton>
        </div>

        <div className="rail__block" ref={accountMenu}>
          <TooltipButton
            className="account"
            type="button"
            onClick={(event) => toggleMenu(event.currentTarget)}
            title={`${accountLabel} · ${t('account.switch')}${inactiveUnseen > 0 ? ` · ${t('account.inactiveMail', { count: inactiveUnseen })}` : ''}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="account__id">
              <span className={cx('dot', !accountConnected && 'dot--idle')} />
              <span className="account__mail">{accountLabel}</span>
              {inactiveUnseen > 0 && (
                <span className="account__alert" aria-hidden="true">
                  <Icon name="mark_email_unread" size={14} />
                </span>
              )}
            </span>
            <Icon name={accounts.length > 1 ? 'expand_more' : accountConnected ? 'tune' : 'add'} size={16} />
          </TooltipButton>

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
                          <span className="account-menu__count-label">{t('list.unread')}</span>
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

        <nav className="rail__nav" aria-label={t('sidebar.inbox')}>
          {folders.filter((folder) => !hiddenByGroup(folder)).map((folder) => {
            const nested = (folder.depth ?? 0) > 0
            const target = (
              <TooltipButton
                key={folder.hasChildren ? undefined : folder.id}
                title={collapsed ? folder.label : undefined}
                aria-label={folder.spam ? `${folder.label} · ${t('sidebar.spam')}` : folder.label}
                type="button"
                className={cx('nav-item', folder.hasChildren && 'nav-group__target', activeFolder === folder.id && 'nav-item--active', folder.spam && 'nav-item--spam')}
                style={!collapsed && nested && !folder.hasChildren ? { paddingLeft: `calc(var(--sp-sm) + ${(folder.depth ?? 0) * 14}px)` } : undefined}
                data-depth={folder.depth || undefined}
                onContextMenu={event => { if (!onFolderContextMenu) return; event.preventDefault(); onFolderContextMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }, folder.id) }}
                onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onFolderContextMenu?.({ x: rect.left, y: rect.bottom, trigger: event.currentTarget }, folder.id) } }}
                onClick={() => onSelectFolder(folder.id)}
                aria-current={activeFolder === folder.id ? 'page' : undefined}
              >
                <span className="nav-item__label">
                  <Icon name={folder.icon} size={18} />
                  <span className="nav-item__text">{folder.label}</span>
                </span>
                {folder.count !== undefined && folder.count > 0 && (
                  <span className={cx('nav-item__count', folder.accent && 'nav-item__count--accent')}>
                    {folder.count}
                  </span>
                )}
              </TooltipButton>
            )
            if (!folder.hasChildren) return target
            const groupExpanded = expandedGroups.has(folder.id)
            return (
              <div className="nav-group" key={folder.id} style={!collapsed && nested ? { marginLeft: `${(folder.depth ?? 0) * 14}px` } : undefined}>
                <div className="nav-group__row">
                  {target}
                  <button
                    className="nav-group__toggle"
                    type="button"
                    aria-expanded={groupExpanded}
                    aria-label={t(groupExpanded ? 'sidebar.collapseGroup' : 'sidebar.expandGroup', { name: folder.label })}
                    onClick={() => toggleGroup(folder.id)}
                  >
                    <Icon name={groupExpanded ? 'expand_more' : 'chevron_right'} size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </nav>

        {showTags && (
          <div className="rail__tags">
            <div className="rail__section-head">
              <span>{t('common.tags')}</span>
              <TooltipButton className="icon-btn" type="button" title={t('sidebar.newTag')} aria-label={t('sidebar.newTag')}>
                <Icon name="add" size={14} />
              </TooltipButton>
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
          <TooltipButton className="account-menu__action" type="button" onClick={onExitDemo} title={collapsed ? t('onboarding.exitDemo') : undefined} aria-label={t('onboarding.exitDemo')}>
            <Icon name="logout" size={15} />
            <span>{t('onboarding.exitDemo')}</span>
          </TooltipButton>
        )}
        <TooltipButton className="nav-item rail__settings" type="button" title={collapsed ? t('sidebar.settings') : undefined} aria-label={t('sidebar.settings')} onClick={onOpenSettings}>
          <span className="nav-item__label">
            <Icon name="settings" size={18} />
            <span className="nav-item__text">{t('sidebar.settings')}</span>
          </span>
        </TooltipButton>
        <div className="sync-pill">
          <span className={cx('sync-pill__state', !offline && 'sr-only')} data-tooltip={`${accountLabel} · ${syncDetail}`} tabIndex={offline ? 0 : undefined}>
            <span
              className={cx('dot', offline ? 'dot--error' : 'dot--tertiary')}
            />
            <span className="sync-pill__text">{syncLabel}</span>
          </span>
        </div>
      </div>
    </aside>
  )
}
