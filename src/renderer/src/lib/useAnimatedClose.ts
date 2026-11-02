import { useEffect, useEffectEvent, useState } from 'react'

/** Deja terminar la salida antes de desmontar el diálogo o ejecutar su acción. */
export function useAnimatedClose(onClose: () => void): { closing: boolean; close: (action?: () => void) => void } {
  const [pending, setPending] = useState<{ action: () => void } | null>(null)
  const finish = useEffectEvent(() => {
    pending?.action()
    setPending(null)
  })
  useEffect(() => {
    if (!pending) return
    const timer = window.setTimeout(finish, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140)
    return () => window.clearTimeout(timer)
  }, [pending])
  return { closing: pending !== null, close: (action = onClose) => setPending(current => current ?? { action }) }
}
