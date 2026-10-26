import { Fragment } from 'react'
import { Icon } from './Icon'

interface StatusBarProps {
  appVersion: string | null
}

interface LegendEntry {
  keys: string[]
  label: string
}

const PRIMARY: ReadonlyArray<LegendEntry> = [
  { keys: ['J', 'K'], label: 'Navigate' },
  { keys: ['E'], label: 'Archive' },
  { keys: ['S'], label: 'Snooze' },
  { keys: ['R'], label: 'Reply' }
]

const SECONDARY: ReadonlyArray<LegendEntry> = [
  { keys: ['C'], label: 'Compose' },
  { keys: ['⌘K'], label: 'Actions' }
]

function LegendItem({ entry }: { entry: LegendEntry }): React.JSX.Element {
  return (
    <span className="legend__item">
      {entry.keys.map((key) => (
        <kbd key={key} className="kbd">
          {key}
        </kbd>
      ))}
      <span>{entry.label}</span>
    </span>
  )
}

export function StatusBar({ appVersion }: StatusBarProps): React.JSX.Element {
  return (
    <footer className="statusbar">
      <div className="legend">
        {PRIMARY.map((entry, index) => (
          <Fragment key={entry.label}>
            {index > 0 && <span className="legend__sep">·</span>}
            <LegendItem entry={entry} />
          </Fragment>
        ))}

        <span className="legend__secondary">
          {SECONDARY.map((entry) => (
            <Fragment key={entry.label}>
              <span className="legend__sep">·</span>
              <LegendItem entry={entry} />
            </Fragment>
          ))}
        </span>
      </div>

      <div className="statusbar__right">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot dot--tertiary" />
          Offline cache active
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
