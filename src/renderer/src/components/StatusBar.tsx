import { UpdateNotice } from './UpdateNotice'
import type { OutboxItem, SyncProgress } from '@shared/ipc'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

interface StatusBarProps {
  pending: number
  progress?: SyncProgress | null
  deletion?: OutboxItem
}

export function StatusBar({ pending, progress = null, deletion }: StatusBarProps): React.JSX.Element {
  const { t } = useI18n()
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.cached / progress.total) * 100)) : 0
  const deleting = deletion?.deletionProgress
  const deletePercent = deleting && deleting.total > 0 ? Math.min(100, Math.round(deleting.completed / deleting.total * 100)) : 0
  const deletionLabel = deletion && deleting ? t(deleting.running ? 'status.deleting' : 'status.deletePending', { folder: deletion.label, completed: deleting.completed, total: deleting.total }) : ''

  return (
    <footer className="statusbar">
      {deletion && deleting ? (
        <div className="sync-progress deletion-progress" role="status" aria-live="polite" data-tooltip={deletionLabel} tabIndex={0}>
          <Icon name={deleting.running ? 'progress_activity' : 'schedule'} size={14} className={deleting.running ? 'spin' : undefined} />
          <span className="sync-progress__label">{deletionLabel}</span>
          {deleting.running && <span className="sync-progress__bar" role="progressbar" aria-label={t('common.deleting')} aria-valuemin={0} aria-valuemax={deleting.total} aria-valuenow={deleting.completed}>
            <span className="sync-progress__fill" style={{ width: `${deletePercent}%` }} />
          </span>}
        </div>
      ) : null}

      <div className="statusbar__right">
        <UpdateNotice />
        {progress && (
          <span className="sync-progress" data-tooltip={t(progress.phase === 'bodies' ? 'sync.bodiesProgress' : 'sync.progress', { cached: progress.cached, total: progress.total })} tabIndex={0}>
            <Icon name="cloud_download" size={12} />
            <span className="sync-progress__label">
              {t(progress.phase === 'bodies' ? 'sync.bodiesProgress' : 'sync.progress', { cached: progress.cached, total: progress.total })}
            </span>
            <span className="sync-progress__bar">
              <span className="sync-progress__fill" style={{ width: `${percent}%` }} />
            </span>
          </span>
        )}
        {pending > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--tertiary)' }}>
            <Icon name="outbox" size={12} />
            {t('outbox.pending', { count: pending })}
          </span>
        )}
      </div>
    </footer>
  )
}
