import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { es, type Dictionary, type TranslationKey } from './es'
import { en } from './en'

export type Locale = 'es' | 'en'
export type { TranslationKey }

const DICTIONARIES: Record<Locale, Dictionary> = { es, en }
const STORAGE_KEY = 'namio.language'

export const LOCALES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: 'es', label: 'ES' },
  { id: 'en', label: 'EN' }
]

function isLocale(value: unknown): value is Locale {
  return value === 'es' || value === 'en'
}

/**
 * Idioma inicial: preferencia guardada → idioma del sistema → español.
 * La lectura de localStorage es sincrónica a propósito: sin parpadeo al abrir.
 */
function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // localStorage no disponible (file:// con origen opaco): se sigue con el sistema
  }
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

interface I18nValue {
  saveError: string | null
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [saveError, setSaveError] = useState<string | null>(null)
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  useEffect(() => {
    // La preferencia vive en settings.json (perfil de la app); localStorage es
    // solo la caché sincrónica del renderer.
    window.api
      ?.getSettings?.()
      .then((settings) => {
        if (isLocale(settings?.language)) setLocaleState(settings.language)
      })
      .catch(() => undefined)
  }, [])

  const setLocale = useCallback(async (next: Locale) => {
    setSaveError(null)
    try {
      await window.api?.setSettings?.({ language: next })
      setLocaleState(next)
      setSaveError(null)
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // El perfil ya se guardó; localStorage solo es una caché.
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const template = DICTIONARIES[locale][key] ?? es[key] ?? key
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match
      )
    },
    [locale]
  )

  const value = useMemo<I18nValue>(() => ({ saveError, locale, setLocale, t }), [saveError, locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n debe usarse dentro de <I18nProvider>')
  return value
}
