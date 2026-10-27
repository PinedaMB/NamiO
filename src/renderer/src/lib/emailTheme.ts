/** Adapta colores calculados; no altera imágenes ni usa filtros sobre el mensaje. */
export function emailColor(value: string, background: boolean): string | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value)
  if (!match) return null
  const channels = match.slice(1, 4).map(Number)
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if (alpha === 0) return null
  const linear = channels.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  if (background ? luminance <= 0.12 : luminance >= 0.65) return null
  const mapped = channels.map((channel) => Math.round(background ? 16 + channel * 0.1 : 210 + channel * 0.15))
  return `rgba(${mapped.join(', ')}, ${alpha})`
}

export function darkenEmail(document: Document): void {
  const view = document.defaultView
  if (!view || !document.body) return
  const imageBacked = new Set<Element>()
  const changes: { element: HTMLElement; color: string; background: string; borders: string[] }[] = []
  for (const element of [document.body, ...document.body.querySelectorAll<HTMLElement>('*')]) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.closest('img, picture, video, svg, canvas, style')) continue
    const computed = view.getComputedStyle(element)
    // Los fondos con imagen conservan también su texto para no romper su contraste.
    if (computed.backgroundImage !== 'none' || (element.parentElement && imageBacked.has(element.parentElement))) {
      imageBacked.add(element)
      continue
    }
    changes.push({ element, color: computed.color, background: computed.backgroundColor,
      borders: [computed.borderTopColor, computed.borderRightColor, computed.borderBottomColor, computed.borderLeftColor] })
  }
  for (const { element, color, background, borders } of changes) {
    const foreground = emailColor(color, false)
    const surface = emailColor(background, true)
    if (foreground) element.style.setProperty('color', foreground, 'important')
    if (surface) element.style.setProperty('background-color', surface, 'important')
    for (const [index, side] of ['top', 'right', 'bottom', 'left'].entries()) {
      const border = emailColor(borders[index]!, true)
      if (border) element.style.setProperty(`border-${side}-color`, border, 'important')
    }
  }
}

// Guardamos los estilos originales una vez para que cada cambio de tema sea reversible.
const originalStyles = new WeakMap<Document, {
  elements: { element: HTMLElement; style: string | null }[]
  sheets: { element: HTMLStyleElement; text: string; media: string }[]
}>()

export function applyEmailTheme(document: Document, theme: 'light' | 'dark'): string | undefined {
  if (!document.body) return
  let original = originalStyles.get(document)
  if (!original) {
    original = {
      elements: [document.body, ...document.body.querySelectorAll<HTMLElement>('*')]
        .map(element => ({ element, style: element.getAttribute('style') })),
      sheets: [...document.querySelectorAll('style')]
        .map(element => ({ element, text: element.textContent ?? '', media: element.media }))
    }
    originalStyles.set(document, original)
  }
  for (const { element, style } of original.elements) {
    if (style === null) element.removeAttribute('style')
    else element.setAttribute('style', style)
  }
  const adaptQuery = (css: string): string => css.replace(/\(prefers-color-scheme:\s*(dark|light)\)/gi,
    (_match, mode: string) => mode.toLowerCase() === theme ? '(min-width: 0px)' : '(width: 0px)')
  for (const { element, text, media } of original.sheets) {
    element.textContent = adaptQuery(text)
    element.media = adaptQuery(media)
  }
  document.documentElement.setAttribute('data-email-theme', theme)
  if (theme === 'dark') darkenEmail(document)
  const background = emailBackground(document)
  if (background) document.body.style.setProperty('background-color', background, 'important')
  return background
}

/** Usa la superficie más grande del contenido, sin tomar imágenes ni fondos transparentes. */
export function emailBackground(document: Document): string | undefined {
  const view = document.defaultView
  if (!view || !document.body) return
  let background = view.getComputedStyle(document.body).backgroundColor
  let largest = 0
  for (const element of document.body.querySelectorAll<HTMLElement>('table, div')) {
    const computed = view.getComputedStyle(element)
    const color = computed.backgroundColor
    if (computed.backgroundImage !== 'none' || !/^rgb\(|^rgba\([^)]*,\s*1\)$/.test(color)) continue
    const { width, height } = element.getBoundingClientRect()
    const area = width * height
    if (area > largest) {
      largest = area
      background = color
    }
  }
  return background
}

