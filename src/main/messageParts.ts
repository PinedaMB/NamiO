import type { MessageStructureObject } from 'imapflow'

/** Conserva el orden MIME para que el índice del adjunto no cambie entre lectura y descarga. */
export function messageParts(structure: MessageStructureObject): { body: MessageStructureObject[]; attachments: MessageStructureObject[] } {
  const body: MessageStructureObject[] = [], attachments: MessageStructureObject[] = []
  const collect = (node: MessageStructureObject): void => {
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name
    const attached = node.disposition?.toLowerCase() === 'attachment' || Boolean(filename) || node.type.toLowerCase() === 'message/rfc822'
    if (!attached && node.childNodes?.length) { node.childNodes.forEach(collect); return }
    if (!attached && ['text/plain', 'text/html'].includes(node.type.toLowerCase())) body.push(node)
    else attachments.push(node)
  }
  collect(structure)
  return { body, attachments }
}
