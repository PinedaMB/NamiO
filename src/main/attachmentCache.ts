export interface CachedAttachment { name: string; type: string; content: Buffer }

const MAX_CACHE_BYTES = 100 * 1024 * 1024
const entries = new Map<string, CachedAttachment>()
let bytes = 0

export function cachedAttachment(key: string): CachedAttachment | undefined {
  const entry = entries.get(key)
  if (entry) { entries.delete(key); entries.set(key, entry) }
  return entry
}

export function cacheAttachment(key: string, attachment: CachedAttachment): void {
  if (attachment.content.length > MAX_CACHE_BYTES) return
  const previous = entries.get(key)
  if (previous) { bytes -= previous.content.length; entries.delete(key) }
  while (entries.size >= 64 || bytes + attachment.content.length > MAX_CACHE_BYTES) {
    const oldest = entries.keys().next().value!
    bytes -= entries.get(oldest)!.content.length
    entries.delete(oldest)
  }
  entries.set(key, attachment)
  bytes += attachment.content.length
}

export function clearAttachmentCache(): void { entries.clear(); bytes = 0 }
