import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { describeError, isApiError } from '@/lib/api/error'
import { createQuiz, quizKey, type CreateQuizRequest } from '@/lib/api/quiz'
import { threadKey } from '@/lib/api/thread'

/** Failures worth a Retry: nothing about the request itself is wrong. */
const RETRYABLE = new Set(['ai_invalid_output', 'ai_provider_error'])

/**
 * Writes a quiz and opens it. Shared by every "Quiz me" button (a thread, a guide, a topic).
 * A failure is a toast, with Retry when asking again could work; the toast goes away with the
 * page that raised it.
 */
export function useCreateQuiz() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const toastId = useRef<string | number | undefined>(undefined)

  useEffect(
    () => () => {
      if (toastId.current !== undefined) toast.dismiss(toastId.current)
    },
    []
  )

  const mutation = useMutation({
    mutationFn: (body: CreateQuizRequest) => createQuiz(body),
    onSuccess: ({ quiz }) => {
      // The thread lists its quizzes; the new one belongs there when the reader comes back.
      if (quiz.threadId) {
        void queryClient.invalidateQueries({ queryKey: threadKey.detail(quiz.threadId) })
      }
      queryClient.setQueryData(quizKey.detail(quiz.id), { quiz })
      router.push(`/quiz/${encodeURIComponent(quiz.id)}`)
    },
    onError: (err, body) => {
      const retryable = isApiError(err) && RETRYABLE.has(err.code)
      toastId.current = toast.error(describeError(err), {
        ...(retryable && { action: { label: 'Retry', onClick: () => mutation.mutate(body) } })
      })
    }
  })

  return { create: mutation.mutate, isPending: mutation.isPending }
}
