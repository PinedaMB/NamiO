import { ImageViewer } from './ImageViewer'
import DOMPurify from 'dompurify'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BodyTheme } from '@shared/ipc'
import { useI18n } from '../i18n'
import { usePreferences } from '../settings/PreferencesProvider'
import { Icon } from './Icon'
import { applyEmailTheme, emailBackground } from '../lib/emailTheme'

interface EmailBodyProps {
  html: string
  blockRemote?: boolean
  theme?: BodyTheme
}

/** GIF transparente de 1×1: conserva el layout cuando se bloquea una imagen remota. */
const TRANSPARENT =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    // Defensa en profundidad: el iframe ya corre sin scripts.
    FORBID_TAGS: ['form', 'input', 'textarea', 'select', 'option', 'object', 'embed', 'base', 'meta', 'link'],
    FORBID_ATTR: ['srcset', 'formaction', 'ping'],
    ALLOW_DATA_ATTR: false
  })
}

/** Devuelve el cuerpo listo para el iframe y cuántas imágenes remotas se bloquearon. */
function prepare(html: string, allowImages: boolean): { body: string; blocked: number } {
  const document_ = new DOMParser().parseFromString(html, 'text/html')
  let blocked = 0

  if (!allowImages) {
    document_.querySelectorAll('img').forEach((image) => {
      const src = image.getAttribute('src') ?? ''
      if (/^(https?:)?\/\//i.test(src)) {
        image.setAttribute('src', TRANSPARENT)
        blocked += 1
      }
    })
  }

  const styles = [...(document_.head?.querySelectorAll('style') ?? [])].map((style) => style.outerHTML).join('')
  return { body: styles + document_.body.innerHTML, blocked }
}

function buildDocument(body: string, allowImages: boolean): string {
  const csp = [
    "default-src 'none'",
    allowImages ? 'img-src data: https: http:' : 'img-src data:',
    "style-src 'unsafe-inline'",
    'font-src data:',
    'media-src data:',
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')

  const style = `
    :root { color-scheme: light; }
    html, body { background: #ffffff; color: #1a1a1a; }
    :root[data-email-theme="dark"] { color-scheme: dark; }
    html[data-email-theme="dark"], html[data-email-theme="dark"] body { background: #14161b; color: #dfe2ee; }
    html, body { margin: 0; padding: 0; overflow: hidden; }
    body {
      padding: 18px 20px;
      font: 14px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
      overflow-wrap: break-word;
      word-break: normal;
    }
    img { max-width: 100%; height: auto; }
    img[role=button] { cursor: zoom-in; }
    img[role=button]:focus-visible { outline: 2px solid #8083ff; outline-offset: 2px; }
    a { color: #2f5bd3; }
    ::selection { background: #c0c1ff; color: #10131b; }
    table { max-width: 100%; }
    pre, code { white-space: pre-wrap; }
  `

  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${style}</style></head><body>${body}</body></html>`
}

export function EmailBody({ html, blockRemote = false, theme }: EmailBodyProps): React.JSX.Element {
  const { t } = useI18n()
  const { remoteImages, bodyTheme: preferredTheme } = usePreferences()
  const bodyTheme = theme ?? preferredTheme
  const frameRef = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const themedDocument = useRef<{ document: Document; theme: BodyTheme } | null>(null)
  const measureFrame = useRef(0)
  const [allowOverride, setAllowOverride] = useState<boolean | null>(null)
  const [height, setHeight] = useState(320)
  const [background, setBackground] = useState<string | undefined>(undefined)
  const [readyDocument, setReadyDocument] = useState<string | null>(null)

  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null)

  // La preferencia manda; el override es solo para este mensaje. Si el usuario
  // cambia la preferencia mientras lee, se vuelve a ella.
  useEffect(() => {
    setAllowOverride(null)
    setPreviewImage(null)
  }, [remoteImages, html])

  const allowImages = !blockRemote && (allowOverride ?? remoteImages === 'allow')
  const prepared = useMemo(() => prepare(sanitize(html), allowImages), [html, allowImages])
  const documentHtml = useMemo(
    () => buildDocument(prepared.body, allowImages),
    [prepared, allowImages]
  )

  useLayoutEffect(() => {
    const inner = frameRef.current?.contentDocument
    if (inner && readyDocument === documentHtml && (themedDocument.current?.document !== inner || themedDocument.current.theme !== bodyTheme)) {
      setBackground(applyEmailTheme(inner, bodyTheme))
      themedDocument.current = { document: inner, theme: bodyTheme }
    }
  }, [bodyTheme, documentHtml, readyDocument])

  const handleLoad = (): void => {
    const frame = frameRef.current
    const inner = frame?.contentDocument
    const frameWindow = inner?.defaultView
    if (!frame || !inner || !frameWindow || themedDocument.current?.document === inner) return

    setBackground(applyEmailTheme(inner, bodyTheme))
    themedDocument.current = { document: inner, theme: bodyTheme }

    // El iframe comparte origen (sin scripts), así que el padre puede medirlo:
    // así el correo crece a su altura real y hay un solo scroll (el del lector).
    const measure = (): void => {
      // Al expandir un mensaje, sus superficies ya tienen dimensiones reales.
      const background = emailBackground(inner)
      if (background) {
        inner.body.style.setProperty('background-color', background, 'important')
        setBackground(background)
      }
      const next = Math.max(inner.documentElement.scrollHeight, 140)
      setHeight(next)
    }
    measure()
    setReadyDocument(documentHtml)

    // Imágenes y fuentes cambian la altura después del load.
    observerRef.current?.disconnect()
    cancelAnimationFrame(measureFrame.current)
    // Pausar la observación evita que el ajuste del iframe realimente la misma entrega.
    let observedSize = ''
    // El observador pertenece al documento medido, no al ciclo de layout del lector.
    const observer = new frameWindow.ResizeObserver(([entry]) => {
      if (!entry) return
      const size = `${entry.contentRect.width}:${entry.contentRect.height}`
      if (size === observedSize) return
      observedSize = size
      observer.disconnect()
      cancelAnimationFrame(measureFrame.current)
      measureFrame.current = requestAnimationFrame(() => {
        measure()
        if (inner.body) observer.observe(inner.body)
      })
    })
    // El elemento raíz sigue la altura del iframe y realimenta su propio ajuste.
    if (inner.body) observer.observe(inner.body)
    observerRef.current = observer

    inner.querySelectorAll('img').forEach(image => {
      const src = image.currentSrc || image.src || ''
      if (!image.closest('a') && src !== TRANSPARENT && /^(https?:|data:image\/)/i.test(src)) {
        image.tabIndex = 0
        image.setAttribute('role', 'button')
        image.setAttribute('aria-label', image.alt || t('image.preview'))
      }
    })

    inner.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.defaultPrevented) {
        const image = (event.target as HTMLElement | null)?.closest<HTMLImageElement>('img[role="button"]')
        if (image) { event.preventDefault(); image.click(); return }
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    inner.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const image = target?.closest('img')
      if (image && !image.closest('a')) {
        const src = image.currentSrc || image.src || ''
        if (src !== TRANSPARENT && /^(https?:|data:image\/)/i.test(src)) {
          event.preventDefault()
          setPreviewImage({ src, title: image.alt || t('image.preview') })
          return
        }
      }
      const anchor = target?.closest('a')
      if (!anchor) return
      event.preventDefault()
      const href = anchor.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) void window.api?.openExternal?.(href)
    })
  }

  // El evento load espera imágenes remotas; el texto puede mostrarse antes.
  useEffect(() => {
    let frameId = 0
    const showWhenParsed = (): void => {
      const inner = frameRef.current?.contentDocument
      if (inner?.URL === 'about:srcdoc' && inner.readyState !== 'loading' && inner.body) {
        handleLoad()
        return
      }
      frameId = requestAnimationFrame(showWhenParsed)
    }
    frameId = requestAnimationFrame(showWhenParsed)
    return () => cancelAnimationFrame(frameId)
  }, [documentHtml, bodyTheme])

  useEffect(() => () => {
    observerRef.current?.disconnect()
    cancelAnimationFrame(measureFrame.current)
  }, [])

  return (
    <div className="email-body" style={{ background: readyDocument === documentHtml ? background : undefined }}>
      {(blockRemote || prepared.blocked > 0) && (
        <div className="email-banner">
          <Icon name="image_not_supported" size={15} />
          <span>{blockRemote ? t('mail.spamRemoteBlocked') : t('mail.imagesBlocked', { count: prepared.blocked })}</span>
          {!blockRemote && <button className="btn btn--primary" type="button" onClick={() => setAllowOverride(true)}>
            {t('mail.showImages')}
          </button>}
        </div>
      )}

      {readyDocument !== documentHtml && (
        <div className="letter-loading" role="status">{t('thread.loading')}</div>
      )}
      {previewImage && <ImageViewer key={previewImage.src} src={previewImage.src} title={previewImage.title} onClose={() => setPreviewImage(null)} />}
      <iframe
        key={documentHtml}
        ref={frameRef}
        className="email-body__frame"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        title={t('mail.frameTitle')}
        srcDoc={documentHtml}
        scrolling="no"
        aria-hidden={readyDocument !== documentHtml}
        style={{ height: readyDocument === documentHtml ? height : 0, visibility: readyDocument === documentHtml ? 'visible' : 'hidden', background: readyDocument === documentHtml ? background : undefined }}
        onLoad={handleLoad}
      />
    </div>
  )
}
