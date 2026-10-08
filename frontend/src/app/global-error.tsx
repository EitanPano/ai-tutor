'use client'

import { ErrorPanel } from '@/component/ui/error-panel'
import './globals.css'

// Replaces the root layout when it throws, so it brings its own document and the tokens.
// No providers here: the panel must not need a query client, router or toaster.
export default function GlobalError({
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full p-6">
        <ErrorPanel as="main" onRetry={retry} retryLabel="Try again">
          Something went wrong.
        </ErrorPanel>
      </body>
    </html>
  )
}
