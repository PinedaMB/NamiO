import { isSelectAll, selectTextContents } from '../lib/selection'
import { lazy, Suspense, useEffect, useRef } from 'react'
import type { AttachmentPreview } from '@shared/ipc'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { TooltipButton } from './Tooltip'

const PdfDocument = lazy(() => import('./PdfDocument').then(module => ({ default: module.PdfDocument })))

export function DocumentViewer({ title, attachment, error, onClose, onSave, saving = false }: {
  title: string
  attachment?: AttachmentPreview
  error?: boolean
  onClose: () => void
  onSave: () => void
  saving?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const loading = <p className="image-viewer__status" role="status">{t('document.loading')}</p>
  return (
    <dialog ref={dialog} className="image-viewer document-viewer" aria-labelledby="document-viewer-title"
      onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
        event.stopPropagation()
        if (isSelectAll(event)) {
          event.preventDefault()
          const text = event.currentTarget.querySelector('.document-viewer__text')
          if (text) selectTextContents(text)
        }
      }}
      onClick={event => { if (event.currentTarget === event.target) onClose() }}>
      <header className="image-viewer__toolbar">
        <Icon name={attachment?.kind === 'text' ? 'article' : 'picture_as_pdf'} size={20} />
        <strong id="document-viewer-title" title={title}>{title}</strong>
        <div className="image-viewer__controls">
          <TooltipButton className="icon-btn" title={t(saving ? 'attachment.preparing' : 'thread.download')} disabled={saving} aria-busy={saving} onClick={onSave}><Icon name={saving ? 'progress_activity' : 'download'} className={saving ? 'spin' : undefined} size={20} /></TooltipButton>
          <TooltipButton className="icon-btn" autoFocus title={t('common.close')} onClick={onClose}><Icon name="close" size={22} /></TooltipButton>
        </div>
      </header>
      {saving && <div className="attachment-progress" role="status"><Icon name="progress_activity" size={16} className="spin" />{t('attachment.preparing')}</div>}
      <div className="document-viewer__body">
        {error ? <p className="document-viewer__message" role="alert">{t('document.failed')}</p> : !attachment ? loading : attachment.kind === 'text' ? (
          <div className="document-viewer__stage"><pre className="document-viewer__text">{attachment.text || t('document.empty')}</pre></div>
        ) : attachment.kind === 'pdf' ? <Suspense fallback={loading}><PdfDocument data={attachment.data} /></Suspense> : null}
      </div>
    </dialog>
  )
}
