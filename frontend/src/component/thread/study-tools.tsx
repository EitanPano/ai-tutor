'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, useState } from 'react'
import { useCreateQuiz } from '@/component/quiz/use-create-quiz'
import { Button } from '@/component/ui/button'
import { Select } from '@/component/ui/select'
import { createGuide, guideKey, type GuideSummary } from '@/lib/api/guide'
import type { Difficulty, QuizSummary } from '@/lib/api/quiz'
import { threadKey } from '@/lib/api/thread'
import { GuideIcon, QuizIcon } from '@/lib/icon'
import { DEFAULT_DIFFICULTY, DIFFICULTIES, difficultyLabel } from '@/lib/quiz'
import { useRetryToast } from '@/lib/retry-toast'

type StudyToolsProps = {
  threadId: string
  /** The thread has at least one complete tutor answer to build a guide or quiz from. */
  hasAnswer: boolean
  /** An answer is being written right now; a guide or quiz must wait for it. */
  busy: boolean
  /** Newest first. */
  guides: GuideSummary[]
  /** Newest first. */
  quizzes: QuizSummary[]
}

const quizLabel = ({ difficulty, bestScore, itemCount }: QuizSummary) =>
  `${difficultyLabel(difficulty)} quiz, ${
    bestScore === null ? 'not taken yet' : `best ${bestScore} of ${itemCount}`
  }`

/**
 * The study-tools toolbar of a conversation: a guide, a quiz, and the ones already made.
 * Memoised on purpose: its props only change when the thread's answers, guides or quizzes do,
 * so typing in the composer never re-renders it.
 */
export const StudyTools = memo(function StudyTools({
  threadId,
  hasAnswer,
  busy,
  guides,
  quizzes
}: StudyToolsProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const showError = useRetryToast('generate')
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY)
  const quiz = useCreateQuiz()

  const create = useMutation({
    mutationFn: () => createGuide(threadId),
    onSuccess: ({ guide }) => {
      void queryClient.invalidateQueries({ queryKey: threadKey.detail(threadId) })
      queryClient.setQueryData(guideKey.detail(guide.id), { guide })
      router.push(`/guide/${encodeURIComponent(guide.id)}`)
    },
    onError: (err) => showError(err, () => create.mutate())
  })

  const reason = !hasAnswer ? 'Ask a question first' : busy ? 'Wait for the answer to finish' : ''
  const disabled = !!reason
  // One thing is written at a time: two generations would only race each other.
  // A success stays busy too: router.push only starts the navigation, the old page lingers.
  const guiding = create.isPending || create.isSuccess
  const working = guiding || quiz.isPending
  const describedBy = disabled ? 'study-reason' : undefined

  return (
    <div className="flex flex-col gap-3">
      <div role="toolbar" aria-label="Study tools" className="flex flex-wrap items-center gap-3">
        <Button
          loading={guiding}
          disabled={disabled || quiz.isPending}
          aria-describedby={describedBy}
          onClick={() => create.mutate()}
        >
          {!guiding && <GuideIcon aria-hidden="true" className="size-4" />}
          {guiding ? 'Writing your guide…' : 'Guide me step by step'}
        </Button>
        <div role="group" aria-label="Quiz" className="flex items-center gap-2">
          <Button
            variant="secondary"
            loading={quiz.isPending}
            disabled={disabled || guiding}
            aria-describedby={describedBy}
            onClick={() => quiz.create({ threadId, difficulty })}
          >
            {!quiz.isPending && <QuizIcon aria-hidden="true" className="size-4" />}
            {quiz.isPending ? 'Writing your quiz…' : 'Quiz me'}
          </Button>
          <Select
            label="Quiz difficulty"
            hideLabel
            value={difficulty}
            disabled={working}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
          >
            {DIFFICULTIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {disabled && (
          <p id="study-reason" className="text-sm text-ink-muted">
            {reason}
          </p>
        )}
      </div>
      {guides.length > 0 && (
        <ul aria-label="Guides for this thread" className="flex flex-col gap-1">
          {guides.map((guide) => (
            <li key={guide.id}>
              <Link
                href={`/guide/${encodeURIComponent(guide.id)}`}
                className="inline-flex max-w-full items-center gap-2 text-sm font-semibold"
              >
                <GuideIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 truncate">
                  Open guide: {guide.title} ({guide.doneCount} of {guide.stepCount} done)
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {quizzes.length > 0 && (
        <ul aria-label="Quizzes for this thread" className="flex flex-col gap-1">
          {quizzes.map((item) => (
            <li key={item.id}>
              <Link
                href={`/quiz/${encodeURIComponent(item.id)}`}
                className="inline-flex max-w-full items-center gap-2 text-sm font-semibold"
              >
                <QuizIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 truncate">{quizLabel(item)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
