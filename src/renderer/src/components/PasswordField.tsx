import { TooltipButton } from './Tooltip'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

interface PasswordFieldProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  autoComplete?: string
  placeholder?: string
}

/** Campo de contraseña con ojo para mostrarla (evita tipear a ciegas). */
export function PasswordField({
  value,
  onChange,
  ariaLabel,
  autoComplete = 'current-password',
  placeholder = '••••••••'
}: PasswordFieldProps): React.JSX.Element {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)

  return (
    <span className="password-field">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        spellCheck={false}
      />
      <TooltipButton
        type="button"
        className="password-field__toggle"
        onClick={() => setVisible((current) => !current)}
        title={t(visible ? 'account.hidePassword' : 'account.showPassword')}
        aria-label={t(visible ? 'account.hidePassword' : 'account.showPassword')}
        aria-pressed={visible}
      >
        <Icon name={visible ? 'visibility_off' : 'visibility'} size={16} />
      </TooltipButton>
    </span>
  )
}
