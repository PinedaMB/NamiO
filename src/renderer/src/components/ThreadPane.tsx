import { useFormatCombo } from '../settings/ShortcutsProvider'
import { useEffect, useState } from 'react'
import type { BodyTheme } from '@shared/ipc'
import logo from '../assets/logo.png'
import { SenderAvatar } from './SenderAvatar'
import { TooltipButton } from './Tooltip'
import type { Attachment, Message, Thread } from '../data/demo'
import { formatMessageDateTime } from '../lib/dates'
import { useI18n } from '../i18n'
import { usePreferences } from '../settings/PreferencesProvider'
import { type Bindings } from '../settings/shortcuts'
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
  /** Hay cuenta real: archivar, eliminar y leído aplican sobre el servidor. */
  canMutate: boolean
  mailbox: string
  spam: boolean
  unread: boolean
  onToggleContext: () => void
  onArchive: () => void
  onToggleRead: () => void
  deleting?: boolean
  onDelete: () => void
  onEmptyFolder?: () => void
  onStar: () => void
  onReply: () => void
  onQuickDraft: () => void
  savingAttachment?: { mailbox: string; messageId: string; index: number } | null
  onOpenAttachment: (index: number, messageId?: string) => void
  onPrev: () => void
  onNext: () => void
  onBack: () => void
}

const ATTACHMENT_ICON: Record<Attachment['kind'], { icon: string; tone: string }> = {
  text: { icon: 'article', tone: 'var(--on-surface-variant)' },
  image: { icon: 'image', tone: 'var(--primary)' },
  pdf: { icon: 'picture_as_pdf', tone: 'var(--primary)' },
  sheet: { icon: 'table_chart', tone: 'var(--tertiary)' },
  calendar: { icon: 'event', tone: 'var(--secondary)' },
  file: { icon: 'description', tone: 'var(--on-surface-variant)' }
}

function Body({ message, theme }: { message: Message; theme: BodyTheme }): React.JSX.Element {
  const { t } = useI18n()

  if (message.partial) {
    return (
      <div className={cx('body', theme === 'light' && 'body--light')}>
        <p style={{ color: theme === 'light' ? '#555555' : 'var(--outline)' }}>{t('offline.bodyUnavailable')}</p>
      </div>
    )
  }

  const before = message.body.slice(0, 2)
  const after = message.body.slice(2)

  return (
    <div className={cx('body', theme === 'light' && 'body--light')}>
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
          <span style={{ color: theme === 'light' ? '#555555' : 'var(--outline)' }}>{message.signature.place}</span>
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
  spam,
  mailbox,
  unread,
  onToggleContext,
  onArchive,
  onToggleRead,
  onDelete,
  onEmptyFolder,
  deleting = false,
  onStar,
  onReply,
  onQuickDraft,
  onOpenAttachment,
  savingAttachment = null,
  onPrev,
  onNext,
  onBack
}: ThreadPaneProps): React.JSX.Element {
  const formatCombo = useFormatCombo()
  const { t, locale } = useI18n()
  const { bodyTheme: preferredTheme } = usePreferences()
  const themeKey = `${mailbox}:${thread.id}:${preferredTheme}`
  const [themeOverride, setThemeOverride] = useState<{ key: string; theme: BodyTheme } | null>(null)
  const bodyTheme = themeOverride?.key === themeKey ? themeOverride.theme : preferredTheme
  useEffect(() => { setThemeOverride(null) }, [themeKey])
  const message = thread.messages[0]
  const from = message?.from

  return (
    <main className="reading" aria-label={thread.subject}>
      <div className="reading__toolbar">
        <div className="toolbar-group">
          <TooltipButton className="tool-btn tool-btn--icon reading__back" type="button" onClick={onBack} title={t('thread.backToList')}>
            <Icon name="arrow_back" size={18} />
          </TooltipButton>
          <TooltipButton
            className="tool-btn tool-btn--icon"
            type="button"
            onClick={onToggleRead}
            disabled={!canMutate}
            title={`${unread ? t('common.markRead') : t('common.markUnread')} (${formatCombo(bindings.read)})`}
          >
            <Icon name={unread ? 'mark_email_read' : 'mark_email_unread'} size={15} />
          </TooltipButton>
          <TooltipButton
            className="tool-btn"
            type="button"
            onClick={onArchive}
            disabled={!canMutate}
            title={canMutate ? `${t('common.archive')} (${formatCombo(bindings.archive)})` : t('toast.readOnly')}
          >
            <Icon name="archive" size={15} />
            {t('common.archive')}
            <kbd className="kbd">{formatCombo(bindings.archive)}</kbd>
          </TooltipButton>
          <TooltipButton className="tool-btn" type="button" disabled title={t('common.move')}>
            <Icon name="drive_file_move" size={15} />
            {t('common.move')}
          </TooltipButton>
          <TooltipButton className="tool-btn tool-btn--icon btn--danger" type="button" disabled title={t('common.spam')}>
            <Icon name="report" size={15} />
          </TooltipButton>
          <TooltipButton
            className="tool-btn tool-btn--icon btn--danger"
            type="button"
            onClick={onDelete}
            disabled={!canMutate}
            title={t(deleting ? 'common.deleting' : 'common.delete')}
            aria-busy={deleting}
          >
            <Icon name={deleting ? 'progress_activity' : 'delete'} size={15} className={deleting ? 'spin' : undefined} />
            {deleting && <span role="status">{t('common.deleting')}</span>}
          </TooltipButton>
          {onEmptyFolder && (
            <TooltipButton className="tool-btn tool-btn--icon btn--danger" type="button" onClick={onEmptyFolder} disabled={!canMutate} title={t('context.emptyFolder')}>
              <Icon name="delete_sweep" size={15} />
            </TooltipButton>
          )}
        </div>

        <div className="toolbar-group">
          <span className="reading__count">{t('thread.threadOf', { n: position, total })}</span>
          <TooltipButton className="tool-btn tool-btn--icon" type="button" onClick={onPrev} title={t('thread.previous')}>
            <Icon name="chevron_left" size={16} />
          </TooltipButton>
          <TooltipButton className="tool-btn tool-btn--icon" type="button" onClick={onNext} title={t('thread.next')}>
            <Icon name="chevron_right" size={16} />
          </TooltipButton>
          {canToggleContext && (
            <>
              <span className="vsep ctx-toggle" style={{ margin: '0 4px' }} />
              <TooltipButton
                className={cx('tool-btn tool-btn--icon', 'ctx-toggle', !contextOpen && 'tool-btn--active')}
                type="button"
                onClick={onToggleContext}
                title={contextOpen ? t('thread.hideContext') : t('thread.showContext')}
                aria-expanded={contextOpen}
                aria-controls="context-rail"
              >
                <Icon name={contextOpen ? 'right_panel_close' : 'right_panel_open'} size={16} />
              </TooltipButton>
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
              <TooltipButton
                className="icon-btn"
                type="button"
                onClick={() => setThemeOverride({ key: themeKey, theme: bodyTheme === 'dark' ? 'light' : 'dark' })}
                title={bodyTheme === 'dark' ? t('mail.bodyThemeLight') : t('mail.bodyThemeDark')}
                aria-label={bodyTheme === 'dark' ? t('mail.bodyThemeLight') : t('mail.bodyThemeDark')}
                aria-pressed={bodyTheme === 'dark'}
              >
                <Icon name={bodyTheme === 'dark' ? 'light_mode' : 'dark_mode'} size={16} />
              </TooltipButton>
              <TooltipButton
                className="icon-btn"
                type="button"
                onClick={onStar}
                disabled={!canMutate}
                title={canMutate ? (thread.starred ? t('thread.unstar') : t('thread.star')) : t('toast.readOnly')}
                aria-pressed={thread.starred}
              >
                <Icon name="star" size={16} fill={thread.starred} />
              </TooltipButton>
            </div>
          </div>

          {!message ? (
            <div className="letter-loading">
              <Icon name="progress_activity" size={18} className="spin" />
              {t('thread.loading')}
            </div>
          ) : (
            [...thread.messages].reverse().map((message, messageIndex) => {
              const from = message.from
              const toLine = message.to.map(person => person.email).join(', ')
              const ccLine = message.cc?.map(person => person.email).join(', ')
              return (
              <details className="thread-message" key={message.id} open={messageIndex === 0}>
              <summary className="participants">
                <div className="participants__top">
                  <div className="participants__who">
                    <SenderAvatar email={from?.email ?? ''} initials={from?.initials ?? '??'} mailbox={mailbox} blocked={spam} className="avatar--lg avatar--accent" />
                    <div>
                      <div className="participants__name">
                        <span className="t-headline-sm">{from?.name}</span>
                        <span className="participants__addr">&lt;{from?.email}&gt;</span>
                      </div>
                      <div className="participants__to">
                        <span>{t('thread.to')}</span>
                        <span className="participants__recipients" title={toLine}>{toLine}</span>
                      </div>
                      {ccLine && <div className="participants__to">
                        <span>{t('compose.cc')}</span>
                        <span className="participants__recipients" title={ccLine}>{ccLine}</span>
                      </div>}
                    </div>
                  </div>

                  <div className="participants__right">
                    {message.priority && message.priority !== 'normal' && <span className={cx('mail-priority', message.priority === 'high' && 'mail-priority--high')}>
                      <Icon name={message.priority === 'high' ? 'priority_high' : 'arrow_downward'} size={16} />
                      {t(message.priority === 'high' ? 'mail.priorityHigh' : 'mail.priorityLow')}
                    </span>}
                    <span>{message.date !== undefined ? formatMessageDateTime(message.date, locale) : message.sentAt}</span>
                    <span className="participants__tls">
                      <span className="dot" />
                      {t('thread.encrypted')}
                    </span>
                  </div>
                  <Icon name="expand_more" size={20} className="thread-message__chevron" />
                </div>

              </summary>

                {message.attachments && message.attachments.length > 0 && (
                  <details className="thread-message__files">
                    <summary className="thread-message__files-label">
                      <Icon name="attach_file" size={16} />
                      <span>{t('thread.attachments')} · {message.attachments.length}</span>
                      <Icon name="expand_more" size={18} className="thread-message__files-chevron" />
                    </summary>
                  <div className="attachments" aria-label={t('thread.attachments')}>
                    {message.attachments.map((attachment, index) => {
                      const meta = ATTACHMENT_ICON[attachment.kind]
                      const saving = savingAttachment?.mailbox === mailbox && savingAttachment.messageId === message.id && savingAttachment.index === index
                      return (
                        <TooltipButton
                          key={`${attachment.name}-${index}`}
                          className="attachment"
                          type="button"
                          title={t(saving ? 'attachment.preparing' : ['image', 'pdf', 'text'].includes(attachment.kind) ? 'document.preview' : 'thread.download')}
                          disabled={savingAttachment !== null}
                          aria-busy={saving}
                          onClick={() => onOpenAttachment(index, message.id)}
                        >
                          <Icon name={saving ? 'progress_activity' : meta.icon} size={18} className={saving ? 'attachment__icon spin' : 'attachment__icon'} />
                          <span className="attachment__meta">
                            <span className="attachment__name">{attachment.name}</span>
                            <span className="attachment__detail">
                              {saving ? t('attachment.preparing') : `${attachment.size} · ${attachment.detail}`}
                            </span>
                          </span>
                          <Icon name="download" size={15} />
                        </TooltipButton>
                      )
                    })}
                  </div>
                  </details>
                )}

              {message.html ? <EmailBody html={message.html} blockRemote={spam} theme={bodyTheme} /> : <Body message={message} theme={bodyTheme} />}
              </details>
              )
            })
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

export function ThreadPaneEmpty({ label, loading = false, bindings, onCompose, onSearch, onSettings }: {
  label?: string
  loading?: boolean
  bindings: Bindings
  onCompose: () => void
  onSearch: () => void
  onSettings: () => void
}): React.JSX.Element {
  const formatCombo = useFormatCombo()
  const { t } = useI18n()
  return (
    <main className="reading" aria-label={t('thread.select')}>
      <div className="reading__scroll reading__welcome-scroll">
        {loading ? (
          <div className="letter-loading" role="status">
            <Icon name="progress_activity" size={18} className="spin" />
            {t('list.loading')}
          </div>
        ) : (
          <section className="mail-welcome" aria-labelledby="mail-welcome-title">
            <img className="mail-welcome__logo" src={logo} alt="" width={56} height={56} />
            <h1 id="mail-welcome-title">{t('welcome.title')}</h1>
            <p className="mail-welcome__hint">{t('welcome.hint')}</p>
            <div className="mail-welcome__actions">
              {[
                { icon: 'edit_square', label: t('welcome.compose'), shortcut: bindings.compose, action: onCompose },
                { icon: 'search', label: t('welcome.search'), shortcut: bindings.palette, action: onSearch },
                { icon: 'settings', label: t('welcome.settings'), shortcut: bindings.settings, action: onSettings }
              ].map(item => (
                <button key={item.icon} type="button" className="mail-welcome__action" data-primary={item.icon === 'edit_square' || undefined} onClick={item.action}>
                  <Icon name={item.icon} size={19} />
                  <span className="mail-welcome__action-label">{item.label}</span>
                  <kbd className="kbd">{formatCombo(item.shortcut)}</kbd>
                </button>
              ))}
            </div>
            <p className="mail-welcome__footer">{label ?? t('thread.select')}</p>
          </section>
        )}
      </div>
    </main>
  )
}
