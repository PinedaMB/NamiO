import { ImageViewer } from './ImageViewer'
import DOMPurify from 'dompurify'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BodyTheme } from '@shared/ipc'
import { useI18n } from '../i18n'
import { usePreferences } from '../settings/PreferencesProvider'
import { Icon } from './Icon'
import { applyEmailTheme, fitEmailTextToSurface } from '../lib/emailTheme'

const TRACKER_HOST_RE = /(?:^|\.)(?:list-manage\d*\.com|mandrillapp\.com|sendgrid\.net|hubspotlinks\.com|hs-analytics\.net|klaviyo\.com|mailgun\.org|mailgun\.net|postmarkapp\.com|sparkpostmail\.com|mailjet\.com|constantcontact\.com|exacttarget\.com|pardot\.com|marketo\.com|doubleclick\.net|google-analytics\.com|mixpanel\.com|segment\.io|intercom-mail\.com|brevo\.com|sendinblue\.com|activecampaign\.com|dripemail2\.com|convertkit-mail\d*\.com|beehiiv\.com|substack\.com)$/i
const TRACKER_PATH_RE = /\/(?:track\/open|wf\/open|open\.gif|pixel\.gif|beacon|o\/eJ|t\/o\/|trk\/|e\/o\/)/i
const TRACKER_SUBDOMAIN_RE = /^(?:track|trk|pixel|open|beacon|clicks?|email-open|analytics)\./i

function parseTrackerDim(raw: string | null): number | null {
  if (!raw) return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(raw)
  return match ? Number(match[1]) : null
}

function styleTrackerDim(style: string, prop: 'width' | 'height'): number | null {
  const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*px`, 'i').exec(style)
  return match ? Number(match[1]) : null
}

function isTrackingPixel(src: string, attrs?: { width?: string | null; height?: string | null; style?: string | null }): boolean {
  if (!/^https?:\/\//i.test(src)) return false
  let parsed: URL
  try { parsed = new URL(src) } catch { return false }
  const w = parseTrackerDim(attrs?.width ?? null) ?? styleTrackerDim(attrs?.style ?? '', 'width')
  const h = parseTrackerDim(attrs?.height ?? null) ?? styleTrackerDim(attrs?.style ?? '', 'height')
  if (w !== null && w <= 1 && h !== null && h <= 1) return true
  if (attrs?.style && /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(attrs.style)) return true
  const host = parsed.hostname.toLowerCase()
  const path = `${parsed.pathname}${parsed.search}`
  if (TRACKER_HOST_RE.test(host) && TRACKER_PATH_RE.test(path)) return true
  if (TRACKER_SUBDOMAIN_RE.test(host) && (TRACKER_PATH_RE.test(path) || (w !== null && w <= 2) || (h !== null && h <= 2))) return true
  return false
}

interface EmailBodyProps {
  html: string
  blockRemote?: boolean
  senderEmail?: string
  theme?: BodyTheme
  integrated?: boolean
}

/** GIF transparente de 1×1: conserva el layout cuando se bloquea una imagen remota. */
const TRANSPARENT =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    // Defensa en profundidad: el iframe ya corre sin scripts.
    FORBID_TAGS: ['form', 'input', 'textarea', 'select', 'option', 'object', 'embed', 'base', 'meta', 'link'],
    FORBID_ATTR: ['srcset', 'formaction', 'ping', 'contenteditable'],
    ADD_ATTR: ['data-namio-reply-quote'],
    ALLOW_DATA_ATTR: false
  })
}

const QUOTE_BANNER_RE = /^-{2,}\s*(?:original\s+message|mensaje\s+original|mensagem\s+original|message\s+d'origine|ursprüngliche\s+nachricht|messaggio\s+originale|oorspronkelijk\s+bericht|forwarded\s+message|mensaje\s+reenviado|mensagem\s+encaminhada)[\s-]*$/i
const QUOTE_FROM_RE = /^(?:de|from|von|da|van|od|från)\s*:/i
const QUOTE_HEADER_RE = /^(?:de|from|von|da|van|od|från)\s*:[\s\S]{0,800}?(?:enviado(?:\s+el|\s+em)?|envoy[ée](?:\s+le)?|sent|date|fecha|data|datum|gesendet|inviato|verzonden|wysłano|skickat)\s*:[\s\S]{0,800}?(?:para|to|an|à|a|aan|do|till)\s*:[\s\S]{0,1500}?(?:asunto|assunto|subject|objet|sujet|betreff|oggetto|onderwerp|temat|ämne)\s*:/i

function stripLeadingQuoteBanner(text: string): string {
  const newline = text.indexOf('\n')
  if (newline === -1) return text
  const firstLine = text.slice(0, newline).trim()
  return QUOTE_BANNER_RE.test(firstLine) ? text.slice(newline + 1).trimStart() : text
}

function nextDomNode(root: Node, current: Node): Node | null {
  const firstChild = current.childNodes?.[0]
  if (firstChild) return firstChild
  let cursor: Node | null = current
  while (cursor && cursor !== root) {
    if (cursor.nextSibling) return cursor.nextSibling
    cursor = cursor.parentElement
  }
  return null
}

function collectFollowingText(root: Node, startNode: Node, maxChars = 3500): string {
  let out = startNode.nodeType === 3 ? (startNode.textContent ?? '') : ''
  let node: Node | null = startNode
  while (out.length < maxChars && (node = nextDomNode(root, node))) {
    if (node.nodeType === 1) {
      const tag = (node as Element).tagName
      if (tag === 'BR' || tag === 'P' || tag === 'DIV' || tag === 'TR' || tag === 'LI' || tag === 'HR') out += '\n'
      continue
    }
    if (node.nodeType === 3) {
      const parent = node.parentElement
      if (parent && (parent.tagName === 'STYLE' || parent.tagName === 'SCRIPT')) continue
      out += node.textContent ?? ''
    }
  }
  return out.slice(0, maxChars)
}

function previousSignificantNode(node: Node): Node | null {
  let current: Node | null = node
  while (current) {
    if (current.previousSibling) {
      current = current.previousSibling
      if (current.nodeType === 3 && !(current.textContent ?? '').trim()) continue
      if (current.nodeType === 1 && (current as Element).tagName === 'BR') continue
      return current
    }
    const parent: HTMLElement | null = current.parentElement
    if (!parent || parent === parent.ownerDocument.body) return null
    current = parent
  }
  return null
}

function findInlineQuoteStart(document_: Document): Node | null {
  const root = document_.body
  if (!root || !root.childNodes?.length) return null
  let node: Node | null = root
  while ((node = nextDomNode(root, node))) {
    if (node.nodeType !== 3) continue
    const parent = node.parentElement
    if (!parent || parent.closest?.('style, script, details')) continue
    const trimmed = (node.textContent ?? '').trim()
    if (!QUOTE_FROM_RE.test(trimmed)) continue
    const following = collectFollowingText(root, node).trim()
    if (!QUOTE_HEADER_RE.test(following)) continue

    let anchor: Node = node
    while (anchor.parentElement && anchor.parentElement !== root) {
      const p = anchor.parentElement
      if (!/^(B|STRONG|SPAN|FONT|EM|I)$/i.test(p.tagName)) break
      if ((p.textContent ?? '').trim() !== trimmed) break
      anchor = p
    }
    const prev = previousSignificantNode(anchor)
    if (prev && QUOTE_BANNER_RE.test((prev.textContent ?? '').trim())) return prev
    return anchor
  }
  return null
}

/** Devuelve el cuerpo listo para el iframe y cuántas imágenes remotas / rastreadores se bloquearon. */
function prepare(html: string, allowImages: boolean, blockTrackers: boolean, showQuote: string, hideQuote: string): { document: Document; blocked: number; trackersBlocked: number } {
  const document_ = new DOMParser().parseFromString(html, 'text/html')
  let blocked = 0
  let trackersBlocked = 0
  // Los clientes también envían cabeceras citadas sin un marcador propio.
  let quote: Node | null = document_.body.querySelector('blockquote[data-namio-reply-quote], .gmail_quote, .gmail_attr, .yahoo_quoted, #divRplyFwdMsg, .moz-cite-prefix, blockquote[type="cite"]')
  for (const candidate of document_.body.querySelectorAll('p, div, td')) {
    const rawText = candidate.textContent?.trim() ?? ''
    const firstText = stripLeadingQuoteBanner(rawText)
    if (!QUOTE_FROM_RE.test(firstText)) continue
    const parts: string[] = [firstText]
    let sibling: Element | null = candidate.nextElementSibling
    for (let index = 1; sibling && index < 8; index++, sibling = sibling.nextElementSibling) parts.push(sibling.textContent ?? '')
    const header = parts.join('\n').slice(0, 5000)
    if (!QUOTE_HEADER_RE.test(header.trim())) continue
    const prev = candidate.previousElementSibling
    const startNode = prev && QUOTE_BANNER_RE.test(prev.textContent?.trim() ?? '') ? prev : candidate
    if (!quote || startNode.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING) quote = startNode
    break
  }
  const inlineQuote = findInlineQuoteStart(document_)
  if (inlineQuote && (!quote || inlineQuote.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING)) {
    quote = inlineQuote
  }
  if (quote) {
    const history = document_.createElement('details')
    history.className = 'namio-quote'
    const toggle = document_.createElement('summary')
    toggle.setAttribute('aria-label', showQuote)
    for (const [className, label] of [['namio-quote-show', showQuote], ['namio-quote-hide', hideQuote]] as const) {
      const text = document_.createElement('span')
      text.className = className
      text.textContent = label
      toggle.append(text)
    }
    const range = document_.createRange()
    range.setStartBefore(quote)
    range.setEnd(document_.body, document_.body.childNodes.length)
    const content = range.extractContents()
    history.append(toggle, content)
    document_.body.append(history)
  }

  if (!allowImages) {
    document_.querySelectorAll('img').forEach((image) => {
      const src = image.getAttribute('src') ?? ''
      if (/^(https?:)?\/\//i.test(src)) {
        image.setAttribute('src', TRANSPARENT)
        blocked += 1
      }
    })
  } else if (blockTrackers) {
    document_.querySelectorAll('img').forEach((image) => {
      const src = image.getAttribute('src') ?? ''
      if (isTrackingPixel(src, { width: image.getAttribute('width'), height: image.getAttribute('height'), style: image.getAttribute('style') })) {
        image.setAttribute('src', TRANSPARENT)
        trackersBlocked += 1
      }
    })
  }

  return { document: document_, blocked, trackersBlocked }
}

function buildDocument(document_: Document, allowImages: boolean): string {
  const output = document_.cloneNode(true) as Document
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
    /* El mensaje determina su altura; 100% dependería del propio iframe. */
    html, body { height: auto !important; min-height: 0 !important; }
    body {
      padding: 18px 20px;
      font: 14px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
      overflow-wrap: break-word;
      word-break: normal;
    }
    img { max-width: 100%; }
    img[role=button] { cursor: zoom-in; }
    img[role=button]:focus-visible { outline: 2px solid #8083ff; outline-offset: 2px; }
    a { color: #2f5bd3; }
    ::selection { background: #c0c1ff; color: #10131b; }
    table { max-width: 100%; }
    pre, code { white-space: pre-wrap; }
    details.namio-quote { margin-top: 20px; }
    details.namio-quote > summary { display: list-item; width: fit-content; padding: 6px 10px; border: 1px solid currentColor; border-radius: 6px; font: 12px/1.5 system-ui, sans-serif; cursor: pointer; }
    details.namio-quote > summary:focus-visible { outline: 2px solid #8083ff; outline-offset: 3px; }
    details.namio-quote:not([open]) > summary .namio-quote-hide,
    details.namio-quote[open] > summary .namio-quote-show { display: none; }
    details.namio-quote[open] > summary { margin-bottom: 16px; }

  `

  // Los estilos del remitente conservan su cabecera y prevalecen sobre nuestros valores base.
  output.head.insertAdjacentHTML('afterbegin', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${style}</style>`)
  return `<!doctype html>${output.documentElement.outerHTML}`
}

const MAX_PREPARED_CACHE = 24
const preparedCache = new Map<string, { documentHtml: string; blocked: number; trackersBlocked: number }>()

function getPreparedDocument(html: string, allowImages: boolean, blockTrackers: boolean, showQuote: string, hideQuote: string): { documentHtml: string; blocked: number; trackersBlocked: number } {
  const key = `${allowImages ? '1' : '0'}|${blockTrackers ? '1' : '0'}|${showQuote}|${hideQuote}|${html}`
  const hit = preparedCache.get(key)
  if (hit) {
    // Mueve la entrada al final para mantener orden LRU.
    preparedCache.delete(key)
    preparedCache.set(key, hit)
    return hit
  }
  const prepared = prepare(sanitize(html), allowImages, blockTrackers, showQuote, hideQuote)
  const entry = { documentHtml: buildDocument(prepared.document, allowImages), blocked: prepared.blocked, trackersBlocked: prepared.trackersBlocked }
  preparedCache.set(key, entry)
  if (preparedCache.size > MAX_PREPARED_CACHE) {
    const oldest = preparedCache.keys().next().value
    if (oldest !== undefined) preparedCache.delete(oldest)
  }
  return entry
}

export function EmailBody({ html, blockRemote = false, senderEmail, theme, integrated = false }: EmailBodyProps): React.JSX.Element {
  const { t } = useI18n()
  const { remoteImages, bodyTheme: preferredTheme, allowedImageSenders = [], allowImageSender, blockTrackers = true } = usePreferences()
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

  const senderAllowed = Boolean(!blockRemote && senderEmail && allowedImageSenders.includes(senderEmail.trim().toLowerCase()))
  const allowImages = !blockRemote && (allowOverride ?? (remoteImages === 'allow' || senderAllowed))
  const prepared = useMemo(
    () => getPreparedDocument(html, allowImages, blockTrackers, t('mail.showQuote'), t('mail.hideQuote')),
    [html, allowImages, blockTrackers, t]
  )
  const documentHtml = prepared.documentHtml

  useLayoutEffect(() => {
    const inner = frameRef.current?.contentDocument
    if (inner && readyDocument === documentHtml && (themedDocument.current?.document !== inner || themedDocument.current.theme !== bodyTheme)) {
      setBackground(applyEmailTheme(inner, bodyTheme))
      themedDocument.current = { document: inner, theme: bodyTheme }
    }
  }, [bodyTheme, documentHtml, readyDocument])

  const integrateSurface = (): string | undefined => {
    const frame = frameRef.current
    const inner = frame?.contentDocument
    if (!frame || !inner?.body) return
    const appTheme = document.documentElement.dataset.appTheme
    const contentTheme = theme ?? (appTheme === 'dark' || (appTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
    if (themedDocument.current?.theme !== contentTheme) {
      applyEmailTheme(inner, contentTheme)
      themedDocument.current = { document: inner, theme: contentTheme }
    }
    const surface = getComputedStyle(frame.closest('.reading, .composer') ?? document.body)
    const background = surface.backgroundColor
    if (!background) return
    const foreground = surface.color
    for (const element of [inner.documentElement, inner.body, ...inner.querySelectorAll<HTMLElement>('details.namio-quote, details.namio-quote > summary')]) {
      element.style.setProperty('background-color', background, 'important')
      element.style.setProperty('color', foreground, 'important')
    }
    fitEmailTextToSurface(inner, background, foreground)
    setBackground(background)
    return background
  }

  useLayoutEffect(() => {
    if (!integrated || readyDocument !== documentHtml) return
    integrateSurface()
    const observer = new MutationObserver(() => integrateSurface())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme'] })
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => { integrateSurface() }
    media.addEventListener('change', update)
    return () => { observer.disconnect(); media.removeEventListener('change', update) }
  }, [integrated, readyDocument, documentHtml, bodyTheme])

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
      if (integrated) integrateSurface()
      // Medir sin el alto anterior permite encoger y conserva el contenido desbordado.
      const previousHeight = frame.style.height
      frame.style.height = '0px'
      const next = Math.max(inner.body.scrollHeight, Math.ceil(inner.body.getBoundingClientRect().bottom), 60)
      frame.style.height = previousHeight
      setHeight(next)
    }
    inner.addEventListener('toggle', event => {
      const details = event.target as HTMLDetailsElement
      if (!details.matches('details.namio-quote')) return
      details.querySelector('summary')?.setAttribute('aria-label', t(details.open ? 'mail.hideQuote' : 'mail.showQuote'))
      measure()
    }, true)
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

    // Un archivo soltado sobre el iframe no debe convertirlo en una página local.
    const blockDrop = (event: Event): void => event.preventDefault()
    inner.addEventListener('dragover', blockDrop)
    inner.addEventListener('drop', blockDrop)

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
    <div className={integrated ? 'email-body email-body--integrated' : 'email-body'} style={{ background: readyDocument === documentHtml ? background : undefined }}>
      {(blockRemote || prepared.blocked > 0) && (
        <div className="email-banner">
          <Icon name="image_not_supported" size={15} />
          <span>{blockRemote ? t('mail.spamRemoteBlocked') : t('mail.imagesBlocked', { count: prepared.blocked })}</span>
          {!blockRemote && <button className="btn btn--primary" type="button" onClick={() => setAllowOverride(true)}>
            {t('mail.showImages')}
          </button>}
          {!blockRemote && senderEmail && allowImageSender && (
            <button className="tool-btn" type="button" onClick={() => void allowImageSender(senderEmail)}>
              {t('mail.alwaysAllowSender')}
            </button>
          )}
        </div>
      )}
      {!blockRemote && prepared.trackersBlocked > 0 && (
        <div className="tracker-badge" role="status">
          <Icon name="shield" size={14} />
          <span>{prepared.trackersBlocked === 1 ? t('mail.trackerBlockedOne') : t('mail.trackersBlocked', { count: prepared.trackersBlocked })}</span>
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
