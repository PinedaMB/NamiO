import DOMPurify from 'dompurify'
import { useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
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

  // El correo se pinta sobre "papel" claro: es lo que asume el HTML de la mayoría
  // de los clientes, y evita que sus estilos choquen con el tema oscuro de la app.
  const style = `
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; background: #ffffff; color: #1a1a1a; }
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
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [showImages, setShowImages] = useState(false)
  const [height, setHeight] = useState(320)

  const prepared = useMemo(() => prepare(sanitize(html), showImages), [html, showImages])
  const documentHtml = useMemo(() => buildDocument(prepared.body, showImages), [prepared, showImages])

  const handleLoad = (): void => {
    const frame = frameRef.current
    const inner = frame?.contentDocument
    if (!frame || !inner) return

    // El iframe comparte origen (sin scripts), así que el padre puede medirlo:
    // así evitamos scroll anidado y el correo crece a su altura real.
    const measure = (): void => {
      const next = Math.min(Math.max(inner.documentElement.scrollHeight, 140), 1600)
      setHeight(next)
    }
    measure()
    window.setTimeout(measure, 350)

    inner.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return
      event.preventDefault()
      const href = anchor.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) void window.api?.openExternal?.(href)
    })
  }

  return (
    <div className="email-body">
      {prepared.blocked > 0 && (
        <div className="email-banner">
          <Icon name="image_not_supported" size={15} />
          <span>{t('mail.imagesBlocked', { count: prepared.blocked })}</span>
          <button className="btn btn--primary" type="button" onClick={() => setShowImages(true)}>
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
        style={{ height }}
        onLoad={handleLoad}
      />
    </div>
  )
}
