import logo from '../assets/logo.png'
import { useI18n, type TranslationKey } from '../i18n'
import { Icon } from './Icon'

export type OnboardingChoice = 'gmail' | 'outlook' | 'custom' | 'local'

interface OnboardingProps {
  onPick: (choice: OnboardingChoice) => void
  onDemo: () => void
}

const CHOICES: ReadonlyArray<{
  id: OnboardingChoice
  icon: string
  titleKey: TranslationKey
  hintKey: TranslationKey
  badgeKey?: TranslationKey
}> = [
  { id: 'gmail', icon: 'mail', titleKey: 'onboarding.gmail', hintKey: 'onboarding.gmailHint', badgeKey: 'onboarding.oauthBadge' },
  {
    id: 'outlook',
    icon: 'mark_email_unread',
    titleKey: 'onboarding.outlook',
    hintKey: 'onboarding.outlookHint',
    badgeKey: 'onboarding.oauthBadge'
  },
  { id: 'custom', icon: 'dns', titleKey: 'onboarding.custom', hintKey: 'onboarding.customHint' },
  { id: 'local', icon: 'terminal', titleKey: 'onboarding.local', hintKey: 'onboarding.localHint' }
]

/** Primera pantalla: elegir cómo entrar. No bloquea: la demo siempre está a un click. */
export function Onboarding({ onPick, onDemo }: OnboardingProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="onboarding">
      <div className="onboarding__panel">
        <div className="onboarding__brand">
          <img className="onboarding__logo" src={logo} alt="" aria-hidden="true" />
          <span className="onboarding__wordmark">NamiO</span>
        </div>

        <h1 className="onboarding__title">{t('onboarding.title')}</h1>
        <p className="onboarding__subtitle">{t('onboarding.subtitle')}</p>

        <div className="onboarding__grid">
          {CHOICES.map((choice) => (
            <button key={choice.id} className="onboarding__card" type="button" onClick={() => onPick(choice.id)}>
              <span className="onboarding__icon">
                <Icon name={choice.icon} size={20} />
              </span>
              <span className="onboarding__card-text">
                <span className="onboarding__card-title">
                  {t(choice.titleKey)}
                  {choice.badgeKey && <span className="chip chip--accent">{t(choice.badgeKey)}</span>}
                </span>
                <span className="onboarding__card-hint">{t(choice.hintKey)}</span>
              </span>
              <Icon name="chevron_right" size={18} className="onboarding__chevron" />
            </button>
          ))}
        </div>

        <p className="onboarding__note">
          <Icon name="lock" size={14} />
          {t('onboarding.note')}
        </p>

        <div className="onboarding__foot">
          <button className="onboarding__demo" type="button" onClick={onDemo}>
            <Icon name="visibility" size={16} />
            {t('onboarding.demo')}
          </button>
          <span className="onboarding__demo-hint">{t('onboarding.demoHint')}</span>
        </div>
      </div>
    </div>
  )
}
