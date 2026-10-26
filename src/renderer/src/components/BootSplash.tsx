import logo from '../assets/logo.png'
import { useI18n } from '../i18n'

/**
 * Pantalla de arranque: se muestra hasta saber si hay cuenta configurada y si el
 * usuario ya pasó por la bienvenida. Sin esto, la bandeja (demo) aparece un
 * instante y después se superpone el onboarding.
 */
export function BootSplash(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="boot" role="status" aria-live="polite" aria-label={t('boot.loading')}>
      <div className="boot__inner">
        <img className="boot__logo" src={logo} alt="" aria-hidden="true" />
        <div className="boot__text">
          <span className="boot__wordmark">NamiO</span>
          <span className="boot__status">{t('boot.loading')}</span>
        </div>
        <div className="boot__bar" aria-hidden="true">
          <span className="boot__bar-fill" />
        </div>
      </div>
    </div>
  )
}
