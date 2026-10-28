export function serverFromEmail(email: string): string {
  const domain = /^[^\s@,]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(email.trim())?.[1]
  return domain ? `email.${domain.toLowerCase()}` : ''
}
