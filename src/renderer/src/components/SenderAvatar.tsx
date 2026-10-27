import { useEffect, useState } from 'react'
import { usePreferences } from '../settings/PreferencesProvider'
import { cx } from '../lib/cx'

interface SenderAvatarProps {
  email: string
  initials: string
  mailbox: string
  blocked?: boolean
  className?: string
}

export function SenderAvatar({ email, initials, mailbox, blocked = false, className }: SenderAvatarProps): React.JSX.Element {
  const { remoteImages } = usePreferences()
  const [image, setImage] = useState<{ email: string; src: string } | null>(null)
  const allowed = !blocked && remoteImages === 'allow'
  useEffect(() => {
    if (!allowed || !email) return
    let canceled = false
    void window.api.senderLogo(email, mailbox).then((src) => {
      if (!canceled) setImage(src ? { email, src } : null)
    }).catch(() => { if (!canceled) setImage(null) })
    return () => { canceled = true }
  }, [email, mailbox, allowed])

  return (
    <span className={cx('avatar', className)}>
      {allowed && image?.email === email
        ? <img className="avatar__image" src={image.src} alt="" onError={() => setImage(null)} />
        : initials}
    </span>
  )
}
