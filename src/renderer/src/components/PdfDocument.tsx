import { useEffect, useRef, useState } from 'react'
import { getDocument, PDFWorker, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import { useI18n } from '../i18n'
import { TooltipButton } from './Tooltip'
import { Icon } from './Icon'

export function PdfDocument({ data }: { data: string }): React.JSX.Element {
  const { t } = useI18n()
  const stage = useRef<HTMLDivElement>(null)
  const pageHost = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState<number | null>(null)
  const [renderedScale, setRenderedScale] = useState(1)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    let port: Worker | undefined
    let task: ReturnType<typeof getDocument> | undefined
    let worker: PDFWorker | undefined
    let workerFailed = false
    setPdf(null)
    setPage(1)
    setError(null)
    setLoading(true)
    try {
      const assets = new URL('pdfjs/', document.baseURI).href
      port = new Worker(`${assets}pdf.worker.min.mjs`, { type: 'module' })
      port.addEventListener('error', () => {
        workerFailed = true
        worker?.destroy()
        port?.terminate()
        if (!canceled) { setPdf(null); setError('document.failed'); setLoading(false) }
      })
      worker = PDFWorker.create({ port })
      task = getDocument({
        data: Uint8Array.from(atob(data), character => character.charCodeAt(0)), worker,
        cMapUrl: `${assets}cmaps/`, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
        useWorkerFetch: false, useWasm: false, enableXfa: false, canvasMaxAreaInBytes: 64_000_000
      })
      void task.promise.then(document => {
        if (!canceled) setPdf(document)
      }).catch((cause: unknown) => {
        if (!canceled) { setError(cause instanceof Error && cause.name === 'PasswordException' ? 'document.password' : 'document.failed'); setLoading(false) }
      })
    } catch {
      setError('document.failed')
      setLoading(false)
    }
    return () => {
      canceled = true
      if (workerFailed) return
      void (task?.destroy() ?? Promise.resolve()).catch(() => undefined).finally(() => { worker?.destroy(); port?.terminate() })
    }
  }, [data])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    if (stage.current) observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pdf || !viewport.width || !viewport.height) return
    let canceled = false
    let rendering: RenderTask | undefined
    setLoading(true)
    setError(null)
    void pdf.getPage(page).then(async current => {
      if (canceled) return
      const original = current.getViewport({ scale: 1 })
      const fit = Math.max(0.05, Math.min(1, (viewport.width - 48) / original.width, (viewport.height - 48) / original.height))
      const zoom = scale ?? fit
      const view = current.getViewport({ scale: zoom })
      // Una sola página y un límite de píxeles evitan reservar lienzos enormes.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (view.width * view.height)))
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(view.width * ratio)
      canvas.height = Math.ceil(view.height * ratio)
      canvas.style.width = `${view.width}px`
      canvas.style.height = `${view.height}px`
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', t('document.page', { page, total: pdf.numPages }))
      rendering = current.render({ canvas, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0], background: '#ffffff' })
      await rendering.promise
      if (canceled) return
      pageHost.current?.replaceChildren(canvas)
      stage.current?.scrollTo(0, 0)
      setRenderedScale(zoom)
      setLoading(false)
    }).catch(() => {
      if (!canceled) { setError('document.failed'); setLoading(false) }
    })
    return () => { canceled = true; rendering?.cancel() }
  }, [pdf, page, scale, viewport.width, viewport.height, t])

  const zoomBy = (factor: number): void => setScale(Math.max(0.1, Math.min(4, (scale ?? renderedScale) * factor)))
  return (
    <div className="pdf-document" onKeyDown={event => {
      if (event.key === 'ArrowLeft' && page > 1) { event.preventDefault(); setPage(page - 1) }
      if (event.key === 'ArrowRight' && pdf && page < pdf.numPages) { event.preventDefault(); setPage(page + 1) }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25) }
      if (event.key === '-') { event.preventDefault(); zoomBy(0.8) }
      if (event.key === '0') { event.preventDefault(); setScale(null) }
    }}>
      <div className="pdf-document__controls" role="group" aria-label={t('document.controls')}>
        <TooltipButton className="icon-btn" title={t('document.previous')} disabled={!pdf || page <= 1 || loading} onClick={() => setPage(page - 1)}><Icon name="chevron_left" size={20} /></TooltipButton>
        <span className="mono" aria-live="polite">{t('document.page', { page: pdf ? page : '—', total: pdf?.numPages ?? '—' })}</span>
        <TooltipButton className="icon-btn" title={t('document.next')} disabled={!pdf || page >= pdf.numPages || loading} onClick={() => setPage(page + 1)}><Icon name="chevron_right" size={20} /></TooltipButton>
        <TooltipButton className="icon-btn" title={t('image.zoomOut')} disabled={!pdf || loading || (scale ?? renderedScale) <= 0.1} onClick={() => zoomBy(0.8)}><Icon name="remove" size={20} /></TooltipButton>
        <span className="image-viewer__zoom">{Math.round((scale ?? renderedScale) * 100)}%</span>
        <TooltipButton className="icon-btn" title={t('image.zoomIn')} disabled={!pdf || loading || (scale ?? renderedScale) >= 4} onClick={() => zoomBy(1.25)}><Icon name="add" size={20} /></TooltipButton>
        <TooltipButton className="icon-btn" title={t('image.fit')} disabled={!pdf || loading} onClick={() => setScale(null)}><Icon name="fit_screen" size={20} /></TooltipButton>
      </div>
      <div ref={stage} className="document-viewer__stage pdf-document__stage" aria-busy={loading}>
        {loading && <p className="image-viewer__status" role="status">{t('document.loading')}</p>}
        {error && <p className="image-viewer__status" role="alert">{t(error === 'document.password' ? 'document.password' : 'document.failed')}</p>}
        <div ref={pageHost} className="pdf-document__page" style={{ visibility: loading || error ? 'hidden' : 'visible' }} />
      </div>
    </div>
  )
}
