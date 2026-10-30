import { useEffect, useState } from 'react'
import type { RecipientSuggestion } from '@shared/ipc'
import { splitRecipients, validRecipients } from '@shared/mailAddresses'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

interface RecipientInputProps {
  field: 'to' | 'cc' | 'bcc'
  initialValue: string
  onChange: (value: string) => void
  suggest: boolean
}

export function RecipientInput({ field, initialValue, onChange, suggest }: RecipientInputProps): React.JSX.Element {
  const { t } = useI18n()
  const [contacts, setContacts] = useState(splitRecipients(initialValue))
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([])
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const [invalid, setInvalid] = useState(false)
  const listId = `recipient-options-${field}`
  const options = suggestions.filter(item => !contacts.some(email => email.toLowerCase() === item.email.toLowerCase()))
  const popup = focused && options.length > 0

  useEffect(() => {
    if (!focused || !suggest) return
    let canceled = false
    const timer = window.setTimeout(() => {
      void window.api?.suggestRecipients?.(draft.trim()).then(items => {
        if (!canceled) { setSuggestions(items); setActive(-1) }
      }).catch(() => { if (!canceled) setSuggestions([]) })
    }, 150)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [draft, focused, suggest])

  const commit = (contact?: RecipientSuggestion): void => {
    const value = contact?.email ?? draft.trim()
    if (!value) return
    if (!validRecipients(value)) { setInvalid(true); return }
    const next = [...contacts]
    for (const email of splitRecipients(value)) if (!next.some(item => item.toLowerCase() === email.toLowerCase())) next.push(email)
    if (contact?.name) setNames(current => ({ ...current, [contact.email]: contact.name }))
    setContacts(next)
    setDraft('')
    setSuggestions([])
    setActive(-1)
    setInvalid(false)
    onChange(next.join(', '))
  }

  if (contacts.length > 2 && !expanded) return <button className="recipient-summary" type="button" aria-expanded={false}
    aria-label={t('compose.editRecipients', { count: contacts.length })} onClick={() => setExpanded(true)}>
    <span>{contacts.slice(0, 2).join('; ')}</span><strong>{t('recipients.more', { count: contacts.length - 2 })}</strong><Icon name="edit" size={14} />
  </button>

  return (
    <div className="recipient-input">
      {contacts.map(email => <span className="recipient recipient--contact" key={email} title={email}>
        <span className="recipient__initials" aria-hidden="true">{(names[email] || email).slice(0, 2).toUpperCase()}</span>
        <strong>{names[email] || email}</strong>
        <button type="button" aria-label={`${t('compose.removeRecipient')}: ${email}`} onClick={() => {
          const next = contacts.filter(item => item !== email)
          setContacts(next)
          onChange([...next, draft].filter(Boolean).join(', '))
        }}><Icon name="close" size={13} /></button>
      </span>)}
      {contacts.length > 2 && <button className="tool-btn" type="button" disabled={Boolean(draft)} aria-expanded={true} onClick={() => setExpanded(false)}>{t('compose.collapseRecipients')}</button>}
      <div className="recipient-input__entry" data-recipient-popup={popup ? 'true' : undefined}>
        <input className="input-bare" value={draft} role="combobox" autoComplete="off" spellCheck={false}
          aria-label={t(`compose.${field}`)} aria-autocomplete="list" aria-expanded={popup}
          aria-controls={popup ? listId : undefined} aria-activedescendant={popup && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined} placeholder={t(contacts.length ? 'compose.addAnother' : 'compose.addRecipient')}
          onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit() }}
          onChange={event => {
            const value = event.target.value
            setDraft(value); setSuggestions([]); setActive(-1); setInvalid(false); setFocused(true)
            onChange([...contacts, value].filter(Boolean).join(', '))
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' && popup) { event.preventDefault(); setActive(index => (index + 1) % options.length) }
            else if (event.key === 'ArrowUp' && popup) { event.preventDefault(); setActive(index => (index <= 0 ? options.length : index) - 1) }
            else if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
              event.preventDefault(); commit(event.key === 'Enter' && active >= 0 ? options[active] : undefined)
            } else if (event.key === 'Escape' && popup) { event.preventDefault(); event.stopPropagation(); setFocused(false) }
          }} />
        {popup && <div className="recipient-options" id={listId} role="listbox" aria-label={t(`compose.${field}`)}>
          {options.map((contact, index) => <button type="button" role="option" id={`${listId}-${index}`} key={contact.email}
            aria-selected={index === active} tabIndex={-1} className="recipient-options__item"
            onMouseDown={event => event.preventDefault()} onClick={() => commit(contact)}>
            <span className="recipient-options__avatar" aria-hidden="true">{(contact.name || contact.email).slice(0, 2).toUpperCase()}</span>
            <span className="recipient-options__text"><strong>{contact.name || contact.email}</strong>{contact.name && <span>{contact.email}</span>}</span>
            <Icon name="keyboard_return" size={16} />
          </button>)}
        </div>}
      </div>
    </div>
  )
}
