const escape = (text: string): string => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const inline = (text: string): string => text.split(/(`[^`\n]+`)/g).map(part => {
  if (/^`[^`\n]+`$/.test(part)) return `<code>${escape(part.slice(1, -1))}</code>`
  return escape(part)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])__([^_\n]+)__(?=$|[\s).,!?:;])/g, '$1<strong>$2</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
}).join('')

// shortcut: admite títulos, énfasis, listas y código; usar un parser Markdown si se necesitan tablas o enlaces.
export function copilotHtml(text: string): string {
  let html = '', list = '', paragraph: string[] = [], code: string[] | null = null
  const flush = (): void => { if (paragraph.length) { html += `<p>${paragraph.map(inline).join('<br>')}</p>`; paragraph = [] } }
  const closeList = (): void => { if (list) { html += `</${list}>`; list = '' } }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      flush(); closeList()
      if (code) { html += `<p><code>${escape(code.join('\n')).replace(/\n/g, '<br>')}</code></p>`; code = null } else code = []
      continue
    }
    if (code) { code.push(line); continue }
    if (!line.trim()) { flush(); continue }
    const heading = line.match(/^#{1,6}\s+(.+)$/)
    if (heading) { flush(); closeList(); html += `<p><strong>${inline(heading[1]!)}</strong></p>`; continue }
    const item = line.match(/^\s*(?:([-+*])|(\d{1,6})[.)])\s+(.+)$/)
    if (item) {
      flush()
      const tag = item[1] ? 'ul' : 'ol'
      if (list !== tag) { closeList(); list = tag; html += tag === 'ol' && Number(item[2]) !== 1 ? `<ol start="${Number(item[2])}">` : `<${tag}>` }
      html += `<li><p>${inline(item[3]!)}</p></li>`
    } else { closeList(); paragraph.push(line) }
  }
  flush(); closeList()
  if (code) html += `<p><code>${escape(code.join('\n')).replace(/\n/g, '<br>')}</code></p>`
  return html
}
