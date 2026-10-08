'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BackLink } from '@/component/ui/back-link'
import { buttonClass } from '@/component/ui/button'
import { ErrorPanel } from '@/component/ui/error-panel'
import { NotFoundPanel } from '@/component/ui/not-found-panel'
import { Sheet } from '@/component/ui/sheet'
import { describeError, isApiError, messageFor } from '@/lib/api/error'
import { getThread, isPending, threadKey } from '@/lib/api/thread'
import { NewIcon, ThreadIcon } from '@/lib/icon'
import { usePageTitle } from '@/lib/page-title'
import { THREAD_LIST_PATH } from '@/lib/route'
import { Composer } from './composer'
import { StudyTools } from './study-tools'
import { takePendingQuestion } from './pending-question'
import { ThreadHeader } from './thread-header'
import { ThreadSkeleton } from './thread-skeleton'
import { Transcript } from './transcript'
import { useAsk } from './use-ask'

/** A thread holds at most this many non-failed messages; each turn adds two. */
const MAX_MESSAGES = 25

function Banner({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-l-4 border-rule border-l-highlight bg-sheet px-4 py-3"
    >
      <p className="font-semibold">{children}</p>
      {action}
    </div>
  )
}

/** How long an unfinished answer may go unchanged before it is shown as failed. */
const STALL_MS = 60_000

const scrollToEnd = () =>
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })

export function Conversation({ threadId }: { threadId: string }) {
  const [draft, setDraft] = useState('')
  const { asking, ask, stop, announcement, isBudgetSpent, isThreadFull } = useAsk(threadId, {
    // A Retry from the toast re-asked the text the composer got back: do not leave it to be sent twice.
    onRetryAccepted: (question) => setDraft((d) => (d.trim() === question.trim() ? '' : d))
  })
  const [stalledId, setStalledId] = useState<string>()
  const detail = useQuery({
    queryKey: threadKey.detail(threadId),
    queryFn: ({ signal }) => getThread(threadId, signal),
    // An answer still being written (in another tab, or just stopped) finishes on the server a
    // moment later: look again until it has. Not while this page is streaming one itself, and
    // not forever: a crashed server would leave it unfinished.
    refetchInterval: (query) => {
      const unfinished = query.state.data?.messages.find(isPending)
      return !asking && unfinished && unfinished.id !== stalledId ? 1500 : false
    }
  })
  usePageTitle(detail.data?.thread.title)
  const wasParkedQuestionChecked = useRef(false)

  const unfinishedId = detail.data?.messages.find(isPending)?.id
  useEffect(() => {
    if (!unfinishedId || asking) return
    const timer = setTimeout(() => setStalledId(unfinishedId), STALL_MS)
    return () => clearTimeout(timer)
  }, [unfinishedId, asking])
  const isStalled = !!unfinishedId && unfinishedId === stalledId

  /** Asks, and hands the text back to the composer when the server never took the question. */
  const submit = useCallback(
    async (question: string) => {
      const { hasStarted, outcome } = await ask(question)
      if (!hasStarted && outcome !== 'completed') setDraft((current) => current || question)
    },
    [ask]
  )
  const retry = useCallback((question: string) => void submit(question), [submit])

  // A question parked by the new-question page is asked as soon as the thread opens.
  useEffect(() => {
    if (wasParkedQuestionChecked.current) return
    wasParkedQuestionChecked.current = true
    const question = takePendingQuestion(threadId)
    // Starting the stream is the sync with an external system (storage, network); the state it
    // sets is that stream's progress.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (question) void submit(question)
  }, [threadId, submit])

  // Keep the newest text in view while it streams, unless the reader scrolled up. Scrolling to
  // the very end leaves the composer in its natural place below the transcript.
  const textLength = asking?.text.length ?? 0
  useEffect(() => {
    if (!textLength) return
    const isNearEnd =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240
    if (isNearEnd) scrollToEnd()
  }, [textLength])

  const isLoaded = !!detail.data
  useEffect(() => {
    if (isLoaded) scrollToEnd()
  }, [isLoaded])

  if (detail.isPending) return <ThreadSkeleton />

  if (!detail.data) {
    const isMissing = isApiError(detail.error) && detail.error.code === 'not_found'
    return isMissing ? (
      <NotFoundPanel icon={ThreadIcon}>{describeError(detail.error)}</NotFoundPanel>
    ) : (
      <ErrorPanel onRetry={() => detail.refetch()}>{describeError(detail.error)}</ErrorPanel>
    )
  }

  const { thread, messages, guides, quizzes } = detail.data
  const hasAnswer = messages.some((m) => m.role === 'assistant' && m.status === 'complete')
  const isFull = isThreadFull || thread.messageCount + 2 > MAX_MESSAGES
  const isBusy = !!asking || (!!unfinishedId && !isStalled)
  const isLocked = isBudgetSpent || isFull
  const isStreaming = asking?.phase === 'thinking' || asking?.phase === 'streaming'

  function send() {
    const question = draft.trim()
    if (!question) return
    setDraft('')
    void submit(question)
  }

  return (
    <div className="flex flex-col gap-5">
      <BackLink href={THREAD_LIST_PATH} className="lg:hidden">
        Threads
      </BackLink>

      <ThreadHeader thread={thread} />

      {/* The study tools: a guide, a quiz, and the ones already made. */}
      <StudyTools
        threadId={threadId}
        hasAnswer={hasAnswer}
        isBusy={isBusy}
        guides={guides}
        quizzes={quizzes}
      />

      <Sheet className="p-5 md:p-8">
        {messages.length === 0 && !isBusy ? (
          <p className="text-ink-muted">Ask your first question below.</p>
        ) : (
          <Transcript
            messages={messages}
            asking={asking}
            isStalled={isStalled}
            onRetry={isLocked || isBusy ? undefined : retry}
          />
        )}
      </Sheet>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Solid canvas behind the composer so transcript text never shows around it. */}
      <div className="sticky bottom-0 z-10 -mx-2 flex flex-col gap-3 bg-canvas px-2 pt-2 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-canvas before:to-transparent">
        {isBudgetSpent && <Banner>{messageFor('ai_budget_exceeded')}</Banner>}
        {isFull && (
          <Banner
            action={
              <Link
                href={`${THREAD_LIST_PATH}?topic=${encodeURIComponent(thread.topicId)}`}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                <NewIcon aria-hidden="true" className="size-4" />
                New thread
              </Link>
            }
          >
            {messageFor('thread_full')}
          </Banner>
        )}
        <Sheet className="p-4 shadow-lg shadow-ink/10">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            disabled={isLocked}
            isStreaming={isBusy && isStreaming}
            isSubmitting={isBusy && !isStreaming}
            onStop={stop}
          />
        </Sheet>
      </div>
    </div>
  )
}
