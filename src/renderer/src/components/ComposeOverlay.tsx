import { TooltipButton } from './Tooltip'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { validRecipients } from '@shared/mailAddresses'
import type { Draft, PickedAttachment } from '@shared/ipc'
import { COPILOT_DRAFT } from '../data/demo'
import { useI18n, type TranslationKey } from '../i18n'
import { usePresence } from '../lib/usePresence'
import { composeEmailHtml } from '../lib/composeHtml'
import { RecipientInput } from './RecipientInput'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

const RichTextEditor = lazy(() => import('./RichTextEditor').then(module => ({ default: module.RichTextEditor })))

interface ComposeOverlayProps {
  open: boolean
  to: string
  subject: string
  body: string
  html?: string
  cc?: string
  bcc?: string
  initialAttachments?: PickedAttachment[]
  onDiscard: () => Promise<void>
  onRestoreDraft?: () => Promise<void>
  /** El copiloto y los adjuntos de ejemplo son de la demo, no de una cuenta real. */
  copilot?: boolean
  onClose: (values: Omit<Draft, 'updatedAt'>) => Promise<void>
  onSend: (payload: Omit<Draft, 'updatedAt'>) => Promise<void>
  /** Abre el diálogo del sistema; solo existe con cuenta real. */
  onPickAttachments?: () => Promise<PickedAttachment[]>
}

const TONES: ReadonlyArray<{ id: TranslationKey }> = [
  { id: 'compose.toneDirect' },
  { id: 'compose.toneWarm' },
  { id: 'compose.toneExecutive' },
  { id: 'compose.toneLegal' }
]

const DEFAULT_PROMPT =
  'Draft reply accepting meeting for 2 PM PST, confirm outside legal review of Section 4.2 is complete, and attach the signed addendum.'

export function ComposeOverlay({
  open,
  to,
  subject,
  body,
  html,
  cc = '',
  bcc = '',
  initialAttachments,
  onDiscard,
  onRestoreDraft,
  copilot = true,
  onClose,
  onSend,
  onPickAttachments
}: ComposeOverlayProps): React.JSX.Element | null {
  const { t } = useI18n()
  const { mounted, closing } = usePresence(open, 140)
  const [toValue, setToValue] = useState(to)
  const [subjectValue, setSubjectValue] = useState(subject)
  const bodyRef = useRef({ body, html })
  const [bodyValue, setBodyValue] = useState(body)
  const [htmlValue, setHtmlValue] = useState(html)
  const [ccValue, setCcValue] = useState(cc)
  const [bccValue, setBccValue] = useState(bcc)
  const [bccOpen, setBccOpen] = useState(Boolean(bcc))
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [ccOpen, setCcOpen] = useState(false)
  const [tone, setTone] = useState<TranslationKey>('compose.toneDirect')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [generating, setGenerating] = useState(false)
  const [applied, setApplied] = useState(false)
  const [picked, setPicked] = useState<PickedAttachment[]>([])
  const [attachments, setAttachments] = useState<ReadonlyArray<{ name: string; detail: string; icon: string }>>(
    copilot
      ? [
          { name: 'Executed_Addendum_v3.pdf', detail: '248 KB · Signed with DocuSign', icon: 'picture_as_pdf' },
          { name: 'Calendar Invite: Series A Sync', detail: 'Tomorrow, 2:00 PM – 2:30 PM PST', icon: 'event' }
        ]
      : []
  )

  useEffect(() => {
    if (!open) return
    setToValue(to)
    setSubjectValue(subject)
    bodyRef.current = { body, html }
    setBodyValue(body)
    setHtmlValue(html)
    setApplied(false)
    setGenerating(false)
    setPicked(initialAttachments ?? [])
    setCcValue(cc)
    setBccValue(bcc)
    setCcOpen(Boolean(cc))
    setBccOpen(Boolean(bcc))
    setError(null)
    // Los adjuntos de ejemplo solo existen en la demo.
    setAttachments(
      copilot
        ? [
            { name: 'Executed_Addendum_v3.pdf', detail: '248 KB · Signed with DocuSign', icon: 'picture_as_pdf' },
            { name: 'Calendar Invite: Series A Sync', detail: 'Tomorrow, 2:00 PM – 2:30 PM PST', icon: 'event' }
          ]
        : []
    )
  }, [open, to, subject, body, html, copilot, cc, bcc, initialAttachments])

  const values = (): Omit<Draft, 'updatedAt'> => ({
    to: toValue, cc: ccValue, bcc: bccValue,
    subject: subjectValue, body: bodyRef.current.body, html: bodyRef.current.html, attachments: picked
  })

  const closeWithDraft = async (): Promise<void> => {
    if (sendingRef.current) return
    sendingRef.current = true
    setError(null)
    try { await onClose(values()) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { sendingRef.current = false }
  }

  const send = async (): Promise<void> => {
    if (sendingRef.current) return
    const payload = values()
    if (!validRecipients(payload.to, payload.cc, payload.bcc ?? '')) { setError(t('compose.invalidRecipients')); return }
    sendingRef.current = true
    setSending(true)
    setError(null)
    try { await onSend({ ...payload, html: payload.html ? composeEmailHtml(payload.html) : undefined }) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { sendingRef.current = false; setSending(false) }
  }

  const discard = async (): Promise<void> => {
    if (sendingRef.current) return
    try { await onDiscard() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  // Escape cierra guardando el borrador; en captura para adelantarse al atajo global.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void send(); return }
      if (event.key !== 'Escape') return
      if ((event.target as HTMLElement | null)?.closest?.('[data-recipient-popup="true"], [data-editor-popup]')) return
      event.stopPropagation()
      event.preventDefault()
      void closeWithDraft()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, toValue, ccValue, bccValue, subjectValue, bodyValue, htmlValue, picked, sending, onClose])

  if (!mounted) return null

  const replaceBody = (text: string): void => {
    bodyRef.current = { body: text, html: undefined }
    setBodyValue(text)
    setHtmlValue(undefined)
  }

  const handleGenerate = (): void => {
    setGenerating(true)
    window.setTimeout(() => {
      setGenerating(false)
      replaceBody(COPILOT_DRAFT)
      setApplied(true)
    }, 650)
  }


  return (
    <div
      className={cx('overlay overlay--center', closing && 'overlay--closing')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeWithDraft()
      }}
    >
      <div className={cx('composer', expanded && 'composer--expanded')} aria-busy={sending} role="dialog" aria-modal="true" aria-label={t('compose.newMessage')}>
        <div className="composer__head">
          <div className="composer__title">
            <Icon name="edit_square" size={18} className="composer__title-icon" />
            <span>{subjectValue || t('compose.newMessage')}</span>
            {subjectValue.startsWith('Re:') && copilot && (
              <span className="chip">{t('compose.threadId')}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-sm)' }}>
            {onRestoreDraft && !toValue && !ccValue && !bccValue && !subjectValue && !bodyValue && !picked.length && (
              <button className="tool-btn" type="button" onClick={() => {
                if (sendingRef.current) return
                sendingRef.current = true
                setSending(true)
                void onRestoreDraft().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
                  .finally(() => { sendingRef.current = false; setSending(false) })
              }} disabled={sending}>
                <Icon name="history" size={16} />{t('draft.restore')}
              </button>
            )}
            <TooltipButton className="icon-btn" type="button" title={t('compose.expand')} onClick={() => setExpanded(value => !value)} disabled={sending}>
              <Icon name="open_in_full" size={16} />
            </TooltipButton>
            <TooltipButton className="icon-btn" type="button" onClick={() => void closeWithDraft()} disabled={sending} title={t('common.close')}>
              <Icon name="close" size={16} />
            </TooltipButton>
          </div>
        </div>

        <div className="composer__fields" inert={sending}>
          <div className="field-row">
            <span className="field-label">{t('compose.to')}</span>
            <RecipientInput key={`${open}:${to}`} field="to" initialValue={to} onChange={setToValue} suggest={!copilot} />
            <div style={{ display: 'flex', gap: 'var(--sp-sm)' }}>
              <button className="tool-btn" type="button" onClick={() => setCcOpen((value) => !value)}>
                {t('compose.cc')}
              </button>
              <button className="tool-btn" type="button" onClick={() => setBccOpen((value) => !value)}>
                {t('compose.bcc')}
              </button>
            </div>
          </div>

          {ccOpen && <div className="field-row">
            <span className="field-label">{t('compose.cc')}</span>
            <RecipientInput key={`${open}:${cc}`} field="cc" initialValue={ccValue} onChange={setCcValue} suggest={!copilot} />
          </div>}
          {bccOpen && <div className="field-row">
            <span className="field-label">{t('compose.bcc')}</span>
            <RecipientInput key={`${open}:${bcc}`} field="bcc" initialValue={bccValue} onChange={setBccValue} suggest={!copilot} />
          </div>}

          <div className="field-row">
            <span className="field-label">{t('compose.subject')}</span>
            <input
              className="subject-input"
              value={subjectValue}
              onChange={(event) => setSubjectValue(event.target.value)}
              aria-label={t('compose.subject')}
            />
          </div>
        </div>

        <div className={cx('composer__split', !copilot && 'composer__split--solo')} inert={sending}>
          <div className="editor">
            <Suspense fallback={<div className="letter-loading" role="status">{t('compose.loadingEditor')}</div>}>
            <RichTextEditor text={bodyValue} html={htmlValue} disabled={sending}
              onChange={(text, markup) => { bodyRef.current = { body: text, html: markup }; setBodyValue(text); setHtmlValue(markup) }}
              onAttach={onPickAttachments ? () => {
                void onPickAttachments().then(files => {
                  if (files.length) setPicked(current => [...current, ...files])
                }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
              } : undefined}>
              {copilot && (
                <div className="composer__sign">
                  <strong>Alex Rivera</strong>
                  <span>{t('compose.signatureRole')}</span>
                </div>
              )}

              <div className="attach-row">
                {picked.map((file) => (
                  <span key={file.id} className="attach-pill">
                    <Icon name="attach_file" size={18} className="attach-pill__icon" />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="attach-pill__name">{file.name}</span>
                      <span className="attach-pill__detail">
                        {Math.max(1, Math.round(file.size / 1024))} KB
                      </span>
                    </span>
                    <TooltipButton
                      type="button"
                      title={t('compose.removeAttachment')}
                      onClick={() => setPicked((list) => list.filter((item) => item.id !== file.id))}
                    >
                      <Icon name="close" size={14} />
                    </TooltipButton>
                  </span>
                ))}
                {attachments.map((attachment) => (
                  <span key={attachment.name} className="attach-pill">
                    <Icon name={attachment.icon} size={18} className="attach-pill__icon" />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="attach-pill__name">{attachment.name}</span>
                      <span className="attach-pill__detail">{attachment.detail}</span>
                    </span>
                    <TooltipButton
                      type="button"
                      title={t('compose.removeAttachment')}
                      onClick={() => setAttachments((list) => list.filter((item) => item.name !== attachment.name))}
                    >
                      <Icon name="close" size={14} />
                    </TooltipButton>
                  </span>
                ))}
              </div>
            </RichTextEditor>
            </Suspense>
          </div>

          <div className="copilot">
            <div className="copilot__scroll">
              <div className="copilot__head">
                <span className="copilot__title">
                  <span className="copilot__mark">
                    <Icon name="auto_awesome" size={16} />
                  </span>
                  {t('compose.copilot')}
                </span>
                <span className="chip chip--primary">Fast Lane 4.5</span>
              </div>

              <div className="copilot__section">
                <span className="card__label">{t('compose.voice')}</span>
                <div className="tone-grid">
                  {TONES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cx('tone', tone === option.id && 'tone--active')}
                      onClick={() => setTone(option.id)}
                      aria-pressed={tone === option.id}
                    >
                      <span>{t(option.id)}</span>
                      <span className="dot" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="copilot__section">
                <span className="card__label">{t('compose.prompt')}</span>
                <div className="prompt-box">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={3}
                    aria-label={t('compose.prompt')}
                  />
                  <div className="prompt-box__foot">
                    <span className="prompt-box__ctx">
                      <Icon name="psychology" size={14} />
                      {t('compose.contextAware')}
                    </span>
                    <button className="btn btn--primary" type="button" onClick={handleGenerate} disabled={generating}>
                      {generating ? <Icon name="progress_activity" size={14} className="spin" /> : null}
                      {generating ? t('compose.generating') : t('compose.generate')}
                      <kbd className="kbd">↵</kbd>
                    </button>
                  </div>
                </div>
              </div>

              <div className="copilot__section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="card__label">{t('compose.synthesis')}</span>
                  <span className="t-kbd" style={{ color: 'var(--tertiary)' }}>
                    {applied ? t('compose.applied', { pct: 100 }) : t('compose.alignment', { pct: '98.4' })}
                  </span>
                </div>
                <div className="synthesis">
                  <span className="synthesis__tag">
                    <Icon name="tune" size={13} />
                    {t('compose.synthesisTag', { tone: t(tone) })}
                  </span>
                  <div className="diff">
                    <del>We are currently waiting on lawyer feedback.</del>{' '}
                    <ins>Our outside legal team at Gunderson has finalized their line-by-line review of Section 4.2.</ins>
                  </div>
                  <div className="diff">
                    <ins>Tomorrow at 2:00 PM PST works perfectly for the founder call.</ins>
                  </div>
                </div>
              </div>

              <div className="copilot__section">
                <span className="card__label">{t('compose.manipulations')}</span>
                <div className="micro-actions">
                  <button className="micro-btn" type="button" onClick={() => replaceBody(bodyValue.trim())}>
                    <Icon name="compress" size={14} />
                    {t('compose.shorter')}
                  </button>
                  <button
                    className="micro-btn"
                    type="button"
                    onClick={() => replaceBody(`${bodyValue}\n\nTomorrow at 10:30 AM – 10:45 AM also works.`)}
                  >
                    <Icon name="calendar_add_on" size={14} />
                    {t('compose.insertSlots')}
                  </button>
                  <button className="micro-btn" type="button">
                    <Icon name="verified_user" size={14} />
                    {t('compose.sla')}
                  </button>
                </div>
              </div>
            </div>

            <div className="copilot__foot">
              <span>
                {t('compose.pressTab')}
              </span>
              <button className="btn btn--primary" type="button" onClick={() => replaceBody(COPILOT_DRAFT)}>
                <Icon name="input" size={16} />
                {t('compose.apply')}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="composer__foot">
          <div className="send-group">
            <div className="send-split">
              <button
                className="send-btn"
                type="button"
                onClick={() => void send()}
                disabled={sending}
              >
                <Icon name="send" size={16} />
                {sending && <Icon name="progress_activity" size={16} className="spin" />}
                {t(sending ? 'compose.sending' : 'compose.sendNow')}
                <kbd className="kbd">⌘↵</kbd>
              </button>
              <TooltipButton className="send-caret" type="button" title={t('compose.sendingOptions')} disabled>
                <Icon name="arrow_drop_down" size={16} />
              </TooltipButton>
            </div>
            {copilot && (
              <button className="tool-btn" type="button">
                <Icon name="schedule_send" size={16} />
                {t('compose.sendTomorrow')}
              </button>
            )}
          </div>

          <div className="composer__foot-right">
            {copilot && (
              <>
                <span>
                  <Icon name="security" size={16} />
                  {t('compose.zeroKnowledge')}
                </span>
                <span className="vsep" />
              </>
            )}
            <button className="tool-btn btn--danger" type="button" onClick={() => void discard()} disabled={sending}>
              <Icon name="delete" size={16} />
              {t('common.discard')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
