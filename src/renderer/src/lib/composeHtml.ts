import DOMPurify from 'dompurify'

export const MAX_COMPOSE_IMAGE_BYTES = 10 * 1024 * 1024

export function composeImageWidth(value: string | null): number | null {
  const width = Number(value)
  return /^\d{1,4}$/.test(value ?? '') && width >= 1 && width <= 4096 ? width : null
}

export function isComposeImage(src: string): boolean {
  return src.length <= Math.ceil(MAX_COMPOSE_IMAGE_BYTES / 3) * 4 + 32 && /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/]+={0,2}$/i.test(src)
}

/** Conserva solo formato de texto admitido; descarta contenido activo y estilos ajenos. */
export function cleanComposeHtml(html: string): string {
  const root = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'span', 'img'],
    ALLOWED_ATTR: ['href', 'start', 'style', 'src', 'alt', 'width'],
    ADD_URI_SAFE_ATTR: ['width'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(https?:|mailto:)/i,
    RETURN_DOM: true
  }) as HTMLElement
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    if (element.tagName === 'IMG' && !isComposeImage(element.getAttribute('src') ?? '')) { element.remove(); continue }
    if (element.tagName === 'IMG') {
      const width = composeImageWidth(element.getAttribute('width') ?? element.style.width.replace(/px$/, ''))
      if (width === null) element.removeAttribute('width')
      else element.setAttribute('width', String(width))
    }
    const styles: string[] = []
    if (element.tagName === 'SPAN') {
      for (const property of ['color', 'background-color']) {
        const value = element.style.getPropertyValue(property)
        if (/^(#[\da-f]{3,8}|rgba?\([\d.,%\s/]+\)|[a-z]+)$/i.test(value)) styles.push(`${property}:${value}`)
      }
      const size = element.style.fontSize.match(/^(\d+(?:\.\d+)?)(px|pt)$/)
      if (size) {
        const pixels = Number(size[1]) * (size[2] === 'pt' ? 4 / 3 : 1)
        if (pixels >= 8 && pixels <= 72) styles.push(`font-size:${pixels}px`)
      }
    }
    element.removeAttribute('style')
    if (styles.length) element.setAttribute('style', styles.join(';'))
  }
  return root.innerHTML
}

export function textToEditorContent(text: string): { type: 'doc'; content: { type: 'paragraph'; content: { type: 'text'; text: string }[] }[] } {
  return {
    type: 'doc',
    content: text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
  }
}

export function splitReplyHtml(html?: string): { html?: string; quote: string; text?: string } {
  if (!html) return { html, quote: '' }
  const document_ = new DOMParser().parseFromString(html, 'text/html')
  const quote = document_.body.querySelector('blockquote[data-namio-reply-quote], :scope > blockquote:has(> p:first-child > strong:only-child)')
  if (!quote) return { html, quote: '' }
  quote.setAttribute('data-namio-reply-quote', 'true')
  const markup = quote.outerHTML
  quote.remove()
  const editable = document_.body.innerHTML
  document_.body.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
  document_.body.querySelectorAll('p, li').forEach(node => node.append('\n'))
  return { html: editable, quote: markup, text: (document_.body.textContent ?? '').replace(/\n$/, '') }
}

function safeReplyQuote(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['style'],
    FORCE_BODY: true,
    FORBID_TAGS: ['form', 'input', 'textarea', 'select', 'option', 'object', 'embed', 'base', 'meta', 'link', 'iframe'],
    FORBID_ATTR: ['srcset', 'formaction', 'ping', 'contenteditable']
  })
}

export function replyComposeHtml(body: string, attribution: string, original: string, label: string, originalHtml?: string): string {
  const paragraphs = (text: string): string => text.split('\n').map(line => {
    const paragraph = document.createElement('p')
    paragraph.textContent = line
    return paragraph.outerHTML
  }).join('')
  const heading = document.createElement('strong')
  heading.textContent = label
  const originalDocument = originalHtml ? new DOMParser().parseFromString(originalHtml, 'text/html') : null
  const content = originalDocument ? safeReplyQuote([...originalDocument.head.querySelectorAll('style')].map(style => style.outerHTML).join('') + originalDocument.body.innerHTML) : paragraphs(original)
  return `${paragraphs(body)}<blockquote data-namio-reply-quote="true"><p>${heading.outerHTML}</p>${paragraphs(attribution)}${content}</blockquote>`
}

/** Estilos inline sencillos para clientes de correo que ignoran las hojas de estilo. */
export function composeEmailHtml(html: string): string {
  const reply = splitReplyHtml(html)
  const container = document.createElement('div')
  container.innerHTML = cleanComposeHtml(reply.html ?? '')
  const styles: Record<string, string> = {
    p: 'margin:0 0 12px',
    a: 'color:#3555c5;text-decoration:underline',
    ul: 'margin:0 0 12px;padding-left:24px',
    ol: 'margin:0 0 12px;padding-left:24px',
    blockquote: 'margin:12px 0;padding-left:12px;border-left:2px solid #888888',
    code: 'font-family:monospace',
    img: 'max-width:100%;height:auto'
  }
  for (const element of container.querySelectorAll<HTMLElement>('*')) {
    const style = styles[element.tagName.toLowerCase()]
    if (style) element.setAttribute('style', style)
  }
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${container.innerHTML}${safeReplyQuote(reply.quote)}</div>`
}

export function isComposeLink(value: string): boolean {
  if (/\s/.test(value)) return false
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return Boolean(url.hostname)
    return url.protocol === 'mailto:' && /^[^@\s]+@[^@\s]+$/.test(url.pathname)
  } catch {
    return false
  }
}
