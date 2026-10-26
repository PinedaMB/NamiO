import { useEffect, useMemo, useState } from 'react'
import type { CoreStatus } from '@shared/ipc'
import { ACCOUNT } from '../data/demo'
import { LOCALES, useI18n, type TranslationKey } from '../i18n'
import { useShortcuts } from '../settings/ShortcutsProvider'
import {
  DEFAULT_BINDINGS,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  actionForCombo,
  comboFromEvent,
  formatCombo,
  type ShortcutAction
} from '../settings/shortcuts'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

interface SettingsProps {
  onBack: () => void
}

type Section = 'general' | 'shortcuts' | 'accounts' | 'copilot' | 'rules'

const NAV: ReadonlyArray<{ id: Section; icon: string; labelKey: TranslationKey }> = [
  { id: 'general', icon: 'bolt', labelKey: 'settings.nav.general' },
  { id: 'shortcuts', icon: 'keyboard', labelKey: 'settings.nav.shortcuts' },
  { id: 'accounts', icon: 'alternate_email', labelKey: 'settings.nav.accounts' },
  { id: 'copilot', icon: 'neurology', labelKey: 'settings.nav.copilot' },
  { id: 'rules', icon: 'filter_alt', labelKey: 'settings.nav.rules' }
]

export function Settings({ onBack }: SettingsProps): React.JSX.Element {
  const { t, locale, setLocale } = useI18n()
  const { bindings, save, reset } = useShortcuts()
  const [section, setSection] = useState<Section>('shortcuts')
  const [query, setQuery] = useState('')
  const [remap, setRemap] = useState<{ action: ShortcutAction; combo: string; conflict: ShortcutAction | null } | null>(
    null
  )
  const [status, setStatus] = useState<CoreStatus | null>(null)

  useEffect(() => {
    window.api
      ?.getCoreStatus?.()
      .then(setStatus)
      .catch(() => undefined)
  }, [])

  /**
   * Captura en fase de captura (true) para que la tecla no llegue a los atajos
   * globales del App mientras se está remapeando.
   */
  useEffect(() => {
    if (!remap) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setRemap(null)
        return
      }
      const combo = comboFromEvent(event)
      if (!combo) return
      event.preventDefault()
      event.stopPropagation()
      const owner = actionForCombo(bindings, combo)
      setRemap((current) =>
        current ? { ...current, combo, conflict: owner && owner !== current.action ? owner : null } : current
      )
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [remap, bindings])

  const matches = (labelKey: TranslationKey, hintKey: TranslationKey): boolean => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return true
    return `${t(labelKey)} ${t(hintKey)}`.toLowerCase().includes(needle)
  }

  const groups = useMemo(
    () =>
      SHORTCUT_GROUPS.map((group) => ({
        ...group,
        rows: SHORTCUTS.filter((shortcut) => shortcut.group === group.id && matches(shortcut.labelKey, shortcut.hintKey))
      })).filter((group) => group.rows.length > 0),
    // `matches` depende de `t` y `query`, que ya están en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, t]
  )

  const applyRemap = (): void => {
    if (!remap || remap.conflict) return
    save({ ...bindings, [remap.action]: remap.combo })
    setRemap(null)
  }

  const renderSection = (): React.JSX.Element => {
    if (section === 'shortcuts') {
      return (
        <div className="settings-card">
          <div className="settings-card__head">
            <div>
              <h2 className="settings-card__title">{t('settings.shortcuts.title')}</h2>
              <p className="settings-card__subtitle">{t('settings.shortcuts.subtitle')}</p>
            </div>
            <button className="tool-btn" type="button" onClick={reset}>
              <Icon name="restart_alt" size={15} />
              {t('settings.shortcuts.reset')}
            </button>
          </div>

          <div className="settings-search">
            <Icon name="search" size={16} />
            <input
              className="settings-search__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.shortcuts.search')}
              aria-label={t('settings.shortcuts.search')}
            />
            {query !== '' && (
              <button className="icon-btn" type="button" onClick={() => setQuery('')} title={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>

          <div className="shortcut-groups">
            {groups.map((group) => (
              <section key={group.id} className="shortcut-group">
                <header className="shortcut-group__head">
                  <span>{t(group.labelKey)}</span>
                  <span className="shortcut-group__count">{group.rows.length}</span>
                </header>
                {group.rows.map((shortcut) => (
                  <button
                    key={shortcut.id}
                    type="button"
                    className="shortcut-row"
                    onClick={() =>
                      setRemap({ action: shortcut.id, combo: bindings[shortcut.id], conflict: null })
                    }
                  >
                    <span className="shortcut-row__main">
                      <Icon name={shortcut.icon} size={18} />
                      <span className="shortcut-row__text">
                        <span className="shortcut-row__label">{t(shortcut.labelKey)}</span>
                        <span className="shortcut-row__hint">{t(shortcut.hintKey)}</span>
                      </span>
                    </span>
                    <span className="shortcut-row__keys">
                      {bindings[shortcut.id] !== DEFAULT_BINDINGS[shortcut.id] && (
                        <span className="chip chip--accent">{t('settings.shortcuts.custom')}</span>
                      )}
                      <kbd className="kbd shortcut-row__kbd">{formatCombo(bindings[shortcut.id])}</kbd>
                    </span>
                  </button>
                ))}
              </section>
            ))}

            {groups.length === 0 && (
              <p className="muted" style={{ padding: '16px 4px' }}>
                {t('palette.noResults', { q: query })}
              </p>
            )}
          </div>
        </div>
      )
    }

    if (section === 'general') {
      return (
        <div className="settings-stack">
          <div className="settings-card">
            <div className="settings-card__head">
              <div>
                <h2 className="settings-card__title">{t('settings.general.language')}</h2>
                <p className="settings-card__subtitle">{t('settings.general.languageHint')}</p>
              </div>
            </div>
            <div className="lang-options">
              {LOCALES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx('lang-option', locale === item.id && 'lang-option--active')}
                  onClick={() => setLocale(item.id)}
                  aria-pressed={locale === item.id}
                >
                  <span className="lang-option__code">{item.label}</span>
                  <span className="lang-option__name">{item.id === 'es' ? 'Español' : 'English'}</span>
                  {locale === item.id && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card__head">
              <h2 className="settings-card__title">{t('settings.general.diagnostics')}</h2>
            </div>
            <dl className="diag">
              <div className="diag__row">
                <dt>{t('settings.general.app')}</dt>
                <dd className="mono">v{status?.appVersion ?? '0.1.0'}</dd>
              </div>
              <div className="diag__row">
                <dt>{t('settings.general.runtime')}</dt>
                <dd className="mono">Electron {status?.electronVersion ?? '45.0.0'}</dd>
              </div>
              <div className="diag__row">
                <dt>{t('settings.general.platform')}</dt>
                <dd className="mono">{status?.platform ?? '—'}</dd>
              </div>
              <div className="diag__row">
                <dt>{t('settings.general.profile')}</dt>
                <dd className="mono">settings.json</dd>
              </div>
            </dl>
            <p className="settings-card__note">
              <Icon name="lock" size={14} />
              {t('settings.general.dataHint')}
            </p>
          </div>
        </div>
      )
    }

    const empty: Record<'accounts' | 'copilot' | 'rules', { icon: string; title: TranslationKey; text: TranslationKey }> = {
      accounts: { icon: 'alternate_email', title: 'settings.accounts.title', text: 'settings.accounts.empty' },
      copilot: { icon: 'neurology', title: 'settings.copilot.title', text: 'settings.copilot.empty' },
      rules: { icon: 'filter_alt', title: 'settings.rules.title', text: 'settings.rules.empty' }
    }
    const current = empty[section]

    return (
      <div className="settings-card settings-card--empty">
        <span className="empty-state__icon">
          <Icon name={current.icon} size={26} />
        </span>
        <h2 className="settings-card__title">{t(current.title)}</h2>
        <p className="settings-card__subtitle">{t(current.text)}</p>
        {section === 'accounts' && (
          <>
            <p className="muted" style={{ maxWidth: '52ch' }}>
              {t('settings.accounts.hint')}
            </p>
            <button className="btn btn--primary" type="button" disabled>
              {t('settings.accounts.cta')}
            </button>
          </>
        )}
        {section !== 'accounts' && <span className="chip chip--outline">{t('settings.soon')}</span>}
      </div>
    )
  }

  return (
    <div className="settings">
      <header className="settings__hero">
        <div className="settings__hero-text">
          <span className="settings__eyebrow">
            <span className="dot" />
            {t('settings.engine')}
          </span>
          <h1 className="settings__title">{t('settings.title')}</h1>
          <p className="settings__subtitle">{t('settings.subtitle')}</p>
        </div>
        <button className="tool-btn" type="button" onClick={onBack}>
          <Icon name="chevron_left" size={16} />
          {t('settings.back')}
        </button>
      </header>

      <div className="settings__grid">
        <aside className="settings__aside">
          <nav className="settings-nav" aria-label={t('settings.title')}>
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cx('settings-nav__item', section === item.id && 'settings-nav__item--active')}
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} />
                <span className="settings-nav__label">{t(item.labelKey)}</span>
                {item.id === 'accounts' ? (
                  <span className="settings-nav__meta">{t('settings.nav.empty')}</span>
                ) : item.id === 'shortcuts' ? (
                  <span className="settings-nav__meta">{SHORTCUTS.length}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="settings-card settings-card--profile">
            <span className="card__label">{t('settings.profile.title')}</span>
            <div className="profile-row">
              <span className="avatar avatar--lg avatar--accent">{ACCOUNT.initials}</span>
              <div style={{ minWidth: 0 }}>
                <div className="profile-row__name">{ACCOUNT.name}</div>
                <div className="profile-row__mail">{ACCOUNT.email}</div>
              </div>
            </div>
            <div className="profile-fact">
              <span>{t('settings.profile.language')}</span>
              <span className="mono">{locale.toUpperCase()}</span>
            </div>
            <div className="profile-fact">
              <span>{t('settings.profile.layout')}</span>
              <span className="mono">{t('settings.profile.layoutValue')}</span>
            </div>
            <div className="profile-fact">
              <span>{t('settings.general.app')}</span>
              <span className="mono">v{status?.appVersion ?? '0.1.0'}</span>
            </div>
          </div>
        </aside>

        <main className="settings__main" key={section}>
          {renderSection()}
        </main>
      </div>

      {remap && (
        <div className="overlay overlay--center" onMouseDown={(event) => event.target === event.currentTarget && setRemap(null)}>
          <div className="remap" role="dialog" aria-modal="true" aria-label={t('settings.shortcuts.pressKey')}>
            <div className="remap__head">
              <span className="remap__title">
                <span className="dot pulse" />
                {t('settings.shortcuts.pressKey')}
              </span>
              <button className="icon-btn" type="button" onClick={() => setRemap(null)} title={t('common.close')}>
                <Icon name="close" size={16} />
              </button>
            </div>

            <span className="remap__action">{t(SHORTCUTS.find((item) => item.id === remap.action)?.labelKey ?? 'shortcut.next')}</span>

            <div className={cx('remap__display', remap.conflict && 'remap__display--conflict')}>
              {formatCombo(remap.combo)}
            </div>

            {remap.conflict ? (
              <p className="remap__error">
                <Icon name="error" size={15} />
                {t('settings.shortcuts.conflict', {
                  action: t(SHORTCUTS.find((item) => item.id === remap.conflict)?.labelKey ?? 'shortcut.next')
                })}
              </p>
            ) : (
              <p className="remap__hint">{t('settings.shortcuts.pressKeyHint')}</p>
            )}

            <div className="remap__foot">
              <button className="tool-btn" type="button" onClick={() => setRemap(null)}>
                {t('common.close')}
                <kbd className="kbd">Esc</kbd>
              </button>
              <button className="btn btn--primary" type="button" onClick={applyRemap} disabled={Boolean(remap.conflict)}>
                <Icon name="check" size={16} />
                {t('settings.shortcuts.assign')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
