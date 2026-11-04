import { useEffect, useState } from 'react'
import type { CopilotConfig, CopilotKeyStorage } from '@shared/ipc'
import { useI18n } from '../i18n'
import { PasswordField } from './PasswordField'
import { Icon } from './Icon'

export function CopilotSettings(): React.JSX.Element {
  const { t } = useI18n()
  const [config, setConfig] = useState<CopilotConfig>({ provider: 'gemini', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: '' })
  const [key, setKey] = useState('')
  const [keyStorage, setKeyStorage] = useState<CopilotKeyStorage>('none')
  const configured = keyStorage !== 'none'
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'' | 'ai.saveError' | 'ai.keyError'>('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    void window.api.copilotStatus?.().then(status => {
      setConfig({ provider: status.provider, ollamaUrl: status.ollamaUrl, ollamaModel: status.ollamaModel })
      setKeyStorage(status.geminiKeyStorage)
      setLoaded(true)
    }).catch(() => setError('ai.saveError'))
  }, [])
  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      if (config.provider === 'gemini' && key.trim()) {
        setKeyStorage(await window.api.setCopilotKey(key.trim()))
        setKey('')
      }
      await window.api.configureCopilot(config)
      setSaved(true)
    } catch (cause) { setError(String(cause).includes('Invalid API key') ? 'ai.keyError' : 'ai.saveError') }
    finally { setBusy(false) }
  }
  const removeKey = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setKeyStorage(await window.api.setCopilotKey(''))
      setKey('')
    } catch { setError('ai.saveError') }
    finally { setBusy(false) }
  }
  return <section className="settings-card ai-settings" aria-labelledby="settings-copilot-title">
    <h2 className="settings-card__title" id="settings-copilot-title">{t('ai.title')}</h2>
    <p className="settings-card__subtitle">{t('ai.settingsHint')}</p>
    <form className="settings-stack" onChange={() => setSaved(false)} onSubmit={event => { event.preventDefault(); void save() }}>
      <fieldset disabled={busy || !loaded} className="ai-key-fields">
        <div className="ai-provider-options" role="group" aria-label={t('ai.provider')}>
          {(['gemini', 'ollama'] as const).map(provider => <label className="ai-provider-choice" key={provider}>
            <input className="sr-only" type="radio" name="ai-provider" value={provider} checked={config.provider === provider} onChange={() => { setConfig(current => ({ ...current, provider })); setSaved(false) }} />
            <span className={`provider-icon provider-icon--${provider}`} aria-hidden="true" />
            <span className="ai-provider-choice__text"><strong>{provider === 'gemini' ? 'Gemini' : 'Ollama'}</strong><span>{t(provider === 'gemini' ? 'ai.geminiLabel' : 'ai.ollamaLabel')}</span></span>
            <Icon name={config.provider === provider ? 'radio_button_checked' : 'radio_button_unchecked'} size={18} />
          </label>)}
        </div>
        {config.provider === 'gemini' ? <>
          <p className="ai-settings__hint">{t('ai.geminiHint')}</p>
          <div className="ai-settings__credential">
            <span>{t('ai.key')}</span>
            <PasswordField value={key} onChange={setKey} ariaLabel={t('ai.key')} autoComplete="off" />
          </div>
          <p className="ai-settings__status" role="status"><Icon name={configured ? 'check_circle' : 'key'} size={16} />{t(keyStorage === 'session' ? 'ai.sessionKey' : configured ? 'ai.configured' : 'ai.notConfigured')}</p>
          <div className="ai-settings__links">
          {configured && <button className="tool-btn" type="button" onClick={() => void removeKey()}>{t('ai.removeKey')}</button>}
          <button type="button" className="tool-btn" onClick={() => void window.api.openExternal('https://aistudio.google.com/apikey')}>{t('ai.getKey')}<Icon name="open_in_new" size={14} /></button>
          </div>
        </> : <>
          <p className="ai-settings__hint">{t('ai.ollamaHint')}</p>
          <label className="ai-field">{t('ai.ollamaUrl')}<input type="url" required maxLength={2048} value={config.ollamaUrl} onChange={event => setConfig(current => ({ ...current, ollamaUrl: event.target.value.trim() }))} /></label>
          <label className="ai-field">{t('ai.ollamaModel')}<input required maxLength={128} placeholder="modelo:etiqueta" value={config.ollamaModel} onChange={event => setConfig(current => ({ ...current, ollamaModel: event.target.value.trim() }))} /></label>
        </>}
        <div className="ai-actions"><button className="btn btn--primary" type="submit">{busy && <Icon name="progress_activity" size={16} className="spin" />}{t('ai.save')}</button></div>
      </fieldset>
      {saved && <p role="status">{t(keyStorage === 'session' && config.provider === 'gemini' ? 'ai.savedSession' : 'ai.saved')}</p>}
      {error && <p className="account-error" role="alert">{t(error)}</p>}
    </form>
  </section>
}
