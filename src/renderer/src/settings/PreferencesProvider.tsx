import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AppSettings, AppTheme, BodyTheme, MailTemplate, RemoteImagePolicy, TimeFormat } from '@shared/ipc'

type NotificationPreferences = Required<Pick<AppSettings, 'notifications' | 'notificationSound' | 'notificationPrivate' | 'keepInBackground'>>

interface PreferencesValue {
  appTheme: AppTheme
  setAppTheme: (theme: AppTheme) => Promise<void>
  notificationPreferences: NotificationPreferences
  setNotificationPreference: (key: keyof NotificationPreferences, value: boolean) => Promise<void>
  saveError: string | null
  remoteImages: RemoteImagePolicy
  setRemoteImages: (policy: RemoteImagePolicy) => void
  allowedImageSenders: string[]
  allowImageSender: (email: string) => Promise<void>
  removeImageSender: (email: string) => Promise<void>
  blockTrackers: boolean
  setBlockTrackers: (enabled: boolean) => Promise<void>
  offlineDownload: boolean
  setOfflineDownload: (enabled: boolean) => Promise<void>
  timeFormat: TimeFormat
  setTimeFormat: (format: TimeFormat) => void
  spellcheckLanguage: 'es' | 'en'
  setSpellcheckLanguage: (language: 'es' | 'en') => Promise<void>
  bodyTheme: BodyTheme
  setBodyTheme: (theme: BodyTheme) => void
  undoSendSeconds: 0 | 5 | 7 | 10 | 20
  setUndoSendSeconds: (seconds: 0 | 5 | 7 | 10 | 20) => void
  templates: MailTemplate[]
  setTemplates: (templates: MailTemplate[]) => Promise<void>
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

/**
 * Preferencias compartidas entre Ajustes y la interfaz de correo.
 * Persisten en settings.json por IPC, como el idioma y los atajos.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [appTheme, setAppThemeState] = useState<AppTheme>('system')
  const [offlineDownload, setOfflineDownloadState] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [remoteImages, setRemoteImagesState] = useState<RemoteImagePolicy>('block')
  const [allowedImageSenders, setAllowedImageSendersState] = useState<string[]>([])
  const [blockTrackers, setBlockTrackersState] = useState(true)
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>('24h')
  const [spellcheckLanguage, setSpellcheckLanguageState] = useState<'es' | 'en'>('es')
  const [bodyTheme, setBodyThemeState] = useState<BodyTheme>('light')
  const [undoSendSeconds, setUndoSendSecondsState] = useState<0 | 5 | 7 | 10 | 20>(7)
  const [templates, setTemplatesState] = useState<MailTemplate[]>([])

  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({ notifications: true, notificationSound: true, notificationPrivate: true, keepInBackground: false })

  useEffect(() => {
    window.api
      ?.getSettings?.()
      .then((settings) => {
        if (settings?.appTheme === 'light' || settings?.appTheme === 'dark' || settings?.appTheme === 'system') setAppThemeState(settings.appTheme)
        setOfflineDownloadState(settings?.offlineDownload === true)
        setNotificationPreferences({ notifications: settings?.notifications !== false, notificationSound: settings?.notificationSound !== false, notificationPrivate: settings?.notificationPrivate !== false, keepInBackground: settings?.keepInBackground === true })
        if (settings?.remoteImages === 'allow' || settings?.remoteImages === 'block') {
          setRemoteImagesState(settings.remoteImages)
        }
        if (Array.isArray(settings?.allowedImageSenders)) {
          setAllowedImageSendersState(settings.allowedImageSenders)
        }
        setBlockTrackersState(settings?.blockTrackers !== false)
        if (settings?.spellcheckLanguage === 'es' || settings?.spellcheckLanguage === 'en') setSpellcheckLanguageState(settings.spellcheckLanguage)
        if (settings?.timeFormat === '12h' || settings?.timeFormat === '24h') setTimeFormatState(settings.timeFormat)
        if (settings?.bodyTheme === 'dark' || settings?.bodyTheme === 'light') {
          setBodyThemeState(settings.bodyTheme)
        }
        if (settings?.undoSendSeconds === 0 || settings?.undoSendSeconds === 5 || settings?.undoSendSeconds === 7 || settings?.undoSendSeconds === 10 || settings?.undoSendSeconds === 20) {
          setUndoSendSecondsState(settings.undoSendSeconds)
        }
        if (Array.isArray(settings?.templates)) {
          setTemplatesState(settings.templates)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.appTheme = appTheme
  }, [appTheme])

  const setAppTheme = useCallback(async (theme: AppTheme) => {
    setSaveError(null)
    try {
      await window.api.setSettings({ appTheme: theme })
      setAppThemeState(theme)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const setOfflineDownload = useCallback(async (enabled: boolean) => {
    setSaveError(null)
    try {
      await window.api.setSettings({ offlineDownload: enabled })
      setOfflineDownloadState(enabled)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
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

  const setSpellcheckLanguage = useCallback(async (language: 'es' | 'en') => {
    setSaveError(null)
    try {
      await window.api.setSettings({ spellcheckLanguage: language })
      setSpellcheckLanguageState(language)
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

  const setUndoSendSeconds = useCallback(async (seconds: 0 | 5 | 7 | 10 | 20) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ undoSendSeconds: seconds })
      setUndoSendSecondsState(seconds)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const setTemplates = useCallback(async (next: MailTemplate[]) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ templates: next })
      setTemplatesState(next)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const allowImageSender = useCallback(async (email: string) => {
    const normalized = email.trim().toLowerCase()
    if (!normalized) return
    setSaveError(null)
    const next = allowedImageSenders.includes(normalized) ? allowedImageSenders : [...allowedImageSenders, normalized].slice(-200)
    try {
      await window.api?.setSettings?.({ allowedImageSenders: next })
      setAllowedImageSendersState(next)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [allowedImageSenders])

  const removeImageSender = useCallback(async (email: string) => {
    const normalized = email.trim().toLowerCase()
    setSaveError(null)
    const next = allowedImageSenders.filter(item => item !== normalized)
    try {
      await window.api?.setSettings?.({ allowedImageSenders: next })
      setAllowedImageSendersState(next)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [allowedImageSenders])

  const setBlockTrackers = useCallback(async (enabled: boolean) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ blockTrackers: enabled })
      setBlockTrackersState(enabled)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const value = useMemo<PreferencesValue>(
    () => ({ appTheme, setAppTheme, offlineDownload, setOfflineDownload, notificationPreferences, setNotificationPreference, saveError, remoteImages, setRemoteImages, allowedImageSenders, allowImageSender, removeImageSender, blockTrackers, setBlockTrackers, bodyTheme, setBodyTheme, timeFormat, setTimeFormat, spellcheckLanguage, setSpellcheckLanguage, undoSendSeconds, setUndoSendSeconds, templates, setTemplates }),
    [appTheme, setAppTheme, offlineDownload, setOfflineDownload, notificationPreferences, setNotificationPreference, saveError, remoteImages, setRemoteImages, allowedImageSenders, allowImageSender, removeImageSender, blockTrackers, setBlockTrackers, bodyTheme, setBodyTheme, timeFormat, setTimeFormat, spellcheckLanguage, setSpellcheckLanguage, undoSendSeconds, setUndoSendSeconds, templates, setTemplates]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences debe usarse dentro de <PreferencesProvider>')
  return value
}
