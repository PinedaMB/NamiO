import { TooltipButton } from './Tooltip'
import { useEffect, useRef, useState } from 'react'
import type {
  AccountConfig,
  AccountState,
  AuthMethod,
  ImapAccountConfig,
  ImapErrorCode,
  OAuthProvider,
  SmtpConfig
} from '@shared/ipc'
import { MICROSOFT_CLIENT_ID } from '@shared/oauth'
import { useI18n } from '../i18n'
import { usePresence } from '../lib/usePresence'
import { configFromAccount } from '../data/live'
import { Icon } from './Icon'
import { cx } from '../lib/cx'
import { ERROR_KEYS } from './errorKeys'
import { PasswordField } from './PasswordField'

export { ERROR_KEYS }

interface AccountDialogProps {
  open: boolean
  account: AccountState | null
  onClose: () => void
  onConnected: (state: AccountState) => void
}

const PRESETS: ReadonlyArray<{ id: string; imap: ImapAccountConfig; smtp: SmtpConfig }> = [
  {
    id: 'gmail',
    imap: { host: 'imap.gmail.com', port: 993, secure: true, user: '' },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true }
  },
  {
    id: 'outlook',
    imap: { host: 'outlook.office365.com', port: 993, secure: true, user: '' },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false }
  },
  {
    id: 'yahoo',
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true, user: '' },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true }
  },
  {
    id: 'local',
    imap: { host: '127.0.0.1', port: 1143, secure: false, user: '' },
    smtp: { host: '127.0.0.1', port: 1025, secure: false }
  },
  {
    id: 'custom',
    imap: { host: '', port: 993, secure: true, user: '' },
    smtp: { host: '', port: 465, secure: true }
  }
]

function serverFromEmail(email: string): string {
  const domain = /^[^\s@,]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(email.trim())?.[1]
  return domain ? `email.${domain.toLowerCase()}` : ''
}

export function AccountDialog({ open, account, onClose, onConnected }: AccountDialogProps): React.JSX.Element | null {
  const { t } = useI18n()
  const { mounted, closing } = usePresence(open, 160)

  const [presetId, setPresetId] = useState('custom')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [secure, setSecure] = useState(true)
  const [user, setUser] = useState('')
  const [label, setLabel] = useState('')
  const [password, setPassword] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('465')
  const [smtpSecure, setSmtpSecure] = useState(true)
  const [auth, setAuth] = useState<AuthMethod>('password')
  const [provider, setProvider] = useState<OAuthProvider>('google')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [tokenUrl, setTokenUrl] = useState('')
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: ImapErrorCode; detail: string } | null>(null)

  // El formulario se inicializa al ABRIR, no cada vez que App refresca la cuenta:
  // si dependiera del objeto `account`, un refresco en vuelo borraría lo tipeado.
  const accountRef = useRef(account)
  accountRef.current = account

  useEffect(() => {
    if (!open) return
    const current = configFromAccount(accountRef.current?.account ?? null)
    const preset = PRESETS.find(item => item.id !== 'custom' && item.imap.host === current.host)
    const presetAuth = preset?.id === 'gmail' || preset?.id === 'outlook' ? 'oauth2' : 'password'
    setPresetId(preset && (current.auth ?? 'password') === presetAuth ? preset.id : 'custom')
    setHost(current.host)
    setPort(String(current.port))
    setSecure(current.secure)
    setUser(current.user)
    setLabel(current.label ?? '')
    setSmtpHost(current.smtp.host)
    setSmtpPort(String(current.smtp.port))
    setSmtpSecure(current.smtp.secure)
    setAuth(current.auth ?? 'password')
    setProvider(current.oauth?.provider ?? 'google')
    setClientId(current.oauth?.clientId ?? '')
    setClientSecret(current.oauth?.clientSecret ?? '')
    setAuthUrl(current.oauth?.authUrl ?? '')
    setTokenUrl(current.oauth?.tokenUrl ?? '')
    setScope(current.oauth?.scope ?? '')
    setPassword('')
    setBusy(false)
    setError(null)
  }, [open])

  if (!mounted) return null

  const portNumber = Number(port)
  const smtpPortNumber = Number(smtpPort)
  const needsOAuth = /^outlook\.office365\.com$/i.test(host.trim())
  const gmail = /^imap\.gmail\.com$/i.test(host.trim())
  const yahoo = /^imap\.mail\.yahoo\.com$/i.test(host.trim())
  const appPassword = auth === 'password' && (gmail || yahoo)
  const microsoft = auth === 'oauth2' && provider === 'microsoft'
  const endpointsOk =
    provider !== 'custom' || (authUrl.trim() !== '' && tokenUrl.trim() !== '' && scope.trim() !== '')
  // Espacios o comas en el usuario son error de tipeo; falta de @ solo avisa.
  const userHasSpaces = /[\s,]/.test(user)
  const userMissingAt = user.trim() !== '' && !user.includes('@')
  const valid =
    host.trim() !== '' &&
    Number.isInteger(portNumber) &&
    portNumber > 0 &&
    portNumber < 65536 &&
    user.trim() !== '' &&
    !userHasSpaces &&
    smtpHost.trim() !== '' &&
    Number.isInteger(smtpPortNumber) &&
    smtpPortNumber > 0 &&
    smtpPortNumber < 65536 &&
    (auth === 'oauth2' ? (provider === 'microsoft' || clientId.trim() !== '') && endpointsOk : password !== '')

  const applyPreset = (preset: (typeof PRESETS)[number]): void => {
    setPresetId(preset.id)
    setPassword('')
    setError(null)
    setHost(preset.imap.host)
    setPort(String(preset.imap.port))
    setSecure(preset.imap.secure)
    setSmtpHost(preset.smtp.host)
    setSmtpPort(String(preset.smtp.port))
    setSmtpSecure(preset.smtp.secure)

    // OAuth2 es el valor inicial para Gmail y Outlook.
    if (preset.id === 'gmail' || preset.id === 'outlook') {
      setAuth('oauth2')
      setProvider(preset.id === 'gmail' ? 'google' : 'microsoft')
    } else {
      setAuth('password')
      setProvider('custom')
    }
  }

  const updateUser = (value: string): void => {
    setUser(value)
    if (presetId !== 'custom') return
    const previous = serverFromEmail(user)
    const next = serverFromEmail(value)
    if (!host || host === previous) setHost(next)
    if (!smtpHost || smtpHost === previous) setSmtpHost(next)
  }

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    const config: AccountConfig = {
      host: host.trim(),
      port: portNumber,
      secure,
      user: user.trim(),
      label: label.trim(),
      smtp: { host: smtpHost.trim(), port: smtpPortNumber, secure: smtpSecure },
      auth
    }

    const result =
      auth === 'oauth2'
        ? await window.api
            .accountConnectOAuth({
              ...config,
              oauth: {
                provider,
                clientId: provider === 'microsoft' ? MICROSOFT_CLIENT_ID : clientId.trim(),
                clientSecret: provider === 'microsoft' ? '' : clientSecret,
                ...(provider === 'custom'
                  ? { authUrl: authUrl.trim(), tokenUrl: tokenUrl.trim(), scope: scope.trim() }
                  : {})
              }
            })
            .catch(() => ({ ok: false as const, code: 'unknown' as const, detail: 'IPC error' }))
        : await window.api
            .accountConnect(config, password)
            .catch(() => ({ ok: false as const, code: 'unknown' as const, detail: 'IPC error' }))

    setBusy(false)
    if (!result.ok) {
      setError({ code: result.code, detail: result.detail })
      return
    }

    setPassword('')
    onConnected(result.data)
  }

  const disconnect = async (): Promise<void> => {
    await window.api.accountDisconnect().catch(() => undefined)
    setPassword('')
    onClose()
  }

  return (
    <div
      className={cx('overlay overlay--center', closing && 'overlay--closing')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="account-modal" role="dialog" aria-modal="true" aria-label={t('account.title')}>
        <div className="account-modal__head">
          <div>
            <h2 className="account-modal__title">{t('account.title')}</h2>
            <p className="account-modal__subtitle">{t('account.subtitle')}</p>
          </div>
          <TooltipButton className="icon-btn" type="button" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={16} />
          </TooltipButton>
        </div>

        <div className="account-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={cx('chip', 'account-preset', presetId === preset.id && 'chip--primary')}
              aria-pressed={presetId === preset.id}
              onClick={() => applyPreset(preset)}
            >
              {preset.id === 'custom' ? t('account.custom') : preset.id === 'local' ? t('account.local') : preset.id === 'gmail' ? 'Gmail' : preset.id === 'outlook' ? 'Outlook' : 'Yahoo'}
            </button>
          ))}
        </div>

        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="account-field">
            <span>{t('account.label')}</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder={t('account.labelPlaceholder')} />
          </label>
          {account?.configured && label.trim() !== (account.account?.label ?? '') && (
            <button className="tool-btn" type="button" disabled={busy} onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const result = await window.api.accountRename(label)
                if (result.ok) onConnected(result.data)
                else setError({ code: result.code, detail: result.detail })
              } catch {
                setError({ code: 'unknown', detail: 'IPC' })
              } finally {
                setBusy(false)
              }
            }}>
              {t('account.saveName')}
            </button>
          )}

          <label className="account-field">
            <span>{t(microsoft ? 'onboarding.email' : 'account.user')}</span>
            <input
              value={user}
              onChange={(event) => updateUser(event.target.value)}
              placeholder="vos@ejemplo.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={userHasSpaces || undefined}
            />
            {userHasSpaces && <em className="account-field__hint">{t('account.emailInvalid')}</em>}
            {!userHasSpaces && userMissingAt && (
              <em className="account-field__hint">{t('account.emailWarning')}</em>
            )}
          </label>

          {microsoft && (
            <p className="account-hint">
              <Icon name="lock" size={14} />
              {t('account.microsoftHint')}
            </p>
          )}

          {auth === 'password' && (
            <label className="account-field">
              <span>{t(appPassword ? 'account.appPassword' : 'account.password')}</span>
              <PasswordField
                value={password}
                onChange={setPassword}
                ariaLabel={t(appPassword ? 'account.appPassword' : 'account.password')}
                autoComplete="new-password"
              />
              {appPassword && <em className="account-field__hint">{t('account.appPasswordHint')}</em>}
            </label>
          )}

          <details className="account-advanced" key={String(open)}>
            <summary>{t('account.advanced')}</summary>
            <div className="account-form">
              <fieldset className="account-section">
                <legend className="account-section__title">{t('account.imap')}</legend>
              <label className="account-field">
                <span>{t('account.host')}</span>
                <input
                  value={host}
                  onChange={(event) => { setHost(event.target.value); setPresetId('custom') }}
                  placeholder="imap.example.com"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <div className="account-row">
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

              </fieldset>

              {(presetId === 'custom' || auth === 'oauth2') && <fieldset className="account-section">
                <legend className="account-section__title">{t('account.auth')}</legend>
              {presetId === 'custom' && <div className="account-field">
                <div className="seg" role="group" aria-label={t('account.auth')}>
                  <TooltipButton
                    type="button"
                    className={cx('seg__btn', auth === 'password' && 'seg__btn--active')}
                    onClick={() => setAuth('password')}
                    aria-pressed={auth === 'password'}
                    disabled={needsOAuth}
                    title={needsOAuth ? t('account.oauthRequired') : undefined}
                  >
                    {t('account.authPassword')}
                  </TooltipButton>
                  <button
                    type="button"
                    className={cx('seg__btn', auth === 'oauth2' && 'seg__btn--active')}
                    onClick={() => {
                      setAuth('oauth2')
                    }}
                    aria-pressed={auth === 'oauth2'}
                  >
                    {t('account.authOAuth')}
                  </button>
                </div>
                {(needsOAuth || gmail) && <em className="account-field__hint">{t(needsOAuth ? 'account.oauthRequired' : 'account.gmailHint')}</em>}
              </div>}

              {auth === 'oauth2' && (
                <>
                  <label className="account-field">
                    <span>{t('account.oauthProvider')}</span>
                    <div className="seg" role="group" aria-label={t('account.oauthProvider')}>
                      {(['google', 'microsoft', 'custom'] as const).map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={cx('seg__btn', provider === id && 'seg__btn--active')}
                          onClick={() => {
                            if (id === 'custom') {
                              setProvider(id)
                            } else {
                              const preset = PRESETS.find((item) => item.id === (id === 'google' ? 'gmail' : 'outlook'))
                              if (preset) applyPreset(preset)
                            }
                          }}
                          aria-pressed={provider === id}
                        >
                          {id === 'google' ? 'Google' : id === 'microsoft' ? 'Microsoft' : t('account.oauthCustom')}
                        </button>
                      ))}
                    </div>
                  </label>

                  {provider !== 'microsoft' && (
                    <>
                      <label className="account-field">
                        <span>{t('account.clientId')}</span>
                        <input
                          value={clientId}
                          onChange={(event) => setClientId(event.target.value)}
                          placeholder="1234-abc.apps.googleusercontent.com"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>

                      <label className="account-field">
                        <span>{t('account.clientSecret')}</span>
                        <input
                          value={clientSecret}
                          onChange={(event) => setClientSecret(event.target.value)}
                          placeholder="GOCSPX-…"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                    </>
                  )}

                  {provider === 'custom' && (
                    <>
                      <label className="account-field">
                        <span>{t('account.authUrl')}</span>
                        <input
                          value={authUrl}
                          onChange={(event) => setAuthUrl(event.target.value)}
                          placeholder="https://proveedor/auth"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      <label className="account-field">
                        <span>{t('account.tokenUrl')}</span>
                        <input
                          value={tokenUrl}
                          onChange={(event) => setTokenUrl(event.target.value)}
                          placeholder="https://proveedor/token"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      <label className="account-field">
                        <span>{t('account.scope')}</span>
                        <input
                          value={scope}
                          onChange={(event) => setScope(event.target.value)}
                          placeholder="openid email https://mail.example.com/"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                    </>
                  )}

                  {!microsoft && (
                    <p className="account-hint">
                      <Icon name="info" size={14} />
                      {t('account.oauthHint')}
                    </p>
                  )}
                </>
              )}

              </fieldset>}

              <fieldset className="account-section">
                <legend className="account-section__title">{t('account.smtp')}</legend>
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
                <div className="account-row">
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
              </fieldset>

              <p className="account-hint">
                <Icon name="info" size={14} />
                {t('account.hint')}
              </p>
            </div>
          </details>

          {account?.configured && !account.passwordStored && (
            <p className="account-hint account-hint--warn">
              <Icon name="key_off" size={14} />
              {t('account.notStored')}
            </p>
          )}

          {error && (
            <div className="account-error" role="alert">
              <Icon name="error" size={16} />
              <div>
                <strong>{t(ERROR_KEYS[error.code])}</strong>
                <span className="account-error__detail">{error.detail}</span>
                {error.code === 'auth' && (
                  <span className="account-error__hint">
                    {t('account.authUser')} <b className="mono">{user}</b>
                    <br />
                    {t('account.authHint')}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="account-modal__foot">
            {account?.configured ? (
              <button className="tool-btn btn--danger" type="button" onClick={() => void disconnect()}>
                <Icon name="link_off" size={15} />
                {t('account.disconnect')}
              </button>
            ) : (
              <span />
            )}

            <div className="account-modal__actions">
              <button className="tool-btn" type="button" onClick={onClose}>
                {t('account.cancel')}
              </button>
              <button className="btn btn--primary" type="submit" disabled={!valid || busy}>
                {busy && <Icon name="progress_activity" size={15} className="spin" />}
                {busy
                  ? t('account.testing')
                  : auth === 'oauth2'
                    ? t('account.connectBrowser')
                    : t('account.test')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
