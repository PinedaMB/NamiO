import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

export function FolderDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  return <dialog ref={dialog} className="account-modal move-dialog" aria-labelledby="folder-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={event => event.stopPropagation()}>
    <form className="account-form" onSubmit={event => {
      event.preventDefault()
      if (busy || !name.trim()) return
      setBusy(true); setError('')
      void onCreate(name.trim()).then(onClose).catch(error => setError(error instanceof Error ? error.message : 'IPC')).finally(() => setBusy(false))
    }}>
      <header className="account-modal__head"><h2 id="folder-title" className="account-modal__title">{t('folder.create')}</h2></header>
      <label className="account-field"><span>{t('folder.name')}</span><input autoFocus maxLength={255} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      {error && <p className="account-error" role="alert">{error}</p>}
      <footer className="account-modal__foot">
        <button className="btn btn--surface" type="button" disabled={busy} onClick={onClose}>{t('account.cancel')}</button>
        <button className="btn btn--primary" disabled={busy || !name.trim() || /[/\\]/.test(name)}>{t(busy ? 'folder.creating' : 'folder.create')}</button>
      </footer>
    </form>
  </dialog>
}
