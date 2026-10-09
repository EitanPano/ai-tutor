import type { ElementType, ReactNode } from 'react'
import { RetryIcon, type IconComponent } from '@/lib/icon'
import { Button } from './button'
import { EmptyState } from './empty-state'
import { Sheet } from './sheet'

type ErrorPanelProps = {
  /** One plain sentence: what failed, or what is gone. */
  children: ReactNode
  /** Shows a Retry button that calls this with no arguments. */
  onRetry?: () => void
  retryLabel?: string
  /** Defaults to the Retry icon; a thing that is gone (404) shows its own. */
  icon?: IconComponent
  /** Replaces the Retry button, such as a link away from a thing that is gone. */
  action?: ReactNode
  /** The sheet's element, such as `main` when the panel is the whole page. */
  as?: ElementType
}

/** A load that failed, in a `Sheet`: the message, and Retry unless `action` replaces it. */
export function ErrorPanel({
  children,
  onRetry,
  retryLabel = 'Retry',
  icon = RetryIcon,
  action,
  as
}: ErrorPanelProps) {
  const retryButton = onRetry && (
    <Button variant="secondary" onClick={() => onRetry()}>
      {retryLabel}
    </Button>
  )
  return (
    <Sheet as={as}>
      <EmptyState icon={icon} action={action ?? retryButton}>
        {children}
      </EmptyState>
    </Sheet>
  )
}
