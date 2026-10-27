import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { BodyTheme, RemoteImagePolicy } from '@shared/ipc'

interface PreferencesValue {
  remoteImages: RemoteImagePolicy
  setRemoteImages: (policy: RemoteImagePolicy) => void
  bodyTheme: BodyTheme
  setBodyTheme: (theme: BodyTheme) => void
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

/**
 * Preferencias de privacidad compartidas entre Ajustes y el visor de correos.
 * Persisten en settings.json por IPC, como el idioma y los atajos.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [remoteImages, setRemoteImagesState] = useState<RemoteImagePolicy>('block')
  const [bodyTheme, setBodyThemeState] = useState<BodyTheme>('light')

  useEffect(() => {
    window.api
      ?.getSettings?.()
      .then((settings) => {
        if (settings?.remoteImages === 'allow' || settings?.remoteImages === 'block') {
          setRemoteImagesState(settings.remoteImages)
        }
        if (settings?.bodyTheme === 'dark' || settings?.bodyTheme === 'light') {
          setBodyThemeState(settings.bodyTheme)
        }
      })
      .catch(() => undefined)
  }, [])

  const setRemoteImages = useCallback((policy: RemoteImagePolicy) => {
    setRemoteImagesState(policy)
    window.api?.setSettings?.({ remoteImages: policy }).catch(() => undefined)
  }, [])

  const setBodyTheme = useCallback((theme: BodyTheme) => {
    setBodyThemeState(theme)
    window.api?.setSettings?.({ bodyTheme: theme }).catch(() => undefined)
  }, [])

  const value = useMemo<PreferencesValue>(
    () => ({ remoteImages, setRemoteImages, bodyTheme, setBodyTheme }),
    [remoteImages, setRemoteImages, bodyTheme, setBodyTheme]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences debe usarse dentro de <PreferencesProvider>')
  return value
}
