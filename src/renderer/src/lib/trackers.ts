const TRACKER_HOST_RE = /(?:^|\.)(?:list-manage\d*\.com|mandrillapp\.com|sendgrid\.net|hubspotlinks\.com|hs-analytics\.net|klaviyo\.com|mailgun\.org|mailgun\.net|postmarkapp\.com|sparkpostmail\.com|mailjet\.com|constantcontact\.com|exacttarget\.com|pardot\.com|marketo\.com|doubleclick\.net|google-analytics\.com|mixpanel\.com|segment\.io|intercom-mail\.com|brevo\.com|sendinblue\.com|activecampaign\.com|dripemail2\.com|convertkit-mail\d*\.com|beehiiv\.com|substack\.com)$/i

const TRACKER_PATH_RE = /\/(?:track\/open|wf\/open|open\.gif|pixel\.gif|beacon|o\/eJ|t\/o\/|trk\/|e\/o\/)/i

const TRACKER_SUBDOMAIN_RE = /^(?:track|trk|pixel|open|beacon|clicks?|email-open|analytics)\./i

function parseDimension(raw: string | null): number | null {
  if (!raw) return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(raw)
  return match ? Number(match[1]) : null
}

function styleDimension(style: string, prop: 'width' | 'height'): number | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*px`, 'i')
  const match = re.exec(style)
  return match ? Number(match[1]) : null
}

/**
 * Detecta si una imagen remota `<img>` actúa como píxel de rastreo (1×1, 0×0,
 * oculta o servida desde endpoints conocidos de apertura/tracking).
 */
export function isTrackingPixel(
  src: string,
  attrs?: { width?: string | null; height?: string | null; style?: string | null }
): boolean {
  if (!/^https?:\/\//i.test(src)) return false
  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    return false
  }

  const w = parseDimension(attrs?.width ?? null) ?? styleDimension(attrs?.style ?? '', 'width')
  const h = parseDimension(attrs?.height ?? null) ?? styleDimension(attrs?.style ?? '', 'height')
  if ((w !== null && w <= 1) && (h !== null && h <= 1)) return true
  if (attrs?.style && /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(attrs.style)) {
    return true
  }

  const host = parsed.hostname.toLowerCase()
  const path = `${parsed.pathname}${parsed.search}`
  if (TRACKER_HOST_RE.test(host) && TRACKER_PATH_RE.test(path)) return true
  if (TRACKER_SUBDOMAIN_RE.test(host) && (TRACKER_PATH_RE.test(path) || (w !== null && w <= 2) || (h !== null && h <= 2))) {
    return true
  }
  return false
}
