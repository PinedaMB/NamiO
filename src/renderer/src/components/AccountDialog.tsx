import { useEffect, useState } from 'react'
import type { AccountState, ImapAccountConfig, ImapErrorCode, SmtpConfig } from '@shared/ipc'
import { useI18n, type TranslationKey } from '../i18n'
import { usePresence } from '../lib/usePresence'
import { configFromAccount } from '../data/live'
import { Icon } from './Icon'
import { cx } from '../lib/cx'

export const ERROR_KEYS: Record<ImapErrorCode, TranslationKey> = {
  auth: 'account.error.auth',
  dns: 'account.error.dns',
  refused: 'account.error.refused',
  timeout: 'account.error.timeout',
  tls: 'account.error.tls',
  network: 'account.error.network',
  unknown: 'account.error.unknown'
}

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

export function AccountDialog({ open, account, onClose, onConnected }: AccountDialogProps): React.JSX.Element | null {
  const { t } = useI18n()
  const { mounted, closing } = usePresence(open, 160)

  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [secure, setSecure] = useState(true)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('465')
  const [smtpSecure, setSmtpSecure] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: ImapErrorCode; detail: string } | null>(null)

  useEffect(() => {
    if (!open) return
    const current = configFromAccount(account?.account ?? null)
    setHost(current.host)
    setPort(String(current.port))
    setSecure(current.secure)
    setUser(current.user)
    setSmtpHost(current.smtp.host)
    setSmtpPort(String(current.smtp.port))
    setSmtpSecure(current.smtp.secure)
    setPassword('')
    setBusy(false)
    setError(null)
  }, [open, account])

  if (!mounted) return null

  const portNumber = Number(port)
  const smtpPortNumber = Number(smtpPort)
  const valid =
    host.trim() !== '' &&
    Number.isInteger(portNumber) &&
    portNumber > 0 &&
    portNumber < 65536 &&
    user.trim() !== '' &&
    password !== '' &&
    smtpHost.trim() !== '' &&
    Number.isInteger(smtpPortNumber) &&
    smtpPortNumber > 0 &&
    smtpPortNumber < 65536

  const applyPreset = (preset: (typeof PRESETS)[number]): void => {
    if (preset.id === 'custom') return
    setHost(preset.imap.host)
    setPort(String(preset.imap.port))
    setSecure(preset.imap.secure)
    setSmtpHost(preset.smtp.host)
    setSmtpPort(String(preset.smtp.port))
    setSmtpSecure(preset.smtp.secure)
  }

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const result = await window.api
      .accountConnect(
        {
          host: host.trim(),
          port: portNumber,
          secure,
          user: user.trim(),
          smtp: { host: smtpHost.trim(), port: smtpPortNumber, secure: smtpSecure }
        },
        password
      )
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
          <button className="icon-btn" type="button" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="account-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={cx('chip', 'account-preset', host === preset.imap.host && 'chip--primary')}
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
            <span>{t('account.host')}</span>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
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

          <label className="account-field">
            <span>{t('account.user')}</span>
            <input
              value={user}
              onChange={(event) => setUser(event.target.value)}
              placeholder="vos@ejemplo.com"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="account-field">
            <span>{t('account.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </label>

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

          <p className="account-hint">
            <Icon name="info" size={14} />
            {t('account.hint')}
          </p>

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
                <span>{error.detail}</span>
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
                {busy ? t('account.testing') : t('account.test')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
