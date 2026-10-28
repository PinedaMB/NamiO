import DOMPurify from 'dompurify'

/** Conserva solo formato de texto admitido; descarta contenido activo y estilos ajenos. */
export function cleanComposeHtml(html: string): string {
  const root = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'span'],
    ALLOWED_ATTR: ['href', 'start', 'style'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(https?:|mailto:)/i,
    RETURN_DOM: true
  }) as HTMLElement
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
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

export function replyComposeHtml(body: string, attribution: string, original: string, label: string): string {
  const paragraphs = (text: string): string => text.split('\n').map(line => {
    const paragraph = document.createElement('p')
    paragraph.textContent = line
    return paragraph.outerHTML
  }).join('')
  const heading = document.createElement('strong')
  heading.textContent = label
  return `${paragraphs(body)}<blockquote><p>${heading.outerHTML}</p>${paragraphs(attribution)}${paragraphs(original)}</blockquote>`
}

/** Estilos inline sencillos para clientes de correo que ignoran las hojas de estilo. */
export function composeEmailHtml(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = cleanComposeHtml(html)
  const styles: Record<string, string> = {
    p: 'margin:0 0 12px',
    a: 'color:#3555c5;text-decoration:underline',
    ul: 'margin:0 0 12px;padding-left:24px',
    ol: 'margin:0 0 12px;padding-left:24px',
    blockquote: 'margin:12px 0;padding-left:12px;border-left:2px solid #888888',
    code: 'font-family:monospace'
  }
  for (const element of container.querySelectorAll<HTMLElement>('*')) {
    const style = styles[element.tagName.toLowerCase()]
    if (style) element.setAttribute('style', style)
  }
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${container.innerHTML}</div>`
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
