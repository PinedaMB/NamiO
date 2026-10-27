import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'

export function TooltipButton({ title, ...props }: ComponentProps<'button'>): React.JSX.Element {
  return <button {...props} data-tooltip={title} aria-label={props['aria-label'] ?? title} />
}

export function Tooltips(): React.JSX.Element | null {
  const id = useId()
  const tip = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let keyboardFocus = true
    let dismissed: Element | null = null
    const clear = (): void => clearTimeout(timer)
    const hide = (): void => {
      clear()
      setAnchor(null)
    }
    const leave = (): void => {
      clear()
      timer = setTimeout(() => setAnchor(null), 100)
    }
    const enter = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="tooltip"]')) {
        clear()
        return
      }
      const button = target?.closest<HTMLElement>('[data-tooltip]')
      if (!button?.dataset.tooltip) return
      if (button === dismissed || (event.type === 'focusin' && !keyboardFocus)) return
      clear()
      timer = setTimeout(() => {
        if (button.isConnected) setAnchor(button)
      }, event.type === 'focusin' ? 0 : 350)
    }
    const exit = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null
      const owner = target?.closest('[data-tooltip], [role="tooltip"]')
      const related = (event as MouseEvent).relatedTarget
      if (related instanceof Node && owner?.contains(related)) return
      if (owner === dismissed) dismissed = null
      if (event.type === 'pointerout' && owner?.contains(document.activeElement)) return
      if (owner) leave()
    }
    const dismiss = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null
      dismissed = target?.closest('[data-tooltip]') ?? null
      hide()
    }
    const pointerDown = (event: Event): void => {
      keyboardFocus = false
      dismiss(event)
    }
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        keyboardFocus = true
        dismissed = null
      }
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') dismiss(event)
    }
    document.addEventListener('pointerover', enter)
    document.addEventListener('pointerout', exit)
    document.addEventListener('focusin', enter)
    document.addEventListener('focusout', exit)
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('click', dismiss, true)
    document.addEventListener('keydown', keyDown)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      clear()
      document.removeEventListener('pointerover', enter)
      document.removeEventListener('pointerout', exit)
      document.removeEventListener('focusin', enter)
      document.removeEventListener('focusout', exit)
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('click', dismiss, true)
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  useLayoutEffect(() => {
    if (!anchor || !tip.current) return
    const rect = anchor.getBoundingClientRect()
    const { width, height } = tip.current.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8)),
      top: rect.bottom + height + 16 <= window.innerHeight
        ? rect.bottom + 8
        : Math.max(8, rect.top - height - 8)
    })
    const previous = anchor.getAttribute('aria-describedby')
    anchor.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '))
    const observer = new MutationObserver(() => {
      if (!anchor.isConnected) setAnchor(null)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (previous === null) anchor.removeAttribute('aria-describedby')
      else anchor.setAttribute('aria-describedby', previous)
    }
  }, [anchor, id])

  return anchor ? createPortal(
    <div className="tooltip" id={id} role="tooltip" ref={tip} style={position}>
      {anchor.dataset.tooltip}
    </div>,
    document.body
  ) : null
}
