type SpinnerProps = {
  /** Accessible name. Pass an empty string when a sibling already announces the state. */
  label?: string
  className?: string
}

export function Spinner({ label = 'Loading', className = 'size-4' }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={`inline-block animate-spin-slow rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}
