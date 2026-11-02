import { lazy, Suspense, useEffect, useState } from 'react'
import { MAX_SIGNATURE_HTML_LENGTH } from '@shared/ipc'
import { useI18n } from '../i18n'
import { cleanComposeHtml } from '../lib/composeHtml'
import { Icon } from './Icon'

const RichTextEditor = lazy(() => import('./RichTextEditor').then(module => ({ default: module.RichTextEditor })))

export function SignatureSection({ accountKey }: { accountKey: string }): React.JSX.Element {
  const { t } = useI18n()
  const [html, setHtml] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'loadError' | 'saveError' | 'tooLarge'>('loading')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let canceled = false
    setStatus('loading')
    void window.api.getSettings().then(settings => {
      if (canceled) return
      const saved = settings.signatures?.[accountKey]
      setHtml(typeof saved === 'string' ? cleanComposeHtml(saved) : '')
      setStatus('ready')
    }).catch(() => { if (!canceled) setStatus('loadError') })
    return () => { canceled = true }
  }, [accountKey, retry])
  const save = async (): Promise<void> => {
    if (html.length > MAX_SIGNATURE_HTML_LENGTH) { setStatus('tooLarge'); return }
    setStatus('saving')
    try {
      await window.api.setSettings({ signatures: { [accountKey]: cleanComposeHtml(html) } })
      setStatus('saved')
    } catch { setStatus('saveError') }
  }
  return <section className="settings-card" aria-labelledby="signature-title">
    <div className="settings-card__head"><div>
      <h2 id="signature-title" className="settings-card__title">{t('signature.title')}</h2>
      <p className="settings-card__subtitle">{t('signature.hint')}</p>
    </div></div>
    {status === 'loading' ? <p role="status">{t('signature.loading')}</p> : status === 'loadError' ? <>
      <p className="account-error" role="alert">{t('signature.loadError')}</p>
      <button className="btn btn--surface" type="button" onClick={() => setRetry(value => value + 1)}>{t('offline.retry')}</button>
    </> : <>
      <div className="signature-editor">
        <Suspense fallback={<p role="status">{t('compose.loadingEditor')}</p>}>
          <RichTextEditor text="" html={html} label={t('signature.title')} disabled={status === 'saving'}
            onChange={(text, markup) => { const next = text.trim() || /<img\b/i.test(markup) ? markup : ''; setHtml(next); if (next !== html) setStatus('ready') }} />
        </Suspense>
      </div>
      <div className="signature-actions">
        <button className="btn btn--primary" type="button" disabled={status === 'saving'} onClick={() => void save()}><Icon name="draw" size={16} />{t(status === 'saving' ? 'signature.saving' : 'signature.save')}</button>
        {status === 'saved' && <span role="status">{t('signature.saved')}</span>}
      </div>
      {(status === 'saveError' || status === 'tooLarge') && <p className="account-error" role="alert">{t(`signature.${status}`)}</p>}
    </>}
  </section>
}
