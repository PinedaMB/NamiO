import { useEffect, useRef, useState } from 'react'
import type { MailboxInfo } from '@shared/ipc'
import { useI18n } from '../i18n'
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
  const dialog = useRef<HTMLDialogElement>(null)
  const [target, setTarget] = useState(folders[0]?.path ?? '')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} className="account-modal move-dialog" aria-labelledby="move-title"
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => event.stopPropagation()}
    onClick={event => { if (event.currentTarget === event.target) onClose() }}>
    <header className="account-modal__head">
      <div><h2 id="move-title" className="account-modal__title">{t('move.title')}</h2><p className="account-modal__subtitle">{subject}</p></div>
      <TooltipButton className="icon-btn" type="button" title={t('common.close')} onClick={onClose}><Icon name="close" size={16} /></TooltipButton>
    </header>
    <label className="move-dialog__field">{t('move.destination')}
      <Select autoFocus value={target} onChange={event => setTarget(event.target.value)}>
        {folders.map(folder => <option key={folder.path} value={folder.path}>{folder.path}</option>)}
      </Select>
    </label>
    <footer className="account-modal__foot">
      <button className="btn btn--surface" type="button" onClick={onClose}>{t('account.cancel')}</button>
      <button className="btn btn--primary" type="button" disabled={!folders.some(folder => folder.path === target)} onClick={() => onMove(target)}>{t('common.move')}</button>
    </footer>
  </dialog>
}
