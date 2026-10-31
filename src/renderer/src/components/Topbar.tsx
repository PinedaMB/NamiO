import { useCallback, useState } from 'react'
import { ContextMenu, type ContextAnchor } from './ContextMenu'
import { TooltipButton } from './Tooltip'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

export type FilterId = 'focused' | 'other' | 'all' | 'vip' | 'files' | 'needs-reply'

interface TopbarProps {
  live: boolean
  query: string
  onQuery: (value: string) => void
  onCompose: () => void
  onOpenPalette: () => void
  onOpenSettings: () => void
  onSync: () => void
  syncing: boolean
}

export function Topbar({ live, query, onQuery, onCompose, onOpenPalette, onOpenSettings, onSync, syncing }: TopbarProps): React.JSX.Element {
  const { t } = useI18n()
  const [menu, setMenu] = useState<ContextAnchor | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  return (
    <header className="topbar">
      <div className="search">
        <Icon name="search" size={18} className="search__icon" />
        <input className="search__input" type="search" value={query}
          onChange={event => onQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onQuery(''); event.currentTarget.blur() } }}
          placeholder={t('topbar.search')} aria-label={t('topbar.search')} spellCheck={false} autoComplete="off" />
        {query !== '' && <TooltipButton className="search__clear" type="button" onClick={() => onQuery('')} title={t('common.close')}><Icon name="close" size={14} /></TooltipButton>}
      </div>
      <div className="topbar__right">
        {syncing && <span className="mail-moving" role="status"><Icon name="sync" size={18} className="spin" /><span className="sr-only">{t('sidebar.syncing')}</span></span>}
        <button className="compose-btn" type="button" onClick={onCompose} aria-label={t('sidebar.compose')}>
          <Icon name="edit_square" size={18} /><span>{t('sidebar.compose')}</span>
        </button>
        <TooltipButton className="icon-btn" type="button" title={t('status.actions')} aria-haspopup="menu" aria-expanded={menu !== null}
          onClick={event => { const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect(); setMenu({ x: bounds.right, y: bounds.bottom, trigger }) }}>
          <Icon name="more_horiz" size={20} />
        </TooltipButton>
      </div>
      {menu && <ContextMenu anchor={menu} label={t('status.actions')} onClose={closeMenu} actions={[
        { label: t('status.actions'), icon: 'keyboard_command_key', run: onOpenPalette },
        { label: t('topbar.sync'), icon: syncing ? 'progress_activity' : 'sync', disabled: !live || syncing, run: onSync },
        { label: t('topbar.preferences'), icon: 'settings', run: onOpenSettings }
      ]} />}
    </header>
  )
}
