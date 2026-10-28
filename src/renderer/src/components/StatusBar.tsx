import { Fragment } from 'react'
import { UpdateNotice } from './UpdateNotice'
import type { OutboxItem, SyncProgress } from '@shared/ipc'
import { useI18n, type TranslationKey } from '../i18n'
import { formatCombo, type Bindings } from '../settings/shortcuts'
import { Icon } from './Icon'

interface StatusBarProps {
  appVersion: string | null
  bindings: Bindings
  /** Elementos esperando en la cola de salida. */
  pending: number
  /** Descarga completa del buzón en curso. */
  progress?: SyncProgress | null
  deletion?: OutboxItem
}

interface LegendEntry {
  keys: string[]
  labelKey: TranslationKey
}

function LegendItem({ entry }: { entry: LegendEntry }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <span className="legend__item">
      {entry.keys.map((key) => (
        <kbd key={key} className="kbd">
          {formatCombo(key)}
        </kbd>
      ))}
      <span>{t(entry.labelKey)}</span>
    </span>
  )
}

export function StatusBar({ appVersion, bindings, pending, progress = null, deletion }: StatusBarProps): React.JSX.Element {
  const { t } = useI18n()
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.cached / progress.total) * 100)) : 0
  const deleting = deletion?.deletionProgress
  const deletePercent = deleting && deleting.total > 0 ? Math.min(100, Math.round(deleting.completed / deleting.total * 100)) : 0
  const deletionLabel = deletion && deleting ? t(deleting.running ? 'status.deleting' : 'status.deletePending', { folder: deletion.label, completed: deleting.completed, total: deleting.total }) : ''

  // La leyenda sale de los atajos activos: si remapeás, el pie lo refleja.
  const primary: ReadonlyArray<LegendEntry> = [
    { keys: [bindings.prev, bindings.next], labelKey: 'status.navigate' },
    { keys: [bindings.archive], labelKey: 'status.archive' },
    { keys: [bindings.star], labelKey: 'status.star' },
    { keys: [bindings.reply], labelKey: 'status.reply' }
  ]

  const secondary: ReadonlyArray<LegendEntry> = [
    { keys: [bindings.compose], labelKey: 'status.compose' },
    { keys: [bindings.palette], labelKey: 'status.actions' }
  ]

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
      ) : <div className="legend">
        {primary.map((entry, index) => (
          <Fragment key={entry.labelKey}>
            {index > 0 && <span className="legend__sep">·</span>}
            <LegendItem entry={entry} />
          </Fragment>
        ))}

        <span className="legend__secondary">
          {secondary.map((entry) => (
            <Fragment key={entry.labelKey}>
              <span className="legend__sep">·</span>
              <LegendItem entry={entry} />
            </Fragment>
          ))}
        </span>
      </div>}

      <div className="statusbar__right">
        <UpdateNotice />
        {progress && (
          <span className="sync-progress" data-tooltip={t('sync.progress', { cached: progress.cached, total: progress.total })} tabIndex={0}>
            <Icon name="cloud_download" size={12} />
            <span className="sync-progress__label">
              {t('sync.progress', { cached: progress.cached, total: progress.total })}
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot dot--tertiary" />
          {t('status.offline')}
        </span>
        <span>24 ms</span>
        {appVersion && (
          <span className="statusbar__version" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="memory" size={12} />
            v{appVersion}
          </span>
        )}
      </div>
    </footer>
  )
}
