import { useEffect, useState } from 'react'

/**
 * Mantiene un elemento montado el tiempo justo para que termine su animación
 * de salida. Sin esto, React lo desmonta en el mismo frame y el cierre se ve
 * como un salto.
 */
export function usePresence(open: boolean, duration = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return

    setClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, duration)

    return () => window.clearTimeout(timer)
  }, [open, duration, mounted])

  return { mounted, closing }
}
