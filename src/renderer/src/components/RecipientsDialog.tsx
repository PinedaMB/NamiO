import { useEffect, useRef, useState } from 'react'
import type { Message } from '../data/demo'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { TooltipButton } from './Tooltip'

export function RecipientsDialog({ message, onClose }: { message: Message; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const [closing, setClosing] = useState(false)
  const [status, setStatus] = useState<{ result: 'copied' | 'failed'; key: string } | null>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => {
    if (!status) return
    const timeout = window.setTimeout(() => setStatus(null), 1600)
    return () => window.clearTimeout(timeout)
  }, [status])
  const copy = async (text: string, key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ result: 'copied', key })
    } catch {
      setStatus({ result: 'failed', key })
    }
  }
  const groups = [{ label: t('compose.from'), people: [message.from] }, { label: t('thread.to'), people: message.to }, { label: t('compose.cc'), people: message.cc ?? [] }]
  const emails = [...new Set([...message.to, ...(message.cc ?? [])].map(person => person.email))]
  return <dialog ref={dialog} className={closing ? 'account-modal recipients-dialog recipients-dialog--closing' : 'account-modal recipients-dialog'} aria-labelledby="recipients-title"
    onAnimationEnd={event => { if (closing && event.target === event.currentTarget && event.animationName === 'dialog-out') onClose() }}
    onCancel={event => { event.preventDefault(); setClosing(true) }} onKeyDown={event => event.stopPropagation()}
    onClick={event => { if (event.currentTarget === event.target) setClosing(true) }}>
    <header className="account-modal__head">
      <div>
        <h2 id="recipients-title" className="account-modal__title">{t('recipients.title')}</h2>
        <p className="account-modal__subtitle">{t('recipients.hint')}</p>
      </div>
      <TooltipButton className="icon-btn" type="button" autoFocus title={t('common.close')} onClick={() => setClosing(true)}><Icon name="close" size={16} /></TooltipButton>
    </header>
    <div className="recipients-dialog__list">
      {groups.filter(group => group.people.length > 0).map(group => <section key={group.label} aria-label={group.label}>
        <h2>{group.label} <span>({group.people.length})</span></h2>
        <ul>{group.people.map((person, index) => <li key={`${person.email}:${index}`}>
          <div>{person.name && person.name !== person.email && <strong>{person.name}</strong>}<span className="recipients-dialog__email">{person.email}</span></div>
          <TooltipButton className={status?.result === 'copied' && status.key === `${group.label}:${index}` ? 'icon-btn recipients-dialog__copy recipients-dialog__copy--copied' : 'icon-btn recipients-dialog__copy'} type="button" title={t('recipients.copy', { email: person.email })} onClick={() => void copy(person.email, `${group.label}:${index}`)}><Icon name={status?.result === 'copied' && status.key === `${group.label}:${index}` ? 'check' : 'content_copy'} size={18} /></TooltipButton>
        </li>)}</ul>
      </section>)}
    </div>
    <footer className="account-modal__foot">
      <p className="recipients-dialog__status" role="status">{status ? t(status.result === 'copied' ? 'recipients.copied' : 'recipients.failed') : ''}</p>
      <button className="btn btn--primary" type="button" onClick={() => void copy(emails.join('; '), 'all')}>{t('recipients.copyAll')}</button>
    </footer>
  </dialog>
}
