import DOMPurify from 'dompurify'

/** El editor admite solo formato básico de correo; descarta estilos y contenido activo del portapapeles. */
export function cleanComposeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'code'],
    ALLOWED_ATTR: ['href', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(https?:|mailto:)/i
  })
}

export function textToEditorContent(text: string): { type: 'doc'; content: { type: 'paragraph'; content: { type: 'text'; text: string }[] }[] } {
  return {
    type: 'doc',
    content: text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
  }
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
