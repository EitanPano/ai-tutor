'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCreateQuiz } from '@/component/quiz/use-create-quiz'
import { Button, buttonClass } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { SEEDED_STALE_MS } from '@/lib/api/client'
import { describeError, isApiError } from '@/lib/api/error'
import { getGuide, guideKey, type Guide } from '@/lib/api/guide'
import { BackIcon, GuideIcon, QuizIcon, RetryIcon } from '@/lib/icon'
import { usePageTitle } from '@/lib/page-title'
import { ProgressBar } from './progress-bar'
import { StepList } from './step-list'
import { StepPanel } from './step-panel'
import { useStepUpdate } from './use-step-update'

const COMPLETE = 'complete'

export function GuideSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading guide" className="flex flex-col gap-5">
      <div className="h-9 w-2/3 animate-pulse rounded-sm bg-rule" />
      <div className="h-2 w-full animate-pulse rounded-sm bg-rule" />
      <div className="h-96 animate-pulse rounded-md border border-rule bg-sheet" />
    </div>
  )
}

function Complete({
  threadId,
  focusTitle,
  onReview
}: {
  threadId: string
  focusTitle: boolean
  onReview: () => void
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const quiz = useCreateQuiz()
  useEffect(() => {
    if (focusTitle) title.current?.focus()
  }, [focusTitle])

  return (
    <Sheet as="section" aria-labelledby="guide-complete" className="p-5 md:p-8">
      <div className="flex flex-col items-start gap-4">
        <GuideIcon aria-hidden="true" className="size-8 text-ink-muted" strokeWidth={1.5} />
        <h2 id="guide-complete" ref={title} tabIndex={-1} className="text-title">
          <span className="marker rounded-sm px-1">Guide complete.</span>
        </h2>
        <p className="text-lead text-ink-muted">Test yourself to see what stuck.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={quiz.isPending} onClick={() => quiz.create({ threadId })}>
            {!quiz.isPending && <QuizIcon aria-hidden="true" className="size-4" />}
            {quiz.isPending ? 'Writing your quiz…' : 'Quiz me on this'}
          </Button>
          <Link
            href={`/thread/${encodeURIComponent(threadId)}`}
            className={buttonClass({ variant: 'secondary' })}
          >
            Back to the conversation
          </Link>
          <Button variant="secondary" onClick={onReview}>
            Review the steps
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

function Viewer({ guide }: { guide: Guide }) {
  const steps = guide.steps
  const update = useStepUpdate(guide.id, guide.threadId)
  // The step the reader picked, or `complete`. Undefined means "the first step not done".
  const [selected, setSelected] = useState<string>()
  // False until the reader moves: the first render must not steal focus from the page.
  const [moved, setMoved] = useState(false)

  const done = steps.filter((s) => s.doneAt).length
  const firstUndone = steps.find((s) => !s.doneAt)
  const picked =
    selected && selected !== COMPLETE ? steps.find((s) => s.id === selected) : undefined
  // `complete` only holds while every step is done: an undone step (a rolled-back mark, a step
  // marked not done elsewhere) brings the reader back to the work.
  const step = picked ?? (selected === COMPLETE && !firstUndone ? undefined : firstUndone)
  const index = step ? steps.indexOf(step) : -1

  const go = useCallback((id: string) => {
    setMoved(true)
    setSelected(id)
  }, [])

  function toggleDone(stepId: string, makeDone: boolean) {
    update.mutate(
      { stepId, body: { isDone: makeDone } },
      // Put the reader back on the step whose mark did not take.
      { onError: () => makeDone && setSelected(stepId) }
    )
    if (!makeDone) return
    const at = steps.findIndex((s) => s.id === stepId)
    const next =
      steps.slice(at + 1).find((s) => !s.doneAt) ?? steps.find((s) => s.id !== stepId && !s.doneAt)
    go(next?.id ?? COMPLETE)
  }

  const revealHint = useCallback(
    (stepId: string) => update.mutate({ stepId, body: { isHintRevealed: true } }),
    // `mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update.mutate]
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link
          href={`/thread/${encodeURIComponent(guide.threadId)}`}
          className="inline-flex items-center gap-1.5 self-start text-sm font-semibold"
        >
          <BackIcon aria-hidden="true" className="size-4" />
          Back to the conversation
        </Link>
        <h1 className="text-title break-words">{guide.title}</h1>
        <ProgressBar done={done} total={steps.length} />
      </header>

      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
        <StepList steps={steps} currentId={step?.id} onSelect={go} />
        <div className="min-w-0">
          {step ? (
            <StepPanel
              key={step.id}
              step={step}
              index={index}
              total={steps.length}
              focusTitle={moved}
              onRevealHint={revealHint}
              onToggleDone={toggleDone}
              onPrevious={() => go(steps[index - 1]!.id)}
              onNext={() => go(steps[index + 1]!.id)}
            />
          ) : (
            <Complete
              threadId={guide.threadId}
              focusTitle={moved}
              onReview={() => go(steps[0]!.id)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function GuideViewer({ guideId }: { guideId: string }) {
  const query = useQuery({
    queryKey: guideKey.detail(guideId),
    queryFn: ({ signal }) => getGuide(guideId, signal),
    staleTime: SEEDED_STALE_MS,
    select: (response) => response.guide
  })

  usePageTitle(query.data?.title)

  if (query.isPending) return <GuideSkeleton />

  if (!query.data) {
    const missing = isApiError(query.error) && query.error.code === 'not_found'
    return (
      <Sheet>
        <EmptyState
          icon={missing ? GuideIcon : RetryIcon}
          action={
            missing ? (
              <Link href="/thread" className={buttonClass({ variant: 'secondary' })}>
                Back to threads
              </Link>
            ) : (
              <Button variant="secondary" onClick={() => query.refetch()}>
                Retry
              </Button>
            )
          }
        >
          {missing ? "This guide doesn't exist or was deleted." : describeError(query.error)}
        </EmptyState>
      </Sheet>
    )
  }

  return <Viewer key={query.data.id} guide={query.data} />
}
