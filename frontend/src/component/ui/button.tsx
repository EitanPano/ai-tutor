import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './spinner'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-sheet hover:bg-ink/90',
  secondary: 'border border-rule bg-sheet text-ink hover:border-ink-muted',
  ghost: 'text-ink hover:bg-ink/10',
  danger: 'border border-wrong bg-sheet text-wrong hover:bg-wrong/10'
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-base',
  lg: 'h-12 px-6 text-base'
}

/** Class names for anything that should look like a button, such as a `Link`. */
export const buttonClass = ({
  variant = 'primary',
  size = 'md'
}: { variant?: ButtonVariant; size?: ButtonSize } = {}) =>
  `${base} ${variants[variant]} ${sizes[size]}`

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
}

export function Button({
  variant,
  size,
  isLoading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(buttonClass({ variant, size }), className)}
      {...rest}
    >
      {isLoading && <Spinner label="" />}
      {children}
    </button>
  )
}
