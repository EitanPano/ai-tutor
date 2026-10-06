import type { ReactNode } from 'react'

/** A form-level error that screen readers announce as it appears. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-sm border border-wrong px-3 py-2 text-sm text-wrong">
      {children}
    </p>
  )
}
