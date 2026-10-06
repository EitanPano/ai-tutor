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
import { Composer } from './composer'
import { takePendingQuestion } from './pending-question'
import { ThreadHeader } from './thread-header'
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

export function Conversation({ threadId }: { threadId: string }) {
  const detail = useQuery({
    queryKey: threadKey.detail(threadId),
    queryFn: ({ signal }) => getThread(threadId, signal),
    // An answer still being written (here, in another tab, or just stopped) finishes on the
    // server a moment later: look again until it has.
    refetchInterval: (query) => (query.state.data?.messages.some(isPending) ? 1500 : false)
  })
  const { asking, ask, stop, announcement, budgetSpent, threadFull } = useAsk(threadId)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const parked = useRef(false)

  /** Asks, and hands the text back to the composer when the server never took the question. */
  const submit = useCallback(
    async (question: string) => {
      const { started, outcome } = await ask(question)
      if (!started && outcome === 'failed') setDraft((current) => current || question)
    },
    [ask]
  )

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

  // Keep the newest text in view while it streams, unless the reader scrolled up.
  const textLength = asking?.text.length ?? 0
  useEffect(() => {
    if (!textLength) return
    const nearEnd =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240
    if (nearEnd) endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [textLength])

  const loaded = !!detail.data
  useEffect(() => {
    if (loaded) endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [loaded])

  if (detail.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading thread" className="flex flex-col gap-4">
        <div className="h-9 w-2/3 animate-pulse rounded-sm bg-rule" />
        <div className="h-64 animate-pulse rounded-md border border-rule bg-sheet" />
      </div>
    )
  }

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

  const { thread, messages } = detail.data
  const full = threadFull || thread.messageCount + 2 > MAX_MESSAGES
  const unfinished = messages.some(isPending)
  const busy = !!asking || unfinished
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

      {/* Slot for the study tools (guide, quiz) that later tasks add. */}
      <div role="toolbar" aria-label="Study tools" className="flex flex-wrap gap-2 empty:hidden" />

      <Sheet className="p-5 md:p-8">
        {messages.length === 0 && !busy ? (
          <p className="text-ink-muted">Ask your first question below.</p>
        ) : (
          <Transcript
            messages={messages}
            asking={asking}
            onRetry={locked || busy ? undefined : (question) => void submit(question)}
          />
        )}
        <div ref={endRef} className="scroll-mb-72" />
      </Sheet>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="sticky bottom-4 flex flex-col gap-3">
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
