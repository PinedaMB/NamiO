import { Fragment } from 'react'
import { useI18n, type TranslationKey } from '../i18n'
import { Icon } from './Icon'

interface StatusBarProps {
  appVersion: string | null
}

interface LegendEntry {
  keys: string[]
  labelKey: TranslationKey
}

const PRIMARY: ReadonlyArray<LegendEntry> = [
  { keys: ['J', 'K'], labelKey: 'status.navigate' },
  { keys: ['E'], labelKey: 'status.archive' },
  { keys: ['S'], labelKey: 'status.snooze' },
  { keys: ['R'], labelKey: 'status.reply' }
]

const SECONDARY: ReadonlyArray<LegendEntry> = [
  { keys: ['C'], labelKey: 'status.compose' },
  { keys: ['⌘K'], labelKey: 'status.actions' }
]

function LegendItem({ entry }: { entry: LegendEntry }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <span className="legend__item">
      {entry.keys.map((key) => (
        <kbd key={key} className="kbd">
          {key}
        </kbd>
      ))}
      <span>{t(entry.labelKey)}</span>
    </span>
  )
}

export function StatusBar({ appVersion }: StatusBarProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <footer className="statusbar">
      <div className="legend">
        {PRIMARY.map((entry, index) => (
          <Fragment key={entry.labelKey}>
            {index > 0 && <span className="legend__sep">·</span>}
            <LegendItem entry={entry} />
          </Fragment>
        ))}

        <span className="legend__secondary">
          {SECONDARY.map((entry) => (
            <Fragment key={entry.labelKey}>
              <span className="legend__sep">·</span>
              <LegendItem entry={entry} />
            </Fragment>
          ))}
        </span>
      </div>

      <div className="statusbar__right">
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
