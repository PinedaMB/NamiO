import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface ContextAction {
  label: string
  icon: string
  run: () => void
  disabled?: boolean
  danger?: boolean
}

export interface ContextAnchor {
  x: number
  y: number
  trigger: HTMLElement
}

export function ContextMenu({ anchor, label, actions, onClose }: {
  anchor: ContextAnchor
  label: string
  actions: ContextAction[]
  onClose: () => void
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y })
  useLayoutEffect(() => {
    const element = menu.current!
    const bounds = element.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(anchor.x, innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(anchor.y, innerHeight - bounds.height - 8)) })
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent): void => { if (!element.contains(event.target as Node)) onClose() }
    const dismiss = (): void => onClose()
    const keys = (event: KeyboardEvent): void => {
      if (!['Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.stopPropagation()
      if (event.key === 'Tab') { onClose(); return }
      event.preventDefault()
      if (event.key === 'Escape') { onClose(); anchor.trigger.focus({ preventScroll: true }); return }
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
      buttons[next]?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', keys, true)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', keys, true)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [anchor, onClose])

  return createPortal(<div ref={menu} className="context-menu" role="menu" aria-label={label} style={position} onContextMenu={event => event.preventDefault()}>
    <span className="context-menu__title">{label}</span>
    {actions.map((action, index) => <Fragment key={action.label}>
      {action.danger && index > 0 && !actions[index - 1]?.danger && <div className="context-menu__separator" role="separator" />}
      <button type="button" role="menuitem" disabled={action.disabled} className={action.danger ? 'context-menu__item context-menu__item--danger' : 'context-menu__item'}
        onClick={() => { onClose(); anchor.trigger.focus({ preventScroll: true }); action.run() }}><Icon name={action.icon} size={17} />{action.label}</button>
    </Fragment>)}
  </div>, document.body)
}
