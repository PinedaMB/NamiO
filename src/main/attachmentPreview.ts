import type { AttachmentPreview } from '@shared/ipc'

export function attachmentPreview(attachment: { name: string; type: string; content: Buffer }): AttachmentPreview {
  const { name, content } = attachment
  const type = attachment.type.toLowerCase().split(';')[0]!.trim()
  if (content.length > 20 * 1024 * 1024) throw new Error('El adjunto supera el límite de vista previa de 20 MB')
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon)$/.test(type)) {
    return { kind: 'image', name, src: `data:${type};base64,${content.toString('base64')}` }
  }
  if (type === 'application/pdf' || (type === 'application/octet-stream' && /\.pdf$/i.test(name))) {
    if (!content.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('PDF inválido')
    return { kind: 'pdf', name, data: content.toString('base64') }
  }
  if (type === 'text/plain' || (type === 'application/octet-stream' && /\.txt$/i.test(name))) {
    let text: string
    if (content[0] === 0xff && content[1] === 0xfe) text = new TextDecoder('utf-16le').decode(content)
    else if (content[0] === 0xfe && content[1] === 0xff) text = new TextDecoder('utf-16be').decode(content)
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(content) }
      catch { text = new TextDecoder('windows-1252').decode(content) }
    }
    if (text.includes('\0')) throw new Error('El adjunto no es texto plano')
    return { kind: 'text', name, text }
  }
  throw new Error('Vista previa no disponible para este adjunto')
}
