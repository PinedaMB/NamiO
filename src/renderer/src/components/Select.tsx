import type { ComponentProps } from 'react'
import { cx } from '../lib/cx'

export function Select({ className, ...props }: ComponentProps<'select'>): React.JSX.Element {
  return <select {...props} className={cx('select', className)} />
}
