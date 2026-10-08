'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { getSession } from '@/lib/api/session'
import { DEFAULT_PATH } from '@/lib/route'
import { SESSION_KEY } from '@/lib/session'

/**
 * Sends an already signed-in visitor on to the app. Checks the session once on mount, so a
 * stale cookie that the API rejects just leaves the form in place (the proxy never redirects
 * away from the auth pages, which would loop).
 */
export function SignedInRedirect() {
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    let isCancelled = false
    queryClient
      .fetchQuery({
        queryKey: SESSION_KEY,
        queryFn: () => getSession(),
        staleTime: 0,
        retry: false
      })
      .then(() => {
        if (!isCancelled) router.replace(DEFAULT_PATH)
      })
      .catch(() => {})
    return () => {
      isCancelled = true
    }
  }, [queryClient, router])

  return null
}
