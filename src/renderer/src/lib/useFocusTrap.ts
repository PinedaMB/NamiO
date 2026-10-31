import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => element.getClientRects().length > 0)
}

/**
 * Mantiene el foco dentro de un diálogo no nativo (`div role="dialog"`). Los
 * `<dialog>.showModal()` ya lo hacen solos; esto cubre los que aún son divs.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = focusable(root)[0]
    ;(first ?? root).focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusable(root)
      if (items.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }
      const firstItem = items[0]!
      const lastItem = items[items.length - 1]!
      const activeElement = document.activeElement as HTMLElement | null
      if (event.shiftKey && (activeElement === firstItem || !root.contains(activeElement))) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && (activeElement === lastItem || !root.contains(activeElement))) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) previous.focus()
    }
  }, [active, ref])
}
