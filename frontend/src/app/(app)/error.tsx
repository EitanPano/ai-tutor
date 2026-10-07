'use client'

import { Button } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { RetryIcon } from '@/lib/icon'

// Catches a render exception below the app shell, so the rail and nav stay. The error itself is
// not shown: its message is not written for readers.
export default function AppError({
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <Sheet>
      <EmptyState
        icon={RetryIcon}
        action={
          <Button variant="secondary" onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        Something broke on this page.
      </EmptyState>
    </Sheet>
  )
}
