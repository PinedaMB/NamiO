import { copilotHtml } from '../lib/copilotHtml'
import { useEffect, useRef, useState } from 'react'
import type { CopilotRequest, CopilotStatus } from '@shared/ipc'
import { useI18n } from '../i18n'
import { Select } from './Select'
import { Icon } from './Icon'

interface Props {
  body: string
  revision: string
  context: string
  mode?: 'compose' | 'thread'
  onApply?: (text: string) => { revision: string; undo: () => void }
}

export function CopilotPanel({ body, revision, context, onApply, mode = 'compose' }: Props): React.JSX.Element {
  const { t, locale } = useI18n()
  const [status, setStatus] = useState<CopilotStatus | null>(null)
  const [outputLocale, setOutputLocale] = useState<'es' | 'en'>(locale)
  const [prompt, setPrompt] = useState('')
  const [targetLocale, setTargetLocale] = useState<'es' | 'en'>(locale === 'es' ? 'en' : 'es')
  const [tone, setTone] = useState<CopilotRequest['tone']>('direct')
  const [includeContext, setIncludeContext] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<{ text: string; source: string; action: CopilotRequest['action']; complete: boolean } | null>(null)
  const [applied, setApplied] = useState(false)
  const [appliedRevision, setAppliedRevision] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const undo = useRef<(() => void) | null>(null)
  const active = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void window.api.copilotStatus().then(value => { if (mounted.current) setStatus(value) }).catch(() => { if (mounted.current) setError(t('ai.error.configuration')) })
    return () => {
      mounted.current = false
      if (active.current) void window.api.cancelCopilot().catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    if (busy && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [proposal?.text, busy])
  const generate = async (action: CopilotRequest['action']): Promise<void> => {
    if (active.current || !status) return
    active.current = true
    setBusy(true)
    setError('')
    setProposal(null)
    follow.current = true
    setApplied(false)
    const source = revision
    try {
      const result = await window.api.generateCopilot({ provider: status.provider, action, targetLocale, prompt: mode === 'thread' ? '' : prompt, body, context: includeContext ? context : '', tone, locale: outputLocale }, delta => {
        if (mounted.current && active.current) setProposal(current => ({ text: (current?.text ?? '') + delta, source, action, complete: false }))
      })
      if (!mounted.current) return
      if (result.error) setError(t(`ai.error.${result.error}`))
      else setProposal({ text: result.text, source, action, complete: true })
    } catch { if (mounted.current) setError(t('ai.error.service')) }
    finally {
      active.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const changed = proposal && revision !== (applied ? appliedRevision : proposal.source)
  return <aside className="ai-panel" aria-label={t('ai.title')}>
    <header className="ai-panel__head">
      <div className="ai-provider-heading">
        {status && <span className={`provider-icon provider-icon--${status.provider}`} aria-hidden="true" />}
        <div><h3>{t(mode === 'thread' ? 'ai.threadTitle' : 'ai.title')}</h3>{status && <p>{status.provider === 'gemini' ? 'Gemini · 3.6 Flash' : `Ollama · ${status.ollamaModel}`}</p>}</div>
      </div>
    </header>
    <div className="ai-panel__scroll" ref={scroll} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48 }}>
      <label className="ai-language">{t('ai.outputLanguage')}
        <Select aria-label={t('ai.outputLanguage')} value={outputLocale} disabled={busy} onChange={event => setOutputLocale(event.target.value as 'es' | 'en')}>
          <option value="es">Español</option><option value="en">English</option>
        </Select>
      </label>
      {status && mode === 'compose' && <details className="ai-panel__privacy"><summary><Icon name="shield" size={14} />{t('ai.dataShared')}<Icon name="expand_more" size={16} className="ai-panel__privacy-chevron" /></summary><p>{t(status.provider === 'gemini' ? 'ai.privacy' : 'ai.privacy.ollama')}</p></details>}
      {mode === 'compose' && <>
      <label className="ai-field">{t('compose.voice')}
        <Select aria-label={t('compose.voice')} value={tone} disabled={busy} onChange={event => setTone(event.target.value as CopilotRequest['tone'])}>
          <option value="direct">{t('compose.toneDirect')}</option>
          <option value="warm">{t('compose.toneWarm')}</option>
          <option value="executive">{t('compose.toneExecutive')}</option>
          <option value="legal">{t('compose.toneLegal')}</option>
        </Select>
      </label>
      <label className="ai-field">{t('compose.prompt')}
        <textarea value={prompt} maxLength={40000} disabled={busy} rows={3} onChange={event => setPrompt(event.target.value)} />
      </label>
      {context && <label className="ai-context"><input type="checkbox" checked={includeContext} disabled={busy} onChange={event => setIncludeContext(event.target.checked)} />{t('ai.includeContext')}</label>}
      <div className="ai-actions ai-panel__generate">
        <button className="btn btn--primary" type="button" disabled={!status || busy || !prompt.trim()} onClick={() => void generate('draft')}><Icon name="auto_awesome" size={16} />{t('ai.draft')}</button>
        <button className="tool-btn" type="button" disabled={!status || busy || !body.trim()} onClick={() => void generate('improve')}>{t('ai.improve')}</button>
        {busy && <button className="tool-btn" type="button" onClick={() => void window.api.cancelCopilot().catch(() => setError(t('ai.error.service')))}>{t('ai.cancel')}</button>}
      </div>
      <div className="ai-rewrite-actions" role="group" aria-label={t('ai.rewriteActions')}>
        {(['shorten', 'expand', 'correct'] as const).map(action => <button key={action} className="micro-btn" type="button" disabled={!status || busy || !body.trim()} onClick={() => void generate(action)}>{t(`ai.${action}`)}</button>)}
      </div>
      <div className="ai-translate">
        <Select aria-label={t('ai.targetLanguage')} value={targetLocale} disabled={busy} onChange={event => setTargetLocale(event.target.value as 'es' | 'en')}>
          <option value="es">Español</option><option value="en">English</option>
        </Select>
        <button className="tool-btn" type="button" disabled={!status || busy || !body.trim()} onClick={() => void generate('translate')}><Icon name="translate" size={16} />{t('ai.translate')}</button>
      </div>
      </>}
      {mode === 'thread' && <>
        <p>{t('ai.threadPrivacy')}</p>
        <div className="ai-actions ai-panel__generate">
          <button className="btn btn--primary" type="button" disabled={!status || busy || !body.trim()} onClick={() => void generate('summarize')}>{t('ai.summarize')}</button>
          <button className="tool-btn" type="button" disabled={!status || busy || !body.trim()} onClick={() => void generate('tasks')}>{t('ai.tasks')}</button>
          {busy && <button className="tool-btn" type="button" onClick={() => void window.api.cancelCopilot().catch(() => setError(t('ai.error.service')))}>{t('ai.cancel')}</button>}
        </div>
      </>}
      {busy && <p className="ai-panel__progress" role="status"><Icon name="progress_activity" size={16} className="spin" />{t('compose.generating')}</p>}
      {error && <p className="account-error" role="alert">{error}</p>}
      {proposal && <section className="ai-panel__result" aria-label={t('ai.proposal')}>
        <h4>{t(mode === 'thread' ? proposal.action === 'tasks' ? 'ai.tasks' : 'ai.summarize' : 'ai.proposal')}</h4>
        <div className="ai-proposal" tabIndex={0} dangerouslySetInnerHTML={{ __html: copilotHtml(proposal.text) }} />
      </section>}
    </div>
    {proposal && <footer className="ai-panel__foot">
      <p role="status">{t(!proposal.complete ? busy ? 'compose.generating' : 'ai.incomplete' : mode === 'thread' ? changed ? 'ai.threadChanged' : 'ai.analysisReview' : changed ? 'ai.changed' : applied ? 'ai.applied' : 'ai.reviewHint')}</p>
      {mode === 'compose' && onApply && (applied
        ? <button className="tool-btn" type="button" disabled={Boolean(changed)} onClick={() => { undo.current?.(); setApplied(false) }}><Icon name="undo" size={16} />{t('ai.undo')}</button>
        : <button className="btn btn--primary" type="button" disabled={!proposal.complete || Boolean(changed) || busy} onClick={() => { const result = onApply(proposal.text); undo.current = result.undo; setAppliedRevision(result.revision); setApplied(true) }}><Icon name="input" size={16} />{t('compose.apply')}</button>)}
    </footer>}
  </aside>
}
