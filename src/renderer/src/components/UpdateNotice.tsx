import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ipc'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

export function UpdateNotice(): React.JSX.Element | null {
  const { t } = useI18n()
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let current = true
    const unsubscribe = window.api?.onUpdateChanged?.(next => { current = false; setState(next) })
    void window.api?.updateStatus?.().then(next => { if (current) setState(next) }).catch(() => undefined)
    return () => { current = false; unsubscribe?.() }
  }, [])
  if (!state) return null
  const busy = ['checking', 'available', 'downloading'].includes(state.phase)
  const label = state.phase === 'ready' ? t('update.install', { version: state.version ?? '' })
    : state.phase === 'downloading' ? t('update.downloading', { percent: state.percent ?? 0 })
    : state.phase === 'available' ? t('update.available', { version: state.version ?? '' })
    : state.phase === 'checking' ? t('update.checking')
    : state.phase === 'error' ? t('update.error') : t('update.check')
  return <div className="update-notice" role="status" aria-live="polite">
    <button type="button" className="update-notice__button" disabled={busy}
      onClick={() => { void (state.phase === 'ready' ? window.api.installUpdate() : window.api.checkForUpdates()).catch(() => setState({ phase: 'error' })) }}>
      <Icon name={state.phase === 'ready' ? 'system_update' : busy ? 'progress_activity' : 'update'} size={14} className={busy ? 'spin' : undefined} />
      {label}
    </button>
    {state.phase === 'downloading' && <span className="sync-progress__bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? 0}>
      <span className="sync-progress__fill" style={{ width: `${state.percent ?? 0}%` }} />
    </span>}
  </div>
}
