import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  describeError,
  fieldIssues,
  isApiError,
  isKnownCode,
  type ApiError,
  type KnownCode
} from '@/lib/api/error'
import { SESSION_KEY } from '@/lib/session'

/** Field name to the message shown under that field. */
export type FieldIssues = Record<string, string>

/** Keyed by known code only, so a misspelt code fails to compile instead of never matching. */
type ErrorHandlers = Partial<Record<KnownCode, (err: ApiError) => void>>

type AuthFormOptions<Input> = {
  /** Logs in or signs up; resolves once the server has set the session cookie. */
  send: (input: Input) => Promise<unknown>
  /** Where the new session lands. */
  nextPath: string
  /** The form's own answer to an error code it expects, such as a wrong password. */
  onErrorCode: ErrorHandlers
}

/**
 * The wiring the login and sign-up forms share. On success it refreshes the session everywhere
 * and goes to `nextPath`. On failure a `validation_failed` response becomes field issues, a code
 * in `onErrorCode` is the form's to show, and anything else is a toast.
 */
export function useAuthForm<Input>({ send, nextPath, onErrorCode }: AuthFormOptions<Input>) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [issues, setIssues] = useState<FieldIssues>({})

  const mutation = useMutation({
    mutationFn: send,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY, refetchType: 'all' })
      router.replace(nextPath)
    },
    onError: (err) => {
      const handlers: ErrorHandlers = {
        validation_failed: (failure) => setIssues(fieldIssues(failure)),
        ...onErrorCode
      }
      // `isKnownCode` checks with `hasOwn`: a code off the wire must never match a prototype key.
      if (isApiError(err) && isKnownCode(err.code)) {
        const handle = handlers[err.code]
        if (handle) return handle(err)
      }
      toast.error(describeError(err))
    }
  })

  /** Shows the client-side `checks` and sends `input` only when they found nothing. */
  function submit(checks: FieldIssues, input: Input) {
    setIssues(checks)
    if (Object.keys(checks).length === 0) mutation.mutate(input)
  }

  return { issues, isPending: mutation.isPending, submit }
}
