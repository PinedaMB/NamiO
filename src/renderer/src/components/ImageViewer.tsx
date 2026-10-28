import { isSelectAll } from '../lib/selection'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { TooltipButton } from './Tooltip'
import { Icon } from './Icon'

interface ImageViewerProps {
  src?: string
  title: string
  error?: boolean
  onClose: () => void
  onSave?: () => void
  saving?: boolean
}

export function ImageViewer({ src, title, error = false, onClose, onSave, saving = false }: ImageViewerProps): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [scale, setScale] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const fit = size.width && viewport.width ? Math.min(1, (viewport.width - 48) / size.width, (viewport.height - 48) / size.height) : 1
  const zoom = scale ?? Math.max(0.01, fit)
  const zoomBy = (factor: number): void => setScale(Math.min(8, Math.max(0.05, zoom * factor)))

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    if (stage.current) observer.observe(stage.current)
    return () => { observer.disconnect(); element?.close() }
  }, [])

  return (
    <dialog ref={dialog} className="image-viewer" aria-labelledby="image-viewer-title"
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
      onKeyDown={event => {
        event.stopPropagation()
        if (isSelectAll(event)) { event.preventDefault(); return }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25) }
        if (event.key === '-') { event.preventDefault(); zoomBy(0.8) }
        if (event.key === '0') { event.preventDefault(); setScale(null) }
      }}>
      <header className="image-viewer__toolbar">
        <strong id="image-viewer-title" title={title}>{title}</strong>
        <div className="image-viewer__controls">
          <TooltipButton type="button" className="icon-btn" title={t('image.zoomOut')} aria-label={t('image.zoomOut')} disabled={!size.width || zoom <= 0.05} onClick={() => zoomBy(0.8)}><Icon name="remove" size={20} /></TooltipButton>
          <span className="image-viewer__zoom">{size.width ? `${Math.round(zoom * 100)}%` : '—'}</span>
          <TooltipButton type="button" className="icon-btn" title={t('image.zoomIn')} aria-label={t('image.zoomIn')} disabled={!size.width || zoom >= 8} onClick={() => zoomBy(1.25)}><Icon name="add" size={20} /></TooltipButton>
          <TooltipButton type="button" className="icon-btn" title={t('image.fit')} aria-label={t('image.fit')} onClick={() => setScale(null)}><Icon name="fit_screen" size={20} /></TooltipButton>
          <TooltipButton type="button" className="tool-btn" disabled={!size.width} onClick={() => setScale(1)}>100%</TooltipButton>
          {onSave && <TooltipButton type="button" className="icon-btn" title={t(saving ? 'attachment.preparing' : 'thread.download')} aria-label={t(saving ? 'attachment.preparing' : 'thread.download')} disabled={saving} aria-busy={saving} onClick={onSave}><Icon name={saving ? 'progress_activity' : 'download'} className={saving ? 'spin' : undefined} size={20} /></TooltipButton>}
          <TooltipButton type="button" className="icon-btn" autoFocus title={t('common.close')} aria-label={t('common.close')} onClick={onClose}><Icon name="close" size={22} /></TooltipButton>
        </div>
      </header>
      {saving && <div className="attachment-progress" role="status"><Icon name="progress_activity" size={16} className="spin" />{t('attachment.preparing')}</div>}
      <div ref={stage} className="image-viewer__stage">
        {(error || failed) ? <p className="image-viewer__status" role="alert">{t('image.failed')}</p> : (
          <>
            {(!src || !size.width) && <p className="image-viewer__status" role="status">{t('image.loading')}</p>}
            {src && <div className="image-viewer__canvas" style={{ width: `max(100%, ${size.width * zoom}px)`, height: `max(100%, ${size.height * zoom}px)` }}>
              <img src={src} alt={title} draggable={false} referrerPolicy="no-referrer" style={{ width: size.width * zoom || undefined, height: size.height * zoom || undefined, visibility: size.width ? 'visible' : 'hidden' }}
                onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
            </div>}
          </>
        )}
      </div>
    </dialog>
  )
}
