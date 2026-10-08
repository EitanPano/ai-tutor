'use client'

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { Toaster } from 'sonner'
import { isApiError } from '@/lib/api/error'
import { LOGIN_PATH, isAuthPath } from '@/lib/route'

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [queryClient] = useState(() => {
    // A 401 `unauthenticated` anywhere means the session is gone: drop cached data and
    // send the user to log in, then back here. The auth pages ask for the session on
    // purpose and expect a 401, so they never redirect.
    const onError = (err: unknown) => {
      if (!isApiError(err) || err.code !== 'unauthenticated') return
      const { pathname, search } = window.location
      if (isAuthPath(pathname)) return
      client.clear()
      router.replace(`${LOGIN_PATH}?next=${encodeURIComponent(pathname + search)}`)
    }
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: (failureCount, err) =>
            isApiError(err) && err.status >= 400 && err.status < 500 ? false : failureCount < 1
        }
      }
    })
    return client
  })

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'flex w-[356px] max-w-[calc(100vw-2rem)] items-center gap-3 rounded-md border border-rule bg-sheet px-4 py-3 text-sm text-ink',
            title: 'font-semibold',
            description: 'text-ink-muted',
            actionButton: 'ml-auto rounded-sm bg-ink px-2 py-1 text-sm font-semibold text-sheet',
            cancelButton: 'rounded-sm border border-rule px-2 py-1 text-sm text-ink',
            error: 'border-wrong text-wrong',
            success: 'border-correct'
          }
        }}
      />
    </QueryClientProvider>
  )
}
