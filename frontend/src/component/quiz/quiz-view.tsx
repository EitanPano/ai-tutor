'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Markdown } from '@/component/markdown/markdown'
import { BackLink } from '@/component/ui/back-link'
import { Button } from '@/component/ui/button'
import { Sheet } from '@/component/ui/sheet'
import { SEEDED_STALE_MS } from '@/lib/api/client'
import { getQuiz, quizKey, submitAttempt, type Quiz, type QuizItem } from '@/lib/api/quiz'
import { threadKey } from '@/lib/api/thread'
import { ProgressIcon } from '@/lib/icon'
import { difficultyLabel, shortDate } from '@/lib/quiz'
import { usePageTitle } from '@/lib/page-title'
import { useTopics } from '@/lib/topic'
import { describeQuizError } from './quiz-error'
import { QuizSkeleton } from './quiz-skeleton'
import { QuizMissing } from './quiz-state'

type ItemFieldProps = {
  item: QuizItem
  value: number | undefined
  onSelect: (itemId: string, choiceIndex: number) => void
}

/** One item: the prompt is the legend, the four choices are radios in one group. */
const ItemField = memo(function ItemField({ item, value, onSelect }: ItemFieldProps) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 max-w-full p-0 text-lead font-semibold">
        <Markdown isInline>{item.prompt}</Markdown>
      </legend>
      <div className="flex flex-col gap-2">
        {item.choices.map((choice, index) => (
          <label
            key={index}
            className="relative flex cursor-pointer items-start gap-3 rounded-md border border-rule bg-sheet px-4 py-3 transition-colors hover:border-ink-muted has-checked:border-ink has-checked:bg-ink/5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-pen"
          >
            <input
              type="radio"
              name={item.id}
              checked={value === index}
              onChange={() => onSelect(item.id, index)}
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden="true"
              className="mt-1.5 grid size-4 shrink-0 place-items-center rounded-full border-2 border-ink-muted after:size-2 after:scale-0 after:rounded-full after:bg-ink after:transition-transform peer-checked:border-ink peer-checked:after:scale-100"
            />
            <Markdown isInline className="min-w-0 break-words">
              {choice}
            </Markdown>
          </label>
        ))}
      </div>
    </fieldset>
  )
})

function Header({ quiz }: { quiz: Quiz }) {
  const topics = useTopics()
  const topic = topics.data?.find((t) => t.id === quiz.topicId)
  usePageTitle(`${difficultyLabel(quiz.difficulty)} quiz${topic ? ` on ${topic.name}` : ''}`)
  return (
    <header className="flex flex-col gap-4">
      {quiz.threadId ? (
        <BackLink href={`/thread/${encodeURIComponent(quiz.threadId)}`}>
          Back to the conversation
        </BackLink>
      ) : (
        <BackLink href="/progress" icon={ProgressIcon}>
          Back to progress
        </BackLink>
      )}
      <h1 className="text-title break-words">
        {difficultyLabel(quiz.difficulty)} quiz
        {topic && (
          <>
            {' on '}
            <span className="marker rounded-sm px-1">{topic.name}</span>
          </>
        )}
      </h1>
      {quiz.attempts.length > 0 && (
        <section aria-labelledby="past-attempts" className="flex flex-col gap-1">
          <h2 id="past-attempts" className="text-sm font-semibold text-ink-muted">
            Past attempts
          </h2>
          <ul className="flex flex-col gap-1">
            {quiz.attempts.map((attempt) => (
              <li key={attempt.id}>
                <Link
                  href={`/quiz/${encodeURIComponent(quiz.id)}/attempt/${encodeURIComponent(attempt.id)}`}
                  className="text-sm font-semibold"
                >
                  Attempt on {shortDate(attempt.submittedAt)}: {attempt.score} of {attempt.total}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </header>
  )
}

function Taker({ quiz }: { quiz: Quiz }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const submitButton = useRef<HTMLButtonElement>(null)

  const total = quiz.items.length
  const answeredCount = quiz.items.filter((item) => answers[item.id] !== undefined).length
  const isReady = answeredCount === total

  const select = useCallback(
    (itemId: string, choiceIndex: number) => setAnswers((a) => ({ ...a, [itemId]: choiceIndex })),
    []
  )

  const submit = useMutation({
    mutationFn: () =>
      submitAttempt(
        quiz.id,
        quiz.items.map((item) => ({ itemId: item.id, choiceIndex: answers[item.id]! }))
      ),
    onSuccess: ({ attempt }) => {
      queryClient.setQueryData(quizKey.attempt(quiz.id, attempt.id), { attempt })
      // The attempt list here and the best score on the thread both changed.
      void queryClient.invalidateQueries({ queryKey: quizKey.detail(quiz.id) })
      if (quiz.threadId) {
        void queryClient.invalidateQueries({ queryKey: threadKey.detail(quiz.threadId) })
      }
      router.push(`/quiz/${encodeURIComponent(quiz.id)}/attempt/${encodeURIComponent(attempt.id)}`)
    },
    onError: (err) => {
      toast.error(describeQuizError(err))
    }
  })

  // The button was disabled while saving, which drops focus: put it back where the reader was.
  useEffect(() => {
    if (submit.isError) submitButton.current?.focus()
  }, [submit.isError])

  // A success stays busy too: router.push only starts the navigation, the old page lingers.
  const isSubmitting = submit.isPending || submit.isSuccess

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isReady && !isSubmitting) submit.mutate()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Sheet className="p-5 md:p-8">
        <ol className="flex flex-col divide-y divide-rule">
          {quiz.items.map((item, index) => (
            <li key={item.id} className="flex gap-4 py-6 first:pt-0 last:pb-0">
              <span
                aria-hidden="true"
                className="w-6 shrink-0 pt-0.5 text-lead font-extrabold text-ink-muted tabular-nums"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <ItemField item={item} value={answers[item.id]} onSelect={select} />
              </div>
            </li>
          ))}
        </ol>
      </Sheet>

      {/* Solid canvas behind the footer so item text never shows around it. */}
      <div className="sticky bottom-0 z-10 -mx-2 bg-canvas px-2 pt-2 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-canvas before:to-transparent">
        <Sheet className="flex flex-wrap items-center justify-between gap-3 p-4 shadow-lg shadow-ink/10">
          <p id="quiz-progress" role="status" className="font-semibold">
            {answeredCount} of {total} answered
          </p>
          <Button
            ref={submitButton}
            type="submit"
            isLoading={isSubmitting}
            disabled={!isReady}
            aria-describedby="quiz-progress"
          >
            {isSubmitting ? 'Grading…' : 'Submit answers'}
          </Button>
        </Sheet>
      </div>
    </form>
  )
}

export function QuizView({ quizId }: { quizId: string }) {
  const query = useQuery({
    queryKey: quizKey.detail(quizId),
    queryFn: ({ signal }) => getQuiz(quizId, signal),
    staleTime: SEEDED_STALE_MS,
    select: (response) => response.quiz
  })

  if (query.isPending) return <QuizSkeleton />
  if (!query.data) return <QuizMissing error={query.error} onRetry={() => query.refetch()} />

  const quiz = query.data
  return (
    <div className="flex flex-col gap-6">
      <Header quiz={quiz} />
      {/* Keyed so a refetch never resets half-answered items, but another quiz starts fresh. */}
      <Taker key={quiz.id} quiz={quiz} />
    </div>
  )
}
