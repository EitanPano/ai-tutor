import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { describeError, isRetryable, type RetryKind } from '@/lib/api/error'

/**
 * Error toasts for one page, with a Retry action when asking again could work (`isRetryable`
 * for `kind`). A toast's Retry must not outlive the page it belongs to: every toast raised here
 * is dismissed on unmount, and a Retry that still fires after that does nothing.
 *
 * Returns `showError(err, retry)`, where `retry` is what the Retry action runs again.
 */
export function useRetryToast(kind: RetryKind) {
  const toastIds = useRef(new Set<string | number>())
  const isMounted = useRef(false)

  useEffect(() => {
    isMounted.current = true
    const ids = toastIds.current
    return () => {
      isMounted.current = false
      for (const id of ids) toast.dismiss(id)
      ids.clear()
    }
  }, [])

  return useCallback(
    (err: unknown, retry: () => void) => {
      const id = toast.error(describeError(err), {
        ...(isRetryable(err, kind) && {
          action: {
            label: 'Retry',
            onClick: () => {
              if (isMounted.current) retry()
            }
          }
        })
      })
      // Never keep an undefined id: `toast.dismiss(undefined)` dismisses every toast on screen.
      if (id !== undefined) toastIds.current.add(id)
    },
    [kind]
  )
}
