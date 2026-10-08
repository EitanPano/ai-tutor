import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { describeError, isApiError } from '@/lib/api/error'
import {
  guideKey,
  updateStep,
  type Guide,
  type Step,
  type UpdateStepRequest
} from '@/lib/api/guide'
import { threadKey } from '@/lib/api/thread'

type Cached = { guide: Guide }
type Variables = { stepId: string; body: UpdateStepRequest }
type Previous = Pick<Step, 'doneAt' | 'hintRevealedAt'>

const STEP_MUTATION = ['guide', 'step'] as const

/** The sentence for a failed step update. A missing guide is named as one, not as a thread. */
export function describeStepError(err: unknown): string {
  return isApiError(err) && err.code === 'not_found'
    ? "This guide doesn't exist or was deleted."
    : describeError(err)
}

/**
 * Marks steps done or reveals hints. Optimistic: the cached guide changes at once and only the
 * field that was asked for is put back on failure, so a rollback never undoes another step
 * change that is still in flight.
 */
export function useStepUpdate(guideId: string, threadId: string | undefined) {
  const queryClient = useQueryClient()
  const key = guideKey.detail(guideId)

  function patch(stepId: string, change: (step: Step) => Step) {
    queryClient.setQueryData<Cached>(key, (cached) =>
      cached
        ? {
            guide: {
              ...cached.guide,
              steps: cached.guide.steps.map((s) => (s.id === stepId ? change(s) : s))
            }
          }
        : cached
    )
  }

  return useMutation<unknown, Error, Variables, Previous | undefined>({
    mutationKey: STEP_MUTATION,
    mutationFn: ({ stepId, body }) => updateStep(guideId, stepId, body),
    onMutate: async ({ stepId, body }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient
        .getQueryData<Cached>(key)
        ?.guide.steps.find((step) => step.id === stepId)
      const now = new Date().toISOString()
      patch(stepId, (step) => ({
        ...step,
        ...(body.isDone !== undefined && { doneAt: body.isDone ? now : null }),
        ...(body.isHintRevealed && { hintRevealedAt: step.hintRevealedAt ?? now })
      }))
      return before && { doneAt: before.doneAt, hintRevealedAt: before.hintRevealedAt }
    },
    onError: (err, { stepId, body }, previous) => {
      if (previous) {
        patch(stepId, (step) => ({
          ...step,
          ...(body.isDone !== undefined && { doneAt: previous.doneAt }),
          ...(body.isHintRevealed && { hintRevealedAt: previous.hintRevealedAt })
        }))
      }
      toast.error(describeStepError(err))
    },
    onSettled: () => {
      // Only the last of several overlapping updates reloads: an earlier reply must not overwrite
      // an optimistic change that has not been answered yet.
      if (queryClient.isMutating({ mutationKey: STEP_MUTATION }) > 1) return
      void queryClient.invalidateQueries({ queryKey: key })
      // The thread's guide links show the done count.
      if (threadId) void queryClient.invalidateQueries({ queryKey: threadKey.detail(threadId) })
    }
  })
}
