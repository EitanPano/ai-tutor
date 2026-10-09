import type { ReactNode } from 'react'
import type { IconComponent } from '@/lib/icon'

type EmptyStateProps = {
  icon: IconComponent
  /** One plain sentence saying what is missing and what to do. */
  children: ReactNode
  /** At most one action, usually a `Button` or a link styled with `buttonClass`. */
  action?: ReactNode
}

export function EmptyState({ icon: Icon, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <Icon aria-hidden="true" className="size-8 text-ink-muted" strokeWidth={1.5} />
      <p className="max-w-[40ch] text-lead text-ink">{children}</p>
      {action}
    </div>
  )
}
