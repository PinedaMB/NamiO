import { useEffect, useRef, useState } from 'react'
import type { MailboxInfo } from '@shared/ipc'
import { useI18n } from '../i18n'
import { useAnimatedClose } from '../lib/useAnimatedClose'
import { mailboxToFolder } from '../data/live'
import { Icon } from './Icon'
import { Select } from './Select'
import { TooltipButton } from './Tooltip'

export function MoveDialog({ subject, folders, onClose, onMove }: {
  subject: string
  folders: readonly MailboxInfo[]
  onClose: () => void
  onMove: (target: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { closing, close } = useAnimatedClose(onClose)
  const dialog = useRef<HTMLDialogElement>(null)
  const [target, setTarget] = useState(folders[0]?.path ?? '')
  const destinations = folders.map(mailbox => {
    const folder = mailboxToFolder(mailbox)
    return { ...folder, label: folder.labelKey ? t(folder.labelKey) : folder.label }
  })
  const selected = destinations.find(folder => folder.id === target)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} className="account-modal move-dialog" data-closing={closing || undefined} aria-labelledby="move-title"
    onCancel={event => { event.preventDefault(); close() }} onKeyDown={event => event.stopPropagation()}
    onClick={event => { if (event.currentTarget === event.target) close() }}>
    <header className="account-modal__head">
      <div><h2 id="move-title" className="account-modal__title">{t('move.title')}</h2><p className="account-modal__subtitle">{subject}</p></div>
      <TooltipButton className="icon-btn" type="button" title={t('common.close')} onClick={() => close()}><Icon name="close" size={16} /></TooltipButton>
    </header>
    <label className="move-dialog__field">{t('move.destination')}
      <Select autoFocus value={target} onChange={event => setTarget(event.target.value)}>
        <button type="button">
          {selected && <><Icon name={selected.icon} size={18} /><span>{selected.label}</span></>}
        </button>
        {destinations.map(folder => <option key={folder.id} value={folder.id} aria-label={folder.label}>
          <Icon name={folder.icon} size={18} /><span>{folder.label}</span>
        </option>)}
      </Select>
    </label>
    <footer className="account-modal__foot">
      <button className="btn btn--surface" type="button" onClick={() => close()}>{t('account.cancel')}</button>
      <button className="btn btn--primary" type="button" disabled={!folders.some(folder => folder.path === target)} onClick={() => close(() => onMove(target))}>{t('common.move')}</button>
    </footer>
  </dialog>
}
