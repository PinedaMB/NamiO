import type { Attachment, Message, Thread } from '../data/demo'
import { useI18n } from '../i18n'
import { formatCombo, type Bindings } from '../settings/shortcuts'
import { EmailBody } from './EmailBody'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface ThreadPaneProps {
  thread: Thread
  position: number
  total: number
  bindings: Bindings
  contextOpen: boolean
  canToggleContext: boolean
  /** En modo real todavía no hay caché local: archivar/eliminar no aplican. */
  canMutate: boolean
  onToggleContext: () => void
  onArchive: () => void
  onSnooze: () => void
  onDelete: () => void
  onStar: () => void
  onReply: () => void
  onQuickDraft: () => void
  onPrev: () => void
  onNext: () => void
}

const ATTACHMENT_ICON: Record<Attachment['kind'], { icon: string; tone: string }> = {
  pdf: { icon: 'picture_as_pdf', tone: 'var(--primary)' },
  sheet: { icon: 'table_chart', tone: 'var(--tertiary)' },
  calendar: { icon: 'event', tone: 'var(--secondary)' },
  file: { icon: 'description', tone: 'var(--on-surface-variant)' }
}

function Body({ message }: { message: Message }): React.JSX.Element {
  const { t } = useI18n()

  if (message.partial) {
    return (
      <div className="body">
        <p style={{ color: 'var(--outline)' }}>{t('offline.bodyUnavailable')}</p>
      </div>
    )
  }

  const before = message.body.slice(0, 2)
  const after = message.body.slice(2)

  return (
    <div className="body">
      {before.map((paragraph, index) => (
        <p key={`lead-${index}`}>{paragraph}</p>
      ))}

      {message.summary && (
        <div className="body__bullets">
          <span className="body__bullets-title">{message.summary.title}</span>
          <ul>
            {message.summary.bullets.map((bullet) => {
              const [head, ...rest] = bullet.split(':')
              return (
                <li key={bullet}>
                  <span>
                    <strong>{head}:</strong>
                    {rest.join(':')}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {after.map((paragraph, index) => (
        <p key={`tail-${index}`}>{paragraph}</p>
      ))}

      {message.signature && (
        <div className="signature">
          <strong>{message.signature.name}</strong>
          <span>{message.signature.role}</span>
          <span style={{ color: 'var(--outline)' }}>{message.signature.place}</span>
        </div>
      )}
    </div>
  )
}

export function ThreadPane({
  thread,
  position,
  total,
  bindings,
  contextOpen,
  canToggleContext,
  canMutate,
  onToggleContext,
  onArchive,
  onSnooze,
  onDelete,
  onStar,
  onReply,
  onQuickDraft,
  onPrev,
  onNext
}: ThreadPaneProps): React.JSX.Element {
  const { t } = useI18n()
  const message = thread.messages[0]
  const from = message?.from
  const recipients = (message?.to ?? []).map((person) => person.email)
  const toLine = [`me <${recipients[0] ?? ''}>`, ...recipients.slice(1)].join(', ')

  return (
    <main className="reading" aria-label={thread.subject}>
      <div className="reading__toolbar">
        <div className="toolbar-group">
          <button
            className="tool-btn"
            type="button"
            onClick={onArchive}
            disabled={!canMutate}
            title={canMutate ? `${t('common.archive')} (${formatCombo(bindings.archive)})` : t('toast.readOnly')}
          >
            <Icon name="archive" size={15} />
            {t('common.archive')}
            <kbd className="kbd">{formatCombo(bindings.archive)}</kbd>
          </button>
          <button
            className="tool-btn"
            type="button"
            onClick={onSnooze}
            disabled={!canMutate}
            title={canMutate ? `${t('common.snooze')} (${formatCombo(bindings.snooze)})` : t('toast.readOnly')}
          >
            <Icon name="schedule" size={15} />
            {t('common.snooze')}
            <kbd className="kbd">{formatCombo(bindings.snooze)}</kbd>
          </button>
          <button className="tool-btn" type="button" disabled={!canMutate} title={t('common.move')}>
            <Icon name="drive_file_move" size={15} />
            {t('common.move')}
          </button>
          <button className="tool-btn tool-btn--icon btn--danger" type="button" disabled={!canMutate} title={t('common.spam')}>
            <Icon name="report" size={15} />
          </button>
          <button
            className="tool-btn tool-btn--icon btn--danger"
            type="button"
            onClick={onDelete}
            disabled={!canMutate}
            title={t('common.delete')}
          >
            <Icon name="delete" size={15} />
          </button>
        </div>

        <div className="toolbar-group">
          <span className="reading__count">{t('thread.threadOf', { n: position, total })}</span>
          <button className="tool-btn tool-btn--icon" type="button" onClick={onPrev} title={t('thread.previous')}>
            <Icon name="chevron_left" size={16} />
          </button>
          <button className="tool-btn tool-btn--icon" type="button" onClick={onNext} title={t('thread.next')}>
            <Icon name="chevron_right" size={16} />
          </button>
          {canToggleContext && (
            <>
              <span className="vsep ctx-toggle" style={{ margin: '0 4px' }} />
              <button
                className={cx('tool-btn tool-btn--icon', 'ctx-toggle', !contextOpen && 'tool-btn--active')}
                type="button"
                onClick={onToggleContext}
                title={contextOpen ? t('thread.hideContext') : t('thread.showContext')}
                aria-expanded={contextOpen}
                aria-controls="context-rail"
              >
                <Icon name={contextOpen ? 'right_panel_close' : 'right_panel_open'} size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="reading__scroll" key={thread.id}>
        <article className="letter">
          <div className="letter__head">
            <h1 className="letter__subject">{thread.subject}</h1>
            <div className="letter__badges">
              {thread.vip && (
                <span className="badge-secure">
                  <Icon name="verified" size={12} fill />
                  {from?.org ?? 'VIP'}
                </span>
              )}
              <button
                className="icon-btn"
                type="button"
                onClick={onStar}
                disabled={!canMutate}
                title={canMutate ? (thread.starred ? t('thread.unstar') : t('thread.star')) : t('toast.readOnly')}
                aria-pressed={thread.starred}
              >
                <Icon name="star" size={16} fill={thread.starred} />
              </button>
            </div>
          </div>

          {!message ? (
            <div className="letter-loading">
              <Icon name="progress_activity" size={18} className="spin" />
              {t('thread.loading')}
            </div>
          ) : (
            <>
              <div className="participants">
                <div className="participants__top">
                  <div className="participants__who">
                    <span className="avatar avatar--lg avatar--accent">{from?.initials ?? '??'}</span>
                    <div>
                      <div className="participants__name">
                        <span className="t-headline-sm">{from?.name}</span>
                        <span className="participants__addr">&lt;{from?.email}&gt;</span>
                      </div>
                      <div className="participants__to">
                        <span>{t('thread.to')}</span>
                        <span style={{ color: 'var(--on-surface)', fontWeight: 500 }}>{toLine}</span>
                      </div>
                    </div>
                  </div>

                  <div className="participants__right">
                    <span>{message.sentAt}</span>
                    <span className="participants__tls">
                      <span className="dot" />
                      {t('thread.encrypted')}
                    </span>
                  </div>
                </div>

                {message.attachments && message.attachments.length > 0 && (
                  <div className="attachments" aria-label={t('thread.attachments')}>
                    {message.attachments.map((attachment) => {
                      const meta = ATTACHMENT_ICON[attachment.kind]
                      return (
                        <a
                          key={attachment.name}
                          className="attachment"
                          href="#archivo"
                          title={t('thread.download')}
                          onClick={(event) => event.preventDefault()}
                        >
                          <Icon name={meta.icon} size={18} className="attachment__icon" />
                          <span className="attachment__meta">
                            <span className="attachment__name">{attachment.name}</span>
                            <span className="attachment__detail">
                              {attachment.size} · {attachment.detail}
                            </span>
                          </span>
                          <Icon name="download" size={15} />
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>

              {message.html ? <EmailBody html={message.html} /> : <Body message={message} />}
            </>
          )}

          <div className="quick-reply">
            <div className="quick-reply__hint">
              <span className="quick-reply__own">
                <Icon name="reply" size={16} />
              </span>
              <span>{t('thread.replyHint', { key: formatCombo(bindings.reply) })}</span>
            </div>
            <div className="quick-reply__actions">
              <button className="tool-btn" type="button" onClick={onQuickDraft}>
                <Icon name="bolt" size={14} />
                {t('thread.quickDraft')}
              </button>
              <button className="btn btn--primary" type="button" onClick={onReply}>
                {t('common.reply')}
              </button>
            </div>
          </div>
        </article>
      </div>
    </main>
  )
}

export function ThreadPaneEmpty({ label }: { label?: string }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <main className="reading" aria-label={t('thread.select')}>
      <div className="reading__scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="muted">{label ?? t('thread.select')}</p>
      </div>
    </main>
  )
}
