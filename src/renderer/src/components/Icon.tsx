import type { CSSProperties } from 'react'

interface IconProps {
  name: string
  size?: number
  fill?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * Icono de Material Symbols por ligadura. La fuente se empaqueta con la app
 * (ver styles/tokens.css), así que no hay pedidos de red.
 */
export function Icon({ name, size = 18, fill = false, className, style }: IconProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={className ? `icon ${className}` : 'icon'}
      data-fill={fill ? '1' : undefined}
      style={{ fontSize: size, ...style }}
    >
      {name}
    </span>
  )
}
