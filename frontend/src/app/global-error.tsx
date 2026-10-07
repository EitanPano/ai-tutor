'use client'

import { Button } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { RetryIcon } from '@/lib/icon'
import './globals.css'

// Replaces the root layout when it throws, so it brings its own document and the tokens.
export default function GlobalError({
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full p-6">
        <Sheet as="main">
          <EmptyState
            icon={RetryIcon}
            action={
              <Button variant="secondary" onClick={() => retry()}>
                Try again
              </Button>
            }
          >
            Something went wrong.
          </EmptyState>
        </Sheet>
      </body>
    </html>
  )
}
