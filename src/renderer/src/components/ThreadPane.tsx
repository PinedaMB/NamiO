import { ThreadCopilot } from './ThreadCopilot'
import { useFormatCombo } from '../settings/ShortcutsProvider'
import { useEffect, useRef, useState } from 'react'
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
import { RecipientsDialog } from './RecipientsDialog'
import type { ContextAnchor } from './ContextMenu'

interface ThreadPaneProps {
  onRetryMessage?: () => void
  thread: Thread
  focusedMessageId?: string | null
  position: number
  total: number
  bindings: Bindings
  readingFocused: boolean
  onToggleFocus: () => void
  contextOpen: boolean
  canToggleContext: boolean
  /** Hay cuenta real: archivar, eliminar y leído aplican sobre el servidor. */
  canMutate: boolean
  mailbox: string
  spam: boolean
  unread: boolean
  onToggleContext: () => void
  moving?: boolean
  onArchive: () => void
  onToggleRead: () => void
  deleting?: boolean
  onDelete: () => void
  onEmptyFolder?: () => void
  onStar: () => void
  onOptions: (anchor: ContextAnchor) => void
  optionsOpen: boolean
  onReplyAll: () => void
  onReply: () => void
  onQuickDraft: () => void
  ai?: boolean
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

function Body({ message, theme, onRetry }: { message: Message; theme?: BodyTheme; onRetry?: () => void }): React.JSX.Element {
  const { t } = useI18n()

  if (message.partial) {
    return (
      <div className={cx('body', theme && `body--${theme}`)}>
        <p style={{ color: theme === 'light' ? '#555555' : 'var(--outline)' }}>{t('offline.bodyUnavailable')}</p>
        {onRetry && <button className="tool-btn" type="button" onClick={onRetry}><Icon name="refresh" size={16} />{t('offline.retry')}</button>}
      </div>
    )
  }

  const before = message.body.slice(0, 2)
  const after = message.body.slice(2)

  return (
    <div className={cx('body', theme && `body--${theme}`)}>
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
  onRetryMessage,
  thread,
  focusedMessageId = null,
  position,
  total,
  bindings,
  readingFocused,
  onToggleFocus,
  contextOpen,
  canToggleContext,
  canMutate,
  spam,
  mailbox,
  unread,
  moving = false,
  onToggleContext,
  onArchive,
  onToggleRead,
  onDelete,
  onEmptyFolder,
  deleting = false,
  onStar,
  onOptions,
  optionsOpen,
  onReply,
  onReplyAll,
  onQuickDraft,
  ai = false,
  onOpenAttachment,
  savingAttachment = null,
  onPrev,
  onNext,
  onBack
}: ThreadPaneProps): React.JSX.Element {
  const formatCombo = useFormatCombo()
  const { t, locale } = useI18n()
  const { bodyTheme: preferredTheme, appTheme, timeFormat } = usePreferences()
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = (): void => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const appBodyTheme = appTheme ? (appTheme === 'dark' || (appTheme === 'system' && systemDark) ? 'dark' : 'light') : preferredTheme
  const themeKey = `${mailbox}:${thread.messageIds?.join(',') ?? thread.id}:${preferredTheme}:${appBodyTheme}`
  const [themeOverride, setThemeOverride] = useState<{ key: string; theme: BodyTheme } | null>(null)
  const bodyTheme = themeOverride?.key === themeKey ? themeOverride.theme : preferredTheme
  useEffect(() => { setThemeOverride(null) }, [themeKey])
  const [messageExpansion, setMessageExpansion] = useState<Record<string, boolean>>({})
  const focusedMessage = useRef<HTMLDetailsElement | null>(null)
  const focusedMessagePresent = thread.messages.some(message => message.id === focusedMessageId)
  useEffect(() => {
    if (!focusedMessageId || !focusedMessagePresent) return
    setMessageExpansion(current => ({ ...current, [`${mailbox}:${focusedMessageId}`]: true }))
    const frame = requestAnimationFrame(() => focusedMessage.current?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [mailbox, focusedMessageId, focusedMessagePresent])
  const [aiThread, setAiThread] = useState<{ key: string; open: boolean } | null>(null)
  const aiThreadKey = `${mailbox}:${thread.id}`
  const [recipientsId, setRecipientsId] = useState<string | null>(null)
  const recipientsMessage = thread.messages.find(message => message.id === recipientsId)

  return (
    <main className="reading" aria-label={thread.subject}>
      <div className="reading__toolbar">
        <div className="toolbar-group">
          {moving && <span className="mail-moving" role="status"><Icon name="progress_activity" size={16} className="spin" />{t('move.moving')}</span>}
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
            className="tool-btn tool-btn--icon"
            type="button"
            onClick={onArchive}
            disabled={!canMutate}
            title={canMutate ? `${t('common.archive')} (${formatCombo(bindings.archive)})` : t('toast.readOnly')}
          >
            <Icon name="archive" size={15} />
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
          {ai && <TooltipButton className="tool-btn" type="button" title={t('ai.threadTitle')} aria-expanded={aiThread?.key === aiThreadKey && aiThread.open} aria-controls="thread-copilot" onClick={() => setAiThread(current => ({ key: aiThreadKey, open: current?.key === aiThreadKey ? !current.open : true }))}><Icon name="auto_awesome" size={16} />{t('ai.threadTitle')}</TooltipButton>}
          <TooltipButton className="tool-btn tool-btn--icon" type="button" onClick={onToggleFocus} title={t(readingFocused ? 'thread.exitFocus' : 'thread.focus')} aria-pressed={readingFocused}>
            <Icon name={readingFocused ? 'left_panel_open' : 'left_panel_close'} size={18} />
          </TooltipButton>
          <span className="sr-only">{t('thread.threadOf', { n: position, total })}</span>
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

      <div className="reading__scroll" key={thread.messageIds?.join(',') ?? thread.id}>
        <article className="letter">
          <div className="letter__head">
            <h1 className="letter__subject">{thread.subject}</h1>
            <div className="letter__badges">
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

          {ai && aiThread?.key === aiThreadKey && <section hidden={!aiThread.open} id="thread-copilot" key={aiThreadKey} aria-label={t('ai.threadTitle')}><ThreadCopilot thread={thread} /></section>}

          {thread.messages.length === 0 ? (
            <div className="letter-loading">
              <Icon name="progress_activity" size={18} className="spin" />
              {t('thread.loading')}
            </div>
          ) : (
            [...thread.messages].reverse().map((message, messageIndex) => {
              const expansionKey = `${mailbox}:${message.id}`
              const expanded = messageExpansion?.[expansionKey] ?? (message.id === focusedMessageId || messageIndex === 0)
              const from = message.from
              return (
              <details className="thread-message" aria-current={message.id === focusedMessageId ? 'true' : undefined} key={message.id} ref={message.id === focusedMessageId ? focusedMessage : undefined} open={expanded} onToggle={event => {
                const open = event.currentTarget.open
                if (open !== expanded) setMessageExpansion(current => ({ ...current, [expansionKey]: open }))
              }}>
              <summary className="participants" onClick={event => {
                // Los botones del encabezado no deben plegar el mensaje.
                if ((event.target as HTMLElement | null)?.closest('button')) event.preventDefault()
              }}>
                <div className="participants__top">
                  <div className="participants__who">
                    <SenderAvatar email={from?.email ?? ''} initials={from?.initials ?? '??'} mailbox={message.mailbox ?? mailbox} blocked={spam || !thread.id.startsWith('live:')} className="avatar--lg" />
                    <div>
                      <div className="participants__name">
                        <span className="t-headline-sm">{from?.name}</span>
                        {message.mailbox && <span className="participants__sent">{t('thread.sent')}</span>}

                      </div>
                      <TooltipButton className="participants__details" type="button" title={t('recipients.title')} aria-haspopup="dialog"
                        onClick={event => { event.preventDefault(); event.stopPropagation(); setRecipientsId(message.id) }}>
                        {t('thread.details')}<Icon name="expand_more" size={14} />
                      </TooltipButton>
                    </div>
                  </div>

                  <div className="participants__right">
                    {message.priority && message.priority !== 'normal' && <span className={cx('mail-priority', message.priority === 'high' && 'mail-priority--high')}>
                      <Icon name={message.priority === 'high' ? 'priority_high' : 'arrow_downward'} size={16} />
                      {t(message.priority === 'high' ? 'mail.priorityHigh' : 'mail.priorityLow')}
                    </span>}
                    <span title={message.date !== undefined ? formatMessageDateTime(message.date, locale, false, timeFormat) : message.sentAt}>{message.date !== undefined ? formatMessageDateTime(message.date, locale, true, timeFormat) : message.sentAt}</span>

                  </div>
                  <div className="thread-message__actions">
                    {!message.mailbox && message.id === thread.messages.findLast(item => !item.mailbox)?.id && (
                      <TooltipButton
                        className="icon-btn"
                        type="button"
                        title={t('thread.moreOptions')}
                        aria-haspopup="menu"
                        aria-expanded={optionsOpen}
                        onClick={event => {
                          event.preventDefault()
                          event.stopPropagation()
                          const trigger = event.currentTarget
                          const bounds = trigger.getBoundingClientRect()
                          onOptions({ x: bounds.right, y: bounds.bottom, trigger })
                        }}
                      >
                        <Icon name="more_horiz" size={18} />
                      </TooltipButton>
                    )}
                    <TooltipButton
                      className="tool-btn thread-message__toggle"
                      title={t(expanded ? 'thread.collapseMessage' : 'thread.expandMessage')}
                      aria-label={t(expanded ? 'thread.collapseMessage' : 'thread.expandMessage')}
                      type="button"
                      aria-expanded={expanded}
                      onClick={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        setMessageExpansion(current => ({ ...current, [expansionKey]: !expanded }))
                      }}
                    >
                      <Icon name="expand_more" size={20} className="thread-message__chevron" />
                    </TooltipButton>
                  </div>
                </div>

              </summary>

                {message.attachments && message.attachments.length > 0 && (
                  <details className="thread-message__files">
                    <summary className="thread-message__files-label">
                      <Icon name="attach_file" size={16} />
                      <span className="thread-message__files-title">{t('thread.attachments')}<span className="thread-message__files-count">{message.attachments.length}</span></span>
                      <span className="thread-message__files-preview">
                        <span className="thread-message__files-names">{message.attachments.slice(0, 2).map(attachment => attachment.name).join(' · ')}</span>
                        {message.attachments.length > 2 && <span className="thread-message__files-more">{t('thread.moreAttachments', { count: message.attachments.length - 2 })}</span>}
                      </span>
                      <Icon name="expand_more" size={18} className="thread-message__files-chevron" />
                    </summary>
                  <div className="attachments" aria-label={t('thread.attachments')}>
                    {message.attachments.map((attachment, index) => {
                      const meta = ATTACHMENT_ICON[attachment.kind]
                      const previewable = ['image', 'pdf', 'text'].includes(attachment.kind)
                      const saving = savingAttachment?.mailbox === (message.mailbox ?? mailbox) && savingAttachment.messageId === message.id && savingAttachment.index === index
                      return (
                        <TooltipButton
                          key={`${attachment.name}-${index}`}
                          className="attachment"
                          type="button"
                          title={t(saving ? 'attachment.preparing' : previewable ? 'document.preview' : 'thread.download')}
                          aria-label={`${attachment.name} · ${t(saving ? 'attachment.preparing' : previewable ? 'document.preview' : 'thread.download')}`}
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
                          <Icon name={previewable ? 'visibility' : 'download'} size={18} />
                        </TooltipButton>
                      )
                    })}
                  </div>
                  </details>
                )}

              {message.html ? <EmailBody html={message.html} blockRemote={spam} theme={bodyTheme} integrated={bodyTheme === appBodyTheme} /> : <Body message={message} theme={bodyTheme === appBodyTheme ? undefined : bodyTheme} onRetry={onRetryMessage} />}
              </details>
              )
            })
          )}
        </article>
      </div>
      <div className="quick-reply">
        <div className="quick-reply__actions">
          <TooltipButton className="tool-btn quick-reply__ai" type="button" onClick={onQuickDraft} title={t('thread.quickDraft')}>
            <Icon name="bolt" size={14} />
            {t('thread.quickDraft')}
          </TooltipButton>
          <TooltipButton className="btn btn--surface" type="button" onClick={onReply} title={t('thread.replySender')}>
            <Icon name="reply" size={16} />
            {t('common.reply')}
          </TooltipButton>
          <TooltipButton className="btn btn--primary" type="button" onClick={onReplyAll} title={t('thread.replyEveryone')}>
            <Icon name="reply_all" size={16} />
            {t('common.replyAll')}
          </TooltipButton>
        </div>
      </div>
      {recipientsMessage && <RecipientsDialog key={`${mailbox}:${recipientsMessage.id}`} message={recipientsMessage} onClose={() => setRecipientsId(null)} />}
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
            <div className="mail-welcome__brand">
              <img className="mail-welcome__logo" src={logo} alt="" width={48} height={48} />
              <span className="mail-welcome__wordmark">NamiO</span>
            </div>
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
