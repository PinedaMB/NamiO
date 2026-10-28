import { useState } from 'react'
import type { AccountConfig, AccountState, SmtpConfig } from '@shared/ipc'
import { GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID } from '@shared/oauth'
import logo from '../assets/logo.png'
import { useI18n, type TranslationKey } from '../i18n'
import { cx } from '../lib/cx'
import { Icon } from './Icon'
import { ERROR_KEYS } from './errorKeys'
import { PasswordField } from './PasswordField'

export type OnboardingChoice = 'gmail' | 'outlook' | 'yahoo' | 'custom' | 'local'

interface OnboardingProps {
  onConnected: (state: AccountState) => void
  onDemo: () => void
}

interface ProviderPreset {
  imap: { host: string; port: number; secure: boolean }
  smtp: SmtpConfig
  oauth: boolean
  provider: 'google' | 'microsoft' | null
}

const PRESETS: Record<OnboardingChoice, ProviderPreset> = {
  gmail: {
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    oauth: true,
    provider: 'google'
  },
  outlook: {
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    oauth: true,
    provider: 'microsoft'
  },
  yahoo: {
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    oauth: false,
    provider: null
  },
  local: {
    imap: { host: '127.0.0.1', port: 1143, secure: false },
    smtp: { host: '127.0.0.1', port: 1025, secure: false },
    oauth: false,
    provider: null
  },
  custom: {
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    oauth: false,
    provider: null
  }
}

const CHOICES: ReadonlyArray<{
  id: OnboardingChoice
  icon: string
  titleKey: TranslationKey
  hintKey: TranslationKey
  badgeKey?: TranslationKey
}> = [
  {
    id: 'gmail',
    icon: 'mail',
    titleKey: 'onboarding.gmail',
    hintKey: 'onboarding.gmailHint',
    badgeKey: 'onboarding.oauthBadge'
  },
  {
    id: 'outlook',
    icon: 'mark_email_unread',
    titleKey: 'onboarding.outlook',
    hintKey: 'onboarding.outlookHint',
    badgeKey: 'onboarding.oauthBadge'
  },
  { id: 'yahoo', icon: 'mail', titleKey: 'onboarding.yahoo', hintKey: 'onboarding.yahooHint' },
  { id: 'custom', icon: 'dns', titleKey: 'onboarding.custom', hintKey: 'onboarding.customHint' },
  { id: 'local', icon: 'terminal', titleKey: 'onboarding.local', hintKey: 'onboarding.localHint' }
]

/**
 * Primera pantalla: elegir cómo entrar. No bloquea: la demo siempre está a un click.
 * El alta se hace acá; el diálogo de cuenta queda para ajustes posteriores.
 */
export function Onboarding({ onConnected, onDemo }: OnboardingProps): React.JSX.Element {
  const { t } = useI18n()
  const [choice, setChoice] = useState<OnboardingChoice | null>(null)
  const [error, setError] = useState<{ code: keyof typeof ERROR_KEYS; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [gmailPassword, setGmailPassword] = useState(false)
  const preset = choice ? { ...PRESETS[choice], oauth: PRESETS[choice].oauth && !(choice === 'gmail' && gmailPassword) } : null

  // Campos del alta
  const [user, setUser] = useState('')
  const [label, setLabel] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [secure, setSecure] = useState(true)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('465')
  const [smtpSecure, setSmtpSecure] = useState(true)

  const openForm = (next: OnboardingChoice): void => {
    const config = PRESETS[next]
    setChoice(next)
    setGmailPassword(false)
    setError(null)
    setPassword('')
    setUser('')
    setHost(config.imap.host)
    setPort(String(config.imap.port))
    setSecure(config.imap.secure)
    setSmtpHost(config.smtp.host)
    setSmtpPort(String(config.smtp.port))
    setSmtpSecure(config.smtp.secure)
  }

  const back = (): void => {
    setChoice(null)
    setError(null)
  }

  const portNumber = Number(port)
  const smtpPortNumber = Number(smtpPort)
  // Un espacio o coma en el correo es error de tipeo seguro; la falta de @ solo avisa.
  const userHasSpaces = /[\s,]/.test(user)
  const userMissingAt = user.trim() !== '' && !user.includes('@')
  const valid =
    preset !== null &&
    host.trim() !== '' &&
    user.trim() !== '' &&
    !userHasSpaces &&
    Number.isInteger(portNumber) &&
    portNumber > 0 &&
    portNumber < 65536 &&
    smtpHost.trim() !== '' &&
    Number.isInteger(smtpPortNumber) &&
    smtpPortNumber > 0 &&
    smtpPortNumber < 65536 &&
    (preset.oauth || password !== '')

  const connect = async (): Promise<void> => {
    if (!preset || !valid || busy) return
    setBusy(true)
    setError(null)

    const config: AccountConfig = {
      host: host.trim(),
      port: portNumber,
      secure,
      user: user.trim(),
      label: label.trim(),
      smtp: { host: smtpHost.trim(), port: smtpPortNumber, secure: smtpSecure },
      auth: preset.oauth ? 'oauth2' : 'password',
      ...(preset.oauth && preset.provider
        ? {
            oauth: {
              provider: preset.provider,
              clientId: preset.provider === 'microsoft' ? MICROSOFT_CLIENT_ID : GOOGLE_CLIENT_ID,
              clientSecret: ''
            }
          }
        : {})
    }

    const result = preset.oauth
      ? await window.api
          .accountConnectOAuth(config)
          .catch(() => ({ ok: false as const, code: 'unknown' as const, detail: 'IPC' }))
      : await window.api
          .accountConnect(config, password)
          .catch(() => ({ ok: false as const, code: 'unknown' as const, detail: 'IPC' }))

    setBusy(false)
    if (!result.ok) {
      setError({ code: result.code, detail: result.detail })
      return
    }

    onConnected(result.data)
  }

  return (
    <div className="onboarding">
      <div className="onboarding__panel">
        <div className="onboarding__brand">
          <img className="onboarding__logo" src={logo} alt="" aria-hidden="true" />
          <span className="onboarding__wordmark">NamiO</span>
        </div>

        {choice === null ? (
          <>
            <h1 className="onboarding__title">{t('onboarding.title')}</h1>
            <p className="onboarding__subtitle">{t('onboarding.subtitle')}</p>

            <div className="onboarding__grid">
              {CHOICES.map((item) => (
                <button
                  key={item.id}
                  className="onboarding__card"
                  type="button"
                  onClick={() => openForm(item.id)}
                >
                  <span className="onboarding__icon">
                    <Icon name={item.icon} size={20} />
                  </span>
                  <span className="onboarding__card-text">
                    <span className="onboarding__card-title">
                      {t(item.titleKey)}
                      {item.badgeKey && <span className="chip chip--accent">{t(item.badgeKey)}</span>}
                    </span>
                    <span className="onboarding__card-hint">{t(item.hintKey)}</span>
                  </span>
                  <Icon name="chevron_right" size={18} className="onboarding__chevron" />
                </button>
              ))}
            </div>

            <p className="onboarding__note">
              <Icon name="lock" size={14} />
              {t('onboarding.note')}
            </p>

            <div className="onboarding__foot">
              <button className="onboarding__demo" type="button" onClick={onDemo}>
                <Icon name="visibility" size={16} />
                {t('onboarding.demo')}
              </button>
              <span className="onboarding__demo-hint">{t('onboarding.demoHint')}</span>
            </div>
          </>
        ) : (
          <>
            <div className="onboarding__head">
              <button className="onboarding__back" type="button" onClick={back}>
                <Icon name="arrow_back" size={16} />
                {t('onboarding.change')}
              </button>
              <h1 className="onboarding__title onboarding__title--sm">
                {t(
                  choice === 'gmail'
                    ? 'onboarding.gmail'
                    : choice === 'outlook'
                      ? 'onboarding.outlook'
                      : choice === 'yahoo'
                        ? 'onboarding.yahoo'
                      : choice === 'local'
                        ? 'onboarding.local'
                        : 'onboarding.custom'
                )}
              </h1>
              <p className="onboarding__subtitle onboarding__subtitle--sm">
                {t(choice === 'outlook'
                  ? 'account.microsoftHint'
                  : preset?.oauth ? 'onboarding.oauthFormHint' : 'onboarding.passwordFormHint')}
              </p>
            </div>

            <form
              className="onboarding__form"
              onSubmit={(event) => {
                event.preventDefault()
                void connect()
              }}
            >
              <label className="account-field">
                <span>{t('account.label')}</span>
                <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder={t('account.labelPlaceholder')} />
              </label>
              <label className="account-field">
                <span>{preset?.oauth ? t('onboarding.email') : t('onboarding.emailOrUser')}</span>
                <input
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                  placeholder="vos@ejemplo.com"
                  autoComplete="username"
                  spellCheck={false}
                  aria-invalid={userHasSpaces || undefined}
                />
              </label>
              {userHasSpaces && <p className="onboarding__field-hint">{t('account.emailInvalid')}</p>}
              {!userHasSpaces && userMissingAt && (
                <p className="onboarding__field-hint">{t('account.emailWarning')}</p>
              )}

              {choice === 'gmail' && (
                <div className="account-field">
                  <span>{t('account.auth')}</span>
                  <div className="seg" role="group" aria-label={t('account.auth')}>
                    <button type="button" className={cx('seg__btn', !gmailPassword && 'seg__btn--active')} aria-pressed={!gmailPassword} onClick={() => { setGmailPassword(false); setPassword(''); setError(null) }}>
                      {t('account.authOAuth')}
                    </button>
                    <button type="button" className={cx('seg__btn', gmailPassword && 'seg__btn--active')} aria-pressed={gmailPassword} onClick={() => { setGmailPassword(true); setError(null) }}>
                      {t('account.appPassword')}
                    </button>
                  </div>
                  <em className="account-field__hint">{t('account.gmailHint')}</em>
                  {gmailPassword && <button className="tool-btn" type="button" onClick={() => void window.api?.openExternal('https://myaccount.google.com/apppasswords')}>{t('account.googleAppPassword')}</button>}
                </div>
              )}

              {preset?.oauth ? (choice !== 'outlook' && (
                <>
                  <p className="account-hint">{t('account.googleOAuthHint')}</p>
                </>
              )) : (
                <>
                  <label className="account-field">
                    <span>{t(choice === 'gmail' || choice === 'yahoo' ? 'account.appPassword' : 'account.password')}</span>
                    <PasswordField
                      value={password}
                      onChange={setPassword}
                      ariaLabel={t(choice === 'gmail' || choice === 'yahoo' ? 'account.appPassword' : 'account.password')}
                      autoComplete="current-password"
                    />
                    {(choice === 'gmail' || choice === 'yahoo') && <em className="account-field__hint">{t('account.appPasswordHint')}</em>}
                  </label>

                  <details className="account-advanced" open={choice === 'custom' || choice === 'local'}>
                    <summary>{t('account.advanced')}</summary>
                    <div className="account-form">
                  <div className="account-section">
                    <span className="account-section__title">{t('account.smtp')}</span>
                    <div className="account-row account-row--host">
                      <label className="account-field">
                        <span>{t('account.host')}</span>
                        <input
                          value={smtpHost}
                          onChange={(event) => setSmtpHost(event.target.value)}
                          placeholder="smtp.example.com"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      <label className="account-field account-field--port">
                        <span>{t('account.port')}</span>
                        <input
                          value={smtpPort}
                          onChange={(event) => setSmtpPort(event.target.value.replace(/[^\d]/g, ''))}
                          inputMode="numeric"
                          placeholder="465"
                        />
                      </label>
                      <div className="account-field">
                        <span>{t('account.tls')}</span>
                        <div className="seg" role="group" aria-label={t('account.tls')}>
                          <button
                            type="button"
                            className={cx('seg__btn', smtpSecure && 'seg__btn--active')}
                            onClick={() => setSmtpSecure(true)}
                            aria-pressed={smtpSecure}
                          >
                            {t('account.tlsOn')}
                          </button>
                          <button
                            type="button"
                            className={cx('seg__btn', !smtpSecure && 'seg__btn--active')}
                            onClick={() => setSmtpSecure(false)}
                            aria-pressed={!smtpSecure}
                          >
                            {t('account.tlsOff')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="account-section">
                      <span className="account-section__title">{t('onboarding.imapSection')}</span>
                      <div className="account-row account-row--host">
                        <label className="account-field">
                          <span>{t('account.host')}</span>
                          <input
                            value={host}
                            onChange={(event) => setHost(event.target.value)}
                            placeholder="imap.example.com"
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </label>
                        <label className="account-field account-field--port">
                          <span>{t('account.port')}</span>
                          <input
                            value={port}
                            onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ''))}
                            inputMode="numeric"
                            placeholder="993"
                          />
                        </label>
                        <div className="account-field">
                          <span>{t('account.tls')}</span>
                          <div className="seg" role="group" aria-label={t('account.tls')}>
                            <button
                              type="button"
                              className={cx('seg__btn', secure && 'seg__btn--active')}
                              onClick={() => setSecure(true)}
                              aria-pressed={secure}
                            >
                              {t('account.tlsOn')}
                            </button>
                            <button
                              type="button"
                              className={cx('seg__btn', !secure && 'seg__btn--active')}
                              onClick={() => setSecure(false)}
                              aria-pressed={!secure}
                            >
                              {t('account.tlsOff')}
                            </button>
                          </div>
                        </div>
                      </div>
                  </div>
                    </div>
                  </details>
                </>
              )}

              {error && (
                <p className="onboarding__error" role="alert">
                  <Icon name="error" size={15} />
                  <span>
                    <strong>{t(ERROR_KEYS[error.code])}</strong>
                    {error.detail}
                    {error.code === 'auth' && (
                      <em className="onboarding__error-hint">
                        {t('account.authUser')} <b className="mono">{user}</b>
                        <br />
                        {t('account.authHint')}
                      </em>
                    )}
                  </span>
                </p>
              )}

              <div className="onboarding__actions">
                <button className="btn btn--primary" type="submit" disabled={!valid || busy}>
                  {busy && <Icon name="progress_activity" size={15} className="spin" />}
                  {busy
                    ? t('onboarding.connecting')
                    : preset?.oauth
                      ? t(choice === 'gmail' ? 'account.googleSignIn' : 'onboarding.connectBrowser')
                      : t('onboarding.connect')}
                </button>
                <span className="onboarding__actions-hint">{t('onboarding.advancedHint')}</span>
              </div>
            </form>

            <p className="onboarding__note">
              <Icon name="lock" size={14} />
              {t('onboarding.note')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
