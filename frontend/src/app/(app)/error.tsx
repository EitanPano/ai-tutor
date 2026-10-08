'use client'

import { ErrorPanel } from '@/component/ui/error-panel'

// Catches a render exception below the app shell, so the rail and nav stay. The error itself is
// not shown: its message is not written for readers.
export default function AppError({
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <ErrorPanel onRetry={retry} retryLabel="Try again">
      Something broke on this page.
    </ErrorPanel>
  )
}
