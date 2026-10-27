import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { BodyTheme, RemoteImagePolicy } from '@shared/ipc'

interface PreferencesValue {
  saveError: string | null
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
  const [saveError, setSaveError] = useState<string | null>(null)
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

  const setRemoteImages = useCallback(async (policy: RemoteImagePolicy) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ remoteImages: policy })
      setRemoteImagesState(policy)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const setBodyTheme = useCallback(async (theme: BodyTheme) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ bodyTheme: theme })
      setBodyThemeState(theme)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const value = useMemo<PreferencesValue>(
    () => ({ saveError, remoteImages, setRemoteImages, bodyTheme, setBodyTheme }),
    [saveError, remoteImages, setRemoteImages, bodyTheme, setBodyTheme]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences debe usarse dentro de <PreferencesProvider>')
  return value
}
