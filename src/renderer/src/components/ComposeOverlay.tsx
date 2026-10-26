import { useEffect, useState } from 'react'
import { COPILOT_DRAFT } from '../data/demo'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface ComposeOverlayProps {
  open: boolean
  to: string
  subject: string
  body: string
  onClose: () => void
  onSend: (payload: { to: string; subject: string; body: string }) => void
}

const TONES = ['Direct & Concise', 'Warm Professional', 'Executive Brief', 'Legal Precise'] as const

export function ComposeOverlay({
  open,
  to,
  subject,
  body,
  onClose,
  onSend
}: ComposeOverlayProps): React.JSX.Element | null {
  const [recipients, setRecipients] = useState<readonly string[]>(to ? [to] : [])
  const [draftRecipient, setDraftRecipient] = useState('')
  const [subjectValue, setSubjectValue] = useState(subject)
  const [bodyValue, setBodyValue] = useState(body)
  const [ccOpen, setCcOpen] = useState(false)
  const [tone, setTone] = useState<(typeof TONES)[number]>('Direct & Concise')
  const [prompt, setPrompt] = useState(
    'Draft reply accepting meeting for 2 PM PST, confirm outside legal review of Section 4.2 is complete, and attach the signed addendum.'
  )
  const [generating, setGenerating] = useState(false)
  const [applied, setApplied] = useState(false)
  const [attachments, setAttachments] = useState<ReadonlyArray<{ name: string; detail: string; icon: string }>>([
    { name: 'Executed_Addendum_v3.pdf', detail: '248 KB · Signed with DocuSign', icon: 'picture_as_pdf' },
    { name: 'Calendar Invite: Series A Sync', detail: 'Tomorrow, 2:00 PM – 2:30 PM PST', icon: 'event' }
  ])

  useEffect(() => {
    if (!open) return
    setRecipients(to ? [to] : [])
    setDraftRecipient('')
    setSubjectValue(subject)
    setBodyValue(body)
    setApplied(false)
    setGenerating(false)
  }, [open, to, subject, body])

  const addRecipient = (): void => {
    const value = draftRecipient.trim().replace(/,$/, '')
    if (value === '' || recipients.includes(value)) {
      setDraftRecipient('')
      return
    }
    setRecipients((current) => [...current, value])
    setDraftRecipient('')
  }

  if (!open) return null

  const handleGenerate = (): void => {
    setGenerating(true)
    window.setTimeout(() => {
      setGenerating(false)
      setBodyValue(COPILOT_DRAFT)
      setApplied(true)
    }, 650)
  }

  return (
    <div
      className="overlay overlay--center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="composer" role="dialog" aria-modal="true" aria-label="Redactar mensaje">
        <div className="composer__head">
          <div className="composer__title">
            <Icon name="edit_square" size={18} className="composer__title-icon" />
            <span>{subjectValue || 'New message'}</span>
            {subjectValue.startsWith('Re:') && <span className="chip">Thread ID: #SQ-984</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="icon-btn" type="button" title="Minimize">
              <Icon name="remove" size={16} />
            </button>
            <button className="icon-btn" type="button" title="Expand">
              <Icon name="open_in_full" size={16} />
            </button>
            <button className="icon-btn" type="button" onClick={onClose} title="Close (Esc)">
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        <div className="composer__fields">
          <div className="field-row">
            <span className="field-label">To</span>
            <div className="field-values">
              {recipients.map((address) => (
                <span key={address} className="recipient">
                  <span className="avatar" style={{ width: 16, height: 16, fontSize: 9 }}>
                    {address.slice(0, 2).toUpperCase()}
                  </span>
                  <strong>{address}</strong>
                  <button
                    type="button"
                    title="Remove recipient"
                    onClick={() => setRecipients((current) => current.filter((item) => item !== address))}
                  >
                    <Icon name="close" size={12} />
                  </button>
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
                placeholder={recipients.length === 0 ? 'Add recipients…' : 'Add another…'}
                aria-label="Recipients"
              />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="tool-btn" type="button" onClick={() => setCcOpen((value) => !value)}>
                Cc
              </button>
              <button className="tool-btn" type="button" onClick={() => setCcOpen((value) => !value)}>
                Bcc
              </button>
            </div>
          </div>

          {ccOpen && (
            <div className="field-row">
              <span className="field-label">Cc</span>
              <div className="field-values">
                <span className="recipient">
                  <strong>David Sterling</strong>
                  <span>&lt;dsterling@gunderson.com&gt;</span>
                </span>
                <input className="input-bare" placeholder="Add CC…" aria-label="CC" />
              </div>
            </div>
          )}

          <div className="field-row">
            <span className="field-label">Subject</span>
            <input
              className="subject-input"
              value={subjectValue}
              onChange={(event) => setSubjectValue(event.target.value)}
              aria-label="Subject"
            />
          </div>
        </div>

        <div className="composer__split">
          <div className="editor">
            <div className="formatbar">
              <div className="formatbar__tools">
                <button className="icon-btn" type="button" title="Bold (⌘B)">
                  <Icon name="format_bold" size={16} />
                </button>
                <button className="icon-btn" type="button" title="Italic (⌘I)">
                  <Icon name="format_italic" size={16} />
                </button>
                <button className="icon-btn" type="button" title="Insert link (⌘K)">
                  <Icon name="link" size={16} />
                </button>
                <button className="icon-btn" type="button" title="Code block">
                  <Icon name="code" size={16} />
                </button>
                <span className="formatbar__sep" />
                <button className="icon-btn" type="button" title="Bullet list">
                  <Icon name="format_list_bulleted" size={16} />
                </button>
                <button className="icon-btn" type="button" title="Numbered list">
                  <Icon name="format_list_numbered" size={16} />
                </button>
                <button className="icon-btn" type="button" title="Attach files">
                  <Icon name="attach_file" size={16} />
                </button>
                <span className="formatbar__sep" />
                <button className="snippet-btn" type="button">
                  <Icon name="auto_stories" size={14} />
                  ;snippets
                </button>
              </div>
              <span className="t-kbd" style={{ color: 'var(--outline)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="cloud_done" size={14} style={{ color: 'var(--tertiary)' }} />
                Draft autosaved
              </span>
            </div>

            <div className="composer__body">
              <textarea
                className="editor__area"
                value={bodyValue}
                onChange={(event) => setBodyValue(event.target.value)}
                placeholder="Write your message…"
                spellCheck
                aria-label="Message body"
              />

              <div className="composer__sign">
                <strong>Alex Rivera</strong>
                <span>Founder &amp; CEO, Veloce Labs</span>
              </div>

              <div className="attach-row">
                {attachments.map((attachment) => (
                  <span key={attachment.name} className="attach-pill">
                    <Icon name={attachment.icon} size={18} className="attach-pill__icon" />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="attach-pill__name">{attachment.name}</span>
                      <span className="attach-pill__detail">{attachment.detail}</span>
                    </span>
                    <button
                      type="button"
                      title="Remove attachment"
                      onClick={() => setAttachments((list) => list.filter((item) => item.name !== attachment.name))}
                    >
                      <Icon name="close" size={14} />
                    </button>
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
                  Veloce AI Copilot
                </span>
                <span className="chip chip--primary">Fast Lane 4.5</span>
              </div>

              <div className="copilot__section">
                <span className="card__label">Strategic Voice &amp; Tone</span>
                <div className="tone-grid">
                  {TONES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={cx('tone', tone === option && 'tone--active')}
                      onClick={() => setTone(option)}
                      aria-pressed={tone === option}
                    >
                      <span>{option}</span>
                      <span className="dot" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="copilot__section">
                <span className="card__label">Instruction Prompt</span>
                <div className="prompt-box">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={3}
                    aria-label="Copilot instruction"
                  />
                  <div className="prompt-box__foot">
                    <span className="prompt-box__ctx">
                      <Icon name="psychology" size={14} />
                      Context-aware
                    </span>
                    <button className="btn btn--primary" type="button" onClick={handleGenerate} disabled={generating}>
                      {generating ? <Icon name="progress_activity" size={14} className="spin" /> : null}
                      {generating ? 'Generating…' : 'Generate'}
                      <kbd className="kbd">↵</kbd>
                    </button>
                  </div>
                </div>
              </div>

              <div className="copilot__section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="card__label">Proposed Synthesis</span>
                  <span className="t-kbd" style={{ color: 'var(--tertiary)' }}>
                    {applied ? '100% applied' : '98.4% alignment'}
                  </span>
                </div>
                <div className="synthesis">
                  <span className="synthesis__tag">
                    <Icon name="tune" size={13} />
                    {tone} + Legal safeguards applied
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
                <span className="card__label">Quick Manipulations</span>
                <div className="micro-actions">
                  <button className="micro-btn" type="button" onClick={() => setBodyValue(bodyValue.trim())}>
                    <Icon name="compress" size={14} />
                    Make shorter
                  </button>
                  <button className="micro-btn" type="button" onClick={() => setBodyValue(`${bodyValue}\n\nTomorrow at 10:30 AM – 10:45 AM also works.`)}>
                    <Icon name="calendar_add_on" size={14} />
                    Insert free slots
                  </button>
                  <button className="micro-btn" type="button">
                    <Icon name="verified_user" size={14} />
                    Ensure SLA precision
                  </button>
                </div>
              </div>
            </div>

            <div className="copilot__foot">
              <span>
                Press <kbd className="kbd">Tab</kbd> to insert draft
              </span>
              <button className="btn btn--primary" type="button" onClick={() => setBodyValue(COPILOT_DRAFT)}>
                <Icon name="input" size={16} />
                Apply to Editor
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
                onClick={() => onSend({ to: recipients.join(', '), subject: subjectValue, body: bodyValue })}
              >
                <Icon name="send" size={16} />
                Send Now
                <kbd className="kbd">⌘↵</kbd>
              </button>
              <button className="send-caret" type="button" title="Sending options">
                <Icon name="arrow_drop_down" size={16} />
              </button>
            </div>
            <button className="tool-btn" type="button">
              <Icon name="schedule_send" size={16} />
              Send Tomorrow 8:00 AM
            </button>
          </div>

          <div className="composer__foot-right">
            <span>
              <Icon name="security" size={16} />
              Zero-Knowledge Retention Active
            </span>
            <span className="vsep" />
            <button className="tool-btn btn--danger" type="button" onClick={onClose}>
              <Icon name="delete" size={16} />
              Discard
              <kbd className="kbd">Esc</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
