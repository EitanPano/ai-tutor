'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Markdown } from '@/component/markdown/markdown'
import { buttonClass } from '@/component/ui/button'
import { Sheet } from '@/component/ui/sheet'
import { getAttempt, getQuiz, quizKey, type Attempt, type GradedItem } from '@/lib/api/quiz'
import { BackIcon, DoneIcon, RetryIcon, WrongIcon } from '@/lib/icon'
import { difficultyLabel } from '@/lib/quiz'
import { useTopics } from '@/lib/topic'
import { QuizSkeleton } from './quiz-skeleton'
import { QuizMissing } from './quiz-state'

function Choice({ text, index, item }: { text: string; index: number; item: GradedItem }) {
  const isAnswer = index === item.answerIndex
  const isPick = index === item.choiceIndex
  const wrongPick = isPick && !isAnswer

  const frame = isAnswer ? 'border-correct' : wrongPick ? 'border-wrong' : 'border-rule'

  return (
    <li className={`flex items-start gap-3 rounded-md border px-4 py-3 ${frame}`}>
      <span className="mt-1 grid size-4 shrink-0 place-items-center">
        {isAnswer ? (
          <DoneIcon aria-hidden="true" className="size-4 text-correct" strokeWidth={3} />
        ) : wrongPick ? (
          <WrongIcon aria-hidden="true" className="size-4 text-wrong" strokeWidth={3} />
        ) : (
          <span aria-hidden="true" className="size-2 rounded-full bg-rule" />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <Markdown
          inline
          className={`break-words ${
            isAnswer
              ? 'marker rounded-sm px-1 [--tw-prose-body:var(--marker-ink)] [--tw-prose-code:var(--marker-ink)] [--tw-prose-bold:var(--marker-ink)]'
              : wrongPick
                ? 'text-wrong line-through decoration-wrong decoration-2'
                : ''
          }`}
        >
          {text}
        </Markdown>
        {(isAnswer || isPick) && (
          <p className="flex flex-wrap gap-x-3 text-sm font-semibold">
            {isPick && (
              <span className={isAnswer ? 'text-correct' : 'text-wrong'}>Your answer</span>
            )}
            {isAnswer && <span className="text-correct">Correct answer</span>}
          </p>
        )}
      </div>
    </li>
  )
}

function ReviewItem({ item, number }: { item: GradedItem; number: number }) {
  return (
    <li className="flex gap-4 py-6 first:pt-0 last:pb-0">
      <span
        aria-hidden="true"
        className="w-6 shrink-0 pt-0.5 text-lead font-extrabold text-ink-muted tabular-nums"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p
          className={`flex items-center gap-1.5 text-sm font-semibold ${
            item.isCorrect ? 'text-correct' : 'text-wrong'
          }`}
        >
          {item.isCorrect ? (
            <DoneIcon aria-hidden="true" className="size-4" strokeWidth={3} />
          ) : (
            <WrongIcon aria-hidden="true" className="size-4" strokeWidth={3} />
          )}
          {item.isCorrect ? 'Correct' : 'Incorrect'}
        </p>
        <p className="text-lead font-semibold">
          <Markdown inline>{item.prompt}</Markdown>
        </p>
        <ul aria-label="Choices" className="flex flex-col gap-2">
          {item.choices.map((choice, index) => (
            <Choice key={index} text={choice} index={index} item={item} />
          ))}
        </ul>
        <div className="max-w-[72ch] border-l-4 border-rule pl-4">
          <p className="text-sm font-semibold text-ink-muted">Explanation</p>
          <Markdown className="[&>:first-child]:mt-1 [&>:last-child]:mb-0">
            {item.explanation}
          </Markdown>
        </div>
      </div>
    </li>
  )
}

function Review({
  attempt,
  threadId,
  eyebrow
}: {
  attempt: Attempt
  threadId: string | null | undefined
  eyebrow: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        {eyebrow && <p className="text-sm font-semibold text-ink-muted">{eyebrow}</p>}
        <h1 ref={heading} tabIndex={-1} className="text-display break-words">
          <span className="marker rounded-sm px-2">{attempt.score}</span> of {attempt.total} correct
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/quiz/${encodeURIComponent(attempt.quizId)}`}
            className={buttonClass({ variant: 'primary' })}
          >
            <RetryIcon aria-hidden="true" className="size-4" />
            Retake quiz
          </Link>
          {threadId && (
            <Link
              href={`/thread/${encodeURIComponent(threadId)}`}
              className={buttonClass({ variant: 'secondary' })}
            >
              <BackIcon aria-hidden="true" className="size-4" />
              Back to the conversation
            </Link>
          )}
        </div>
      </header>

      <Sheet className="p-5 md:p-8">
        <ol className="flex flex-col divide-y divide-rule">
          {attempt.items.map((item, index) => (
            <ReviewItem key={item.itemId} item={item} number={index + 1} />
          ))}
        </ol>
      </Sheet>
    </div>
  )
}

export function AttemptView({ quizId, attemptId }: { quizId: string; attemptId: string }) {
  const attempt = useQuery({
    queryKey: quizKey.attempt(quizId, attemptId),
    queryFn: ({ signal }) => getAttempt(quizId, attemptId, signal),
    // A submitted attempt never changes.
    staleTime: Infinity,
    select: (response) => response.attempt
  })
  // Only the thread link and the title need the quiz: the review itself never waits for it.
  const quiz = useQuery({
    queryKey: quizKey.detail(quizId),
    queryFn: ({ signal }) => getQuiz(quizId, signal),
    select: (response) => response.quiz
  })
  const topics = useTopics()

  if (attempt.isPending) return <QuizSkeleton />
  if (!attempt.data) {
    return <QuizMissing error={attempt.error} onRetry={() => attempt.refetch()} />
  }

  const topic = topics.data?.find((t) => t.id === quiz.data?.topicId)
  const eyebrow = quiz.data
    ? `${difficultyLabel(quiz.data.difficulty)} quiz${topic ? ` on ${topic.name}` : ''}`
    : ''

  return <Review attempt={attempt.data} threadId={quiz.data?.threadId} eyebrow={eyebrow} />
}
