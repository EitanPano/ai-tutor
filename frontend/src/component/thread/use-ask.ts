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

/** Ask turns into Stop in place, so a double click or key repeat must not stop the answer just asked for. */
const STOP_GRACE_MS = 400

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
export function useAsk(
  threadId: string,
  {
    onRetryAccepted
  }: {
    /** A toast Retry was accepted by the server: the question is no longer a draft. */
    onRetryAccepted?: (question: string) => void
  } = {}
) {
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<Asking>()
  const [announcement, setAnnouncement] = useState('')
  const [budgetSpent, setBudgetSpent] = useState(false)
  const [threadFull, setThreadFull] = useState(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const askedAt = useRef(0)
  const mounted = useRef(true)
  // Streamed text waits here and reaches state at most once per animation frame: every state
  // change re-parses the whole growing answer as Markdown.
  const buffered = useRef('')
  const frame = useRef<number | undefined>(undefined)
  const askRef =
    useRef<(question: string, onAccepted?: () => void) => Promise<AskResult>>(undefined)
  const retryAccepted = useRef(onRetryAccepted)
  const toastIds = useRef(new Set<string | number>())

  useEffect(() => {
    retryAccepted.current = onRetryAccepted
  }, [onRetryAccepted])

  useEffect(() => {
    mounted.current = true
    const ids = toastIds.current
    return () => {
      mounted.current = false
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      frame.current = undefined
      buffered.current = ''
      // Deferred so React's dev-only unmount/remount does not cancel a stream that just started.
      setTimeout(() => {
        if (mounted.current) return
        controller.current?.abort()
        // A toast's Retry must not outlive the page it belongs to.
        for (const id of ids) toast.dismiss(id)
        ids.clear()
      })
    }
  }, [])

  const ask = useCallback(
    async (question: string, onAccepted?: () => void): Promise<AskResult> => {
      if (controller.current) return { started: false, outcome: 'failed' }
      const abort = new AbortController()
      controller.current = abort
      askedAt.current = Date.now()
      let started = false
      let answerId: string | undefined
      let outcome: AskResult['outcome'] = 'failed'
      buffered.current = ''
      setAnnouncement('')
      setAsking({ phase: 'thinking', question, text: '' })

      // Missing counts as not saved yet: while the thread's first load is in flight, an
      // invalidation joins that load instead of starting a new one, and it may have read the
      // thread before this question was saved.
      const stillSaving = (id: string | undefined) =>
        !!id &&
        !queryClient
          .getQueryData<ThreadDetailResponse>(threadKey.detail(threadId))
          ?.messages.some((m) => m.id === id && !isPending(m))

      // Only the first question changes the title, so only then does the list need to know now.
      const firstQuestion = !queryClient.getQueryData<ThreadDetailResponse>(
        threadKey.detail(threadId)
      )?.messages.length
      const refreshDetail = () =>
        queryClient.invalidateQueries({ queryKey: threadKey.detail(threadId) })
      // `all` would refetch every loaded list page too; the list is refreshed on its own terms.
      const refreshList = () => queryClient.invalidateQueries({ queryKey: threadKey.list })

      const update = (change: (current: Asking) => Asking) =>
        setAsking((current) => (current ? change(current) : current))

      // Moves the buffered text into state now and drops the pending frame, so nothing is lost
      // or applied twice. Call it before any change that must come after the text.
      const flush = () => {
        if (frame.current !== undefined) cancelAnimationFrame(frame.current)
        frame.current = undefined
        const text = buffered.current
        buffered.current = ''
        if (text && mounted.current)
          update((a) => ({ ...a, phase: 'streaming', text: a.text + text }))
      }

      try {
        const result = await askQuestion(threadId, question, {
          signal: abort.signal,
          onStart: ({ userMessageId, assistantMessageId }) => {
            started = true
            onAccepted?.()
            answerId = assistantMessageId
            update((a) => ({ ...a, userMessageId, assistantMessageId }))
            void refreshDetail()
            if (firstQuestion) void refreshList()
          },
          onDelta: (text) => {
            buffered.current += text
            frame.current ??= requestAnimationFrame(flush)
          },
          onComplete: () => {
            flush()
            update((a) => ({ ...a, phase: 'finalizing' }))
          }
        })
        outcome = result
        if (result === 'completed' && mounted.current) setAnnouncement('Answer ready')
      } catch (err) {
        if (mounted.current) {
          const code = isApiError(err) ? err.code : ''
          if (code === 'ai_budget_exceeded') setBudgetSpent(true)
          if (code === 'thread_full') setThreadFull(true)
          const id = toast.error(describeError(err), {
            ...(RETRYABLE.has(code) && {
              action: {
                label: 'Retry',
                onClick: () => {
                  if (!mounted.current) return
                  void askRef.current?.(question, () => retryAccepted.current?.(question))
                }
              }
            })
          })
          if (id !== undefined) toastIds.current.add(id)
        }
      } finally {
        flush()
        if (mounted.current) setAsking((a) => (a ? { ...a, phase: 'finalizing' } : a))
        // The saved thread is the truth: keep the streamed text on screen until it has loaded.
        // The controller stays set until then, so a second ask cannot start mid-handover.
        await refreshDetail().catch(() => undefined)
        // After a Stop the server finishes saving the partial answer a moment later, and the
        // first look may come from a load that started before this turn existed.
        for (let i = 0; i < 10 && mounted.current && stillSaving(answerId); i++) {
          await new Promise((resolve) => setTimeout(resolve, 300))
          await refreshDetail().catch(() => undefined)
        }
        // Every turn moves the thread to the top of the list: one refresh, once it has settled.
        void refreshList().catch(() => undefined)
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

  const stop = useCallback(() => {
    if (Date.now() - askedAt.current < STOP_GRACE_MS) return
    controller.current?.abort()
  }, [])

  return { asking, ask, stop, announcement, budgetSpent, threadFull }
}
