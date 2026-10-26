import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_BINDINGS, normalizeBindings, type Bindings } from './shortcuts'

interface ShortcutsValue {
  bindings: Bindings
  save: (next: Bindings) => void
  reset: () => void
}

const ShortcutsContext = createContext<ShortcutsValue | null>(null)

/**
 * Estado único de atajos para toda la app: si Ajustes remapea, la bandeja,
 * la leyenda y el manejador de teclas ven el cambio en el acto.
 *
 * Persistencia: settings.json (mismo canal que el idioma). La UI nunca escribe archivos.
 */
export function ShortcutsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [bindings, setBindings] = useState<Bindings>(DEFAULT_BINDINGS)

  useEffect(() => {
    window.api
      ?.getSettings?.()
      .then((settings) => {
        const stored = normalizeBindings(settings?.shortcuts)
        if (Object.keys(stored).length > 0) setBindings({ ...DEFAULT_BINDINGS, ...stored })
      })
      .catch(() => undefined)
  }, [])

  const save = useCallback((next: Bindings) => {
    setBindings(next)
    window.api?.setSettings?.({ shortcuts: next }).catch(() => undefined)
  }, [])

  const reset = useCallback(() => {
    setBindings(DEFAULT_BINDINGS)
    window.api?.setSettings?.({ shortcuts: DEFAULT_BINDINGS }).catch(() => undefined)
  }, [])

  const value = useMemo<ShortcutsValue>(() => ({ bindings, save, reset }), [bindings, save, reset])

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

export function useShortcuts(): ShortcutsValue {
  const value = useContext(ShortcutsContext)
  if (!value) throw new Error('useShortcuts debe usarse dentro de <ShortcutsProvider>')
  return value
}
