'use client'

import { useId, useState, type ReactNode } from 'react'
import { useCreateQuiz } from '@/component/quiz/use-create-quiz'
import { Button } from '@/component/ui/button'
import { Select } from '@/component/ui/select'
import { Sheet } from '@/component/ui/sheet'
import type { Difficulty } from '@/lib/api/quiz'
import type { TopicProgress } from '@/lib/api/progress'
import { QuizIcon } from '@/lib/icon'
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '@/lib/quiz'
import { relativeTime } from '@/lib/relative-time'

/** Topics with activity first, newest first; the rest keep taxonomy order. */
export function splitTopics(topics: TopicProgress[]) {
  const started = topics
    .filter((t) => t.lastActivityAt !== null)
    .sort((a, b) => Date.parse(b.lastActivityAt!) - Date.parse(a.lastActivityAt!))
  const notStarted = topics.filter((t) => t.lastActivityAt === null)
  return { started, notStarted }
}

const percent = (value: number | null) =>
  value === null ? (
    <span role="img" aria-label="no score yet">
      —
    </span>
  ) : (
    `${Math.round(value)}%`
  )

type Cell = {
  label: string
  children: ReactNode
  isNumeric?: boolean
  shouldHideWhenStacked?: boolean
}

/** A cell that names itself above `xl`, where the table collapses into one card per topic. */
function Td({ label, children, isNumeric = false, shouldHideWhenStacked = false }: Cell) {
  return (
    <td
      role="cell"
      className={`flex items-baseline justify-between gap-4 py-1 xl:table-cell xl:px-3 xl:py-3 xl:align-middle ${
        isNumeric ? 'tabular-nums xl:text-right' : 'xl:whitespace-nowrap'
      } ${shouldHideWhenStacked ? 'max-xl:hidden' : ''}`}
    >
      {/* Real text, so the label is announced when the header row is hidden by the stacked layout. */}
      <span className="text-sm font-normal text-ink-muted xl:hidden">{label}</span>
      <span>{children}</span>
    </td>
  )
}

type QuizMeProps = {
  topic: TopicProgress
  /** Another quiz is being written, so every button waits. */
  isBusy: boolean
  /** This topic's quiz is the one being written. */
  isLoading: boolean
  onCreate: (topicId: string, difficulty: Difficulty) => void
}

function QuizMe({ topic, isBusy, isLoading, onCreate }: QuizMeProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY)
  return (
    <div role="group" aria-label={`Quiz on ${topic.topicName}`} className="flex items-center gap-2">
      <Select
        label={`Difficulty for the ${topic.topicName} quiz`}
        isLabelHidden
        value={difficulty}
        disabled={isBusy}
        className="h-8! px-2 text-sm"
        onChange={(e) => setDifficulty(e.target.value as Difficulty)}
      >
        {DIFFICULTIES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="sm"
        isLoading={isLoading}
        disabled={isBusy}
        aria-label={
          isLoading ? `Writing your ${topic.topicName} quiz` : `Quiz me on ${topic.topicName}`
        }
        onClick={() => onCreate(topic.topicId, difficulty)}
      >
        {!isLoading && <QuizIcon aria-hidden="true" className="size-4" />}
        {isLoading ? 'Writing…' : 'Quiz me'}
      </Button>
    </div>
  )
}

const rowClass =
  'flex flex-col gap-1 border-t border-rule px-4 py-4 first:border-t-0 xl:table-row xl:px-0 xl:py-0'

type RowProps = { topic: TopicProgress; isMuted?: boolean } & Omit<QuizMeProps, 'topic'>

function TopicRow({ topic, isMuted = false, ...quiz }: RowProps) {
  return (
    <tr role="row" className={`${rowClass} ${isMuted ? 'text-ink-muted' : ''}`.trim()}>
      <th
        scope="row"
        role="rowheader"
        className="pb-1 text-left text-base font-semibold xl:table-cell xl:px-3 xl:py-3 xl:pb-3"
      >
        {topic.topicName}
      </th>
      <Td label="Questions" isNumeric shouldHideWhenStacked={isMuted}>
        {topic.questions}
      </Td>
      <Td label="Steps done" isNumeric shouldHideWhenStacked={isMuted}>
        {topic.stepsDone}
      </Td>
      <Td label="Guides completed" isNumeric shouldHideWhenStacked={isMuted}>
        {topic.guidesCompleted}
      </Td>
      <Td label="Quiz attempts" isNumeric shouldHideWhenStacked={isMuted}>
        {topic.attempts}
      </Td>
      <Td label="Best score" isNumeric shouldHideWhenStacked={isMuted}>
        {percent(topic.bestScorePercent)}
      </Td>
      <Td label="Topic score" isNumeric shouldHideWhenStacked={isMuted}>
        {percent(topic.averageScorePercent)}
      </Td>
      <Td label="Last activity" shouldHideWhenStacked={isMuted}>
        {topic.lastActivityAt ? (
          <time dateTime={topic.lastActivityAt}>{relativeTime(topic.lastActivityAt)}</time>
        ) : (
          <span role="img" aria-label="no activity yet">
            —
          </span>
        )}
      </Td>
      <td role="cell" className="pt-2 xl:table-cell xl:px-3 xl:py-3">
        <QuizMe topic={topic} {...quiz} />
      </td>
    </tr>
  )
}

const headClass = 'px-3 py-3 text-sm font-semibold'

export function TopicTable({ topics }: { topics: TopicProgress[] }) {
  const headingId = useId()
  const notStartedId = useId()
  const quiz = useCreateQuiz()
  const [target, setTarget] = useState<string | null>(null)
  const { started, notStarted } = splitTopics([...topics])

  const rowProps = (topic: TopicProgress) => ({
    isBusy: quiz.isPending,
    isLoading: quiz.isPending && target === topic.topicId,
    onCreate: (topicId: string, difficulty: Difficulty) => {
      setTarget(topicId)
      quiz.create({ topicId, difficulty })
    }
  })

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lead">
        Topics
      </h2>
      <Sheet className="overflow-hidden">
        <table
          role="table"
          aria-labelledby={headingId}
          className="block w-full border-collapse xl:table"
        >
          <thead role="rowgroup" className="max-xl:sr-only">
            <tr role="row" className="border-b border-rule text-left xl:table-row">
              <th scope="col" role="columnheader" className={headClass}>
                Topic
              </th>
              <th scope="col" role="columnheader" className={`${headClass} text-right`}>
                Questions
              </th>
              <th scope="col" role="columnheader" className={`${headClass} text-right`}>
                Steps done
              </th>
              <th scope="col" role="columnheader" className={`${headClass} text-right`}>
                Guides completed
              </th>
              <th scope="col" role="columnheader" className={`${headClass} text-right`}>
                Quiz attempts
              </th>
              <th scope="col" role="columnheader" className={`${headClass} text-right`}>
                Best score
              </th>
              <th
                scope="col"
                role="columnheader"
                title="Average of each quiz's best attempt"
                className={`${headClass} text-right`}
              >
                Topic score
              </th>
              <th scope="col" role="columnheader" className={headClass}>
                Last activity
              </th>
              <th scope="col" role="columnheader" className={headClass}>
                <span className="sr-only">Quiz</span>
              </th>
            </tr>
          </thead>
          {started.length > 0 && (
            <tbody role="rowgroup" className="block xl:table-row-group">
              {started.map((topic) => (
                <TopicRow key={topic.topicId} topic={topic} {...rowProps(topic)} />
              ))}
            </tbody>
          )}
          {notStarted.length > 0 && (
            <tbody
              role="rowgroup"
              aria-labelledby={notStartedId}
              className="block xl:table-row-group"
            >
              <tr role="row" className="block border-t border-rule bg-canvas/60 xl:table-row">
                <td
                  role="cell"
                  id={notStartedId}
                  colSpan={9}
                  className="block px-4 py-2 text-left text-sm font-semibold text-ink-muted xl:table-cell xl:px-3"
                >
                  Not started yet
                </td>
              </tr>
              {notStarted.map((topic) => (
                <TopicRow key={topic.topicId} topic={topic} isMuted {...rowProps(topic)} />
              ))}
            </tbody>
          )}
        </table>
      </Sheet>
      <p className="text-sm text-ink-muted">
        Topic score is the average of each quiz&apos;s best attempt.
      </p>
    </section>
  )
}
