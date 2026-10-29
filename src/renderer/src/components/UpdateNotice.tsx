import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ipc'
import { useI18n } from '../i18n'
import { formatMessageDateTime } from '../lib/dates'
import { Icon } from './Icon'

export function UpdateNotice({ detailed = false }: { detailed?: boolean }): React.JSX.Element | null {
  const { t, locale } = useI18n()
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let current = true
    const unsubscribe = window.api?.onUpdateChanged?.(next => { current = false; setState(next) })
    void window.api?.updateStatus?.().then(next => { if (current) setState(next) }).catch(() => undefined)
    return () => { current = false; unsubscribe?.() }
  }, [])
  if (!state) return null
  const busy = ['checking', 'available', 'downloading'].includes(state.phase)
  const upToDate = state.phase === 'idle' && state.checkedAt !== undefined
  const label = state.phase === 'ready' ? t('update.install', { version: state.version ?? '' })
    : state.phase === 'downloading' ? t('update.downloading', { percent: state.percent ?? 0 })
    : state.phase === 'available' ? t('update.available', { version: state.version ?? '' })
    : state.phase === 'checking' ? t('update.checking')
    : state.phase === 'error' ? t('update.error') : t('update.check')
  const icon = state.phase === 'ready' ? 'system_update' : busy ? 'progress_activity' : upToDate ? 'check_circle' : 'update'
  const mb = (bytes: number): string => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))
  return <div className={detailed ? 'update-notice update-notice--detailed' : 'update-notice'} role={detailed ? undefined : 'status'} aria-live={detailed ? undefined : 'polite'}>
    {detailed && <div className="update-notice__summary" role="status" aria-live="polite">
      <Icon name={state.phase === 'error' ? 'error_outline' : icon} size={22} className={busy ? 'spin' : undefined} />
      <div>
        <p className="update-notice__status">{upToDate ? t('update.latest') : state.phase === 'idle' ? t('update.unchecked') : state.phase === 'ready' ? t('update.ready') : label}</p>
        {state.version && <p className="settings-card__subtitle">{t('update.version', { version: state.version })}</p>}
      </div>
    </div>}
    {state.phase === 'downloading' && <div className={detailed ? 'update-notice__download' : 'update-notice__compact-progress'}>
      <div className={detailed ? 'update-notice__progress' : 'sync-progress__bar'} role="progressbar" aria-label={t('update.downloading', { percent: state.percent ?? 0 })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? 0}>
        <span className="sync-progress__fill" style={{ width: `${state.percent ?? 0}%` }} />
      </div>
      {detailed && <div className="update-notice__metrics">
        <strong>{state.percent ?? 0}%</strong>
        {state.total !== undefined && state.total > 0 && <span>{t('update.downloadSize', { downloaded: mb(state.transferred ?? 0), total: mb(state.total) })}</span>}
        {state.bytesPerSecond !== undefined && state.bytesPerSecond > 0 && <span>{t('update.speed', { speed: mb(state.bytesPerSecond) })}</span>}
      </div>}
    </div>}
    {detailed && (state.releaseDate || state.checkedAt !== undefined) && <dl className="update-notice__details">
      {state.releaseDate && <div><dt>{t('update.published')}</dt><dd>{formatMessageDateTime(state.releaseDate, locale)}</dd></div>}
      {state.checkedAt !== undefined && <div><dt>{t('update.checked')}</dt><dd>{formatMessageDateTime(state.checkedAt, locale)}</dd></div>}
    </dl>}
    <div className="update-notice__actions">
      {(!detailed || !busy) && <button type="button" className={detailed && state.phase === 'ready' ? 'btn btn--primary' : 'update-notice__button'} disabled={busy}
        onClick={() => { void (state.phase === 'ready' ? window.api.installUpdate() : window.api.checkForUpdates()).catch(() => setState({ phase: 'error' })) }}>
        <Icon name={icon} size={14} className={busy ? 'spin' : undefined} />
        {label}
      </button>}
      {detailed && state.version && <button type="button" className="tool-btn" onClick={() => { void window.api.openExternal(`https://github.com/PinedaMB/NamiO/releases/tag/v${encodeURIComponent(state.version ?? '')}`).catch(() => undefined) }}>
        <Icon name="open_in_new" size={14} />{t('update.notes')}
      </button>}
    </div>
  </div>
}
