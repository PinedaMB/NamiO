import DOMPurify from 'dompurify'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BodyTheme } from '@shared/ipc'
import { useI18n } from '../i18n'
import { usePreferences } from '../settings/PreferencesProvider'
import { Icon } from './Icon'

interface EmailBodyProps {
  html: string
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

  return { body: document_.body.innerHTML, blocked }
}

function buildDocument(body: string, allowImages: boolean, theme: BodyTheme): string {
  const csp = [
    "default-src 'none'",
    allowImages ? 'img-src data: https: http:' : 'img-src data:',
    "style-src 'unsafe-inline'",
    'font-src data:',
    'media-src data:',
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')

  // El correo se pinta sobre "papel" claro: es lo que asume el HTML de la mayoría
  // de los clientes, y evita que sus estilos choquen con el tema oscuro de la app.
  // En oscuro se invierte el lienzo (y se re-invierten las imágenes) porque el HTML
  // de los correos trae colores propios: forzar `color` dejaría texto ilegible.
  const paper =
    theme === 'dark'
      ? `
    :root { color-scheme: dark; }
    html { background: #14161b; }
    body { background: #f2f2f2; filter: invert(1) hue-rotate(180deg); }
    img, video, picture, svg, [style*='background-image'] { filter: invert(1) hue-rotate(180deg); }
  `
      : `
    :root { color-scheme: light; }
    html, body { background: #ffffff; color: #1a1a1a; }
  `

  const style = `
    ${paper}
    html, body { margin: 0; padding: 0; overflow: hidden; }
    body {
      padding: 18px 20px;
      font: 14px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    img { max-width: 100%; height: auto; }
    a { color: #2f5bd3; }
    table { max-width: 100%; }
    pre, code { white-space: pre-wrap; }
  `

  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${style}</style></head><body>${body}</body></html>`
}

export function EmailBody({ html }: EmailBodyProps): React.JSX.Element {
  const { t } = useI18n()
  const { remoteImages, bodyTheme } = usePreferences()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [allowOverride, setAllowOverride] = useState<boolean | null>(null)
  const [height, setHeight] = useState(320)

  // La preferencia manda; el override es solo para este mensaje. Si el usuario
  // cambia la preferencia mientras lee, se vuelve a ella.
  useEffect(() => {
    setAllowOverride(null)
  }, [remoteImages, html])

  const allowImages = allowOverride ?? remoteImages === 'allow'
  const prepared = useMemo(() => prepare(sanitize(html), allowImages), [html, allowImages])
  const documentHtml = useMemo(
    () => buildDocument(prepared.body, allowImages, bodyTheme),
    [prepared, allowImages, bodyTheme]
  )

  const handleLoad = (): void => {
    const frame = frameRef.current
    const inner = frame?.contentDocument
    if (!frame || !inner) return

    // El iframe comparte origen (sin scripts), así que el padre puede medirlo:
    // así el correo crece a su altura real y hay un solo scroll (el del lector).
    const measure = (): void => {
      const next = Math.max(inner.documentElement.scrollHeight, 140)
      setHeight(next)
    }
    measure()
    window.setTimeout(measure, 350)

    // Imágenes y fuentes cambian la altura después del load.
    observerRef.current?.disconnect()
    const observer = new ResizeObserver(measure)
    observer.observe(inner.documentElement)
    if (inner.body) observer.observe(inner.body)
    observerRef.current = observer

    inner.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return
      event.preventDefault()
      const href = anchor.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) void window.api?.openExternal?.(href)
    })
  }

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return (
    <div className="email-body">
      {prepared.blocked > 0 && (
        <div className="email-banner">
          <Icon name="image_not_supported" size={15} />
          <span>{t('mail.imagesBlocked', { count: prepared.blocked })}</span>
          <button className="btn btn--primary" type="button" onClick={() => setAllowOverride(true)}>
            {t('mail.showImages')}
          </button>
        </div>
      )}

      <iframe
        ref={frameRef}
        className="email-body__frame"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        title={t('mail.frameTitle')}
        srcDoc={documentHtml}
        scrolling="no"
        style={{ height, background: bodyTheme === 'dark' ? '#14161b' : '#ffffff' }}
        onLoad={handleLoad}
      />
    </div>
  )
}
