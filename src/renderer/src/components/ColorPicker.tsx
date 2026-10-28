import { useId, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { TooltipButton } from './Tooltip'

const COLORS = ['#000000', '#ffffff', '#d32f2f', '#ef6c00', '#f9a825', '#2e7d32', '#1565c0', '#6a1b9a', '#ad1457', '#616161']
const HIGHLIGHTS = ['#fff59d', '#ffffff', '#ffcdd2', '#ffe0b2', '#fff9c4', '#b9f6ca', '#bbdefb', '#e1bee7', '#f8bbd0', '#e0e0e0']
const NAMES = ['black', 'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'] as const

export function ColorPicker({ highlight, value, disabled, onChange }: {
  highlight: boolean
  value?: string
  disabled: boolean
  onChange: (value: string | null) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const id = useId()
  const popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const label = t(highlight ? 'compose.format.highlight' : 'compose.format.color')
  const choose = (color: string | null): void => { onChange(color); popup.current?.hidePopover() }
  return <>
    <TooltipButton className="color-picker__trigger" type="button" title={label} popoverTarget={id} disabled={disabled}
      onMouseDown={event => event.preventDefault()} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - 256)), top: Math.max(8, Math.min(rect.bottom + 8, innerHeight - 270)) })
      }}>
      <Icon name={highlight ? 'format_ink_highlighter' : 'format_color_text'} size={17} />
      <span className="color-picker__sample" style={{ backgroundColor: value || (highlight ? 'transparent' : 'var(--on-surface)') }} />
      <Icon name="arrow_drop_down" size={13} />
    </TooltipButton>
    <div id={id} ref={popup} popover="auto" className="color-picker" style={position} role="dialog" aria-label={label} data-editor-popup>
      <strong>{label}</strong>
      <TooltipButton className="color-picker__default" type="button" title={t(highlight ? 'compose.format.resetHighlight' : 'compose.format.resetColor')}
        aria-pressed={!value} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => choose(null)}>
        <Icon name="format_color_reset" size={17} />{t('compose.format.defaultColor')}
        {!value && <Icon name="check" size={16} />}
      </TooltipButton>
      <div className="color-picker__grid" role="group" aria-label={t('compose.format.presets')}>
        {(highlight ? HIGHLIGHTS : COLORS).map((color, index) => <button key={color} className="color-picker__swatch" type="button"
          data-color={color} aria-label={`${t(`compose.color.${highlight && index === 0 ? 'yellow' : NAMES[index]!}`)} ${color}`}
          aria-pressed={value?.toLowerCase() === color} disabled={disabled} style={{ backgroundColor: color }}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(color)} />)}
      </div>
      <label className="color-picker__custom">{t('compose.format.customColor')}
        <input type="color" aria-label={label} value={value || (highlight ? '#fff59d' : '#000000')} disabled={disabled}
          onChange={event => onChange(event.target.value)} />
      </label>
    </div>
  </>
}
