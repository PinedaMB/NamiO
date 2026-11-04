import { useMemo } from 'react'
import type { Thread } from '../data/demo'
import { useI18n } from '../i18n'
import { CopilotPanel } from './CopilotPanel'

export function ThreadCopilot({ thread }: { thread: Thread }): React.JSX.Element {
  const { t } = useI18n()
  const text = useMemo(() => JSON.stringify({
    subject: thread.subject,
    messages: thread.messages.map(message => {
      let body = message.body.join('\n\n').trim()
      if (!body && message.html) {
        const document_ = new DOMParser().parseFromString(message.html, 'text/html')
        document_.querySelectorAll('script, style, noscript').forEach(node => node.remove())
        document_.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
        document_.querySelectorAll('p, div, li').forEach(node => node.append('\n'))
        body = document_.body.textContent ?? ''
      }
      return { from: message.from.name || message.from.email, date: message.sentAt, body }
    })
  }), [thread.subject, thread.messages])
  if (!thread.messages.length || thread.messages.some(message => message.partial)) return <p role="status">{t('ai.threadIncomplete')}</p>
  if (text.length > 40000) return <p role="status">{t('ai.threadTooLong')}</p>
  return <div className="thread-copilot"><CopilotPanel mode="thread" body={text} revision={text} context="" /></div>
}
