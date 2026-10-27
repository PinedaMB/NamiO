import { TooltipButton } from './Tooltip'
import { useCallback, useEffect, useState } from 'react'
import type { MailboxInfo, Rule, RuleAction, RuleDraft, RuleField, RuleOp } from '@shared/ipc'
import { useI18n, type TranslationKey } from '../i18n'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

const FIELDS: ReadonlyArray<{ id: RuleField; labelKey: TranslationKey }> = [
  { id: 'from', labelKey: 'rules.field.from' },
  { id: 'subject', labelKey: 'rules.field.subject' },
  { id: 'to', labelKey: 'rules.field.to' },
  { id: 'any', labelKey: 'rules.field.any' }
]

const OPS: ReadonlyArray<{ id: RuleOp; labelKey: TranslationKey }> = [
  { id: 'contains', labelKey: 'rules.op.contains' },
  { id: 'starts', labelKey: 'rules.op.starts' },
  { id: 'equals', labelKey: 'rules.op.equals' }
]

const ACTIONS: ReadonlyArray<{ id: RuleAction; labelKey: TranslationKey }> = [
  { id: 'archive', labelKey: 'rules.action.archive' },
  { id: 'move', labelKey: 'rules.action.move' },
  { id: 'read', labelKey: 'rules.action.read' },
  { id: 'delete', labelKey: 'rules.action.delete' }
]

const labelOf = <T extends string>(
  list: ReadonlyArray<{ id: T; labelKey: TranslationKey }>,
  id: T,
  t: (key: TranslationKey) => string
): string => t(list.find((item) => item.id === id)?.labelKey ?? 'rules.field.any')

const blank = (): RuleDraft => ({
  name: '',
  enabled: true,
  field: 'from',
  op: 'contains',
  value: '',
  action: 'archive',
  target: null
})

/**
 * Reglas locales. Se aplican solas a lo que llega y, con el botón, a lo que ya
 * está en la caché. Las acciones pasan por la cola de salida: archivar, mover,
 * marcar leído o eliminar ocurren en el servidor, con reintentos.
 */
export function RulesSection(): React.JSX.Element {
  const { t } = useI18n()
  const [rules, setRules] = useState<readonly Rule[]>([])
  const [mailboxes, setMailboxes] = useState<readonly MailboxInfo[]>([])
  const [draft, setDraft] = useState<RuleDraft>(blank)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const list = await window.api?.rules?.().catch(() => null)
    if (list) setRules(list)
    const boxes = await window.api?.listMailboxes?.(false).catch(() => null)
    if (boxes?.ok) setMailboxes(boxes.data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = async (): Promise<void> => {
    if (draft.value.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.saveRule(draft)
      setRules(next)
      setDraft(blank())
      setCreating(false)
      setStatus(t('rules.saved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number): Promise<void> => {
    setBusy(true)
    try {
      setRules(await window.api.deleteRule(id))
      setStatus(t('rules.deleted'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (rule: Rule): Promise<void> => {
    const next = await window.api.saveRule({
      id: rule.id,
      name: rule.name,
      enabled: !rule.enabled,
      field: rule.field,
      op: rule.op,
      value: rule.value,
      action: rule.action,
      target: rule.target
    })
    setRules(next)
  }

  const applyToCache = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.applyRules()
      setStatus(t('rules.applied', { count: result.matched }))
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-stack">
      <div className="settings-card">
        <div className="settings-card__head">
          <div>
            <h2 className="settings-card__title">{t('rules.title')}</h2>
            <p className="settings-card__subtitle">{t('rules.subtitle')}</p>
          </div>
          <div className="rules__head-actions">
            <button className="tool-btn" type="button" onClick={() => void applyToCache()} disabled={busy || rules.length === 0}>
              <Icon name="play_arrow" size={15} />
              {t('rules.apply')}
            </button>
            <button className="btn btn--primary" type="button" onClick={() => setCreating((open) => !open)}>
              <Icon name={creating ? 'close' : 'add'} size={15} />
              {creating ? t('account.cancel') : t('rules.new')}
            </button>
          </div>
        </div>

        {status && <p className="rules__status">{status}</p>}
        {error && (
          <p className="account-error" role="alert">
            <Icon name="error" size={15} />
            <span className="account-error__detail">{error}</span>
          </p>
        )}

        {creating && (
          <div className="rules__form">
            <div className="account-row account-row--host">
              <label className="account-field">
                <span>{t('rules.field.label')}</span>
                <select
                  className="rules__select"
                  value={draft.field}
                  onChange={(event) => setDraft({ ...draft, field: event.target.value as RuleField })}
                >
                  {FIELDS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="account-field">
                <span>{t('rules.op.label')}</span>
                <select
                  className="rules__select"
                  value={draft.op}
                  onChange={(event) => setDraft({ ...draft, op: event.target.value as RuleOp })}
                >
                  {OPS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="account-field">
              <span>{t('rules.value.label')}</span>
              <input
                value={draft.value}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                placeholder={t('rules.value.placeholder')}
                autoFocus
              />
            </label>

            <div className="account-row account-row--host">
              <label className="account-field">
                <span>{t('rules.action.label')}</span>
                <select
                  className="rules__select"
                  value={draft.action}
                  onChange={(event) => setDraft({ ...draft, action: event.target.value as RuleAction })}
                >
                  {ACTIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              {draft.action === 'move' && (
                <label className="account-field">
                  <span>{t('rules.target.label')}</span>
                  <select
                    className="rules__select"
                    value={draft.target ?? ''}
                    onChange={(event) => setDraft({ ...draft, target: event.target.value || null })}
                  >
                    <option value="">{t('rules.target.placeholder')}</option>
                    {mailboxes.map((box) => (
                      <option key={box.path} value={box.path}>
                        {box.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="rules__form-actions">
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => void save()}
                disabled={draft.value.trim() === '' || busy || (draft.action === 'move' && !draft.target)}
              >
                {t('rules.create')}
              </button>
              <span className="rules__preview">
                {t('rules.preview', {
                  field: labelOf(FIELDS, draft.field, t).toLowerCase(),
                  op: labelOf(OPS, draft.op, t).toLowerCase(),
                  value: draft.value || '…',
                  action: labelOf(ACTIONS, draft.action, t).toLowerCase()
                })}
              </span>
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <div className="settings-card settings-card--empty rules__empty">
            <span className="empty-state__icon">
              <Icon name="filter_alt" size={24} />
            </span>
            <p className="settings-card__subtitle">{t('rules.empty')}</p>
          </div>
        ) : (
          <ul className="rules__list">
            {rules.map((rule) => (
              <li key={rule.id} className={cx('rules__item', !rule.enabled && 'rules__item--off')}>
                <TooltipButton
                  className={cx('rules__switch', rule.enabled && 'rules__switch--on')}
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={rule.enabled ? t('rules.disable') : t('rules.enable')}
                  onClick={() => void toggle(rule)}
                  title={rule.enabled ? t('rules.disable') : t('rules.enable')}
                >
                  <span className="rules__knob" />
                </TooltipButton>

                <div className="rules__text">
                  <span className="rules__name">{rule.name}</span>
                  <span className="rules__detail">
                    {t('rules.describe', {
                      field: labelOf(FIELDS, rule.field, t).toLowerCase(),
                      op: labelOf(OPS, rule.op, t).toLowerCase(),
                      value: rule.value,
                      action: labelOf(ACTIONS, rule.action, t).toLowerCase()
                    })}
                    {rule.action === 'move' && rule.target ? ` → ${rule.target}` : ''}
                  </span>
                </div>

                <span className="rules__hits" title={t('rules.hits', { count: rule.hits })}>
                  {rule.hits}
                </span>
                <TooltipButton
                  className="icon-btn"
                  type="button"
                  onClick={() => void remove(rule.id)}
                  disabled={busy}
                  title={t('rules.delete')}
                  aria-label={t('rules.delete')}
                >
                  <Icon name="delete" size={16} />
                </TooltipButton>
              </li>
            ))}
          </ul>
        )}

        <p className="settings-card__subtitle rules__note">
          <Icon name="info" size={13} /> {t('rules.note')}
        </p>
      </div>
    </div>
  )
}
