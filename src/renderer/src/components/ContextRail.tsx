import { useState } from 'react'
import type { ActionItem, BriefPoint, Slot } from '../data/demo'
import { DOSSIER } from '../data/demo'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface ContextRailProps {
  brief: readonly BriefPoint[]
  actions: readonly ActionItem[]
  slots: readonly Slot[]
  onInsertSlot: (slot: string) => void
}

export function ContextRail({ brief, actions, slots, onInsertSlot }: ContextRailProps): React.JSX.Element {
  const { t } = useI18n()
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string): void => {
    setDone((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="context" id="context-rail" aria-label={t('context.brief')}>
      <div className="card">
        <div className="card__head">
          <span className="card__title">
            <Icon name="psychology" size={16} />
            {t('context.brief')}
          </span>
          <span className="chip chip--accent">{t('context.live')}</span>
        </div>

        <div className="brief">
          {brief.map((point, index) => (
            <div key={point.title} className="brief__item">
              <span className="brief__num">{String(index + 1).padStart(2, '0')}</span>
              <p style={{ margin: 0 }}>
                <strong>{point.title}</strong> {point.text}
              </p>
            </div>
          ))}
        </div>

        <div className="actions">
          <span className="card__label">{t('context.actions')}</span>
          {actions.map((action) => (
            <label key={action.id} className="action">
              <input type="checkbox" checked={done.has(action.id)} onChange={() => toggle(action.id)} />
              <span className="action__text">
                <span
                  className="action__title"
                  style={done.has(action.id) ? { textDecoration: 'line-through', color: 'var(--outline)' } : undefined}
                >
                  {action.title}
                </span>
                <span className={cx('action__due', action.urgent && 'action__due--urgent')}>{action.due}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__label">{t('context.dossier')}</span>
          <button className="icon-btn" type="button" title={t('context.dossier')} aria-label={t('context.dossier')}>
            <Icon name="open_in_new" size={16} />
          </button>
        </div>

        <div className="dossier__id">
          <span className="avatar avatar--xl avatar--accent">{DOSSIER.person.initials}</span>
          <div style={{ minWidth: 0 }}>
            <div className="dossier__name">{DOSSIER.person.name}</div>
            <div className="dossier__role">{DOSSIER.person.org}</div>
            <div className="dossier__loc">{DOSSIER.location}</div>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <span className="stat__value">{DOSSIER.threadsInCommon}</span>
            <span className="stat__label">{t('context.common')}</span>
          </div>
          <div className="stat">
            <span className="stat__value stat__value--tertiary">{DOSSIER.responseRate}</span>
            <span className="stat__label">{t('context.rate')}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="fact-row">
            <span>{t('context.boards')}</span>
            <span>{DOSSIER.boards}</span>
          </div>
          <div className="fact-row">
            <span>{t('context.last')}</span>
            <span>{DOSSIER.lastInteraction}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">
            <Icon name="calendar_today" size={16} />
            {t('context.available')}
          </span>
          <span className="t-kbd" style={{ color: 'var(--outline)' }}>
            GMT-7
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {slots.map((slot) => (
            <div key={slot.start} className={cx('slot', slot.status === 'free' && 'slot--muted')}>
              <span className="slot__time">
                <span className={cx('dot', slot.status === 'free' ? 'dot--idle' : '')} />
                {slot.start} – {slot.end}
              </span>
              {slot.status === 'requested' ? (
                <span className="chip chip--accent">{t('context.requested')}</span>
              ) : (
                <span className="t-kbd" style={{ color: 'var(--outline)' }}>
                  {t('context.free')}
                </span>
              )}
            </div>
          ))}
        </div>

        <button className="tool-btn" type="button" onClick={() => onInsertSlot('10:30 AM – 10:45 AM')}>
          <Icon name="event_available" size={15} />
          {t('context.insert')}
        </button>
      </div>
    </aside>
  )
}
