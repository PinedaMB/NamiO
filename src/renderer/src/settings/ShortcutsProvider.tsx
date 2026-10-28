import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_BINDINGS, normalizeBindings, defaultShortcutModifier, formatCombo, type ShortcutModifier, type Bindings } from './shortcuts'

interface ShortcutsValue {
  saveError: string | null
  bindings: Bindings
  modifier: ShortcutModifier
  setModifier: (next: ShortcutModifier) => Promise<void>
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [bindings, setBindings] = useState<Bindings>(DEFAULT_BINDINGS)

  const [modifier, updateModifier] = useState<ShortcutModifier>(defaultShortcutModifier)

  useEffect(() => {
    window.api
      ?.getSettings?.()
      .then((settings) => {
        if (settings?.shortcutModifier === 'ctrl' || settings?.shortcutModifier === 'command') updateModifier(settings.shortcutModifier)
        const stored = normalizeBindings(settings?.shortcuts)
        if (Object.keys(stored).length > 0) setBindings({ ...DEFAULT_BINDINGS, ...stored })
      })
      .catch(() => undefined)
  }, [])

  const save = useCallback(async (next: Bindings) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ shortcuts: next })
      setBindings(next)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const setModifier = useCallback(async (next: ShortcutModifier) => {
    if (next !== 'ctrl' && next !== 'command') return
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ shortcutModifier: next })
      updateModifier(next)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const reset = useCallback(() => { void save(DEFAULT_BINDINGS) }, [save])

  const value = useMemo<ShortcutsValue>(() => ({ saveError, bindings, modifier, setModifier, save, reset }), [saveError, bindings, modifier, setModifier, save, reset])

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

export function useShortcuts(): ShortcutsValue {
  const value = useContext(ShortcutsContext)
  if (!value) throw new Error('useShortcuts debe usarse dentro de <ShortcutsProvider>')
  return value
}

export function useFormatCombo(): (combo: string) => string {
  const value = useContext(ShortcutsContext)
  return useCallback((combo: string) => formatCombo(combo, value?.modifier), [value?.modifier])
}
