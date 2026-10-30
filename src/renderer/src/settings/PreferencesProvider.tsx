import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AppSettings, BodyTheme, RemoteImagePolicy, TimeFormat } from '@shared/ipc'

type NotificationPreferences = Required<Pick<AppSettings, 'notifications' | 'notificationSound' | 'notificationPrivate' | 'keepInBackground'>>

interface PreferencesValue {
  notificationPreferences: NotificationPreferences
  setNotificationPreference: (key: keyof NotificationPreferences, value: boolean) => Promise<void>
  saveError: string | null
  remoteImages: RemoteImagePolicy
  setRemoteImages: (policy: RemoteImagePolicy) => void
  timeFormat: TimeFormat
  setTimeFormat: (format: TimeFormat) => void
  bodyTheme: BodyTheme
  setBodyTheme: (theme: BodyTheme) => void
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

/**
 * Preferencias compartidas entre Ajustes y la interfaz de correo.
 * Persisten en settings.json por IPC, como el idioma y los atajos.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [saveError, setSaveError] = useState<string | null>(null)
  const [remoteImages, setRemoteImagesState] = useState<RemoteImagePolicy>('block')
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>('24h')
  const [bodyTheme, setBodyThemeState] = useState<BodyTheme>('light')

  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({ notifications: true, notificationSound: true, notificationPrivate: true, keepInBackground: false })

  useEffect(() => {
    window.api
      ?.getSettings?.()
      .then((settings) => {
        setNotificationPreferences({ notifications: settings?.notifications !== false, notificationSound: settings?.notificationSound !== false, notificationPrivate: settings?.notificationPrivate !== false, keepInBackground: settings?.keepInBackground === true })
        if (settings?.remoteImages === 'allow' || settings?.remoteImages === 'block') {
          setRemoteImagesState(settings.remoteImages)
        }
        if (settings?.timeFormat === '12h' || settings?.timeFormat === '24h') setTimeFormatState(settings.timeFormat)
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

  const setTimeFormat = useCallback(async (format: TimeFormat) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ timeFormat: format })
      setTimeFormatState(format)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const setNotificationPreference = useCallback(async (key: keyof NotificationPreferences, value: boolean) => {
    setSaveError(null)
    try {
      await window.api.setSettings({ [key]: value })
      setNotificationPreferences(current => ({ ...current, [key]: value }))
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const value = useMemo<PreferencesValue>(
    () => ({ notificationPreferences, setNotificationPreference, saveError, remoteImages, setRemoteImages, bodyTheme, setBodyTheme, timeFormat, setTimeFormat }),
    [notificationPreferences, setNotificationPreference, saveError, remoteImages, setRemoteImages, bodyTheme, setBodyTheme, timeFormat, setTimeFormat]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences debe usarse dentro de <PreferencesProvider>')
  return value
}
