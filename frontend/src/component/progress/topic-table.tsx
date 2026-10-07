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

type Cell = { label: string; children: ReactNode; numeric?: boolean; hideStacked?: boolean }

/** A cell that names itself above `xl`, where the table collapses into one card per topic. */
function Td({ label, children, numeric = false, hideStacked = false }: Cell) {
  return (
    <td
      data-label={label}
      className={`flex items-baseline justify-between gap-4 py-1 before:text-sm before:text-ink-muted before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-3 xl:align-middle xl:before:hidden ${
        numeric ? 'tabular-nums xl:text-right' : 'xl:whitespace-nowrap'
      } ${hideStacked ? 'max-xl:hidden' : ''}`}
    >
      {children}
    </td>
  )
}

type QuizMeProps = {
  topic: TopicProgress
  /** Another quiz is being written, so every button waits. */
  busy: boolean
  /** This topic's quiz is the one being written. */
  loading: boolean
  onCreate: (topicId: string, difficulty: Difficulty) => void
}

function QuizMe({ topic, busy, loading, onCreate }: QuizMeProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY)
  return (
    <div role="group" aria-label={`Quiz on ${topic.topicName}`} className="flex items-center gap-2">
      <Select
        label={`Difficulty for the ${topic.topicName} quiz`}
        hideLabel
        value={difficulty}
        disabled={busy}
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
        loading={loading}
        disabled={busy}
        aria-label={
          loading ? `Writing your ${topic.topicName} quiz` : `Quiz me on ${topic.topicName}`
        }
        onClick={() => onCreate(topic.topicId, difficulty)}
      >
        {!loading && <QuizIcon aria-hidden="true" className="size-4" />}
        {loading ? 'Writing…' : 'Quiz me'}
      </Button>
    </div>
  )
}

const rowClass =
  'flex flex-col gap-1 border-t border-rule px-4 py-4 first:border-t-0 xl:table-row xl:px-0 xl:py-0'

type RowProps = { topic: TopicProgress; muted?: boolean } & Omit<QuizMeProps, 'topic'>

function TopicRow({ topic, muted = false, ...quiz }: RowProps) {
  return (
    <tr className={`${rowClass} ${muted ? 'text-ink-muted' : ''}`.trim()}>
      <th
        scope="row"
        className="pb-1 text-left text-base font-semibold xl:table-cell xl:px-3 xl:py-3 xl:pb-3"
      >
        {topic.topicName}
      </th>
      <Td label="Questions" numeric hideStacked={muted}>
        {topic.questions}
      </Td>
      <Td label="Steps done" numeric hideStacked={muted}>
        {topic.stepsDone}
      </Td>
      <Td label="Guides completed" numeric hideStacked={muted}>
        {topic.guidesCompleted}
      </Td>
      <Td label="Quiz attempts" numeric hideStacked={muted}>
        {topic.attempts}
      </Td>
      <Td label="Best score" numeric hideStacked={muted}>
        {percent(topic.bestScorePercent)}
      </Td>
      <Td label="Topic score" numeric hideStacked={muted}>
        {percent(topic.averageScorePercent)}
      </Td>
      <Td label="Last activity" hideStacked={muted}>
        {topic.lastActivityAt ? (
          <time dateTime={topic.lastActivityAt}>{relativeTime(topic.lastActivityAt)}</time>
        ) : (
          <span role="img" aria-label="no activity yet">
            —
          </span>
        )}
      </Td>
      <td className="pt-2 xl:table-cell xl:px-3 xl:py-3">
        <QuizMe topic={topic} {...quiz} />
      </td>
    </tr>
  )
}

const headClass = 'px-3 py-3 text-sm font-semibold'

export function TopicTable({ topics }: { topics: TopicProgress[] }) {
  const headingId = useId()
  const quiz = useCreateQuiz()
  const [target, setTarget] = useState<string | null>(null)
  const { started, notStarted } = splitTopics([...topics])

  const rowProps = (topic: TopicProgress) => ({
    busy: quiz.isPending,
    loading: quiz.isPending && target === topic.topicId,
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
        <table className="block w-full border-collapse xl:table">
          <thead className="max-xl:sr-only">
            <tr className="border-b border-rule text-left xl:table-row">
              <th scope="col" className={headClass}>
                Topic
              </th>
              <th scope="col" className={`${headClass} text-right`}>
                Questions
              </th>
              <th scope="col" className={`${headClass} text-right`}>
                Steps done
              </th>
              <th scope="col" className={`${headClass} text-right`}>
                Guides completed
              </th>
              <th scope="col" className={`${headClass} text-right`}>
                Quiz attempts
              </th>
              <th scope="col" className={`${headClass} text-right`}>
                Best score
              </th>
              <th
                scope="col"
                title="Average of each quiz's best attempt"
                className={`${headClass} text-right`}
              >
                Topic score
              </th>
              <th scope="col" className={headClass}>
                Last activity
              </th>
              <th scope="col" className={headClass}>
                <span className="sr-only">Quiz</span>
              </th>
            </tr>
          </thead>
          {started.length > 0 && (
            <tbody className="block xl:table-row-group">
              {started.map((topic) => (
                <TopicRow key={topic.topicId} topic={topic} {...rowProps(topic)} />
              ))}
            </tbody>
          )}
          {notStarted.length > 0 && (
            <tbody className="block xl:table-row-group">
              <tr className="block border-t border-rule bg-canvas/60 xl:table-row">
                <th
                  scope="colgroup"
                  colSpan={9}
                  className="block px-4 py-2 text-left text-sm font-semibold text-ink-muted xl:table-cell xl:px-3"
                >
                  Not started yet
                </th>
              </tr>
              {notStarted.map((topic) => (
                <TopicRow key={topic.topicId} topic={topic} muted {...rowProps(topic)} />
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
