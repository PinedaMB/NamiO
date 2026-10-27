import logo from '../assets/logo.png'
import naomi from '../assets/naomi.png'
import { TooltipButton } from './Tooltip'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccountSummary, CoreStatus } from '@shared/ipc'
import { LOCALES, useI18n, type TranslationKey } from '../i18n'
import { useShortcuts } from '../settings/ShortcutsProvider'
import { usePreferences } from '../settings/PreferencesProvider'
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
import { RulesSection } from './RulesSection'
import { cx } from '../lib/cx'

interface SettingsProps {
  onCacheCleared: (accountId: string) => void
  accountKey: string
  onBack: () => void
  accounts: readonly AccountSummary[]
  onAddAccount: () => void
  onManageAccount: () => void
  onSelectAccount: (id: string) => void
}

const PLATFORM_NAMES: Record<string, string> = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }

type Section = 'general' | 'shortcuts' | 'accounts' | 'copilot' | 'rules' | 'about'

const NAV: ReadonlyArray<{ id: Section; icon: string; labelKey: TranslationKey }> = [
  { id: 'general', icon: 'bolt', labelKey: 'settings.nav.general' },
  { id: 'shortcuts', icon: 'keyboard', labelKey: 'settings.nav.shortcuts' },
  { id: 'accounts', icon: 'alternate_email', labelKey: 'settings.nav.accounts' },
  { id: 'copilot', icon: 'neurology', labelKey: 'settings.nav.copilot' },
  { id: 'rules', icon: 'filter_alt', labelKey: 'settings.nav.rules' },
  { id: 'about', icon: 'info', labelKey: 'settings.nav.about' }
]

export function Settings({ onCacheCleared, accountKey, onBack, accounts, onAddAccount, onManageAccount, onSelectAccount }: SettingsProps): React.JSX.Element {
  const { t, locale, setLocale, saveError: localeError } = useI18n()
  const { bindings, save, reset, saveError: shortcutsError } = useShortcuts()
  const { remoteImages, setRemoteImages, bodyTheme, setBodyTheme, saveError: preferencesError } = usePreferences()
  const saveError = localeError || shortcutsError || preferencesError
  const activeAccount = accounts.find((account) => account.active)
  const formatSize = (bytes: number): string => bytes < 1024 * 1024
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024)} KiB`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MiB`
  const [section, setSection] = useState<Section>('general')
  const dedication = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [remap, setRemap] = useState<{ action: ShortcutAction; combo: string; conflict: ShortcutAction | null } | null>(
    null
  )
  const [clearingCache, setClearingCache] = useState<string | null>(null)
  const [cacheError, setCacheError] = useState<string | null>(null)
  const [cacheCleared, setCacheCleared] = useState(false)
  const [status, setStatus] = useState<CoreStatus | null>(null)

  useEffect(() => {
    window.api
      ?.getCoreStatus?.()
      .then(setStatus)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (section !== 'about') return
    let sequence = ''
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dedication.current?.open) {
        event.stopPropagation()
        return
      }
      if (event.repeat || event.isComposing) return
      if (event.ctrlKey || event.metaKey || event.altKey) {
        sequence = ''
        return
      }
      sequence = (sequence + event.key).slice(-6)
      if (sequence === '100825') {
        sequence = ''
        event.preventDefault()
        event.stopPropagation()
        dedication.current?.showModal()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [section])

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

  const clearCache = async (accountId: string): Promise<void> => {
    if (clearingCache) return
    setClearingCache(accountId)
    setCacheError(null)
    setCacheCleared(false)
    try {
      const result = await window.api.clearMailCache(accountId)
      if (!result.canceled) {
        onCacheCleared(accountId)
        setCacheCleared(true)
        setStatus(await window.api.getCoreStatus())
      }
    } catch (cause) {
      setCacheError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setClearingCache(null)
    }
  }

  const renderSection = (): React.JSX.Element => {
    if (section === 'rules') return <RulesSection key={accountKey} />

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
              <TooltipButton className="icon-btn" type="button" onClick={() => setQuery('')} title={t('common.close')}>
                <Icon name="close" size={14} />
              </TooltipButton>
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

    if (section === 'about') {
      return (
        <div className="settings-card settings-about">
          <div className="settings-about__identity">
            <img src={logo} alt="" width={64} height={64} />
            <div>
              <h2 className="settings-about__name">NamiO</h2>
              <span className="mono">{status?.appVersion ? `v${status.appVersion}` : '—'}</span>
            </div>
          </div>
          <p className="settings-about__description">{t('settings.about.description')}</p>
          <p className="settings-card__subtitle">{t('settings.about.features')}</p>
          <dl className="diag">
            <div className="diag__row"><dt>{t('settings.about.author')}</dt><dd>PinedaMB</dd></div>
            <div className="diag__row"><dt>{t('settings.about.license')}</dt><dd>MIT</dd></div>
          </dl>
          <div className="settings-about__links">
            <button className="btn btn--primary" type="button" onClick={() => void window.api?.openExternal('https://github.com/PinedaMB/NamiO')}>
              <Icon name="code" size={16} />{t('settings.about.repository')}
            </button>
            <button className="tool-btn" type="button" onClick={() => void window.api?.openExternal('https://github.com/PinedaMB/NamiO/issues')}>
              <Icon name="bug_report" size={16} />{t('settings.about.report')}
            </button>
          </div>
          <p className="settings-card__note"><Icon name="construction" size={16} />{t('settings.about.development')}</p>
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
              <div>
                <h2 className="settings-card__title">{t('settings.images.title')}</h2>
                <p className="settings-card__subtitle">{t('settings.images.hint')}</p>
              </div>
            </div>
            <div className="seg" role="group" aria-label={t('settings.images.title')}>
              <button
                type="button"
                className={cx('seg__btn', remoteImages === 'block' && 'seg__btn--active')}
                onClick={() => setRemoteImages('block')}
                aria-pressed={remoteImages === 'block'}
              >
                <Icon name="image_not_supported" size={14} />
                {t('settings.images.block')}
              </button>
              <button
                type="button"
                className={cx('seg__btn', remoteImages === 'allow' && 'seg__btn--active')}
                onClick={() => setRemoteImages('allow')}
                aria-pressed={remoteImages === 'allow'}
              >
                <Icon name="image" size={14} />
                {t('settings.images.allow')}
              </button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card__head">
              <div>
                <h2 className="settings-card__title">{t('settings.body.title')}</h2>
                <p className="settings-card__subtitle">{t('settings.body.hint')}</p>
              </div>
            </div>
            <div className="seg" role="group" aria-label={t('settings.body.title')}>
              <button
                type="button"
                className={cx('seg__btn', bodyTheme === 'light' && 'seg__btn--active')}
                onClick={() => setBodyTheme('light')}
                aria-pressed={bodyTheme === 'light'}
              >
                <Icon name="light_mode" size={14} />
                {t('settings.body.light')}
              </button>
              <button
                type="button"
                className={cx('seg__btn', bodyTheme === 'dark' && 'seg__btn--active')}
                onClick={() => setBodyTheme('dark')}
                aria-pressed={bodyTheme === 'dark'}
              >
                <Icon name="dark_mode" size={14} />
                {t('settings.body.dark')}
              </button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card__head">
              <div>
                <h2 className="settings-card__title">{t('settings.general.diagnostics')}</h2>
                <p className="settings-card__subtitle">{t('settings.general.diagnosticsHint')}</p>
              </div>
            </div>
            <dl className="diag">
              <div className="diag__row">
                <dt>{t('settings.general.app')}</dt>
                <dd className="mono">{status?.appVersion ? `v${status.appVersion}` : '—'}</dd>
              </div>
              <div className="diag__row">
                <dt>{t('settings.general.runtime')}</dt>
                <dd className="mono">{status?.electronVersion ? `Electron ${status.electronVersion}` : '—'}</dd>
              </div>
              <div className="diag__row">
                <dt>{t('settings.general.platform')}</dt>
                <dd className="mono">{PLATFORM_NAMES[status?.platform ?? ''] ?? status?.platform ?? '—'}</dd>
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

    if (section === 'accounts') {
      return (
        <div className="settings-card">
          <div className="settings-card__head">
            <div>
              <h2 className="settings-card__title">{t('settings.accounts.title')}</h2>
              <p className="settings-card__subtitle">{t('settings.accounts.hint')}</p>
            </div>
            <button className="btn btn--primary" type="button" onClick={onAddAccount}>
              <Icon name="add" size={15} />
              {t('account.add')}
            </button>
          </div>
            <section className="settings-cache" aria-label={t('settings.cache.title')}>
              <div className="settings-cache__total">
                <span><Icon name="storage" size={16} />{t('settings.cache.title')}</span>
                <strong className="mono">{status?.cacheUsage ? formatSize(status.cacheUsage.totalBytes) : '—'}</strong>
              </div>
              {status && !status.cacheUsage && <p className="settings-card__subtitle">{t('settings.cache.unavailable')}</p>}
              {status?.cacheUsage && status.cacheUsage.unassignedBytes > 0 && <p className="settings-card__subtitle">
                {t('settings.cache.unassigned')}: {formatSize(status.cacheUsage.unassignedBytes)}
              </p>}
              <p className="settings-card__subtitle">{t('settings.cache.clearHint')}</p>
            </section>
          {cacheError && <p className="account-error" role="alert">{t('toast.actionFailed', { error: cacheError })}</p>}
          {cacheCleared && <p className="settings-card__subtitle" role="status">{t('settings.cache.cleared')}</p>}
          {accounts.length === 0 ? (
            <p className="muted">{t('settings.accounts.empty')}</p>
          ) : (
            <ul className="settings-accounts">
              {accounts.map((account) => (
                <li className="settings-accounts__row" key={account.id}>
                  <div className="settings-accounts__identity">
                    <strong>{account.label || account.user}</strong>
                    {account.label && account.label !== account.user && <span>{account.user}</span>}
                    <span className="mono">{account.host}:{account.port} · {account.auth === 'oauth2' ? 'OAuth2' : t('account.authPassword')}</span>
                    {account.active && <span className="settings-accounts__active">{t('settings.accounts.active')}</span>}
                  </div>
                  <div className="settings-accounts__actions">
                    <span className="settings-accounts__size mono">{status?.cacheUsage ? formatSize(status.cacheUsage.accounts.find(item => item.id === account.id)?.bytes ?? 0) : '—'}</span>
                    <button className="tool-btn" type="button" disabled={clearingCache !== null || !status?.cacheUsage} onClick={() => void clearCache(account.id)}>
                      <Icon name={clearingCache === account.id ? 'progress_activity' : 'cleaning_services'} size={15} className={clearingCache === account.id ? 'spin' : undefined} />
                      {t(clearingCache === account.id ? 'settings.cache.clearing' : 'settings.cache.clear')}
                    </button>
                  <button className="tool-btn" type="button" disabled={clearingCache !== null} onClick={() => account.active ? onManageAccount() : onSelectAccount(account.id)}>
                    <Icon name={account.active ? 'tune' : 'swap_horiz'} size={15} />
                    {t(account.active ? 'account.manage' : 'settings.accounts.select')}
                  </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }

    return (
      <div className="settings-card settings-card--empty">
        <span className="empty-state__icon"><Icon name="neurology" size={26} /></span>
        <h2 className="settings-card__title">{t('settings.copilot.title')}</h2>
        <p className="settings-card__subtitle">{t('settings.copilot.empty')}</p>
        <span className="chip chip--outline">{t('settings.soon')}</span>
      </div>
    )
  }

  return (
    <div className="settings">
      <header className="settings__hero">
        <div className="settings__hero-text">
          <span className="settings__eyebrow">
            <span className="dot" />
            {t('settings.engine', { stage: status?.stage ?? '—' })}
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
                  <span className="settings-nav__meta">{accounts.length}</span>
                ) : item.id === 'shortcuts' ? (
                  <span className="settings-nav__meta">{SHORTCUTS.length}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <section className="settings-card settings-card--profile" aria-label={t('settings.profile.title')}>
            <div className="profile-row">
              <span className="avatar avatar--lg avatar--accent" aria-hidden="true">{activeAccount ? activeAccount.user.slice(0, 2).toUpperCase() : 'N'}</span>
              <div className="profile-row__identity">
                <h2 className="profile-row__name">{activeAccount?.label || activeAccount?.user || t('account.demo')}</h2>
                <span className="profile-row__caption">{t(activeAccount ? 'settings.accounts.active' : 'settings.profile.title')}</span>
              </div>
            </div>
            <p className="profile-row__mail">{activeAccount?.user ?? t('sidebar.demo')}</p>
            <dl className="profile-details">
              <div className="profile-fact">
                <dt>{t('settings.profile.language')}</dt>
                <dd>{locale === 'es' ? 'Español' : 'English'}</dd>
              </div>
              <div className="profile-fact">
                <dt>{t('settings.profile.layout')}</dt>
                <dd>{t('settings.profile.layoutValue')}</dd>
              </div>
              <div className="profile-fact">
                <dt>{t('settings.general.app')}</dt>
                <dd className="mono">{status?.appVersion ? `v${status.appVersion}` : '—'}</dd>
              </div>
            </dl>
          </section>
        </aside>

        <main className="settings__main" key={section}>
          {saveError && <div className="account-error" role="alert">
            <Icon name="error" size={16} />
            <span>{t('settings.saveFailed', { error: saveError })}</span>
          </div>}
          {renderSection()}
        </main>
      </div>

      <dialog ref={dedication} className="dedication" aria-labelledby="dedication-title" aria-describedby="dedication-message">
        <img className="dedication__portrait" src={naomi} alt="" />
        <h2 id="dedication-title">{t('settings.about.dedicationTitle')}</h2>
        <p id="dedication-message">{t('settings.about.dedicationMessage')}</p>
        <button className="tool-btn" type="button" autoFocus onClick={() => dedication.current?.close()}>
          {t('common.close')}
          <kbd className="kbd">Esc</kbd>
        </button>
      </dialog>

      {remap && (
        <div className="overlay overlay--center" onMouseDown={(event) => event.target === event.currentTarget && setRemap(null)}>
          <div className="remap" role="dialog" aria-modal="true" aria-label={t('settings.shortcuts.pressKey')}>
            <div className="remap__head">
              <span className="remap__title">
                <span className="dot pulse" />
                {t('settings.shortcuts.pressKey')}
              </span>
              <TooltipButton className="icon-btn" type="button" onClick={() => setRemap(null)} title={t('common.close')}>
                <Icon name="close" size={16} />
              </TooltipButton>
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
