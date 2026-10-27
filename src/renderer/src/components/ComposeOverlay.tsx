import { TooltipButton } from './Tooltip'
import { useEffect, useState } from 'react'
import type { PickedAttachment } from '@shared/ipc'
import { COPILOT_DRAFT } from '../data/demo'
import { useI18n, type TranslationKey } from '../i18n'
import { usePresence } from '../lib/usePresence'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface ComposeOverlayProps {
  open: boolean
  to: string
  subject: string
  body: string
  /** El copiloto y los adjuntos de ejemplo son de la demo, no de una cuenta real. */
  copilot?: boolean
  onClose: (values?: { to: string; subject: string; body: string }) => void
  onSend: (payload: { to: string; subject: string; body: string; attachments: PickedAttachment[] }) => void
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
  copilot = true,
  onClose,
  onSend,
  onPickAttachments
}: ComposeOverlayProps): React.JSX.Element | null {
  const { t } = useI18n()
  const { mounted, closing } = usePresence(open, 140)
  const [recipients, setRecipients] = useState<readonly string[]>(to ? [to] : [])
  const [draftRecipient, setDraftRecipient] = useState('')
  const [subjectValue, setSubjectValue] = useState(subject)
  const [bodyValue, setBodyValue] = useState(body)
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
    setRecipients(to ? [to] : [])
    setDraftRecipient('')
    setSubjectValue(subject)
    setBodyValue(body)
    setApplied(false)
    setGenerating(false)
    setPicked([])
    // Los adjuntos de ejemplo solo existen en la demo.
    setAttachments(
      copilot
        ? [
            { name: 'Executed_Addendum_v3.pdf', detail: '248 KB · Signed with DocuSign', icon: 'picture_as_pdf' },
            { name: 'Calendar Invite: Series A Sync', detail: 'Tomorrow, 2:00 PM – 2:30 PM PST', icon: 'event' }
          ]
        : []
    )
  }, [open, to, subject, body, copilot])

  const addRecipient = (): void => {
    const value = draftRecipient.trim().replace(/,$/, '')
    if (value === '' || recipients.includes(value)) {
      setDraftRecipient('')
      return
    }
    setRecipients((current) => [...current, value])
    setDraftRecipient('')
  }

  // Escape cierra guardando el borrador; en captura para adelantarse al atajo global.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onClose({ to: recipients.join(', '), subject: subjectValue, body: bodyValue })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, recipients, subjectValue, bodyValue, onClose])

  if (!mounted) return null

  const handleGenerate = (): void => {
    setGenerating(true)
    window.setTimeout(() => {
      setGenerating(false)
      setBodyValue(COPILOT_DRAFT)
      setApplied(true)
    }, 650)
  }

  const closeWithDraft = (): void => {
    onClose({ to: recipients.join(', '), subject: subjectValue, body: bodyValue })
  }

  return (
    <div
      className={cx('overlay overlay--center', closing && 'overlay--closing')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeWithDraft()
      }}
    >
      <div className="composer" role="dialog" aria-modal="true" aria-label={t('compose.newMessage')}>
        <div className="composer__head">
          <div className="composer__title">
            <Icon name="edit_square" size={18} className="composer__title-icon" />
            <span>{subjectValue || t('compose.newMessage')}</span>
            {subjectValue.startsWith('Re:') && copilot && (
              <span className="chip">{t('compose.threadId')}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-sm)' }}>
            <TooltipButton className="icon-btn" type="button" title={t('compose.minimize')}>
              <Icon name="remove" size={16} />
            </TooltipButton>
            <TooltipButton className="icon-btn" type="button" title={t('compose.expand')}>
              <Icon name="open_in_full" size={16} />
            </TooltipButton>
            <TooltipButton className="icon-btn" type="button" onClick={closeWithDraft} title={t('common.close')}>
              <Icon name="close" size={16} />
            </TooltipButton>
          </div>
        </div>

        <div className="composer__fields">
          <div className="field-row">
            <span className="field-label">{t('compose.to')}</span>
            <div className="field-values">
              {recipients.map((address) => (
                <span key={address} className="recipient">
                  <span className="avatar" style={{ width: 16, height: 16, fontSize: 9 }}>
                    {address.slice(0, 2).toUpperCase()}
                  </span>
                  <strong>{address}</strong>
                  <TooltipButton
                    type="button"
                    title={t('compose.removeRecipient')}
                    onClick={() => setRecipients((current) => current.filter((item) => item !== address))}
                  >
                    <Icon name="close" size={12} />
                  </TooltipButton>
                </span>
              ))}
              <input
                className="input-bare"
                value={draftRecipient}
                onChange={(event) => setDraftRecipient(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    addRecipient()
                  }
                }}
                onBlur={addRecipient}
                placeholder={recipients.length === 0 ? t('compose.addRecipient') : t('compose.addAnother')}
                aria-label={t('compose.to')}
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-sm)' }}>
              <button className="tool-btn" type="button" onClick={() => setCcOpen((value) => !value)}>
                {t('compose.cc')}
              </button>
              <button className="tool-btn" type="button" onClick={() => setCcOpen((value) => !value)}>
                {t('compose.bcc')}
              </button>
            </div>
          </div>

          {ccOpen && (
            <div className="field-row">
              <span className="field-label">{t('compose.cc')}</span>
              <div className="field-values">
                <span className="recipient">
                  <strong>David Sterling</strong>
                  <span>&lt;dsterling@gunderson.com&gt;</span>
                </span>
                <input className="input-bare" placeholder={t('compose.addRecipient')} aria-label={t('compose.cc')} />
              </div>
            </div>
          )}

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

        <div className={cx('composer__split', !copilot && 'composer__split--solo')}>
          <div className="editor">
            <div className="formatbar">
              <div className="formatbar__tools">
                <TooltipButton className="icon-btn" type="button" title="Bold (⌘B)">
                  <Icon name="format_bold" size={16} />
                </TooltipButton>
                <TooltipButton className="icon-btn" type="button" title="Italic (⌘I)">
                  <Icon name="format_italic" size={16} />
                </TooltipButton>
                <TooltipButton className="icon-btn" type="button" title="Insert link (⌘K)">
                  <Icon name="link" size={16} />
                </TooltipButton>
                <TooltipButton className="icon-btn" type="button" title="Code block">
                  <Icon name="code" size={16} />
                </TooltipButton>
                <span className="formatbar__sep" />
                <TooltipButton className="icon-btn" type="button" title="Bullet list">
                  <Icon name="format_list_bulleted" size={16} />
                </TooltipButton>
                <TooltipButton className="icon-btn" type="button" title="Numbered list">
                  <Icon name="format_list_numbered" size={16} />
                </TooltipButton>
                <TooltipButton
                  className="icon-btn"
                  type="button"
                  title={t('compose.attach')}
                  onClick={() => {
                    if (!onPickAttachments) return
                    void onPickAttachments().then((files) => {
                      if (files.length > 0) setPicked((current) => [...current, ...files])
                    })
                  }}
                  disabled={!onPickAttachments}
                >
                  <Icon name="attach_file" size={16} />
                </TooltipButton>
                <span className="formatbar__sep" />
                <button className="snippet-btn" type="button">
                  <Icon name="auto_stories" size={14} />
                  {t('compose.snippets')}
                </button>
              </div>
              <span className="t-kbd" style={{ color: 'var(--outline)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {copilot && (
                  <>
                    <Icon name="cloud_done" size={14} style={{ color: 'var(--tertiary)' }} />
                    {t('compose.autosaved')}
                  </>
                )}
              </span>
            </div>

            <div className="composer__body">
              <textarea
                className="editor__area"
                value={bodyValue}
                onChange={(event) => setBodyValue(event.target.value)}
                placeholder={t('compose.placeholder')}
                spellCheck
                aria-label={t('compose.placeholder')}
              />

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
            </div>
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
                  <button className="micro-btn" type="button" onClick={() => setBodyValue(bodyValue.trim())}>
                    <Icon name="compress" size={14} />
                    {t('compose.shorter')}
                  </button>
                  <button
                    className="micro-btn"
                    type="button"
                    onClick={() => setBodyValue(`${bodyValue}\n\nTomorrow at 10:30 AM – 10:45 AM also works.`)}
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
              <button className="btn btn--primary" type="button" onClick={() => setBodyValue(COPILOT_DRAFT)}>
                <Icon name="input" size={16} />
                {t('compose.apply')}
              </button>
            </div>
          </div>
        </div>

        <div className="composer__foot">
          <div className="send-group">
            <div className="send-split">
              <button
                className="send-btn"
                type="button"
                onClick={() =>
                  onSend({
                    to: recipients.join(', '),
                    subject: subjectValue,
                    body: bodyValue,
                    attachments: picked
                  })
                }
              >
                <Icon name="send" size={16} />
                {t('compose.sendNow')}
                <kbd className="kbd">⌘↵</kbd>
              </button>
              <TooltipButton className="send-caret" type="button" title={t('compose.sendingOptions')}>
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
            <button className="tool-btn btn--danger" type="button" onClick={closeWithDraft}>
              <Icon name="delete" size={16} />
              {t('common.discard')}
              <kbd className="kbd">Esc</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
