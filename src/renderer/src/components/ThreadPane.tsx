import type { Attachment, Message, Thread } from '../data/demo'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface ThreadPaneProps {
  thread: Thread
  position: number
  total: number
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
  onArchive,
  onSnooze,
  onDelete,
  onStar,
  onReply,
  onQuickDraft,
  onPrev,
  onNext
}: ThreadPaneProps): React.JSX.Element {
  const message = thread.messages[0]
  const from = message?.from
  const recipients = (message?.to ?? []).map((person) => person.email)
  const toLine = [`me <${recipients[0] ?? ''}>`, ...recipients.slice(1)].join(', ')

  return (
    <main className="reading" aria-label="Conversation">
      <div className="reading__toolbar">
        <div className="toolbar-group">
          <button className="tool-btn" type="button" onClick={onArchive} title="Archive (E)">
            <Icon name="archive" size={15} />
            Archive
            <kbd className="kbd">E</kbd>
          </button>
          <button className="tool-btn" type="button" onClick={onSnooze} title="Snooze (S)">
            <Icon name="schedule" size={15} />
            Snooze
            <kbd className="kbd">S</kbd>
          </button>
          <button className="tool-btn" type="button" title="Move (M)">
            <Icon name="drive_file_move" size={15} />
            Move
            <kbd className="kbd">M</kbd>
          </button>
          <button className="tool-btn tool-btn--icon btn--danger" type="button" title="Mark as spam">
            <Icon name="report" size={15} />
          </button>
          <button className="tool-btn tool-btn--icon btn--danger" type="button" onClick={onDelete} title="Delete">
            <Icon name="delete" size={15} />
          </button>
        </div>

        <div className="toolbar-group">
          <span className="reading__count">
            Thread {position} of {total}
          </span>
          <button className="tool-btn tool-btn--icon" type="button" onClick={onPrev} title="Previous (K)">
            <Icon name="chevron_left" size={16} />
          </button>
          <button className="tool-btn tool-btn--icon" type="button" onClick={onNext} title="Next (J)">
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      </div>

      <div className="reading__scroll">
        <article className="letter">
          <div className="letter__head">
            <h1 className="letter__subject">{thread.subject}</h1>
            <div className="letter__badges">
              {thread.vip && (
                <span className="badge-secure">
                  <Icon name="verified" size={12} fill />
                  {from?.org ?? 'VIP'} Direct
                </span>
              )}
              <button
                className="icon-btn"
                type="button"
                onClick={onStar}
                title={thread.starred ? 'Unstar (S)' : 'Star (S)'}
                aria-pressed={thread.starred}
              >
                <Icon name="star" size={16} fill={thread.starred} />
              </button>
            </div>
          </div>

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
                    <span>to</span>
                    <span style={{ color: 'var(--on-surface)', fontWeight: 500 }}>{toLine}</span>
                  </div>
                </div>
              </div>

              <div className="participants__right">
                <span>{message?.sentAt}</span>
                <span className="participants__tls">
                  <span className="dot" />
                  Encrypted TLS 1.3
                </span>
              </div>
            </div>

            {message?.attachments && message.attachments.length > 0 && (
              <div className="attachments">
                {message.attachments.map((attachment) => {
                  const meta = ATTACHMENT_ICON[attachment.kind]
                  return (
                    <a key={attachment.name} className="attachment" href="#archivo" onClick={(event) => event.preventDefault()}>
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

          {message && <Body message={message} />}

          <div className="quick-reply">
            <div className="quick-reply__hint">
              <span className="quick-reply__own">
                <Icon name="reply" size={16} />
              </span>
              <span>
                Hit <kbd className="kbd kbd--quiet">R</kbd> to reply,{' '}
                <kbd className="kbd kbd--quiet">A</kbd> to reply all, or run AI synthesis…
              </span>
            </div>
            <div className="quick-reply__actions">
              <button className="tool-btn" type="button" onClick={onQuickDraft}>
                <Icon name="bolt" size={14} />
                AI Quick Draft
              </button>
              <button className="btn btn--primary" type="button" onClick={onReply}>
                Reply
              </button>
            </div>
          </div>
        </article>
      </div>
    </main>
  )
}

export function ThreadPaneEmpty(): React.JSX.Element {
  return (
    <main className="reading" aria-label="Conversation">
      <div className="reading__scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="muted">Select a conversation</p>
      </div>
    </main>
  )
}

export { cx }
