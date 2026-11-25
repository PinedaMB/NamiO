import { useEffect, useState, type MutableRefObject } from 'react'

export type AutodiscoverState = 'idle' | 'searching' | 'found'

export interface AutodiscoverResult {
  imap: { host: string; port: number; secure: boolean }
  smtp: { host: string; port: number; secure: boolean }
}

interface UseAutodiscoverOptions {
  enabled: boolean
  email: string
  manualHostsRef: MutableRefObject<boolean>
  onFound: (found: AutodiscoverResult) => void
}

/** Busca configuración IMAP/SMTP por dominio con debounce cuando el usuario escribe su correo. */
export function useAutodiscover({ enabled, email, manualHostsRef, onFound }: UseAutodiscoverOptions): {
  autodiscoverState: AutodiscoverState
  setAutodiscoverState: (next: AutodiscoverState) => void
} {
  const [autodiscoverState, setAutodiscoverState] = useState<AutodiscoverState>('idle')

  useEffect(() => {
    if (!enabled || manualHostsRef.current) return
    const trimmed = email.trim()
    const at = trimmed.lastIndexOf('@')
    if (at <= 0 || !trimmed.slice(at + 1).includes('.')) {
      setAutodiscoverState('idle')
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setAutodiscoverState('searching')
      void window.api?.autodiscoverAccount?.(trimmed).then((found) => {
        if (cancelled || manualHostsRef.current) return
        if (!found) {
          setAutodiscoverState('idle')
          return
        }
        onFound(found)
        setAutodiscoverState('found')
      }).catch(() => {
        if (!cancelled) setAutodiscoverState('idle')
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, email])

  return { autodiscoverState, setAutodiscoverState }
}
