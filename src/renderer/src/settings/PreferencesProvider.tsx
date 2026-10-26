import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { RemoteImagePolicy } from '@shared/ipc'

interface PreferencesValue {
  remoteImages: RemoteImagePolicy
  setRemoteImages: (policy: RemoteImagePolicy) => void
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

/**
 * Preferencias de privacidad compartidas entre Ajustes y el visor de correos.
 * Persisten en settings.json por IPC, como el idioma y los atajos.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [remoteImages, setRemoteImagesState] = useState<RemoteImagePolicy>('block')

  useEffect(() => {
    window.api
      ?.getSettings?.()
      .then((settings) => {
        if (settings?.remoteImages === 'allow' || settings?.remoteImages === 'block') {
          setRemoteImagesState(settings.remoteImages)
        }
      })
      .catch(() => undefined)
  }, [])

  const setRemoteImages = useCallback((policy: RemoteImagePolicy) => {
    setRemoteImagesState(policy)
    window.api?.setSettings?.({ remoteImages: policy }).catch(() => undefined)
  }, [])

  const value = useMemo<PreferencesValue>(() => ({ remoteImages, setRemoteImages }), [remoteImages, setRemoteImages])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences debe usarse dentro de <PreferencesProvider>')
  return value
}
