import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { askQuestion } from '@/lib/api/ask'
import { describeError, isApiError } from '@/lib/api/error'
import { isPending, threadKey, type ThreadDetailResponse } from '@/lib/api/thread'

/** Failures worth offering a one-tap Retry for: nothing about the question itself is wrong. */
const RETRYABLE = new Set([
  'ai_provider_error',
  'stream_interrupted',
  'network_error',
  'generation_in_progress'
])

export type Asking = {
  /** `thinking` until the first delta, `streaming` while text arrives, `finalizing` while the saved thread reloads. */
  phase: 'thinking' | 'streaming' | 'finalizing'
  question: string
  text: string
  userMessageId?: string
  assistantMessageId?: string
}

export type AskResult = {
  /** The server accepted the question (a `message.start` arrived), so it is saved in the thread. */
  started: boolean
  outcome: 'completed' | 'stopped' | 'failed'
}

/** Owns the stream state of the one answer that may be in flight for a thread. */
export function useAsk(threadId: string) {
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<Asking>()
  const [announcement, setAnnouncement] = useState('')
  const [budgetSpent, setBudgetSpent] = useState(false)
  const [threadFull, setThreadFull] = useState(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const mounted = useRef(true)
  const askRef = useRef<(question: string) => Promise<AskResult>>(undefined)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Deferred so React's dev-only unmount/remount does not cancel a stream that just started.
      setTimeout(() => {
        if (!mounted.current) controller.current?.abort()
      })
    }
  }, [])

  const ask = useCallback(
    async (question: string): Promise<AskResult> => {
      if (controller.current) return { started: false, outcome: 'failed' }
      const abort = new AbortController()
      controller.current = abort
      let started = false
      let answerId: string | undefined
      let outcome: AskResult['outcome'] = 'failed'
      setAnnouncement('')
      setAsking({ phase: 'thinking', question, text: '' })

      const stillSaving = (id: string | undefined) =>
        !!id &&
        !!queryClient
          .getQueryData<ThreadDetailResponse>(threadKey.detail(threadId))
          ?.messages.some((m) => m.id === id && isPending(m))

      const update = (change: (current: Asking) => Asking) =>
        setAsking((current) => (current ? change(current) : current))

      try {
        const result = await askQuestion(threadId, question, {
          signal: abort.signal,
          onStart: ({ userMessageId, assistantMessageId }) => {
            started = true
            answerId = assistantMessageId
            update((a) => ({ ...a, userMessageId, assistantMessageId }))
          },
          onDelta: (text) => update((a) => ({ ...a, phase: 'streaming', text: a.text + text })),
          onComplete: () => update((a) => ({ ...a, phase: 'finalizing' }))
        })
        outcome = result
        if (result === 'completed' && mounted.current) setAnnouncement('Answer ready')
      } catch (err) {
        if (mounted.current) {
          const code = isApiError(err) ? err.code : ''
          if (code === 'ai_budget_exceeded') setBudgetSpent(true)
          if (code === 'thread_full') setThreadFull(true)
          toast.error(describeError(err), {
            ...(RETRYABLE.has(code) && {
              action: { label: 'Retry', onClick: () => void askRef.current?.(question) }
            })
          })
        }
      } finally {
        if (mounted.current) setAsking((a) => (a ? { ...a, phase: 'finalizing' } : a))
        // The saved thread is the truth: keep the streamed text on screen until it has loaded.
        // The controller stays set until then, so a second ask cannot start mid-handover.
        await queryClient.invalidateQueries({ queryKey: threadKey.all }).catch(() => undefined)
        // After a Stop the server finishes saving the partial answer a moment later.
        for (let i = 0; i < 10 && mounted.current && stillSaving(answerId); i++) {
          await new Promise((resolve) => setTimeout(resolve, 300))
          await queryClient.invalidateQueries({ queryKey: threadKey.all }).catch(() => undefined)
        }
        controller.current = undefined
        if (mounted.current) setAsking(undefined)
      }
      return { started, outcome }
    },
    [threadId, queryClient]
  )

  useEffect(() => {
    askRef.current = ask
  }, [ask])

  const stop = useCallback(() => controller.current?.abort(), [])

  return { asking, ask, stop, announcement, budgetSpent, threadFull }
}
