'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, buttonClass } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { describeError, isApiError } from '@/lib/api/error'
import { getThread, isPending, threadKey } from '@/lib/api/thread'
import { BackIcon, NewIcon, RetryIcon, ThreadIcon } from '@/lib/icon'
import { usePageTitle } from '@/lib/page-title'
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
  const { asking, ask, stop, announcement, budgetSpent, threadFull } = useAsk(threadId, {
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
  const parked = useRef(false)

  const unfinishedId = detail.data?.messages.find(isPending)?.id
  useEffect(() => {
    if (!unfinishedId || asking) return
    const timer = setTimeout(() => setStalledId(unfinishedId), STALL_MS)
    return () => clearTimeout(timer)
  }, [unfinishedId, asking])
  const stalled = !!unfinishedId && unfinishedId === stalledId

  /** Asks, and hands the text back to the composer when the server never took the question. */
  const submit = useCallback(
    async (question: string) => {
      const { started, outcome } = await ask(question)
      if (!started && outcome !== 'completed') setDraft((current) => current || question)
    },
    [ask]
  )
  const retry = useCallback((question: string) => void submit(question), [submit])

  // A question parked by the new-question page is asked as soon as the thread opens.
  useEffect(() => {
    if (parked.current) return
    parked.current = true
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
    const nearEnd =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240
    if (nearEnd) scrollToEnd()
  }, [textLength])

  const loaded = !!detail.data
  useEffect(() => {
    if (loaded) scrollToEnd()
  }, [loaded])

  if (detail.isPending) return <ThreadSkeleton />

  if (!detail.data) {
    const missing = isApiError(detail.error) && detail.error.code === 'not_found'
    return (
      <Sheet>
        <EmptyState
          icon={missing ? ThreadIcon : RetryIcon}
          action={
            missing ? (
              <Link href="/thread" className={buttonClass({ variant: 'secondary' })}>
                Back to threads
              </Link>
            ) : (
              <Button variant="secondary" onClick={() => detail.refetch()}>
                Retry
              </Button>
            )
          }
        >
          {describeError(detail.error)}
        </EmptyState>
      </Sheet>
    )
  }

  const { thread, messages, guides, quizzes } = detail.data
  const hasAnswer = messages.some((m) => m.role === 'assistant' && m.status === 'complete')
  const full = threadFull || thread.messageCount + 2 > MAX_MESSAGES
  const busy = !!asking || (!!unfinishedId && !stalled)
  const locked = budgetSpent || full
  const streaming = asking?.phase === 'thinking' || asking?.phase === 'streaming'

  function send() {
    const question = draft.trim()
    if (!question) return
    setDraft('')
    void submit(question)
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/thread"
        className="inline-flex items-center gap-1.5 self-start text-sm font-semibold lg:hidden"
      >
        <BackIcon aria-hidden="true" className="size-4" />
        Threads
      </Link>

      <ThreadHeader thread={thread} />

      {/* The study tools: a guide, a quiz, and the ones already made. */}
      <StudyTools
        threadId={threadId}
        hasAnswer={hasAnswer}
        busy={busy}
        guides={guides}
        quizzes={quizzes}
      />

      <Sheet className="p-5 md:p-8">
        {messages.length === 0 && !busy ? (
          <p className="text-ink-muted">Ask your first question below.</p>
        ) : (
          <Transcript
            messages={messages}
            asking={asking}
            stalled={stalled}
            onRetry={locked || busy ? undefined : retry}
          />
        )}
      </Sheet>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Solid canvas behind the composer so transcript text never shows around it. */}
      <div className="sticky bottom-0 z-10 -mx-2 flex flex-col gap-3 bg-canvas px-2 pt-2 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-canvas before:to-transparent">
        {budgetSpent && (
          <Banner>
            You&apos;ve used today&apos;s AI budget. It resets at midnight in your time zone.
          </Banner>
        )}
        {full && (
          <Banner
            action={
              <Link
                href={`/thread?topic=${encodeURIComponent(thread.topicId)}`}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                <NewIcon aria-hidden="true" className="size-4" />
                New thread
              </Link>
            }
          >
            This thread is full. Start a new thread to keep going.
          </Banner>
        )}
        <Sheet className="p-4 shadow-lg shadow-ink/10">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            disabled={locked}
            streaming={busy && streaming}
            submitting={busy && !streaming}
            onStop={stop}
          />
        </Sheet>
      </div>
    </div>
  )
}
