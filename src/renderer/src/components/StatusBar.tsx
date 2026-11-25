import { useEffect, useRef, useState } from 'react'
import { UpdateNotice } from './UpdateNotice'
import type { OutboxItem, SyncProgress } from '@shared/ipc'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { TooltipButton } from './Tooltip'

interface StatusBarProps {
  pending: number
  outbox?: readonly OutboxItem[]
  onRetryOutbox?: (id: string) => void
  onCancelOutbox?: (id: string) => void
  progress?: SyncProgress | null
  deletion?: OutboxItem
}

export function StatusBar({ pending, outbox = [], onRetryOutbox, onCancelOutbox, progress = null, deletion }: StatusBarProps): React.JSX.Element {
  const { t } = useI18n()
  const [queueOpen, setQueueOpen] = useState(false)
  const queueRef = useRef<HTMLDivElement>(null)
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.cached / progress.total) * 100)) : 0
  const deleting = deletion?.deletionProgress
  const deletePercent = deleting && deleting.total > 0 ? Math.min(100, Math.round(deleting.completed / deleting.total * 100)) : 0
  const deletionLabel = deletion && deleting ? t(deleting.running ? 'status.deleting' : 'status.deletePending', { folder: deletion.label, completed: deleting.completed, total: deleting.total }) : ''

  useEffect(() => {
    if (pending === 0) setQueueOpen(false)
  }, [pending])

  useEffect(() => {
    if (!queueOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!queueRef.current?.contains(event.target as Node)) setQueueOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setQueueOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [queueOpen])

  const itemLabel = (item: OutboxItem): string => {
    if (item.kind === 'draft-save') return t('draft.syncAction')
    if (item.kind === 'draft-delete') return t('draft.removeAction')
    if (item.kind === 'archive') return t('common.archive')
    if (item.kind === 'delete') return t('common.delete')
    if (item.kind === 'move') return t('common.move')
    return item.label
  }

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
          <div className="statusbar__outbox" ref={queueRef}>
            <button
              type="button"
              className="statusbar__outbox-btn"
              aria-expanded={queueOpen}
              aria-haspopup="dialog"
              onClick={() => setQueueOpen(open => !open)}
            >
              <Icon name="outbox" size={12} />
              <span>{t('outbox.pending', { count: pending })}</span>
            </button>
            {queueOpen && outbox.length > 0 && (
              <div className="outbox-popover" role="dialog" aria-label={t('outbox.title')}>
                <div className="outbox-popover__head">
                  <strong>{t('outbox.title')}</strong>
                  <TooltipButton className="icon-btn" type="button" title={t('common.close')} onClick={() => setQueueOpen(false)}>
                    <Icon name="close" size={14} />
                  </TooltipButton>
                </div>
                <ul className="outbox-popover__list">
                  {outbox.map(item => (
                    <li key={item.id} className="outbox-popover__item">
                      <div className="outbox-popover__info">
                        <span className="outbox-popover__label">{itemLabel(item)}</span>
                        <span className={item.status === 'failed' ? 'outbox-popover__meta outbox-popover__meta--error' : 'outbox-popover__meta'}>
                          {item.lastError ? item.lastError : t('outbox.queued')}
                        </span>
                      </div>
                      <div className="outbox-popover__actions">
                        {onRetryOutbox && (
                          <TooltipButton className="icon-btn" type="button" title={t('offline.retry')} onClick={() => onRetryOutbox(item.id)}>
                            <Icon name="refresh" size={14} />
                          </TooltipButton>
                        )}
                        {onCancelOutbox && (
                          <TooltipButton className="icon-btn" type="button" title={t('common.close')} onClick={() => onCancelOutbox(item.id)}>
                            <Icon name="close" size={14} />
                          </TooltipButton>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </footer>
  )
}
